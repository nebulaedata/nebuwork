"""Black-box lifecycle checks against tests/compose.yaml, never production services."""
import json
import pathlib
import subprocess
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPOSE = ['docker', 'compose', '-f', str(ROOT / 'tests/compose.yaml')]
ENV = {
    'NEBULAEKNO_DATABASE_URL': 'postgres://nebulaekno:integration-only@postgres:5432/nebulaekno',
    'NEBULAEKNO_NEO4J_URL': 'bolt://neo4j:integration-only@graph:7687',
    'NEBULAEKNO_REDIS_URL': 'redis://default:integration-only@redis:6379/0',
    'NEBULAEKNO_CONNECT_RETRY_WINDOW_SECONDS': '2',
    'NEBULAEKNO_CONNECT_TIMEOUT_SECONDS': '2',
}


def command(args, check=True, timeout=120):
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
    if check and r.returncode:
        raise AssertionError(f'command failed ({r.returncode}): {r.stdout[-2000:]} {r.stderr[-2000:]}')
    return r


def request(path):
    try:
        with urllib.request.urlopen('http://127.0.0.1:18080' + path, timeout=3) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)
    except (OSError, ValueError):
        return 0, {}


def wait_ready(want=200, seconds=90):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        status, body = request('/health/ready')
        if status == want:
            return body
        time.sleep(.5)
    logs = command(COMPOSE + ['logs', '--tail', '30', 'app']).stdout
    raise AssertionError(f'readiness expected {want}: {logs}')


def failure_case(name, overrides, code):
    env = {**ENV, **overrides}
    args = ['docker', 'run', '--rm', '--network', 'nebulaekno-test_default']
    for key, value in env.items():
        if value is not None:
            args.extend(['-e', key + '=' + value])
    result = command(args + ['nebulaekno:0.1.0'], check=False)
    assert result.returncode != 0, name + ': unexpectedly started'
    assert code in result.stdout, name + ': wrong error: ' + result.stdout
    assert 'integration-only' not in result.stdout + result.stderr, name + ': credential leak'
    print('PASS', name, flush=True)


def main():
    failure_case('missing URL', {'NEBULAEKNO_DATABASE_URL': None}, 'CONFIG_MISSING')
    failure_case('wrong database kind', {'NEBULAEKNO_DATABASE_URL': 'sqlite:///tmp/db'}, 'INVALID_CONNECTION_URL')
    failure_case('Neo4j authentication', {'NEBULAEKNO_NEO4J_URL': 'bolt://neo4j:wrong@graph:7687'}, 'AUTH_FAILED')
    failure_case('Redis authentication', {'NEBULAEKNO_REDIS_URL': 'redis://default:wrong@redis:6379/0'}, 'AUTH_FAILED')
    failure_case('Postgres authentication', {'NEBULAEKNO_DATABASE_URL': 'postgres://nebulaekno:wrong@postgres:5432/nebulaekno'}, 'AUTH_FAILED')
    failure_case('network failure', {'NEBULAEKNO_REDIS_URL': 'redis://127.0.0.1:1/0'}, 'DEPENDENCY_UNREACHABLE')
    command(COMPOSE + ['up', '-d', '--wait', 'graph-noapoc'])
    failure_case('missing APOC', {'NEBULAEKNO_NEO4J_URL': 'bolt://neo4j:integration-only@graph-noapoc:7687'}, 'GRAPH_PROCEDURE_UNAVAILABLE')
    command(COMPOSE + ['stop', 'graph-noapoc'])
    command(COMPOSE + ['exec', '-T', 'redis', 'redis-cli', '-a', 'integration-only', 'CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru'])
    try:
        failure_case('wrong Redis policy', {}, 'REDIS_CAPABILITY_MISSING')
    finally:
        command(COMPOSE + ['exec', '-T', 'redis', 'redis-cli', '-a', 'integration-only', 'CONFIG', 'SET', 'maxmemory-policy', 'noeviction'])
    command(COMPOSE + ['up', '-d', 'app'])
    ready = wait_ready()
    identity = ready['data']['installation_id']
    assert request('/api/v1/system/version')[0] == 200
    infra = json.dumps(request('/api/v1/system/infrastructure')[1])
    assert 'integration-only' not in infra
    print('PASS fresh database and container startup', flush=True)
    command(COMPOSE + ['restart', 'app'])
    assert wait_ready()['data']['installation_id'] == identity
    print('PASS restart preserves identity', flush=True)
    command(COMPOSE + ['stop', 'redis'])
    wait_ready(503, 20)
    assert request('/api/v1/system/version')[0] == 503
    command(COMPOSE + ['start', 'redis'])
    wait_ready()
    print('PASS dependency failure gates API and recovers', flush=True)
    # The child is found by its exact argv; no unrelated process is touched.
    kill_reader = "import pathlib,os,signal; [os.kill(int(p.name),signal.SIGKILL) for p in pathlib.Path('/proc').iterdir() if p.name.isdigit() and (p/'cmdline').exists() and (p/'cmdline').read_bytes().split(b'\\0')[:2] == [b'python3',b'/app/reader/server.py']]"
    command(COMPOSE + ['exec', '-T', 'app', 'python3', '-c', kill_reader])
    cid = command(COMPOSE + ['ps', '-aq', 'app']).stdout.strip()
    exit_code = command(['docker', 'wait', cid], timeout=30).stdout.strip()
    assert exit_code == '1', 'critical child failure did not propagate'
    command(COMPOSE + ['start', 'app'])
    wait_ready()
    print('PASS critical parser failure exits container', flush=True)
    pathlib.Path(ROOT / 'test-results').mkdir(exist_ok=True)
    (ROOT / 'test-results/startup.json').write_text(json.dumps({'passed': True, 'installation_id': identity}), encoding='utf-8')


if __name__ == '__main__':
    main()
