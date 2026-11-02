import { createUuid } from '../src/uuid.js';
import { beforeAll, afterAll, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { Store } from "../src/store.js";
import { sign } from "../src/auth.js";
import { fixture, testConfig } from "./fixture.js";
const exec = promisify(execFile),
  store = new Store(testConfig.DATABASE_URL);
const prefix = `nebu-it-${createUuid().slice(0, 8)}`,
  containers: string[] = [],
  apis: string[] = [];
const infrastructureProject = process.env.TEST_COMPOSE_PROJECT ?? "nebu-engine-v2-test";
const engineImage = process.env.TEST_ENGINE_IMAGE ?? "nebu-agent-engine:2.0.0";
let provider: Awaited<ReturnType<typeof fixture>>, token: string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function docker(...args: string[]) {
  return (
    await exec("docker", args, { maxBuffer: 4 * 1024 ** 2 })
  ).stdout.trim();
}
async function eventually<T>(
  fn: () => Promise<T | undefined>,
  ms = 75000,
): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value !== undefined) return value;
    await sleep(150);
  }
  throw Error("deadline exceeded");
}
beforeAll(async () => {
  await store.migrate();
  provider = await fixture();
  provider.setTransform((m) => ({
    ...m,
    model: {
      ...m.model,
      baseUrl: `http://host.docker.internal:${provider.port}/v1`,
    },
  }));
  token = await sign(
    {
      service: "distributed-tests",
      tenantId: "tests",
      ownerId: prefix,
      projects: ["p"],
      scopes: ["engine:*"],
    },
    testConfig.ENGINE_SIGNING_KEY,
    "30m",
  );
  const environment = {
    ...testConfig,
    DATABASE_URL:
      `mysql://root:isolated-test-password@${infrastructureProject}-mysql-1:3306/agent_test`,
    REDIS_URL: `redis://${infrastructureProject}-redis-1:6379`,
    S3_ENDPOINT: `http://${infrastructureProject}-minio-1:9000`,
    BUSINESS_API_URL: `http://host.docker.internal:${provider.port}`,
    HOST: "0.0.0.0",
    PORT: 42110,
  };
  for (const role of ["api", "api", "worker", "worker", "worker"]) {
    const name = `${prefix}-${role}-${containers.length}`;
    containers.push(name);
    await docker(
      "run",
      "-d",
      "--name",
      name,
      "--network",
      `${infrastructureProject}_default`,
      "--add-host",
      "host.docker.internal:host-gateway",
      ...(role === "api"
        ? ["-p", "127.0.0.1::42110"]
        : ["-v", "/var/run/docker.sock:/var/run/docker.sock"]),
      ...Object.entries({ ...environment, ENGINE_ROLE: role }).flatMap(
        ([k, v]) => ["-e", `${k}=${v}`],
      ),
      engineImage,
    );
    if (role === "api") {
      const port = JSON.parse(await docker("inspect", name))[0].NetworkSettings
        .Ports["42110/tcp"][0].HostPort;
      apis.push(`http://127.0.0.1:${port}`);
    }
  }
  for (const url of apis)
    await eventually(async () => {
      try {
        return (await fetch(`${url}/health/ready`)).ok ? true : undefined;
      } catch {
        return undefined;
      }
    });
});
afterAll(async () => {
  await mkdir('.qa/distributed', { recursive: true });
  await Promise.allSettled(containers.map(async name => {
    const result = await exec('docker', ['logs', name], { maxBuffer: 4 * 1024 ** 2 });
    await writeFile(`.qa/distributed/${name}.log`, result.stdout + result.stderr);
  }));
  await Promise.allSettled(containers.map((name) => docker("rm", "-f", name)));
  await provider?.app.close();
  await store.close();
});
async function request(
  index: number,
  path: string,
  body?: unknown,
  key = createUuid(),
) {
  const response = await fetch(`${apis[index]}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw Error(`${response.status}: ${await response.text()}`);
  return response.json() as any;
}
it("runs five isolated service containers and survives a killed Worker plus Redis restart", async () => {
  const session = await request(0, "/v1/sessions", {
    projectId: "p",
    taskId: createUuid(),
    title: "node recovery",
  });
  const run = await request(0, `/v1/sessions/${session.id}/runs`, {
    content: `slow-once ${createUuid()}`,
    fileIds: [],
  });
  await eventually(async () =>
    provider.modelRequests.length > 0 ? true : undefined,
  );
  const executing = await store.run(run.id);
  expect(executing.status).toBe("running");
  const hostname = executing.workerId!.split(":")[0];
  const active = await eventually(async () => {
    for (const name of containers.filter((n) => n.includes("worker"))) {
      const state = JSON.parse(await docker("inspect", name))[0];
      if (state.Config.Hostname === hostname) return name;
    }
    return undefined;
  });
  await docker("kill", active);
  provider.setRevision("new-version-after-crash");
  await docker("restart", `${infrastructureProject}-redis-1`);
  const recovered = await eventually(async () => {
    const r = await store.run(run.id);
    return ["completed", "failed", "interrupted"].includes(r.status)
      ? r
      : undefined;
  });
  expect(recovered.error).toBeNull();
  expect(recovered.status).toBe("completed");
  expect(recovered.attempt).toBeGreaterThan(1);
  expect(recovered.workerId).not.toBe(executing.workerId);
  expect(recovered.manifest!.model.revision).toBe("1");
  await eventually(async () => (await docker('ps','-aq','--filter',`label=nebu.run=${run.id}`)).trim()==='' ? true : undefined);
  const report = await request(1, `/v1/sessions/${session.id}/runs`, {
    content: "write-report",
    fileIds: [],
  });
  await eventually(async () => {
    const r = await store.run(report.id);
    return r.status === "completed"
      ? r
      : r.status === "failed"
        ? Promise.reject(r.error)
        : undefined;
  });
  const snapshot = await request(0, `/v1/sessions/${session.id}`),
    again = await request(1, `/v1/sessions/${session.id}`);
  expect(snapshot.cursor).toBe(again.cursor);
  expect(snapshot.events).toEqual(again.events);
  const artifact = snapshot.events.find(
    (e: any) => e.type === "artifact.created",
  ).payload.artifact;
  const bytes = await fetch(`${apis[1]}/v1/artifacts/${artifact.id}/content`, {
    headers: { authorization: `Bearer ${token}`, range: "bytes=0-7" },
  });
  expect(bytes.status).toBe(206);
  expect(await bytes.text()).toBe("# Report");
  const abort = new AbortController();
  const stream = await fetch(`${apis[1]}/v1/sessions/${session.id}/events`, {
    headers: {
      authorization: `Bearer ${token}`,
      "last-event-id": String(snapshot.cursor - 1),
    },
    signal: abort.signal,
  });
  const chunk = await stream.body!.getReader().read();
  expect(new TextDecoder().decode(chunk.value)).toContain(
    `id: ${snapshot.cursor}`,
  );
  abort.abort();
});
