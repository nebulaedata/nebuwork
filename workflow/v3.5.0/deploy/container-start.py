"""New Docker dev state only. Never opens the migrated Windows runtime."""
import os
from pathlib import Path
import shutil
project = Path('/data/project')
demo = project / 'workflows/demo'
if not (project / '.initialized').exists():
    project.mkdir(parents=True, exist_ok=True)
    if not demo.exists():
        shutil.copytree('/opt/demo', demo)
    (project / '.initialized').touch()
os.execvp('python', ['python', '-m', 'nebulae', '--project', str(project), '--runtime', '/data/runtime',
                    'serve', '--host', '0.0.0.0', '--remote-access', '--trusted-host', 'workflow',
                    '--trusted-host', 'localhost', '--trusted-host', '127.0.0.1'])
