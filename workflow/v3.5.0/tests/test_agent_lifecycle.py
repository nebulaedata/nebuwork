import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import time

import pytest

from nebulae.api import create_app
from nebulae.client import Client
from nebulae.engine import Engine
from nebulae.agent_runtime import DEFAULTS
from agent_model import model_server
from test_agent import configure, runtime, serve, wait
from wheels import wheel


def results(body):
    return [json.loads(m['content']) for m in body['messages'] if m['role'] == 'tool']


def test_pi_independent_environment_and_offline_package(tmp_path, runtime):
    app = create_app(tmp_path)
    service = app.state.agent_service
    flow = app.state.engine.catalog.create('isolated')
    root = app.state.engine.catalog.directory('isolated')
    package = wheel(root, '3.0')
    (root / 'requirements.txt').write_text('--no-index\n./' + package + '\n')
    (root / 'main.py').write_text("def run(ctx):\n    import nebulae_env_fixture\n    ctx.task.save_text('version', nebulae_env_fixture.VERSION)\n")
    def responder(body):
        r = results(body); n = len(r)
        if n == 0: return 'environment_get', {'workflow_id': 'isolated'}
        if n == 1: return 'environment_operate', {'workflow_id': 'isolated', 'kind': 'create', 'expected_version': r[-1]['version'], 'command_id': 'create'}
        if n == 2: return 'environment_wait', {'operation_id': r[-1]['id'], 'seconds': 30}
        if n == 3: return 'environment_get', {'workflow_id': 'isolated'}
        if n == 4: return 'environment_operate', {'workflow_id': 'isolated', 'kind': 'install', 'expected_version': r[-1]['version'], 'command_id': 'install', 'requirements': True}
        if n == 5: return 'environment_wait', {'operation_id': r[-1]['id'], 'seconds': 30}
        if n == 6: return 'environment_get', {'workflow_id': 'isolated'}
        if n == 7: return 'environment_select', {'workflow_id': 'isolated', 'mode': 'isolated', 'expected_revision': r[-1]['workflow_revision']}
        if n == 8: return 'task_create', {'workflow_id': 'isolated', 'command_id': 'task'}
        if n == 9: return 'task_control', {'task_id': r[-1]['id'], 'expected_version': r[-1]['version'], 'command_id': 'start', 'action': 'start'}
        if n == 10: return 'task_wait', {'task_id': r[-1]['id'], 'seconds': 15}
        return '独立环境执行完毕'
    with model_server(responder) as (model, _), serve(app) as url:
        configure(service, model)
        s = service.create_session('isolated', '依赖调试', False, 'session')
        service.submit(s['id'], '创建专属环境并安装 requirements，然后选择独立环境运行一次', 0, 'run', url)
        done = wait(service, s['id'])
        assert done['state'] == 'succeeded', done['rounds']
        assert all(c['state'] == 'succeeded' for c in done['calls']), done['calls']
        task = app.state.engine.status(app.state.engine.tasks()[0]['id'])
        assert task['state'] == 'succeeded'
        assert task['steps'][0]['history'][0]['environment']['mode'] == 'isolated'


def test_large_results_are_paged_and_version_conflicts_not_overwritten(tmp_path, runtime):
    app = create_app(tmp_path)
    service, engine = app.state.agent_service, app.state.engine
    engine.catalog.create('large')
    source = 'text = ' + repr('x' * 65000)
    engine.catalog.save('large', 'large.py', source, None)
    def responder(body):
        r = results(body)
        if not r: return 'source_read', {'workflow_id': 'large', 'path': 'large.py'}
        if len(r) == 1:
            assert r[-1]['truncated']
            return 'tool_result_read', {'round_id': r[-1]['round_id'], 'call_id': r[-1]['call_id'], 'offset': 20000, 'limit': 20000}
        return '完整结果保留，分段读取成功'
    with model_server(responder) as (model, _), serve(app) as url:
        configure(service, model)
        s = service.create_session('large', '大结果', False, 'session')
        service.submit(s['id'], '读取代码', 0, 'run', url)
        done = wait(service, s['id'])
        assert done['state'] == 'succeeded'
        assert done['calls'][0]['result']['result']['content'] == source
        assert len(done['calls'][1]['result']['result']['text']) == 20000


def test_context_compaction_preserves_ui_history(tmp_path, runtime):
    app = create_app(tmp_path)
    service = app.state.agent_service
    app.state.engine.catalog.create('long-chat')
    def responder(body):
        # The Pi summarizer deliberately has no tools; both paths use the actual SDK.
        return '工作流上下文摘要：用户希望构建文本处理流程。' if not body.get('tools') else '已记录这些需求。'
    with model_server(responder) as (model, requests), serve(app) as url:
        values = {k: v for k, v in DEFAULTS.items() if k != 'version'}
        values.update(base_url=model, model='fixture', context_window=8192, max_tokens=1024)
        service.configure(values, '', 0, 'config')
        s = service.create_session('long-chat', '长对话', False, 'new')
        for i in range(3):
            service.submit(s['id'], ('处理中文文本并保存命名产物。' * 1100) + str(i), s['version'], 'round-' + str(i), url)
            s = wait(service, s['id'])
            assert s['state'] == 'succeeded', s['rounds']
        events = service.events(s['id'])
        assert len([e for e in events if e['kind'] == 'user.message']) == 3
        assert any(e['kind'] == 'pi.compaction_end' for e in events)
        assert any(not r.get('tools') for r in requests)


def alive(pid):
    if os.name == 'nt':
        import ctypes
        api = ctypes.WinDLL('kernel32', use_last_error=True)
        api.OpenProcess.restype = ctypes.c_void_p
        handle = api.OpenProcess(0x1000, False, pid)
        if not handle: return False
        code = ctypes.c_ulong()
        api.GetExitCodeProcess(ctypes.c_void_p(handle), ctypes.byref(code))
        api.CloseHandle(ctypes.c_void_p(handle))
        return code.value == 259
    try:
        os.kill(pid, 0)
        # A reparented zombie has stopped executing and holds no resources.
        stat = Path(f'/proc/{pid}/stat')
        return not (stat.exists() and stat.read_text().split(') ', 1)[1].startswith('Z'))
    except ProcessLookupError: return False


def test_parent_crash_leaves_no_agent_and_restart_never_resumes(tmp_path, runtime):
    def delayed(_):
        time.sleep(4)
        return 'slow'
    listener = socket.socket(); listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]; listener.close()
    client = Client(f'http://127.0.0.1:{port}')
    command = [sys.executable, '-m', 'nebulae', '--project', str(tmp_path), 'serve', '--port', str(port)]
    process = None
    with model_server(delayed) as (url, requests):
        log = (tmp_path / 'test-server.log').open('wb')
        def start():
            p = subprocess.Popen(command, stdout=log, stderr=log, env=os.environ.copy())
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                try:
                    if client.request('/health')['scheduler']: return p
                except Exception: time.sleep(.05)
            p.kill(); p.wait(); pytest.fail('Test service failed to start')
        try:
            process = start()
            config = {k: v for k, v in DEFAULTS.items() if k != 'version'}
            config.update(base_url=url, model='fixture', expected_version=0, command_id='settings', api_key='')
            client.request('/agent/settings', 'PUT', config)
            s = client.request('/agent/sessions', 'POST', {'workflow_id': 'crash', 'new_workflow': True, 'title': '崩溃恢复', 'command_id': 'session'})
            client.request('/agent/sessions/' + s['id'] + '/messages', 'POST', {'text': '构建工作流', 'expected_version': 0, 'command_id': 'send'})
            deadline = time.monotonic() + 10
            pid = None
            while time.monotonic() < deadline:
                pid = client.request('/agent/runtime')['active_pid']
                if pid and requests: break
                time.sleep(.05)
            assert pid and alive(pid)
            process.kill(); process.wait(10)
            deadline = time.monotonic() + 8
            while alive(pid) and time.monotonic() < deadline: time.sleep(.05)
            assert not alive(pid)
            count = len(requests)
            process = start()
            assert client.request('/agent/sessions/' + s['id'])['state'] == 'interrupted'
            assert client.request('/agent/runtime')['active_pid'] is None
            time.sleep(.5)
            assert len(requests) == count
        finally:
            if process and process.poll() is None: process.kill(); process.wait(10)
            log.close()


def test_v2_backup_preserves_tasks_and_artifacts(tmp_path):
    with Engine(tmp_path) as engine:
        engine.catalog.create('legacy')
        task = engine.create_task('legacy', {'value': 1})
        engine.control(task, 'start'); engine.drain()
    with sqlite3.connect(engine.store.path) as db:
        for table in ('agent_calls', 'agent_events', 'agent_rounds', 'agent_sessions', 'agent_commands'):
            db.execute('DROP TABLE ' + table)
        db.execute('PRAGMA user_version=2')
    upgraded = Engine(tmp_path)
    assert upgraded.status(task)['state'] == 'succeeded'
    assert len(upgraded.status(task)['artifacts']) == 1
    backups = list(engine.runtime.glob('*.v2-*.bak'))
    assert len(backups) == 1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 2


def test_responses_stream_and_tools(tmp_path, runtime):
    app = create_app(tmp_path)
    service = app.state.agent_service
    def responder(body):
        assert 'messages' not in body
        if not any(i.get('type') == 'function_call_output' for i in body['input']):
            return 'connection_probe', {'value': 'nebulae'}
        return 'Responses 连接验证通过'
    with model_server(responder) as (url, _), serve(app) as base:
        values = {k: v for k, v in DEFAULTS.items() if k != 'version'}
        values.update(base_url=url, model='fixture', api='openai-responses')
        service.configure(values, '', 0, 'config')
        assert service.check(base)['ok']


def test_tool_loop_is_bounded(tmp_path, runtime):
    app = create_app(tmp_path)
    service = app.state.agent_service
    app.state.engine.catalog.create('limit')
    with model_server(lambda _: ('workflow_health', {})) as (model, _), serve(app) as url:
        configure(service, model)
        s = service.create_session('limit', '预算边界', False, 'new')
        service.submit(s['id'], '查询服务状态', 0, 'run', url)
        done = wait(service, s['id'])
        assert done['state'] == 'failed'
        assert len(done['calls']) == 50
        assert '50' in done['rounds'][0]['error']
        assert service.active is None
