import { Redis } from "ioredis";
import { config } from "./config.js";
import { Store } from "./store.js";
import { Objects } from "./objects.js";
import { Business } from "./business.js";
import { Worker } from "./worker.js";
import { createApi } from "./api.js";
const env = config(),
  store = new Store(env.DATABASE_URL),
  objects = new Objects(env);
await objects.initialize();
const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});
redis.on("error", () => {});
void redis.connect().catch(() => {});
const worker =
  env.ENGINE_ROLE !== "api"
    ? new Worker(env, store, objects, new Business(env))
    : undefined;
const api =
  env.ENGINE_ROLE !== "worker"
    ? await createApi(env, store, objects)
    : undefined;
if (api) await api.listen({ host: env.HOST, port: env.PORT });
let busy = false;
const schedule = () => {
  if (busy) return;
  busy = true;
  (async () => {
    await worker?.tick();
    if (redis.status === "ready")
      await store.publishOutbox(async (topic, payload) => {
        await redis.publish(`${env.REDIS_CHANNEL_PREFIX}:${topic}`, payload);
      });
  })()
    .catch((e) => console.error("Scheduler unavailable", e.code ?? "unknown"))
    .finally(() => {
      busy = false;
    });
};
const interval = setInterval(schedule, 500);
const notifications = worker ? redis.duplicate() : undefined;
notifications?.on('error',()=>{});
notifications?.on('message',()=>schedule());
if(notifications) void notifications.subscribe(`${env.REDIS_CHANNEL_PREFIX}:runs`,`${env.REDIS_CHANNEL_PREFIX}:commands`).catch(()=>{});
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  clearInterval(interval);
  await worker?.stop();
  await api?.close();
  redis.disconnect();
  notifications?.disconnect();
  await store.close();
};
process.on("SIGTERM", () => void close());
process.on("SIGINT", () => void close());
