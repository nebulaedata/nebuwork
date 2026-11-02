import {
  StreamableHttpTransport,
  type McpTransport,
  type JsonRpcMessage,
} from "@earendil-works/pi-mcp";
import type { Sandbox } from "./sandbox.js";
import { EngineError, type RuntimeManifest } from "./contracts.js";
import type { Business } from "./business.js";
import type { Run } from "./contracts.js";
import {
  createMcpExtension,
  type McpServerEntry,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

class DockerTransport implements McpTransport {
  private messages = new Set<(message: JsonRpcMessage) => void>();
  private errors = new Set<(error: Error) => void>();
  private closes = new Set<() => void>();
  private io: Awaited<ReturnType<Sandbox["stdio"]>> | undefined;
  constructor(
    private sandbox: Sandbox,
    private command: string,
    private args: string[],
    private env: Record<string, string>,
  ) {}
  onMessage(fn: (message: JsonRpcMessage) => void) {
    this.messages.add(fn);
    return () => {
      this.messages.delete(fn);
    };
  }
  onError(fn: (error: Error) => void) {
    this.errors.add(fn);
    return () => {
      this.errors.delete(fn);
    };
  }
  onClose(fn: () => void) {
    this.closes.add(fn);
    return () => {
      this.closes.delete(fn);
    };
  }
  async start() {
    this.io = await this.sandbox.stdio(this.command, this.args, this.env);
    let pending = "";
    this.io.output.setEncoding("utf8");
    this.io.output.on("data", (text: string) => {
      pending += text;
      if (pending.length > 8 * 1024 ** 2) {
        for (const fn of this.errors) fn(new Error("MCP message too large"));
        void this.close();
        return;
      }
      let at;
      while ((at = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, at);
        pending = pending.slice(at + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          for (const fn of this.messages) fn(message);
        } catch {
          for (const fn of this.errors)
            fn(new Error("MCP returned invalid JSON"));
        }
      }
    });
    this.io.input.on("error", (error: Error) => {
      for (const fn of this.errors) fn(error);
    });
    this.io.input.on("end", () => {
      for (const fn of this.closes) fn();
    });
    this.io.error.resume();
  }
  async send(message: JsonRpcMessage) {
    if (!this.io) throw new Error("MCP not connected");
    await new Promise<void>((resolve, reject) =>
      this.io!.input.write(JSON.stringify(message) + "\n", (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
  async close() {
    this.io?.input.destroy();
    for (const fn of this.closes) fn();
    this.closes.clear();
  }
}

/** The SDK transport factory is synchronous; authentication is refreshed in start(). */
export class RefreshingMcpTransport implements McpTransport {
  private transport?: McpTransport;
  private dispose?: () => Promise<void>;
  private closed = false;
  private disposal?: Promise<void>;
  private started = false;
  private protocolVersion?: string;
  private messages = new Set<(message: JsonRpcMessage) => void>();
  private errors = new Set<(error: Error) => void>();
  private closes = new Set<() => void>();
  constructor(private prepare: () => Promise<{ transport: McpTransport; dispose?: () => Promise<void> }>) {}
  onMessage(fn: (message: JsonRpcMessage) => void) { this.messages.add(fn); return () => { this.messages.delete(fn); }; }
  onError(fn: (error: Error) => void) { this.errors.add(fn); return () => { this.errors.delete(fn); }; }
  onClose(fn: () => void) { this.closes.add(fn); return () => { this.closes.delete(fn); }; }
  setProtocolVersion(version: string) { this.protocolVersion = version; this.transport?.setProtocolVersion?.(version); }
  private async release() { if (this.dispose) await (this.disposal ??= this.dispose()); }
  async start() {
    if (this.started || this.closed) throw new Error('MCP connection already started or closed');
    this.started = true;
    try {
      const prepared = await this.prepare();
      this.transport = prepared.transport; this.dispose = prepared.dispose;
      if (this.closed) { await this.transport.close(); await this.release(); throw new Error('MCP connection closed'); }
      if (this.protocolVersion) this.transport.setProtocolVersion?.(this.protocolVersion);
      this.transport.onMessage(message => { for (const fn of this.messages) fn(message); });
      this.transport.onError(() => { for (const fn of this.errors) fn(new Error('MCP connection failed')); });
      this.transport.onClose(() => { this.closed = true; void this.release().catch(() => {}); for (const fn of this.closes) fn(); this.closes.clear(); });
      await this.transport.start();
    } catch {
      await this.transport?.close().catch(() => {});
      await this.release().catch(() => {});
      for (const fn of this.errors) fn(new Error('MCP authentication or connection unavailable'));
      throw new Error('MCP authentication or connection unavailable');
    }
  }
  async send(message: JsonRpcMessage) { if (!this.transport || this.closed) throw new Error('MCP not connected'); try { await this.transport.send(message); } catch { throw new Error('MCP request unavailable'); } }
  async close() { if (this.closed) { await this.release(); return; } this.closed = true; try { await this.transport?.close(); } finally { await this.release(); } }
}
export async function mcpExtension(
  manifest: RuntimeManifest,
  run: Run,
  business: Business,
  sandbox: Sandbox,
  onStatus: (id: string, status: string, catalog?: unknown) => Promise<void>,
): Promise<{ extension: ExtensionFactory; ready: () => Promise<Record<string,unknown>> }> {
  const catalog: Record<string,unknown> = {};
  const publications: Promise<void>[] = [];
  const entries: McpServerEntry[] = [];
  for (const s of manifest.mcp) {
    const exposure = s.tools ? "hidden" : "direct";
    entries.push({
      name: s.id,
      source: `manifest:${run.manifestHash}`,
      scope: "extension",
      config:
        s.transport === "http"
          ? {
              type: "http",
              url: s.url!,
              exposure,
              toolExposure: s.tools
                ? Object.fromEntries(s.tools.map((t) => [t, "direct"]))
                : undefined,
            }
          : {
              type: "stdio",
              command: s.command!,
              args: s.args,
              exposure,
              toolExposure: s.tools
                ? Object.fromEntries(s.tools.map((t) => [t, "direct"]))
                : undefined,
            },
    });
  }
  const states = new Map<string, { ready: boolean; error?: string }>();
  const extension = createMcpExtension({
    loadConfig: () => ({
      servers: entries,
      errors: [],
      autoEnableCodemode: false,
    }),
    startupWaitMs: 15000,
    updateConfig: () => {
      throw new Error("运行中的 MCP 配置不可修改");
    },
    openUrl: () => {
      throw new Error("请在系统配置 MCP 授权");
    },
    createTransport: (entry) => {
      const m = manifest.mcp.find((s) => s.id === entry.name)!;
      states.set(m.id, { ready: false });
      const transport = new RefreshingMcpTransport(async () => {
        const managed = Boolean(m.credentialRef?.startsWith('market-mcp:'));
        if (managed && m.transport === 'stdio' && !sandbox.isolatedMcp) throw new Error('Managed MCP isolation unavailable');
        const secret = m.credentialRef && (!managed || m.transport === 'stdio') ? await business.credential(run, m.credentialRef, 'mcp', managed ? 'isolated_stdio' : undefined) : undefined;
        if (m.transport === 'stdio') {
          const isolated = managed ? await sandbox.isolatedMcp!() : sandbox;
          return { transport: new DockerTransport(isolated, m.command!, m.args, secret?.env ?? {}), dispose: managed ? () => isolated.close() : undefined };
        }
        return { transport: new StreamableHttpTransport({ url: m.url!, headers: secret?.headers ?? (secret?.apiKey ? { Authorization: `Bearer ${secret.apiKey}` } : {}),
          ...(managed ? { fetch: async (input, init) => {
            // Every HTTP request, including an SDK SSE reconnect, gets current authentication.
            // Redirects must never forward shared credentials to a different destination.
            if (new URL(String(input)).href !== new URL(m.url!).href) throw new Error('MCP destination changed');
            const current = await business.credential(run, m.credentialRef!, 'mcp', 'worker_http');
            const headers = new Headers(init?.headers);
            for (const [key, value] of Object.entries(current.headers ?? {})) headers.set(key, value);
            return fetch(input, { ...init, headers, redirect: 'error' });
          } } : {}) }) };
      });
      transport.onMessage((message) => {
        if (
          "result" in message &&
          message.result &&
          typeof message.result === "object" &&
          "tools" in message.result
        ) {
          states.set(m.id, { ready: true });
          catalog[m.id]=message.result.tools;
          const publication=onStatus(m.id,'connected',message.result.tools);
          publications.push(publication);void publication.catch(()=>{});
        }
      });
      transport.onError(() => {
        states.set(m.id, { ready: false, error: "连接失败" });
        void onStatus(m.id, "failed").catch(() => {});
      });
      transport.onClose(() => {
        states.set(m.id, { ready: false, error: "连接已关闭" });
        void onStatus(m.id, "unavailable").catch(() => {});
      });
      return transport;
    },
  });
  return {
    extension,
    ready: async () => {
      const deadline = Date.now() + 16000;
      while (
        Date.now() < deadline &&
        entries.some(
          (s) =>
            !states.get(s.name)?.ready && !states.get(s.name)?.error,
        )
      )
        await new Promise((r) => setTimeout(r, 100));
      for (const s of manifest.mcp) {
        if (s.required && !states.get(s.id)?.ready)
          throw new EngineError(
            422,
            "required_mcp_unavailable",
            `必需 MCP 服务不可用：${s.id}`,
          );
        if (!s.required && !states.get(s.id)?.ready) await onStatus(s.id, 'unavailable');
      }
      await Promise.all(publications);
      return catalog;
    },
  };
}
