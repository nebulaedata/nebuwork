import { beforeEach, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { DockerSandbox } from '../src/sandbox.js';
const docker = vi.hoisted(() => ({ containers: [] as any[], old: [] as any[], removed: [] as string[], failStart: false }));
vi.mock('dockerode', () => ({ default: class {
  modem = { demuxStream: vi.fn() };
  async listContainers() { return docker.old; }
  getContainer(id: string) { return { remove: async () => { docker.removed.push(id); } }; }
  getImage() { return { inspect: async () => ({ Id: 'sha256:fixed-image' }) }; }
  async createContainer(options: any) {
    const calls: any[] = [], container = { options, calls, start: vi.fn(async () => { if (docker.failStart) throw Error('start failed'); }), remove: vi.fn(async () => {}),
      exec: async (command: any) => { calls.push(command); return { start: async () => { const stream = new PassThrough(); queueMicrotask(() => stream.end()); return stream; }, inspect: async () => ({ ExitCode: 0 }) }; } };
    docker.containers.push(container); return container;
  }
} }));
const config = { SANDBOX_IMAGE: 'sandbox:fixed', LEASE_MS: 6000 } as any;
beforeEach(() => { docker.containers.length = 0; docker.old = []; docker.removed.length = 0; docker.failStart = false; });
it('creates an independent bounded container and forwards heartbeats/cleanup without exposing task mounts or environment', async () => {
  const task = await DockerSandbox.create(config, 'run', 7, 'sha256:fixed-image');
  const sidecar = await task.isolatedMcp(); await sidecar.stdio('node', ['mcp.js'], { API_KEY: 'shared-secret' });
  const [root, child] = docker.containers;
  expect(root.options.Labels['nebu.role']).toBe('task'); expect(child.options.Labels['nebu.role']).toBe('mcp');
  expect(child.options.name).not.toBe(root.options.name);
  expect(child.options.HostConfig.Binds).toBeUndefined(); expect(child.options.HostConfig.PidMode).toBeUndefined();
  expect(child.options.HostConfig.NetworkMode).not.toBe('host'); expect(child.options.HostConfig.Memory).toBeGreaterThan(0);
  expect(child.options.HostConfig.PidsLimit).toBeGreaterThan(0); expect(child.options.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
  expect(child.calls[0].Env).toEqual(['API_KEY=shared-secret']); expect(JSON.stringify(root.calls)).not.toContain('shared-secret');
  await task.heartbeat(); expect(root.calls).toHaveLength(1); expect(child.calls).toHaveLength(2);
  await task.close(); expect(root.remove).toHaveBeenCalledOnce(); expect(child.remove).toHaveBeenCalledOnce();
  await expect(task.isolatedMcp()).rejects.toThrow('执行容器已关闭');
});
it('removes only older fencing generations and rejects a changed image before starting a container', async () => {
  docker.old = [{ Id: 'old-task', Labels: { 'nebu.fence': '6' } }, { Id: 'old-mcp', Labels: { 'nebu.fence': '6' } }, { Id: 'current', Labels: { 'nebu.fence': '7' } }];
  const task = await DockerSandbox.create(config, 'run', 7, 'sha256:fixed-image');
  expect(docker.removed).toEqual(['old-task', 'old-mcp']); await task.close();
  await expect(DockerSandbox.create(config, 'run', 8, 'sha256:other-image')).rejects.toThrow('当前节点的执行镜像与运行快照不一致');
  expect(docker.containers).toHaveLength(1);
});
it('removes a newly created container when its start fails', async () => {
  docker.failStart = true;
  await expect(DockerSandbox.create(config, 'run', 7, 'sha256:fixed-image')).rejects.toThrow('start failed');
  expect(docker.containers[0].remove).toHaveBeenCalledWith({ force: true });
});
