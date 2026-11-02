"""Optional, pinned Node runtime and private model credentials."""
import csv
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from .catalog import atomic_write
from .process import Child, SchedulerLock

PACKAGE = Path(__file__).with_name('agent_runtime')
PI_VERSION = '1.1.0'
DEFAULTS = {'base_url': '', 'model': '', 'api': 'openai-completions', 'node_path': '',
            'context_window': 128000, 'max_tokens': 8192, 'version': 0}


def private_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.credential-')
    os.close(fd)
    try:
        if os.name == 'nt':
            identity = subprocess.check_output(['whoami', '/user', '/fo', 'csv', '/nh'],
                                               creationflags=subprocess.CREATE_NO_WINDOW).decode(errors='replace')
            sid = next(csv.reader(identity.strip().splitlines()))[1]
            subprocess.run(['icacls', temporary, '/inheritance:r', '/grant:r', f'*{sid}:(F)'],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            os.chmod(temporary, 0o600)
        with open(temporary, 'w', encoding='utf-8') as file:
            json.dump(value, file, ensure_ascii=False)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def node_info(config):
    path = config.get('node_path') or shutil.which('node')
    if not path:
        raise ValueError('未找到 Node.js，请安装 22.19+ 或配置解释器绝对路径')
    path = Path(path).resolve()
    result = subprocess.run([str(path), '--version'], capture_output=True, text=True, timeout=5,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    if result.returncode:
        raise ValueError('Node.js 无法启动')
    version = result.stdout.strip().lstrip('v')
    if tuple(int(p) for p in version.split('.')[:3]) < (22, 19, 0):
        raise ValueError('Pi 需要 Node.js 22.19+')
    return str(path), version


def runtime_directory(root):
    # Explicit service-side override for offline tests/development; never accepted from an API request.
    if os.environ.get('NEBULAE_AGENT_RUNTIME'):
        return Path(os.environ['NEBULAE_AGENT_RUNTIME']).resolve()
    digest = hashlib.sha256(b''.join((PACKAGE / f).read_bytes() for f in
                                    ('package.json', 'package-lock.json', 'worker.mjs'))).hexdigest()[:16]
    return Path(root) / 'runtime' / digest


def runtime_status(root, config):
    result = {'ready': False, 'pi_version': PI_VERSION, 'node_path': None, 'node_version': None, 'error': None}
    try:
        result['node_path'], result['node_version'] = node_info(config)
        directory = runtime_directory(root)
        manifest = directory / 'node_modules' / '@earendil-works' / 'pi-coding-agent' / 'package.json'
        if not manifest.exists() or json.loads(manifest.read_text())['version'] != PI_VERSION or not (directory / 'worker.mjs').exists():
            raise ValueError('助手依赖未安装，请运行 python -m nebulae agent-install')
        result.update(ready=True, directory=str(directory))
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        result['error'] = str(exc)
    return result


def install(runtime, node_path=''):
    root = Path(runtime).resolve() / 'agent'
    root.mkdir(parents=True, exist_ok=True)
    node, version = node_info({'node_path': node_path})
    npm = shutil.which('npm')
    candidates = [Path(node).parent / 'node_modules/npm/bin/npm-cli.js']
    if npm:
        candidates += [Path(npm).resolve().parent / 'node_modules/npm/bin/npm-cli.js',
                       Path(npm).resolve().parent / 'npm-cli.js']
    npm_cli = next((p for p in candidates if p.is_file()), None)
    if not npm_cli:
        raise ValueError('未找到 npm，请安装包含 npm 的 Node.js')
    with SchedulerLock(root / 'install.lock'):
        directory = runtime_directory(root)
        if runtime_status(root, {'node_path': node})['ready']:
            return {'ready': True, 'directory': str(directory), 'node_version': version}
        directory.mkdir(parents=True, exist_ok=True)
        for name in ('package.json', 'package-lock.json'):
            shutil.copyfile(PACKAGE / name, directory / name)
        log = directory / 'install.log'
        child = Child([node, str(npm_cli), 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
                      cwd=directory, env=os.environ.copy(), logfile=log)
        try:
            if child.process.wait(timeout=1800):
                raise ValueError(f'Pi 依赖安装失败，请查看 {log}')
        finally:
            child.close()
        # Probe SDK import before publishing a usable worker.
        subprocess.run([node, '--input-type=module', '-e',
                        "await import('@earendil-works/pi-coding-agent')"], cwd=directory,
                       check=True, capture_output=True, timeout=60,
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        atomic_write(directory / 'worker.mjs', (PACKAGE / 'worker.mjs').read_text(encoding='utf-8'))
        return runtime_status(root, {'node_path': node})
