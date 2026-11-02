import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { artifactPublicationFields } from "./artifact-publication.js";
import { htmlBundleSchema } from './html-bundle.js';
import {
  ID,
  Resource,
  Instruction,
  Skill,
  Mcp,
  ModelBinding,
  Expert,
  BusinessTool,
  Manifest,
} from "./contracts.js";
export const createSessionSchema = z
  .object({ projectId: ID, taskId: ID, title: z.string().min(1).max(240) })
  .strict();
export const inputSchema = z
  .object({
    content: z.string().min(1).max(100000),
    fileIds: z.array(ID).max(20).default([]),
    fileRefs: z.array(z.object({id: ID, version: z.number().int().positive()}).strict()).max(20).optional(),
    context: z.record(z.unknown()).optional(),
    retryOf: ID.optional(),
  })
  .strict();
export const bundleSchema = z
  .object({
    id: ID,
    version: ID,
    name: z.string(),
    files: z.array(Resource),
    instructions: z.array(Instruction).default([]),
    skills: z.array(Skill).default([]),
    mcp: z.array(Mcp).default([]),
    experts: z.array(Expert).default([]),
    businessTools: z.array(BusinessTool).default([]),
    defaultModel: ModelBinding.optional(),
  })
  .strict();
export const commandSchema = z
  .object({
    type: z.enum(["steer", "follow_up", "cancel", "resume"]),
    content: z.string().max(100000).optional(),
  })
  .strict();
export const artifactUploadSchema = z.object({
  name: z.string().min(1).max(240),
  contentBase64: z.string().max(28 * 1024 ** 2),
  mediaType: z.string().default("application/octet-stream"),
  sessionId: ID.optional(),
  ...artifactPublicationFields,
  source: z.object({kind: z.literal('workflow'), workflowId: ID, taskId: ID.optional(), artifactId: ID}).strict().optional(),
}).strict();
export const jsonSchema = (schema: z.ZodTypeAny) =>
  zodToJsonSchema(schema, { $refStrategy: "none", target: "jsonSchema7" });
export const manifestJsonSchema = jsonSchema(Manifest);
export const eventSchema=z.object({schemaVersion:z.literal(1),eventId:ID,sessionId:ID,sequence:z.number().int().positive(),runId:ID.nullable(),invocationId:ID.nullable(),type:z.string().min(1),occurredAt:z.string().datetime(),payload:z.record(z.unknown())}).strict();
export function routeSchema(method: string | string[], url: string) {
  const write = method === "POST";
  const schema: Record<string, unknown> = {
    tags: [url.split("/")[2] ?? "health"],
  };
  const names = [...url.matchAll(/:([a-zA-Z]+)/g)].map((m) => m[1]!);
  if (names.length)
    schema.params = jsonSchema(
      z.object(Object.fromEntries(names.map((name) => [name, ID]))),
    );
  if (write)
    schema.headers = {
      type: "object",
      required: ["idempotency-key"],
      properties: {
        "idempotency-key": {
          type: "string",
          pattern: "^[A-Za-z0-9_.:-]{1,128}$",
        },
      },
    };
  const upload = z
    .object({
      contentBase64: z.string().max(28 * 1024 ** 2),
      mediaType: z.string().default("application/octet-stream"),
    })
    .strict();
  const bodies: Record<string, z.ZodTypeAny> = {
    "/v1/sessions": createSessionSchema,
    "/v1/sessions/:id/runs": inputSchema,
    "/v1/runs/:id/commands": commandSchema,
    "/v1/objects": upload,
    "/v1/runtime-bundles": bundleSchema,
    "/v1/projects/:id/artifacts": artifactUploadSchema,
    "/v1/projects/:id/html-bundles": htmlBundleSchema,
    "/v1/session-grants": z
      .object({
        sourceSessionId: ID,
        targetSessionId: ID,
        beforeSequence: z.number().int().positive(),
      })
      .strict(),
  };
  if (write && bodies[url]) schema.body = jsonSchema(bodies[url]!);
  if (url.endsWith("/events"))
    schema.querystring = {
      type: "object",
      properties: {
        after: { type: "integer", minimum: 0 },
        format: { type: "string", enum: ["json"] },
      },
    };
  return schema;
}
