import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import {
  InMemoryCredentialStore,
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  ModelRuntime,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionFactory,
  type ToolDefinition,
  type FileEntry,
} from "@earendil-works/pi-coding-agent";
import {
  EngineError,
  hash,
  id,
  safePath,
  terminal,
  type Run,
  type Session,
  type Checkpoint,
  type Principal,
  type RuntimeManifest,
  type ResourceFile,
  type Artifact,
} from "./contracts.js";
import { Store, type Lease, type ToolRecord } from "./store.js";
import { Objects } from "./objects.js";
import { Business } from "./business.js";
import { mcpExtension } from "./mcp.js";
import { PlatformMcpClient } from "./platform-mcp-client.js";
import { knowledgeContext } from "./knowledge.js";
import { databaseContext } from "./database.js";
import { tokens, hasReportedUsage } from "./usage.js";
import type { Sandbox } from "./sandbox.js";
import { artifactPublicationInstructions, resolveArtifactPublication } from "./artifact-publication.js";

const textResult = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value),
    },
  ],
  details: {},
});
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class AgentRuntime {
  private agent?: AgentSession;
  private manager!: SessionManager;
  private workspace: ResourceFile[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private failure: unknown;
  private modelAttempt = 0;
  private messageId = "";
  private delta = "";
  private deltaTimer?: NodeJS.Timeout;
  private knownUsage = false;
  private mcpCatalog: Record<string,unknown> = {};
  private platformClient?: PlatformMcpClient;
  private mcpStatus: Record<string,string> = {};
  private lease: Lease;
  private manifest: RuntimeManifest;
  private p: Principal;
  private records = new Map<string, ToolRecord>();
  private toolStarts = new Map<string, number>();
  private modelStarted = 0;
  private firstText = false;
  private commandIds = new Set<string>();
  private polling = false;
  private phase: "active" | "waiting" = "active";
  constructor(
    private store: Store,
    private objects: Objects,
    private business: Business,
    private sandbox: Sandbox,
    private run: Run,
    private session: Session,
    private signal: AbortSignal,
    private acquireCapacity: () => Promise<boolean> = async () => true,
  ) {
    this.lease = { id: run.id, workerId: run.workerId!, fence: run.fence };
    this.manifest = run.manifest!;
    this.p = {
      service: "worker",
      tenantId: run.tenantId,
      ownerId: run.ownerId,
      projects: [run.projectId],
      scopes: ["engine:*"],
    };
  }
  get waiting() {
    return this.phase === "waiting";
  }
  private async resumeExecution() {
    while (!(await this.acquireCapacity())) {
      await this.barrier();
      await delay(250);
    }
    await this.store.update(this.lease, { status: "running" });
  }
  private serialize(fn: () => Promise<unknown>) {
    this.queue = this.queue.then(fn).catch((error) => {
      this.failure ??= error;
      void this.agent?.abort();
    });
    return this.queue;
  }
  private async barrier() {
    await this.queue;
    if (this.failure) throw this.failure;
    this.signal.throwIfAborted();
  }
  private checkpoint(): Checkpoint {
    return {
      entries: [this.manager.getHeader(), ...this.manager.getEntries()].filter(
        Boolean,
      ),
      leafId: this.manager.getLeafId(),
      workspace: this.workspace,
      sdkVersion: "1.1.0",
      runId: this.run.id,
      modelAttempt: this.modelAttempt,
      mcpCatalog:this.mcpCatalog,
    };
  }
  private async save() {
    await this.barrier();
    await this.store.checkpoint(this.lease, this.checkpoint());
  }
  private async syncWorkspace() {
    this.workspace = await this.sandbox.snapshot(
      this.objects,
      this.run.tenantId,
      this.run.ownerId,
    );
  }
  private flushDelta() {
    if (!this.delta) return;
    const delta = this.delta;
    this.delta = "";
    const messageId = this.messageId;
    this.serialize(() =>
      this.store.append(this.lease, "message.delta", { messageId, delta }),
    );
  }
  private replayPolicy(name: string) {
    if(name.startsWith("mcp__nebuwork__"))return this.platformClient?.replay(name)??"reconcile";
    if (
      [
        "workspace_read",
        "list_artifacts",
        "read_artifact",
        "session_read",
        "expert_status",
      ].includes(name)
    )
      return "read";
    if (
      [
        "workspace_write",
        "workspace_edit",
        "publish_artifact",
        "delegate_expert",
        "wait_experts",
        "update_plan",
        "request_user_input",
        "expert_input",
        "cancel_expert",
      ].includes(name)
    )
      return "idempotent";
    return (
      this.manifest.businessTools.find((t) => t.name === name)?.replay ??
      "reconcile"
    );
  }
  private async startTool(callId: string, name: string, args: unknown) {
    if(name.startsWith('mcp__nebuwork__'))await this.platformClient?.authorize(name,args,callId);
    await this.save();
    await this.business.authorize(
      this.run,
      name.startsWith("mcp__") ? "mcp" : "tool",
      name,
    );
    this.toolStarts.set(callId, Date.now());
    const record: ToolRecord = {
      callId,
      name,
      arguments: args,
      replay: this.replayPolicy(name),
      status: "started",
    };
    const prior = await this.store.toolStart(this.lease, record);
    this.records.set(callId, prior ?? record);
    return prior;
  }
  private async finishTool(callId: string, result: unknown) {
    await this.barrier();
    await this.syncWorkspace();
    const record = this.records.get(callId);
    if (!record) throw new Error("missing tool intent");
    record.result = result;
    record.status = "completed";
    await this.store.toolComplete(this.lease, record, this.checkpoint());
    if (this.toolStarts.has(callId)) {
      await this.store.metric(
        "tool_duration_ms",
        Date.now() - this.toolStarts.get(callId)!,
      );
      this.toolStarts.delete(callId);
    }
  }
  private tool(
    name: string,
    description: string,
    parameters: unknown,
    execute: (
      args: any,
      callId: string,
      signal?: AbortSignal,
    ) => Promise<unknown>,
  ): ToolDefinition {
    return {
      name,
      label: description,
      description,
      parameters: parameters as ToolDefinition["parameters"],
      execute: async (callId, args, signal) =>
        textResult(await execute(args, callId, signal)),
    };
  }
  private tools(): ToolDefinition[] {
    const pathSchema = Type.Object({ path: Type.String() });
    const tools = [
      this.tool(
        "workspace_read",
        "读取任务工作区文件",
        pathSchema,
        async (args) => {
          const path = safePath(args.path);
          const skill = this.manifest.skills.find(
            (s) => path === `${s.directory}/SKILL.md`,
          );
          if (skill)
            await this.store.append(this.lease, "skill.loaded", {
              id: skill.id,
              name: skill.name,
              revision: skill.revision,
              path,
            });
          return (await this.sandbox.read(path)).toString("utf8");
        },
      ),
      this.tool(
        "workspace_write",
        "生成或覆盖工作区文件",
        Type.Object({ path: Type.String(), content: Type.String() }),
        async (args) => {
          await this.sandbox.write(
            safePath(args.path),
            Buffer.from(args.content),
          );
          return { path: args.path, written: true };
        },
      ),
      this.tool(
        "workspace_edit",
        "精确替换文件中的唯一文本",
        Type.Object({
          path: Type.String(),
          oldText: Type.String(),
          newText: Type.String(),
        }),
        async (args) => {
          const source = (await this.sandbox.read(args.path)).toString();
          if (!args.oldText || source.split(args.oldText).length !== 2)
            throw new Error("替换目标必须唯一");
          await this.sandbox.write(
            args.path,
            Buffer.from(source.replace(args.oldText, args.newText)),
          );
          return { edited: true, path: args.path };
        },
      ),
      this.tool(
        "shell",
        "在独立任务容器执行命令",
        Type.Object({ command: Type.String() }),
        async (args, callId, signal) =>
          this.sandbox.exec(args.command, signal, (text, stream) => {
            this.serialize(() =>
              this.store.append(this.lease, "tool.output", {
                toolCallId: callId,
                stream,
                text: text.slice(0, 16384),
              }),
            );
          }),
      ),
      this.tool(
        "list_artifacts",
        "查看项目共享成果",
        Type.Object({}),
        async () => ({
          items: await this.store.artifacts(this.p, this.run.projectId),
        }),
      ),
      this.tool(
        "read_artifact",
        "读取指定版本的项目文件到工作区",
        Type.Object({
          artifactId: Type.String(),
          version: Type.Integer({minimum:1}),
          path: Type.String(),
        }),
        async (args) => {
          const a = await this.store.artifact(
            this.p,
            args.artifactId,
            args.version,
          );
          if(this.sandbox.materialize)await this.sandbox.materialize({path:safePath(args.path),sha256:a.sha256,objectKey:a.objectKey,size:a.size,mediaType:a.mediaType},this.objects);
          else await this.sandbox.write(safePath(args.path),await this.objects.bytes(a.objectKey,a.sha256));
          return { path: args.path, artifactId: a.id, version: a.version };
        },
      ),
      this.tool(
        "publish_artifact",
        "将工作区文件发布为项目成果",
        Type.Object({
          path: Type.String(),
          name: Type.Optional(Type.String()),
          mediaType: Type.Optional(Type.String()),
          mode: Type.Optional(Type.Union([Type.Literal("create"), Type.Literal("update")], {description:"create：新建成果，忽略更新字段；update：更新已有成果，目标或版本缺失时按新建处理。省略时兼容旧请求。"})),
          artifactId: Type.Optional(Type.Union([Type.String(), Type.Null()], {description:"仅更新时提供真实成果 ID；新建时省略，空值按新建处理。"})),
          baseVersion: Type.Optional(Type.Union([Type.Integer({minimum:1}), Type.Null()], {description:"仅更新时提供已有成果当前版本，成功后版本加 1；新建时省略，缺少时按新建处理。"})),
        }),
        async (args, callId) => {
          const target = await resolveArtifactPublication(this.store, this.p, this.run.projectId, args);
          const data = await this.objects.put(
            this.run.tenantId,
            this.run.ownerId,
            await this.sandbox.read(args.path),
            args.mediaType ?? "application/octet-stream",
          );
          const a: Artifact = {
            ...target,
            tenantId: this.run.tenantId,
            ownerId: this.run.ownerId,
            projectId: this.run.projectId,
            sessionId: this.run.sessionId,
            runId: this.run.id,
            name: args.name ?? safePath(args.path).split("/").at(-1),
            ...data,
            source: {
              path: args.path,
              expertId: this.session.expertId,
              manifestHash: this.run.manifestHash,
              inputFileIds: this.run.input.fileIds,
              inputFileRefs: this.run.input.resolvedFiles,
            },
            createdAt: new Date().toISOString(),
          };
          return this.store.addArtifact(
            this.p,
            a,
            `tool:${this.run.id}:${callId}`,
            this.lease,
          );
        },
      ),
      this.tool(
        "session_read",
        "读取已授权的其他任务会话",
        Type.Object({ grantId: Type.String(), after: Type.Optional(Type.Integer({minimum:0})) }),
        async (args) => {
          if (!this.manifest.sessionGrants.includes(args.grantId))
            throw new Error("授权未包含在本轮配置");
          return this.store.grantedHistoryPage(
            this.p,
            args.grantId,
            this.run.sessionId,
            args.after ?? 0,
          );
        },
      ),
      this.tool(
        "update_plan",
        "更新用户可见的任务计划",
        Type.Object({
          items: Type.Array(
            Type.Object({
              id: Type.String(),
              text: Type.String(),
              status: Type.Union([
                Type.Literal("pending"),
                Type.Literal("running"),
                Type.Literal("completed"),
              ]),
            }),
          ),
        }),
        async (args) => {
          await this.store.append(this.lease, "plan.updated", {
            items: args.items,
          });
          return { saved: true };
        },
      ),
      this.tool(
        "request_user_input",
        "向用户请求缺失的任务信息",
        Type.Object({ question: Type.String() }),
        async (args, callId) => {
          this.phase = "waiting";
          await this.store.update(
            this.lease,
            { status: "waiting_input" },
            {
              type: "input.required",
              payload: { question: args.question, toolCallId: callId },
            },
          );
          try {
            while (true) {
              await this.barrier();
              const reply = (await this.store.commands(this.lease)).find(
                (c) => c.type === "resume" && c.content,
              );
              if (reply) {
                const answer = { answer: reply.content };
                await this.finishTool(callId, textResult(answer));
                await this.store.consumeCommand(this.lease, reply.id);
                await this.resumeExecution();
                return answer;
              }
              await delay(500);
            }
          } finally {
            this.phase = "active";
          }
        },
      ),
    ];
    for (const businessTool of this.manifest.businessTools.filter(tool=>!this.manifest.platformMcp||!["knowledge","memory","workflow"].includes(tool.capability)))
      tools.push(
        this.tool(
          businessTool.name,
          businessTool.description,
          businessTool.parameters,
          (args, callId, signal) =>
            this.business.execute(
              this.run,
              this.manifest,
              businessTool.name,
              args,
              callId,
              signal,
            ),
        ),
      );
    if (!this.session.parentRunId) {
      tools.push(
        this.tool(
          "delegate_expert",
          "将子任务委派给本轮可用的专家",
          Type.Object({
            expertId: Type.String(),
            goal: Type.String(),
            fileIds: Type.Optional(Type.Array(Type.String())),
            fileRefs: Type.Optional(Type.Array(Type.Object({id:Type.String(),version:Type.Integer({minimum:1})}))),
          }),
          async (args, callId) => {
            const expert = this.manifest.experts.find(
              (e) => e.id === args.expertId,
            );
            if (!expert) throw new Error("专家未包含在本轮配置");
            await this.business.authorize(this.run,"expert",expert.id);
            const children = await this.store.children(this.run.id);
            if (
              children.filter((c) => !terminal.has(c.status)).length >=
              this.manifest.maxExpertConcurrency
            )
              throw new Error("专家并行数量已达上限，请先等待现有专家");
            return this.store.fenced(this.lease, async (c) => {
              const child = await this.store.createSession(
                this.p,
                {
                  projectId: this.run.projectId,
                  taskId: `expert:${this.run.id}:${hash(callId).slice(0, 16)}`,
                  title: expert.name,
                },
                `child:${this.run.id}:${hash(callId).slice(0, 24)}`,
                { runId: this.run.id, expertId: expert.id },
                c,
              );
              const skills = (expert.runtime?.skills??this.manifest.skills).filter((s) =>
                expert.skillIds.includes(s.id),
              );
              const m: RuntimeManifest = {
                ...this.manifest,
                primaryExpertId: expert.id,
                taskId: child.taskId,
                instructions: [
                  ...(expert.runtime?.instructions??this.manifest.instructions).filter(
                    (i) => !i.source.startsWith("expert:"),
                  ),
                  {
                    source: `expert:${expert.id}`,
                    scope: "",
                    path: "EXPERT.md",
                    revision: "snapshot",
                    content: expert.instructions,
                  },
                ],
                skills,
                files: expert.runtime?.files??this.manifest.files.filter(
                  (f) =>
                    !this.manifest.skills.some((s) =>
                      f.path.startsWith(`${s.directory}/`),
                    ) ||
                    skills.some((s) => f.path.startsWith(`${s.directory}/`)),
                ),
                model: expert.model ?? this.manifest.model,
                mcp: expert.runtime?.mcp??this.manifest.mcp,
                knowledgeRefs: expert.runtime?.knowledgeRefs??this.manifest.knowledgeRefs,
                databaseReferences: expert.runtime?.databaseReferences??this.manifest.databaseReferences.filter(ref=>ref.scopeKind!=="expert"||ref.scopeId===expert.id),
                knowledgeReferences: (expert.runtime?.knowledgeReferences??this.manifest.knowledgeReferences).filter(
                  ref => (expert.runtime?.knowledgeRefs??this.manifest.knowledgeRefs).includes(ref.id),
                ),
                businessTools: (expert.runtime?.businessTools??this.manifest.businessTools).filter(
                  tool => tool.capability!=="knowledge"||(expert.runtime?.knowledgeRefs??this.manifest.knowledgeRefs).length>0,
                ),
                memory: {status:'not_recalled',facts:[],problems:[]},
                experts: [],
                sessionGrants: [],
              };
              const r = await this.store.createRun(
                this.p,
                child.id,
                { content: args.goal, fileIds: args.fileIds ?? [], fileRefs:args.fileRefs??[] },
                `delegate:${hash(callId)}`,
                m,
                c,
              );
              await this.store.emit(
                c,
                this.run.sessionId,
                this.run.id,
                "expert.delegated",
                {
                  expertId: expert.id,
                  name: expert.name,
                  runId: r.id,
                  sessionId: child.id,
                  goal: args.goal,
                },
              );
              return { runId: r.id, sessionId: child.id };
            });
          },
        ),
      );
      tools.push(
        this.tool(
          "expert_status",
          "查看已委派专家的状态",
          Type.Object({}),
          async () => ({
            items: (await this.store.children(this.run.id)).map((c) => ({
              id: c.id,
              sessionId: c.sessionId,
              status: c.status,
              error: c.error,
            })),
          }),
        ),
      );
      tools.push(
        this.tool(
          "expert_input",
          "向本轮专家补充任务信息",
          Type.Object({ runId: Type.String(), content: Type.String() }),
          async (args, callId) => {
            const child = (await this.store.children(this.run.id)).find(
              (c) => c.id === args.runId,
            );
            if (!child || terminal.has(child.status))
              throw new EngineError(
                409,
                "expert_inactive",
                "专家不存在或已完成",
              );
            return this.store.command(
              this.p,
              child.id,
              { type: "steer", content: args.content },
              `expert:${hash(callId)}`,
            );
          },
        ),
      );
      tools.push(
        this.tool(
          "cancel_expert",
          "取消本轮专家子任务",
          Type.Object({ runId: Type.String() }),
          async (args, callId) => {
            const child = (await this.store.children(this.run.id)).find(
              (c) => c.id === args.runId,
            );
            if (!child)
              throw new EngineError(404, "expert_missing", "专家子任务不存在");
            return this.store.command(
              this.p,
              child.id,
              { type: "cancel" },
              `expert:${hash(callId)}`,
            );
          },
        ),
      );
      tools.push(
        this.tool(
          "wait_experts",
          "等待本轮专家完成并收集结果",
          Type.Object({}),
          async () => {
            this.phase = "waiting";
            await this.store.update(this.lease, { status: "waiting_children" });
            try {
              while (true) {
                await this.barrier();
                const children = await this.store.children(this.run.id);
                if (
                  children.every(
                    (c) => terminal.has(c.status) || c.status === "interrupted",
                  )
                ) {
                  const result = [];
                  for (const child of children) {
                    const events = [];
                    let after = 0;
                    while (true) {
                      const page = await this.store.events(child.sessionId, after, 1000);
                      events.push(...page.filter(e => e.type === 'message.completed' || e.type === 'artifact.created'));
                      if (page.length < 1000) break;
                      after = page[page.length-1]!.sequence;
                    }
                    result.push({
                      runId: child.id,
                      status: child.status,
                      messages: events
                        .filter((e) => e.type === "message.completed")
                        .map((e) => e.payload),
                      artifacts: events
                        .filter((e) => e.type === "artifact.created")
                        .map((e) => e.payload),
                    });
                  }
                  await this.resumeExecution();
                  await this.store.append(this.lease, "experts.completed", {
                    items: result,
                  });
                  return result;
                }
                await delay(500);
              }
            } finally {
              this.phase = "active";
            }
          },
        ),
      );
    }
    return tools;
  }
  async execute() {
    const local = await mkdtemp(join(tmpdir(), "nebu-runtime-"));
    let commandTimer: NodeJS.Timeout | undefined;
    try {
      const prior = this.session.checkpoint;
      this.workspace = prior?.workspace ?? [];
      this.modelAttempt = prior?.runId === this.run.id ? prior.modelAttempt : 0;
      // Restore writable state, then re-materialize this run's frozen resource versions.
      for (const issue of this.manifest.degraded ?? []) await this.store.append(this.lease,"context.degraded",issue);
      for (const f of [...this.workspace, ...this.manifest.files]) {
        if(this.manifest.skills.some(s=>!s.available && f.path.startsWith(s.directory+"/")))continue;
        this.objects.authorize(
          this.run.tenantId,
          this.run.ownerId,
          f.objectKey,
        );
        if(this.sandbox.materialize)await this.sandbox.materialize(f,this.objects);
        else await this.sandbox.write(f.path,await this.objects.bytes(f.objectKey,f.sha256));
      }
      for (const ref of this.run.input.resolvedFiles ?? this.run.input.fileIds.map(id=>({id,version:undefined}))) {
        const a = await this.store.artifact(this.p, ref.id, ref.version);
        const path=`inputs/${a.id}/v${a.version}/${a.name.replace(/[\\/]/g, "_")}`;
        if(this.sandbox.materialize)await this.sandbox.materialize({path,sha256:a.sha256,objectKey:a.objectKey,size:a.size,mediaType:a.mediaType},this.objects);
        else await this.sandbox.write(path,await this.objects.bytes(a.objectKey,a.sha256));
      }
      this.manager = SessionManager.inMemory(
        "/workspace",
        undefined,
        prior?.entries as FileEntry[] | undefined,
      );
      if (prior?.leafId) this.manager.branch(prior.leafId);
      for (const record of await this.store.toolRecords(this.run.id))
        this.records.set(record.callId, record);
      const requiredSkills = [];
      for (const skill of this.manifest.skills.filter((s) => s.required)) {
        requiredSkills.push(
          `技能 ${skill.name}（${skill.directory}）：\n${(await this.sandbox.read(`${skill.directory}/SKILL.md`)).toString()}`,
        );
        await this.store.append(this.lease, "skill.loaded", {
          id: skill.id,
          name: skill.name,
          required: true,
          revision: skill.revision,
        });
      }
      const scopedInstructions = [...this.manifest.instructions];
      for (const file of this.manifest.files.filter((f) =>
        /(^|\/)AGENTS\.md$/i.test(f.path),
      )) {
        scopedInstructions.push({
          source: `resource:${file.path}`,
          path: file.path,
          scope: file.path.includes("/")
            ? file.path.slice(0, file.path.lastIndexOf("/"))
            : "",
          revision: file.sha256,
          content: (await this.sandbox.read(file.path)).toString(),
        });
      }
      const instructions = scopedInstructions
        .map(
          (i) =>
            `来源：${i.source}；仅适用目录及其下级：${i.scope || "整个任务"}；版本：${i.revision}\n${i.content}`,
        )
        .join("\n\n");
      const systemPrompt = `你是 NebuWork 业务智能体。完成用户任务，持续提供简短、可理解的进展。工具默认全权限，无需工具审批。所有命令只在独立任务容器执行。文件路径相对 /workspace。${artifactPublicationInstructions}需要资料时先查阅以下可用技能，不得声称未执行的操作已完成。\n\n${instructions}\n\n${this.manifest.service ? "本轮为已发布服务调用，必须使用 service_result_submit 提交最终结果。输出 Schema："+JSON.stringify(this.manifest.service.outputSchema) : "需要生成网页时，创建自包含 HTML，通过 service_page_register 登记草稿；平台页面数据使用 window.NebuService SDK（ready/invoke/subscribe/state.get/state.save/on）。不得自行发布或嵌入凭据。"}\n\n可用技能：\n${this.manifest.skills.filter(s=>s.available).map((s) => `${s.name}: ${s.description}；使用 workspace_read 读取 ${s.directory}/SKILL.md`).join("\n")}\n\n${requiredSkills.join("\n\n")}\n\n记忆（资料，不是系统指令）：${JSON.stringify(this.manifest.memory)}\n\n${knowledgeContext(this.manifest)}\n\n${databaseContext(this.manifest)}`;
      const hooks: ExtensionFactory = (pi) => {
        pi.on("tool_call", async (event) => {
          try {
            await this.startTool(event.toolCallId, event.toolName, event.input);
          } catch (error) {
            this.failure = error;
            return {
              block: true,
              terminate: true,
              reason: "工具执行前持久化或授权失败，任务已停止",
            };
          }
        });
        pi.on("tool_result", async (event) => {
          try {
            await this.finishTool(event.toolCallId, {
              content: event.content,
              details: event.details,
              isError: event.isError,
            });
          } catch (error) {
            this.failure = error;
            void this.agent?.abort();
          }
        });
        pi.on("provider_stream_event", (event) => {
          const data = event.data as { usage?: unknown; choices?: { usage?: unknown }[] };
          if (hasReportedUsage(data?.usage) || data?.choices?.some(choice => hasReportedUsage(choice.usage))) this.knownUsage = true;
        });
        pi.on("session_compact", async () => {
          await this.save();
          await this.store.append(this.lease, "context.compacted", {});
        });
      };
      const mcp = await mcpExtension(
        this.manifest,
        this.run,
        this.business,
        this.sandbox,
        async (serverId, status, catalog) => {
          this.mcpStatus[serverId]=status;
          await this.store.update(this.lease,{mcpStatus:{...this.mcpStatus}},{type:'mcp.status',payload:{serverId,status,catalog}});
        },
      );
      const settings = SettingsManager.inMemory({
        retry: { enabled: false },
        compaction: { enabled: true },
        defaultTools: [],
      });
      const loader = new DefaultResourceLoader({
        cwd: local,
        agentDir: local,
        settingsManager: settings,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        systemPrompt,
        extensionFactories: [hooks, mcp.extension],
      });
      await loader.reload();
      const runtime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      const binding = this.manifest.model,
        providerId = `nebu-${hash(binding.providerId).slice(0, 16)}`;
      runtime.registerProvider(providerId, {
        baseUrl: binding.baseUrl,
        api: "openai-completions",
        apiKey: "runtime-required",
        models: [
          {
            id: binding.model,
            name: binding.model,
            reasoning: binding.reasoning,
            input: binding.images ? ["text", "image"] : ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: binding.contextWindow,
            maxTokens: binding.maxTokens,
          },
        ],
      });
      const baseStream = runtime.streamSimple.bind(runtime);
      runtime.streamSimple = (model, context, options) => {
        const output = createAssistantMessageEventStream();
        void (async () => {
          const callId = id();
          let started = false;
          let measured: ReturnType<typeof tokens> = null;
          let reported = false;
          try {
            await this.save();
            if (++this.modelAttempt > this.manifest.maxTurns)
              throw new EngineError(
                422,
                "turn_limit",
                "已达到本轮模型调用上限",
              );
            await this.business.authorize(
              this.run,
              "model",
              binding.providerId,
            );
            const secret = await this.business.credential(
              this.run,
              binding.credentialRef,
              "model",
            );
            if (!secret.apiKey)
              throw new EngineError(
                422,
                "model_credentials",
                "系统未提供模型凭据",
              );
            await runtime.setRuntimeApiKey(providerId, secret.apiKey);
            await this.store.checkpoint(this.lease, this.checkpoint());
            await this.store.usage.start(this.lease, callId, options?.cacheRetention === "none" ? "summary" : "assistant", { model: model.id, providerId: binding.providerId }, this.modelAttempt);
            started = true;
            this.knownUsage = false;
            this.modelStarted = Date.now();
            this.firstText = false;
            const stream = baseStream(model, context, {
              ...options,
              onProviderStreamEvent: async (data, actualModel) => {
                const chunk = data as { usage?: unknown; choices?: { usage?: unknown }[] };
                if (hasReportedUsage(chunk?.usage) || chunk?.choices?.some(choice => hasReportedUsage(choice.usage))) reported = true;
                await options?.onProviderStreamEvent?.(data, actualModel);
              },
              headers: { ...options?.headers, ...secret.headers },
              temperature: binding.temperature,
              maxTokens: binding.maxTokens,
              signal: AbortSignal.any([
                this.signal,
                ...(options?.signal ? [options.signal] : []),
                AbortSignal.timeout(binding.timeoutMs),
              ]),
            });
            let terminalEvent: any;
            for await (const event of stream) {
              if (event.type === "done") measured = reported ? tokens(event.message.usage) : null;
              if (event.type === "error") measured = reported ? tokens(event.error.usage) : null;
              if (event.type === "done" || event.type === "error") terminalEvent = event;
              else output.push(event);
            }
            const result = await stream.result();
            measured = reported ? tokens(result.usage) : measured;
            await this.store.usage.finish(this.lease, callId, measured);
            started = false;
            if (terminalEvent) output.push(terminalEvent);
            output.end(result);
          } catch (error) {
            if (started) {
              try { await this.store.usage.finish(this.lease, callId, measured); }
              catch (meterError) { this.failure ??= meterError; }
            }
            this.failure ??= error;
            const message = {
              role: "assistant",
              content: [],
              api: "openai-completions",
              provider: providerId,
              model: binding.model,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0,
                },
              },
              stopReason: "error",
              errorMessage:
                error instanceof EngineError ? error.message : "模型执行中断",
              timestamp: Date.now(),
            } as AssistantMessage;
            output.push({ type: "error", reason: "error", error: message });
            output.end(message);
          }
        })();
        return output;
      };
      if(this.manifest.platformMcp){this.platformClient=new PlatformMcpClient(this.business,this.run);await this.platformClient.connect();}
      const toolDefinitions = [...this.tools(),...(this.platformClient?.definitions()??[])];
      const created = await createAgentSession({
        cwd: local,
        agentDir: local,
        modelRuntime: runtime,
        model: runtime.getModel(providerId, binding.model)!,
        thinkingLevel: binding.reasoning ? "medium" : "off",
        resourceLoader: loader,
        sessionManager: this.manager,
        settingsManager: settings,
        noTools: "builtin",
        customTools: toolDefinitions,
      });
      this.agent = created.session;
      this.agent.agent.toolExecution = "sequential";
      await this.agent.bindExtensions({});
      this.mcpCatalog=await mcp.ready();
      if(this.platformClient)this.mcpCatalog.nebuwork=this.platformClient.tools;
      await this.store.update(this.lease,{mcpCatalog:this.mcpCatalog});
      if(prior?.runId===this.run.id && prior.mcpCatalog && hash(prior.mcpCatalog)!==hash(this.mcpCatalog))throw new EngineError(409,"mcp_catalog_changed","MCP 工具目录已变化，无法按原快照恢复；请重新执行新一轮");
      await this.save();
      this.agent.setActiveToolsByName([
        ...toolDefinitions.map((t) => t.name),
        ...this.agent
          .getAllTools()
          .map((t) => t.name)
          .filter((n) => n.startsWith("mcp__") || n.includes("mcp_resource")),
      ]);
      this.agent.agent.state.tools = this.agent.agent.state.tools.map(
        (tool) => ({
          ...tool,
          execute: async (...args) => {
            const prior = this.records.get(args[0]);
            if (prior?.status === "completed")
              return prior.result as Awaited<ReturnType<typeof tool.execute>>;
            return tool.execute(...args);
          },
        }),
      );
      const abort = () => {
        void this.agent?.abort();
      };
      this.signal.addEventListener("abort", abort, { once: true });
      this.agent.subscribe((event) => {
        if (
          event.type === "message_start" &&
          event.message.role === "assistant"
        ) {
          this.flushDelta();
          this.messageId = `assistant:${this.run.id}:${id()}`;
          const messageId = this.messageId;
          this.serialize(() =>
            this.store.append(this.lease, "message.created", {
              messageId,
              role: "assistant",
              content: "",
            }),
          );
        }
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          if (!this.firstText) {
            this.firstText = true;
            const latency = Date.now() - this.modelStarted;
            this.serialize(() =>
              this.store.metric("model_first_text_ms", latency),
            );
          }
          this.delta += event.assistantMessageEvent.delta;
          if (!this.deltaTimer)
            this.deltaTimer = setTimeout(() => {
              this.deltaTimer = undefined;
              this.flushDelta();
            }, 60);
        }
        if (
          event.type === "message_end" &&
          event.message.role === "assistant"
        ) {
          this.flushDelta();
          const message = event.message;
          const messageId = this.messageId;
          const usageKnown = this.knownUsage;
          this.serialize(async () => {
            await this.store.append(this.lease, "message.completed", {
              messageId,
              role: "assistant",
              content: message.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join(""),
              stopReason: message.stopReason,
              usageKnown,
              metered: true,
              usage: usageKnown
                ? {
                    input: message.usage.input,
                    output: message.usage.output,
                    cacheRead: message.usage.cacheRead,
                    cacheWrite: message.usage.cacheWrite,
                    totalTokens: message.usage.totalTokens,
                  }
                : null,
            });
            if (usageKnown) {
              await this.store.metric(
                "model_input_tokens",
                message.usage.input,
              );
              await this.store.metric(
                "model_output_tokens",
                message.usage.output,
              );
            }
          });
        }
      });
      commandTimer = setInterval(() => {
        void this.pollCommands().catch((e) => {
          this.failure = e;
          void this.agent?.abort();
        });
      }, 500);
      await this.syncWorkspace();
      await this.save();
      await this.store.update(
        this.lease,
        { status: "running" },
        {
          type: "run.started",
          payload: {
            model: binding.model,
            permissionProfile: "full_access",
            manifestHash: this.run.manifestHash,
          },
        },
      );
      if (prior?.runId === this.run.id) {
        await this.recoverPendingTools();
        await this.pollCommands();
        const tail = this.agent.agent.state.messages.at(-1);
        if (!tail) await this.agent.prompt(this.run.input.content);
        else if (tail.role !== "assistant") await this.agent.agent.continue();
        else if ((tail as AssistantMessage).stopReason !== "stop")
          throw new EngineError(
            409,
            "tool_outcome_unknown",
            "上次模型尝试未完整提交，需要核对后重新执行",
          );
      } else await this.agent.prompt(this.run.input.content);
      this.flushDelta();
      await this.save();
      if (this.failure) throw this.failure;
      const last = this.agent.messages
        .filter((m) => m.role === "assistant")
        .at(-1) as AssistantMessage | undefined;
      if (last?.stopReason === "error" || last?.stopReason === "aborted")
        throw new EngineError(502, "model_interrupted", "模型响应未完整完成");
      await this.store.update(
        this.lease,
        { status: "completed" },
        { type: "run.completed", payload: {} },
      );
      this.signal.removeEventListener("abort", abort);
    } finally {
      if (commandTimer) clearInterval(commandTimer);
      if (this.deltaTimer) clearTimeout(this.deltaTimer);
      this.agent?.dispose();
      await this.platformClient?.close();
      await rm(local, { recursive: true, force: true });
    }
  }
  private async pollCommands() {
    if (this.phase === "waiting" || this.polling) return;
    this.polling = true;
    try {
      for (const c of await this.store.commands(this.lease)) {
        if (c.type !== "steer" || this.commandIds.has(c.id)) continue;
        this.commandIds.add(c.id);
        this.agent!.agent.steer({
          role: "user",
          content: [{ type: "text", text: c.content! }],
          timestamp: Date.now(),
          commandId: c.id,
        } as any);
      }
    } finally {
      this.polling = false;
    }
  }
  private async recoverPendingTools() {
    const branch = this.manager.getBranch();
    const messages = branch
      .filter((e) => e.type === "message")
      .map((e) => (e as any).message);
    const completed = new Set(
      messages.filter((m) => m.role === "toolResult").map((m) => m.toolCallId),
    );
    for (const message of messages.filter((m) => m.role === "assistant"))
      for (const call of message.content.filter(
        (c: any) => c.type === "toolCall",
      )) {
        if (completed.has(call.id)) continue;
        let record = this.records.get(call.id);
        let result: any;
        if (record?.status === "completed") {
          if(call.name.startsWith('mcp__nebuwork__'))await this.platformClient?.authorize(call.name,call.arguments,call.id);
          result = record.result;
        }
        else {
          if (record?.replay === "reconcile") {
            const reconciled = this.manifest.businessTools.some(
              (t) => t.name === call.name,
            )
              ? await this.business.reconcile(this.run, call.name, call.id)
              : call.name.startsWith("mcp__nebuwork__") && this.platformClient
                ? await this.platformClient.reconcile(call.name,call.id) : { status: "unknown" };
            if (reconciled.status === "completed" && "result" in reconciled)
              result = reconciled.result;
            else if (reconciled.status !== "not_started")
              throw new EngineError(
                409,
                "tool_outcome_unknown",
                `工具 ${call.name} 的执行结果需要核对，未自动重放`,
                { callId: call.id },
              );
          }
          if (result === undefined) {
            await this.startTool(call.id, call.name, call.arguments);
            const tool = this.agent!.agent.state.tools.find(
              (t) => t.name === call.name,
            );
            if (!tool)
              throw new EngineError(
                422,
                "tool_missing",
                `恢复所需工具不可用：${call.name}`,
              );
            result = await tool.execute(call.id, call.arguments, this.signal);
          }
          await this.finishTool(call.id, result);
        }
        this.manager.appendMessage({
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.name,
          content: result.content ?? textResult(result).content,
          details: result.details ?? {},
          isError: result.isError ?? false,
          timestamp: Date.now(),
        });
      }
    // createAgentSession reconstructs before pending results are repaired. Recreate its live
    // context from the authoritative manager, never by editing only the persisted transcript.
    this.agent!.agent.state.messages =
      this.manager.buildSessionContext().messages;
    await this.save();
  }
}
