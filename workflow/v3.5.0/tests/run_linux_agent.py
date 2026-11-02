"""Copy only test sources from a read-only mount; never write into the host project."""
from pathlib import Path
import shutil
import subprocess

source = Path('/source')
target = Path('/tmp/project')
shutil.copytree(source / 'nebulae', target / 'nebulae', dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('node_modules', '__pycache__', 'web'))
shutil.copytree(source / 'tests', target / 'tests', dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__'))
shutil.copyfile(source / 'nebulae/agent_runtime/worker.mjs', '/opt/pi/worker.mjs')
shutil.copyfile(source / 'pyproject.toml', target / 'pyproject.toml')
shutil.copyfile(source / 'start_mcp.py', target / 'start_mcp.py')
raise SystemExit(subprocess.call(['python', '-m', 'pytest', '-q'], cwd=target))
