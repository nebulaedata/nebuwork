"""Local OpenAI-compatible fixture. Uses real Pi streaming/tool execution, no model keys."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time


def choose(body):
    messages = body['messages']
    names = [t['function']['name'] for t in body.get('tools', [])]
    results = []
    for message in messages:
        if message['role'] == 'tool':
            try:
                results.append(json.loads(message['content']))
            except (ValueError, TypeError):
                results.append({})
    if 'connection_probe' in names:
        return ('connection_probe', {'value': 'nebulae'}) if not results else '连接测试通过。'
    system = str(messages[0]['content'])
    workflow = system.split('绑定工作流ID：', 1)[1].split('\n', 1)[0]
    definitions = {'name': '智能体并行验收', 'steps': {
        'prepare': {'code': 'prepare.py:run'}, 'left': {'code': 'left.py:run', 'needs': ['prepare']},
        'right': {'code': 'right.py:run', 'needs': ['prepare']},
        'report': {'code': 'report.py:run', 'needs': ['left', 'right']}}}
    files = [
        ('prepare.py', "def run(ctx):\n    ctx.task.save_json('value', 3)\n    return {'ignored': True}\n"),
        ('left.py', "def run(ctx):\n    ctx.task.save_json('value', ctx.task.read('prepare', 'value') + 1)\n"),
        ('right.py', "def run(ctx):\n    raise ValueError('fixture failure')\n"),
        ('report.py', "def run(ctx):\n    ctx.task.save_json('total', ctx.task.read('left', 'value') + ctx.task.read('right', 'value'))\n")]
    n = len(results)
    if n == 0: return 'workflow_create', {'workflow_id': workflow, 'name': '智能体并行验收'}
    if 1 <= n <= 4:
        path, content = files[n-1]
        return 'source_save', {'workflow_id': workflow, 'path': path, 'content': content, 'expected_revision': None}
    if n == 5: return 'workflow_get', {'workflow_id': workflow}
    if n == 6: return 'workflow_save_definition', {'workflow_id': workflow, 'definition': definitions, 'expected_revision': results[-1]['revision']}
    if n == 7: return 'task_create', {'workflow_id': workflow, 'input': {}, 'command_id': 'fixture-create'}
    task = next((r for r in results if r.get('workflow_id') == workflow and 'steps' in r and 'state' in r), None)
    if n == 8: return 'task_control', {'task_id': task['id'], 'action': 'start', 'expected_version': task['version'], 'command_id': 'fixture-start'}
    if n == 9: return 'task_wait', {'task_id': task['id'], 'seconds': 10}
    if n == 10: return 'task_logs', {'task_id': task['id'], 'step_id': 'right', 'attempt': 1}
    if n == 11: return 'source_read', {'workflow_id': workflow, 'path': 'right.py'}
    if n == 12: return 'source_save', {'workflow_id': workflow, 'path': 'right.py', 'expected_revision': results[-1]['revision'],
                                      'content': "def run(ctx):\n    ctx.task.save_json('value', ctx.task.read('prepare', 'value') * 2)\n"}
    if n == 13: return 'task_rerun_preview', {'task_id': task['id'], 'from_steps': ['right']}
    if n == 14: return 'task_rerun', {'task_id': task['id'], 'from_steps': ['right'], 'expected_version': results[-1]['version'],
                                   'expected_environment': results[-1]['environment_token'], 'command_id': 'fixture-rerun'}
    if n == 15: return 'task_wait', {'task_id': task['id'], 'seconds': 10}
    if n == 16: return 'artifact_list', {'workflow_id': workflow, 'task_id': task['id']}
    if n == 17:
        artifact = next(a for a in results[-1]['artifacts'] if a['name'] == 'total')
        return 'artifact_read', {'artifact_id': artifact['id']}
    return f"工作流已构建并调试成功，产物 total = **10**。\n\n[查看任务](#task/{task['id']})\n\n```python\nctx.task.save_json('total', 10)\n```"


@contextmanager
def model_server(responder=choose):
    calls = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def handle(self):
            try:
                super().handle()
            except (BrokenPipeError, ConnectionResetError):
                pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append(body)
            try:
                result = responder(body)
            except Exception as exc:
                self.send_response(500); self.end_headers(); self.wfile.write(str(exc).encode()); return
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            if self.path.endswith('/responses'):
                try:
                    response_chunks(self.wfile, body, result)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            def chunk(delta, finish=None):
                data = {'id': 'fixture', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': body['model'],
                        'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
                self.wfile.write(('data: ' + json.dumps(data) + '\n\n').encode()); self.wfile.flush()
            try:
                chunk({'role': 'assistant'})
                if isinstance(result, tuple):
                    name, args = result
                    chunk({'tool_calls': [{'index': 0, 'id': 'call-' + str(len(calls)), 'type': 'function',
                                           'function': {'name': name, 'arguments': json.dumps(args)}}]})
                    chunk({}, 'tool_calls')
                else:
                    chunk({'content': result[:5]}); chunk({'content': result[5:]}); chunk({}, 'stop')
                self.wfile.write(b'data: [DONE]\n\n'); self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError): pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/v1', calls
    finally:
        server.shutdown(); server.server_close(); thread.join(5)


def response_chunks(file, body, result):
    def emit(kind, **values):
        file.write(('event: ' + kind + '\ndata: ' + json.dumps({'type': kind, **values}) + '\n\n').encode())
        file.flush()
    response = {'id': 'resp-fixture', 'object': 'response', 'created_at': int(time.time()),
                'status': 'in_progress', 'model': body['model'], 'output': []}
    emit('response.created', response=response)
    if isinstance(result, tuple):
        name, args = result
        item = {'type': 'function_call', 'id': 'fc-fixture', 'call_id': 'call-fixture', 'name': name, 'arguments': '', 'status': 'in_progress'}
        emit('response.output_item.added', output_index=0, item=item)
        emit('response.function_call_arguments.delta', item_id=item['id'], output_index=0, delta=json.dumps(args))
        item.update(arguments=json.dumps(args), status='completed')
        emit('response.function_call_arguments.done', item_id=item['id'], output_index=0, arguments=item['arguments'])
    else:
        item = {'type': 'message', 'id': 'msg-fixture', 'role': 'assistant', 'status': 'in_progress', 'content': []}
        emit('response.output_item.added', output_index=0, item=item)
        part = {'type': 'output_text', 'text': '', 'annotations': []}
        emit('response.content_part.added', item_id=item['id'], output_index=0, content_index=0, part=part)
        emit('response.output_text.delta', item_id=item['id'], output_index=0, content_index=0, delta=result)
        part['text'] = result
        emit('response.output_text.done', item_id=item['id'], output_index=0, content_index=0, text=result)
        item.update(content=[part], status='completed')
    emit('response.output_item.done', output_index=0, item=item)
    response.update(status='completed', output=[item], usage={'input_tokens': 100, 'output_tokens': 20, 'total_tokens': 120,
                                                           'input_tokens_details': {'cached_tokens': 0}, 'output_tokens_details': {'reasoning_tokens': 0}})
    emit('response.completed', response=response)
