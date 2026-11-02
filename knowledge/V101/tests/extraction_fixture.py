"""Isolated extraction protocol fixture. No claims about real model quality."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
import time
import hashlib
import threading


class Handler(BaseHTTPRequestHandler):
    calls = {}
    lock = threading.Lock()
    active = 0
    peak = 0
    active_models = {}
    peak_models = {}
    def log_message(self, *args):
        pass

    def do_GET(self):
        with self.lock:
            if self.path == '/metrics/reset':
                type(self).peak = type(self).active
                type(self).peak_models = dict(type(self).active_models)
            value = {'active': self.active, 'peak': self.peak, 'peak_models': self.peak_models} if self.path.startswith('/metrics') else self.calls
            data = json.dumps(value).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        model = data.get('model', '')
        cls = type(self)
        with self.lock:
            cls.active += 1
            cls.active_models[model] = cls.active_models.get(model, 0) + 1
            cls.peak = max(cls.peak, cls.active)
            cls.peak_models[model] = max(cls.peak_models.get(model, 0), cls.active_models[model])
        try:
            self.respond(data)
        finally:
            with self.lock:
                cls.active -= 1
                cls.active_models[model] -= 1

    def respond(self, data):
        digest = hashlib.sha256(json.dumps(data['messages'], ensure_ascii=False).encode()).hexdigest()
        self.calls[digest] = self.calls.get(digest, 0) + 1
        if data.get('model') == 'extraction-slow':
            time.sleep(12)
        if data.get('model', '').startswith('extraction-concurrency'):
            time.sleep(.7)
        user = data['messages'][-1]['content']
        payload = json.JSONDecoder().raw_decode(user[user.index('{'):])[0] if '{' in user else {}
        records, coverage = [], []
        for unit in payload.get('units', []):
            if unit['kind'] == 'heading':
                coverage.append({'unit_id': unit['id'], 'disposition': 'context_only', 'reason': '章节标题'})
                continue
            matches = re.findall(r'(额定电压|额定频率).*?(\d+\s*(?:kV|Hz))', unit['text'])
            for subject, value in matches or [('独立要求', unit['text'])]:
                records.append({'type': 'requirement', 'subject': subject, 'conditions': None,
                                'content': value, 'primary_unit_id': unit['id'],
                                'evidence': [{'unit_id': unit['id'], 'quote': unit['text']}]})
            coverage.append({'unit_id': unit['id'], 'disposition': 'extracted', 'reason': '测试原文证据'})
        body = json.dumps({'choices': [{'finish_reason': 'stop', 'message': {
            'content': json.dumps({'records': records, 'coverage': coverage}, ensure_ascii=False) if 'units' in payload else '连接成功。'}}]}, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


ThreadingHTTPServer(('0.0.0.0', 9000), Handler).serve_forever()
