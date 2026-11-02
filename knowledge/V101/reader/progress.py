"""Per-process, atomic progress snapshots. Counters reflect work actually completed."""
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
import time

_target = None
_engine = ''
_phases = []
_paused = 0
_last_write = 0


def now():
    return datetime.now(timezone.utc).isoformat()


def configure(output, engine):
    global _target, _engine, _phases, _last_write
    if _paused:
        return
    _target, _engine, _phases, _last_write = output / 'progress.json', engine, [], 0


def write(force=False):
    global _last_write
    if _target is None or _paused:
        return
    if not force and time.monotonic() - _last_write < .25:
        return
    temporary = _target.with_suffix('.tmp')
    temporary.write_text(json.dumps({'engine': _engine, 'phases': _phases}, ensure_ascii=False), encoding='utf-8')
    os.replace(temporary, _target)
    _last_write = time.monotonic()


def report(name, unit='', completed=0, total=0, current=0, **counts):
    if _paused:
        return
    changed = not _phases or _phases[-1]['name'] != name
    if changed:
        finish()
        _phases.append(dict(name=name, status='running', started_at=now()))
    _phases[-1]['progress'] = dict(unit=unit, completed=completed, total=total, current=current, **counts)
    write(changed or total > 0 and completed == total)


def finish(status='succeeded'):
    if _paused:
        return
    if _phases and _phases[-1]['status'] == 'running':
        _phases[-1].update(status=status, finished_at=now())
        write(True)


@contextmanager
def suspended():
    global _paused
    _paused += 1
    try:
        yield
    finally:
        _paused -= 1
