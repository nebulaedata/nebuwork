"""Private, supervised parser. Only the Go service exposes public routes."""
import importlib.util
import importlib.metadata
import functools
import json
import shutil
import subprocess
import os
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


@functools.lru_cache(maxsize=1)
def capabilities():
    modules = {name: importlib.util.find_spec(name) is not None for name in
               ('pdfplumber', 'pypdf', 'docx', 'openpyxl', 'xlrd', 'olefile', 'pptx', 'bs4', 'PIL', 'anydoc')}
    tools = {name: shutil.which(name) is not None for name in ('ffmpeg', 'ffprobe', 'libreoffice', 'tesseract')}
    checks = {}
    for name, args in {'ffmpeg': ['-version'], 'ffprobe': ['-version'],
                       'libreoffice': ['--headless', '--version'], 'tesseract': ['--list-langs']}.items():
        try:
            result = subprocess.run([name, *args], capture_output=True, text=True, timeout=10)
            checks[name] = result.returncode == 0
            if name == 'tesseract':
                checks[name] = checks[name] and 'chi_sim' in result.stdout and 'eng' in result.stdout
        except (OSError, subprocess.TimeoutExpired):
            checks[name] = False
    try:
        import anydoc
        checks['anydoc'] = bool(anydoc.to_markdown_bytes(b'a,b\n1,2\n', 'csv'))
        anydoc_version = importlib.metadata.version('firecrawl-anydoc')
    except Exception:
        checks['anydoc'] = False
        anydoc_version = None
    try:
        from ofd import renderer_command
        result = subprocess.run(renderer_command() + ['--version'], capture_output=True, text=True, timeout=15)
        checks['ofd_renderer'] = result.returncode == 0 and 'OFDRW 2.4.0' in result.stdout
    except (OSError, subprocess.TimeoutExpired):
        checks['ofd_renderer'] = False
    try:
        from wps import converter_capabilities
        wps_formats = converter_capabilities()
        checks['wps_filters'] = bool(wps_formats) and all(wps_formats.values())
    except Exception:
        wps_formats = {}
        checks['wps_filters'] = False
    return {'wps_formats': wps_formats, 'anydoc': {'available': checks['anydoc'], 'version': anydoc_version, 'local': True}, 'ready': all(modules.values()) and all(tools.values()) and all(checks.values()),
            'modules': modules, 'tools': checks}


class Handler(BaseHTTPRequestHandler):
    jobs = {}
    lock = threading.Lock()

    def do_POST(self):
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 2*1024**2:
                raise ValueError('invalid body')
            data = json.loads(self.rfile.read(size))
            job = data['job_id']
            if self.path == '/cancel':
                with self.lock:
                    process = self.jobs.get(job)
                    if process and process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                self.send_response(200);self.end_headers();return
            if self.path != '/parse':
                self.send_response(404);self.end_headers();return
            process = subprocess.Popen(['python3','/app/reader/parse.py'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            with self.lock:
                self.jobs[job] = process
            try:
                output, _ = process.communicate(json.dumps(data).encode(),timeout=1800)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL);process.communicate()
                output = b'{"error":"PARSE_TIMEOUT"}'
            finally:
                with self.lock:
                    self.jobs.pop(job,None)
            if not output:
                output=b'{"error":"PARSE_PROCESS_FAILED"}'
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(output)
        except (ValueError,KeyError,json.JSONDecodeError):
            self.send_response(400);self.end_headers()
        except (BrokenPipeError,ConnectionResetError):
            pass

    def do_GET(self):
        data = capabilities()
        self.send_response(200 if data['ready'] else 503)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, *_):
        pass


if __name__ == '__main__':
    print(json.dumps({'component': 'reader', 'event': 'started', **capabilities()}), flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8091), Handler).serve_forever()
