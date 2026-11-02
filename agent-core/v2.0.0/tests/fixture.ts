import Fastify from "fastify";
import type { Config } from "../src/config.js";
import { validateManifest, type RuntimeManifest } from "../src/contracts.js";

export const testConfig: Config = {
  ENGINE_ROLE: "all",
  PORT: 0,
  HOST: "127.0.0.1",
  DATABASE_URL:
    "mysql://root:isolated-test-password@127.0.0.1:43306/agent_test",
  REDIS_URL: "redis://127.0.0.1:46379",
  REDIS_CHANNEL_PREFIX: "nebu-agent-test",
  S3_ENDPOINT: "http://127.0.0.1:49000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "agent-test",
  S3_PREFIX: "",
  S3_ACCESS_KEY: "isolated-test",
  S3_SECRET_KEY: "isolated-test-password",
  ENGINE_SIGNING_KEY: "isolated-test-signing-key-32-characters",
  BUSINESS_API_KEY: "isolated-test-business-key-32-characters",
  BUSINESS_API_URL: "http://127.0.0.1:1",
  WORKER_CONCURRENCY: 2,
  ACCOUNT_CONCURRENCY: 6,
  LEASE_MS: 3000,
  SANDBOX_IMAGE: "nebu-agent-sandbox:1",
  TEST_MODE: "true",
};

// This is an explicitly scripted upstream HTTP service. The production SDK loop,
// model protocol, SQL, object storage, Docker tools and APIs remain real.
export async function fixture() {
  const app = Fastify();
  let revision = "1";
  let allowed = true;
  const modelRequests: any[] = [];
  const delayed = new Set<string>();
  let transform = (m: RuntimeManifest) => m;
  app.post("/internal/agent/context", async (r) => {
    const b = r.body as any;
    return transform(
      validateManifest({
        schemaVersion: 1,
        tenantId: b.tenantId,
        ownerId: b.ownerId,
        projectId: b.projectId,
        taskId: b.taskId,
        resolvedAt: new Date().toISOString(),
        instructions: [
          {
            source: "fixture",
            revision,
            content: `配置版本 ${revision}`,
            path: "AGENTS.md",
            scope: "",
          },
        ],
        model: {
          providerId: "fixture",
          revision,
          protocol: "openai-compatible",
          baseUrl: `http://host.docker.internal:${port}/v1`,
          model: "scripted-model",
          credentialRef: "fixture-key",
          maxTokens: 1024,
        },
        image: testConfig.SANDBOX_IMAGE,
      }),
    );
  });
  app.post("/internal/agent/credentials", async () => ({
    apiKey: "fixture-secret-never-persist",
  }));
  app.post("/internal/agent/authorize", async () => ({ allowed }));
  app.post("/internal/agent/tools/execute", async (r) => ({
    value: (r.body as any).arguments,
    source: "fixture",
  }));
  app.post("/internal/agent/tools/reconcile", async () => ({
    status: "unknown",
  }));
  app.post("/v1/chat/completions", async (r, reply) => {
    const b = r.body as any;
    modelRequests.push(b);
    if (r.headers.authorization !== "Bearer fixture-secret-never-persist")
      return reply
        .code(401)
        .send({ error: { message: "missing explicit model credentials" } });
    const messages = b.messages as any[];
    const raw = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
    const user = Array.isArray(raw)
      ? raw.map((c) => c.text ?? "").join("")
      : raw;
    if (String(user).includes("slow-once") && !delayed.has(String(user))) {
      delayed.add(String(user));
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10000);
        reply.raw.once("close", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
    }
    const last = messages.at(-1);
    let delta: any,
      finish = "stop";
    const call = (name: string, args: any, index = 0) => ({
      index,
      id: `fixture-${modelRequests.length}-${index}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    });
    if (String(user).includes("artifact-publication|")) {
      const steps = JSON.parse(String(user).slice(String(user).indexOf("artifact-publication|") + "artifact-publication|".length));
      const results = messages.filter((m: any) => m.role === "tool");
      const step = steps[results.length];
      if (step) {
        const args = { ...step.arguments };
        if (args.artifactId === "$first") {
          const published = results.map((m: any) => {
            try { return JSON.parse(typeof m.content === "string" ? m.content : m.content.find((c: any) => c.type === "text").text); }
            catch { return null; }
          }).find((value: any) => value?.id && value?.version);
          if (!published) throw Error("Missing first artifact result");
          args.artifactId = published.id;
        }
        delta = { role: "assistant", tool_calls: [call(step.name, args)] }; finish = "tool_calls";
      } else delta = { role: "assistant", content: "成果发布测试已完成。" };
    } else if (String(user).includes("service-result-smoke") && last?.role !== "tool") {
      delta = { role: "assistant", tool_calls: [call("service_result_submit", {result:{answer:"official SDK service result"}})] }; finish = "tool_calls";
    } else if (String(user).includes("service-page-smoke")) {
      const completed=messages.filter((m:any)=>m.role==='tool').length;
      if(completed===0){delta={role:"assistant",tool_calls:[call("service_draft_get",{})]};finish="tool_calls";}
      else if(completed===1){const value=JSON.parse(messages.filter((m:any)=>m.role==='tool').at(-1).content[0]?.text??messages.filter((m:any)=>m.role==='tool').at(-1).content);delta={role:"assistant",tool_calls:[call("service_page_register",{revision:value.revision,page:{key:"generated",name:"智能体生成页面",capabilities:[],refreshSeconds:0},html:"<!doctype html><html><body><h1>Generated by agent tools</h1></body></html>"})]};finish="tool_calls";}
      else delta={role:"assistant",content:"页面草稿已登记，等待用户发布。"};
    } else if (String(user).includes("delegate-experts") && last?.role !== "tool") {
      delta = {
        role: "assistant",
        tool_calls: [
          call("delegate_expert", {
            expertId: "analyst",
            goal: "first expert",
          }),
          call(
            "delegate_expert",
            { expertId: "writer", goal: "second expert" },
            1,
          ),
        ],
      };
      finish = "tool_calls";
    } else if (
      String(user).includes("delegate-experts") &&
      !messages.some((m) =>
        m.tool_calls?.some((t: any) => t.function.name === "wait_experts"),
      )
    ) {
      delta = { role: "assistant", tool_calls: [call("wait_experts", {})] };
      finish = "tool_calls";
    } else if (String(user).includes('platform-mcp-smoke|')) {
      const [_,projectId,sourceProject]=String(user).split('|');
      const completed=messages.filter((m:any)=>m.role==='tool').length;
      const steps=[['nw_project_list',{}],['nw_task_create',{projectId,data:{title:'MCP 派生报告',content:'write-report 请生成真实测试成果'}}],['nw_memory_propose',{kind:'project',id:sourceProject,data:{title:'MCP 验收建议',content:'所有建议保持待审核，并记录真实执行来源。'}}]] as const;
      const step=steps[completed];
      if(step){const tool=b.tools.find((t:any)=>t.function.name===`mcp__nebuwork__${step[0]}`);if(!tool)throw Error(`Missing platform tool ${step[0]}`);delta={role:'assistant',tool_calls:[call(tool.function.name,step[1])]};finish='tool_calls';}
      else delta={role:'assistant',content:'系统 MCP 测试调用已返回。'};
    } else if (String(user).includes("use-mcp") && last?.role !== "tool") {
      const tool = b.tools.find((t: any) =>
        t.function.name.includes("echo_value"),
      );
      if (!tool) throw Error("MCP tools not activated");
      delta = {
        role: "assistant",
        tool_calls: [call(tool.function.name, { value: "mcp verified" })],
      };
      finish = "tool_calls";
    } else if (String(user).includes("pause-model")) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 30000);
        reply.raw.once("close", () => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
      delta = { role: "assistant", content: "resumed" };
    } else if (String(user).includes("write-report") && last?.role !== "tool") {
      delta = {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "write-1",
            type: "function",
            function: {
              name: "workspace_write",
              arguments: JSON.stringify({
                path: "report.md",
                content: "# Report\nVerified output",
              }),
            },
          },
        ],
      };
      finish = "tool_calls";
    } else if (
      String(user).includes("write-report") &&
      last?.role === "tool" &&
      messages.some((m) =>
        m.tool_calls?.some((t: any) => t.function.name === "workspace_write"),
      ) &&
      !messages.some((m) =>
        m.tool_calls?.some((t: any) => t.function.name === "publish_artifact"),
      )
    ) {
      delta = {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "publish-1",
            type: "function",
            function: {
              name: "publish_artifact",
              arguments: JSON.stringify({
                path: "report.md",
                mediaType: "text/markdown",
              }),
            },
          },
        ],
      };
      finish = "tool_calls";
    } else
      delta = { role: "assistant", content: "已完成，资料与本轮配置已核对。" };
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream" });
    const base = {
      id: "fixture-completion",
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: "scripted-model",
    };
    for (const chunk of [
      { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
      {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: finish }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      },
    ])
      reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    reply.raw.end("data: [DONE]\n\n");
  });
  await app.listen({ port: 0, host: "0.0.0.0" });
  const port = (app.server.address() as { port: number }).port;
  // The model client executes on the host in tests, not inside the task container.
  transform = (m) => ({
    ...m,
    model: { ...m.model, baseUrl: `http://127.0.0.1:${port}/v1` },
  });
  return {
    app,
    port,
    modelRequests,
    setRevision: (v: string) => {
      revision = v;
    },
    setAllowed: (v: boolean) => {
      allowed = v;
    },
    setTransform: (fn: typeof transform) => {
      transform = (m) =>
        fn({
          ...m,
          model: { ...m.model, baseUrl: `http://127.0.0.1:${port}/v1` },
        });
    },
  };
}
