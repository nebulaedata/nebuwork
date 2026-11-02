import asyncio
from contextlib import contextmanager
import json
import os
from pathlib import Path
import socket
import threading
import time

import pytest
import uvicorn
from fastapi.testclient import TestClient

from nebulae.api import create_app
from nebulae.agent_runtime import DEFAULTS
from nebulae.agent_tools import ScopedTools
from nebulae.store import Conflict
from agent_model import model_server

RUNTIME = Path(os.environ.get('NEBULAE_AGENT_RUNTIME', Path(__file__).resolve().parents[1] / 'nebulae' / 'agent_runtime'))


@contextmanager
def serve(app):
    listener = socket.socket(); listener.bind(('127.0.0.1', 0))
    server = uvicorn.Server(uvicorn.Config(app, log_level='error', timeout_graceful_shutdown=2))
    thread = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True); thread.start()
    until = time.monotonic() + 10
    while not server.started:
        assert thread.is_alive() and time.monotonic() < until
        time.sleep(.02)
    try:
        yield f'http://127.0.0.1:{listener.getsockname()[1]}'
    finally:
        server.should_exit = True; thread.join(45); listener.close()
        assert not thread.is_alive()


@pytest.fixture
def runtime(monkeypatch):
    if not (RUNTIME / 'node_modules/@earendil-works/pi-coding-agent').exists():
        pytest.skip('npm ci --ignore-scripts in nebulae/agent_runtime to run real Pi integration')
    monkeypatch.setenv('NEBULAE_AGENT_RUNTIME', str(RUNTIME))


def configure(service, base_url, key=''):
    values = {k: v for k, v in DEFAULTS.items() if k != 'version'}
    values.update(base_url=base_url, model='fixture')
    return service.configure(values, key, service.config()['version'], 'config-' + str(time.time_ns()))


def wait(service, session_id):
    until = time.monotonic() + 55
    while time.monotonic() < until:
        session = service.session(session_id)
        if session['state'] not in {'running', 'stopping'}:
            return session
        time.sleep(.05)
    pytest.fail('Agent did not finish')


def test_real_pi_build_debug_and_restore(tmp_path, runtime):
    app = create_app(tmp_path)
    service = app.state.agent_service
    with model_server() as (model, requests), serve(app) as url:
        configure(service, model, 'fixture-secret-key')
        assert service.check(url)['tool_calling']
        session = service.create_session('agent-dag', '构建并调试', True, 'session-one')
        assert service.create_session('agent-dag', '构建并调试', True, 'session-one')['id'] == session['id']
        service.submit(session['id'], '创建并调试一个并行汇合流程', 0, 'send-one', url)
        service.submit(session['id'], '创建并调试一个并行汇合流程', 0, 'send-one', url)
        done = wait(service, session['id'])
        assert done['state'] == 'succeeded', done['rounds']
        assert len(done['rounds']) == 1
        assert len(done['calls']) == 18, done['calls']
        assert all(c['state'] == 'succeeded' for c in done['calls'])
        task = app.state.engine.status(app.state.engine.tasks()[0]['id'])
        assert task['state'] == 'succeeded'
        assert [s['attempts'] for s in task['steps'] if s['name'] == 'prepare'] == [1]
        assert next(s for s in task['steps'] if s['name'] == 'right')['attempts'] == 2
        assert not any(a['name'] == 'ignored' for a in task['artifacts'])
        assert done['calls'][12]['changes'][0]['before']['content'].find('fixture failure') >= 0
        events = service.events(session['id'])
        assert any(e['kind'] == 'pi.delta' for e in events)
        assert len({e['id'] for e in events}) == len(events)
        assert service.events(session['id'], events[-1]['id']) == []
        assert 'fixture-secret-key' not in json.dumps(done)
        # New round restores real Pi JSONL context; it must not recreate or rerun the task.
        service.submit(session['id'], '解释这个结果', done['version'], 'send-two', url)
        assert wait(service, session['id'])['state'] == 'succeeded'
        assert len(app.state.engine.tasks()) == 1
        assert 'workflow_create' in json.dumps(requests)


def test_scope_conflicts_and_recovery(tmp_path):
    app = create_app(tmp_path, run_scheduler=False)
    engine, service = app.state.engine, app.state.agent_service
    with engine, TestClient(app) as client:
        engine.catalog.create('one'); engine.catalog.create('two')
        task = engine.create_task('two')
        scoped = ScopedTools(engine, 'one', 'http://127.0.0.1:8765', threading.Event())
        for name, args in [('workflow_get', {'workflow_id': 'two'}), ('task_get', {'task_id': task}),
                           ('workflow_create', {'workflow_id': 'one', 'copy_from': 'two'})]:
            with pytest.raises(ValueError):
                asyncio.run(scoped.call(name, args))
        assert scoped.validate('task_list', {})['workflow_id'] == 'one'
        session = service.create_session('one', '会话', False, 'session')
        with pytest.raises(Conflict): service.create_session('two', '会话', False, 'session')
        with engine.store.transaction() as db:
            db.execute("INSERT INTO agent_rounds(id,session_id,state,prompt,config,created_at) VALUES('unfinished',?,'running','hello','{}',0)", (session['id'],))
            db.execute("UPDATE agent_sessions SET state='running' WHERE id=?", (session['id'],))
        service.open()
        assert service.session(session['id'])['state'] == 'interrupted'
        assert service.active is None
        assert client.get('/api/v1/agent/sessions/' + session['id'] + '/stream?follow=false').status_code == 200
        # Ordinary UI still works without optional Node dependencies or model setup.
        assert client.get('/api/v1/workflows').status_code == 200


def test_stop_does_not_cancel_tasks(tmp_path, runtime):
    def slow(body):
        time.sleep(2)
        return '响应中'
    app = create_app(tmp_path)
    service = app.state.agent_service
    with model_server(slow) as (model, _), serve(app) as url:
        configure(service, model)
        app.state.engine.catalog.create('stop')
        task_id = app.state.engine.create_task('stop')
        session = service.create_session('stop', '停止测试', False, 'new')
        sent = service.submit(session['id'], 'hello', 0, 'send', url)
        with pytest.raises(Conflict): service.submit(session['id'], 'other', sent['version'], 'other', url)
        service.stop(session['id'], sent['version'], 'stop')
        done = wait(service, session['id'])
        assert done['state'] == 'stopped'
        assert app.state.engine.status(task_id)['state'] == 'ready'


def test_secret_configuration_is_private_and_versioned(tmp_path):
    app = create_app(tmp_path, run_scheduler=False)
    with app.state.engine, TestClient(app) as client:
        body = {**DEFAULTS, 'base_url': 'http://127.0.0.1:9988/v1', 'model': 'fixture', 'api_key': 'never-return-this',
                'expected_version': 0, 'command_id': 'save'}
        body.pop('version')
        response = client.put('/api/v1/agent/settings', json=body)
        assert response.status_code == 200, response.text
        assert 'never-return-this' not in response.text and response.json()['has_api_key']
        assert client.put('/api/v1/agent/settings', json=body).status_code == 200
        body['command_id'] = 'stale'
        assert client.put('/api/v1/agent/settings', json=body).status_code == 409
        assert 'never-return-this' not in json.dumps(app.state.engine.store.read('SELECT * FROM meta'))


def test_build_only_saves_code_scenarios_and_documentation_without_running(tmp_path, runtime):
    presets = [{'id': 'text', 'name': '文本处理', 'description': '处理指定文本',
                'input': {'text': '示例输入'}, 'fields': {'/text': '需要处理的文本'}}]
    source = 'def run(ctx):\n    ctx.task.save_text("result", ctx.input["text"])\n'

    def build(body):
        messages = body['messages']
        assert 'input_presets' in str(messages[0]['content'])
        assert 'workflow_get 回读确认' in str(messages[0]['content'])
        workflow = str(messages[0]['content']).split('绑定工作流ID：', 1)[1].split('\n', 1)[0]
        results = [json.loads(message['content']) for message in messages if message['role'] == 'tool']
        count = len(results)
        if count == 0:
            return 'workflow_create', {'workflow_id': workflow, 'name': '场景构建验收'}
        if count == 1:
            return 'source_read', {'workflow_id': workflow, 'path': 'main.py'}
        if count == 2:
            return 'source_save', {'workflow_id': workflow, 'path': 'main.py', 'content': source, 'expected_revision': results[-1]['revision']}
        if count == 3:
            return 'workflow_get', {'workflow_id': workflow}
        definition = {**results[3]['definition'], 'input_presets': presets}
        if count == 4:
            return 'workflow_validate', {'workflow_id': workflow, 'definition': definition}
        if count == 5:
            return 'workflow_save_definition', {'workflow_id': workflow, 'definition': definition, 'expected_revision': results[3]['revision']}
        if count == 6:
            return 'workflow_get', {'workflow_id': workflow}
        assert results[-1]['definition']['input_presets'] == presets
        return '已保存代码与文本处理场景，字段 text 为待处理文本；已校验，尚未运行。'

    app = create_app(tmp_path)
    service = app.state.agent_service
    with model_server(build) as (model, requests), serve(app) as url:
        configure(service, model)
        session = service.create_session('build-presets', '仅构建场景', True, 'build-presets-session')
        service.submit(session['id'], '只构建文本处理流程并配置输入场景，不运行。', 0, 'build-presets-send', url)
        done = wait(service, session['id'])
        assert done['state'] == 'succeeded', done['rounds']
        assert app.state.engine.catalog.read('build-presets', 'main.py')['content'] == source
        assert app.state.engine.catalog.get('build-presets')['definition']['input_presets'] == presets
        assert app.state.engine.tasks() == []
        assert len(done['calls']) == 7
        assert requests
