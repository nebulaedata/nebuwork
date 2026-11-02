import type { Config } from "./config.js";
import {
  EngineError,
  validateManifest,
  type Run,
  type Session,
  type RuntimeManifest,
} from "./contracts.js";
export class Business {
  constructor(private config: Config) {}
  async request<T>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(
      `${this.config.BUSINESS_API_URL.replace(/\/$/, "")}/internal/agent/${path}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.BUSINESS_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new EngineError(
        response.status >= 500 ? 502 : response.status,
        "business_unavailable",
        `业务服务请求失败（${response.status}）`,
      );
    return (await response.json()) as T;
  }
  identity(run: Run) {
    return {
      runId: run.id,
      sessionId: run.sessionId,
      tenantId: run.tenantId,
      ownerId: run.ownerId,
      projectId: run.projectId,
      manifestHash: run.manifestHash,
    };
  }
  async resolve(run: Run, session: Session) {
    const manifest = validateManifest(
      await this.request("context", {
        ...this.identity(run),
        taskId: session.taskId,
        input: run.input,
      }),
    );
    if (
      manifest.ownerId !== run.ownerId ||
      manifest.tenantId !== run.tenantId ||
      manifest.projectId !== run.projectId ||
      manifest.taskId !== session.taskId
    )
      throw new EngineError(403, "context_identity", "运行上下文身份不匹配");
    return manifest;
  }
  credential(run: Run, ref: string, kind: "model" | "mcp", executionContext?: 'worker_http' | 'isolated_stdio') {
    return this.request<{
      apiKey?: string;
      headers?: Record<string, string>;
      env?: Record<string, string>;
    }>("credentials", { ...this.identity(run), credentialRef: ref, kind,
      ...(executionContext ? { managedAuthProtocol: 1, executionContext, workerId: run.workerId, fence: run.fence } : {}) });
  }
  async authorize(run: Run, kind: string, resourceId?: string) {
    const result = await this.request<{ allowed: boolean }>("authorize", {
      ...this.identity(run),
      kind,
      resourceId,
    });
    if (!result.allowed)
      throw new EngineError(403, "access_revoked", "资源访问权限已撤销");
  }
  execute(
    run: Run,
    manifest: RuntimeManifest,
    toolName: string,
    args: unknown,
    callId: string,
    signal?: AbortSignal,
  ) {
    const tool = manifest.businessTools.find((t) => t.name === toolName);
    if (!tool)
      throw new EngineError(403, "unknown_tool", "工具未包含在运行上下文");
    return this.request<Record<string, unknown>>(
      "tools/execute",
      {
        ...this.identity(run),
        capability: tool.capability,
        operation: tool.operation,
        arguments: args,
        callId,
      },
      signal,
    );
  }
  reconcile(run: Run, toolName: string, callId: string) {
    return this.request<{
      status: "completed" | "not_started" | "unknown";
      result?: unknown;
    }>("tools/reconcile", { ...this.identity(run), toolName, callId });
  }
}
