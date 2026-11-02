"""Install a built wheel into a disposable service venv and run its isolated SDK."""
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    wheel = Path(sys.argv[1]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="nebulae-wheel-") as temporary:
        root = Path(temporary)
        service = root / "service"
        subprocess.run([sys.executable, "-m", "venv", str(service)], check=True)
        python = service / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        subprocess.run([str(python), "-m", "pip", "--disable-pip-version-check", "install", "--no-index", "--no-deps", str(wheel)],
                       cwd=root, check=True)
        script = '''import importlib.util,json,re,sysconfig
from pathlib import Path
import nebulae
from nebulae import Engine
from nebulae.context import read_artifact
runtime_source = Path(nebulae.__file__).parent / 'agent_runtime'
assert (runtime_source / 'worker.mjs').is_file()
assert (runtime_source / 'package-lock.json').is_file()
assert not (runtime_source / 'node_modules').exists()
web = Path(nebulae.__file__).parent / 'web'
html = (web / 'index.html').read_text(encoding='utf-8')
for asset in re.findall(r'(?:src|href)="(/assets/[^\"]+)"', html):
    assert (web / asset.lstrip('/')).is_file(), asset
site = Path(sysconfig.get_paths()['purelib'])
(site / 'shared_only_fixture.py').write_text('VALUE = 1')
assert importlib.util.find_spec('shared_only_fixture') is not None
with Engine('project') as engine:
    engine.catalog.create('wheel-test')
    source = engine.catalog.directory('wheel-test') / 'main.py'
    source.write_text("import importlib.util\\ndef run(ctx):\\n    assert importlib.util.find_spec('shared_only_fixture') is None\\n    print('中文执行日志')\\n    ctx.task.save_text('ok', 'wheel isolated SDK passed')\\n", encoding='utf-8')
    manager = engine.environments
    operation = manager.submit('wheel-test','create',0,'wheel-create')
    engine.drain(timeout=120)
    status = manager.status('wheel-test')
    assert status['state'] == 'ready', manager.operation(operation['id'])
    manager.select('wheel-test','isolated',status['workflow_revision'])
    task = engine.create_task('wheel-test')
    engine.control(task,'start')
    engine.drain()
    result = engine.status(task)
    assert result['state'] == 'succeeded', result
    assert read_artifact(result['artifacts'][0]) == 'wheel isolated SDK passed'
    logs = ''.join(e['payload']['text'] for e in engine.events(task) if e['kind']=='console')
    assert '中文执行日志' in logs, logs
    print('PASS: wheel installation, packaged assets, isolated environment, SDK, artifacts, UTF-8 logs')
'''
        subprocess.run([str(python), "-I", "-X", "utf8", "-c", script], cwd=root, check=True)


if __name__ == "__main__":
    main()
