import { z } from "zod";
const Env = z.object({
  ENGINE_ROLE: z.enum(["api", "worker", "all"]).default("api"),
  PORT: z.coerce.number().default(42110),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  REDIS_CHANNEL_PREFIX: z.string().regex(/^[A-Za-z0-9:_-]+$/).default("nebu-agent"),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("nebu-agent"),
  S3_PREFIX: z.string().default("").transform(value => value.replace(/\/+$/, ""))
    .refine(value => value === "" || value.split("/").every(segment => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(segment)), "Invalid S3 object prefix"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  ENGINE_SIGNING_KEY: z.string().min(32),
  BUSINESS_API_URL: z.string().url(),
  BUSINESS_API_KEY: z.string().min(32),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  ACCOUNT_CONCURRENCY: z.coerce.number().int().positive().default(6),
  LEASE_MS: z.coerce.number().min(3000).default(30000),
  SANDBOX_IMAGE: z.string().default("nebu-agent-sandbox:1"),
  DOCKER_HOST: z.string().optional(),
  TEST_MODE: z.enum(["true", "false"]).default("false"),
});
export type Config = z.infer<typeof Env>;
export const config = () => Env.parse(process.env);
