import { expect, it, vi } from "vitest";
import { validateManifest } from "../src/contracts.js";
import { knowledgeContext } from "../src/knowledge.js";
import { AgentRuntime } from "../src/runtime.js";

const source = (id: string, scopeKind: "project" | "expert", scopeId: string, name = id) => ({ id, scopeKind, scopeId, name });
const knowledgeTools = [{ name: "knowledge_search", description: "检索", capability: "knowledge", operation: "search", replay: "read" }];
const base = {
  schemaVersion: 1, tenantId: "tenant", ownerId: "alice", projectId: "project", taskId: "task",
  resolvedAt: new Date().toISOString(),
  model: { providerId: "model", revision: "1", protocol: "openai-compatible", baseUrl: "https://model.example/v1", model: "test", credentialRef: "key" },
};
const manifest = () => validateManifest({
  ...base,
  knowledgeRefs: ["common", "law", "finance"],
  knowledgeReferences: [source("common", "project", "project", "公共库"), source("law", "expert", "law-expert", "法律法规库"), source("finance", "expert", "finance-expert", "财务库")],
  businessTools: knowledgeTools,
  experts: [{ id: "law-expert", name: "法律法规专家", instructions: "核验原文", runtime: {
    knowledgeRefs: ["common", "law"],
    knowledgeReferences: [source("common", "project", "project", "公共库"), source("law", "expert", "law-expert", "法律法规库")],
    businessTools: knowledgeTools,
  } }],
});

it("shows the model authorized library names, IDs, sources and expert resources", () => {
  const prompt = knowledgeContext(manifest());
  expect(prompt).toContain('"id":"law"');
  expect(prompt).toContain("法律法规库");
  expect(prompt).toContain('"scopeId":"law-expert"');
  expect(prompt).toContain("referenceId");
  expect(prompt).toContain("法律法规专家");
  expect(knowledgeContext(validateManifest({ ...base, knowledgeRefs: ["legacy-ref"] }))).toContain('"id":"legacy-ref"');
});

async function delegate(input = manifest()) {
  const store = {
    children: vi.fn().mockResolvedValue([]),
    fenced: vi.fn(async (_lease, callback) => callback({})),
    createSession: vi.fn().mockResolvedValue({ id: "child-session", taskId: "child-task" }),
    createRun: vi.fn().mockResolvedValue({ id: "child-run" }),
    emit: vi.fn(),
  };
  const runtime = new AgentRuntime(store as any, {} as any, { authorize: vi.fn() } as any, {} as any,
    { id: "run", manifest: input, tenantId: "tenant", ownerId: "alice", projectId: "project", sessionId: "session", workerId: "worker", fence: 1 } as any,
    { id: "session" } as any, new AbortController().signal);
  const tool = (runtime as any).tools().find((tool: any) => tool.name === "delegate_expert");
  await tool.execute("delegate-call", { expertId: "law-expert", goal: "核验法律原文" });
  return validateManifest(store.createRun.mock.calls[0]![4]);
}

it("delegates project and own expert knowledge and excludes other expert libraries", async () => {
  const child = await delegate();
  expect(child.knowledgeRefs).toEqual(["common", "law"]);
  expect(child.businessTools.map(tool => tool.name)).toContain("knowledge_search");
  expect(knowledgeContext(child)).toContain("法律法规库");
  expect(knowledgeContext(child)).not.toContain("财务库");
  expect(child.experts).toEqual([]);
});

it("removes knowledge tools for an explicitly empty child scope and retains old snapshots", async () => {
  const input = manifest();
  Object.assign(input.experts[0]!.runtime!, { knowledgeRefs: [], knowledgeReferences: [] });
  expect((await delegate(input)).businessTools).toEqual([]);
  delete input.experts[0]!.runtime!.knowledgeReferences;
  expect(validateManifest(input).experts[0]!.runtime!.knowledgeRefs).toEqual([]);
  delete input.experts[0]!.runtime!.knowledgeRefs;
  delete input.experts[0]!.runtime!.businessTools;
  expect((await delegate(input)).knowledgeRefs).toEqual(input.knowledgeRefs);
});

it("rejects knowledge directories and expert references outside the frozen scope", () => {
  expect(() => validateManifest({ ...base, knowledgeRefs: ["law"], knowledgeReferences: [source("other", "expert", "law-expert")] })).toThrow("授权范围");
  expect(() => validateManifest({ ...base, knowledgeRefs: ["law"], knowledgeReferences: [source("law", "project", "other-project")] })).toThrow("授权范围");
  const input = manifest();
  input.experts[0]!.runtime!.knowledgeRefs!.push("unrelated");
  expect(() => validateManifest(input)).toThrow("授权范围");
  input.experts[0]!.runtime!.knowledgeRefs = ["finance"];
  expect(() => validateManifest(input)).toThrow("自身授权范围");
});

it("explains the read-only graph, wiki, gallery and durable evidence tools", () => {
  const prompt=knowledgeContext(manifest());
  expect(prompt).toContain("knowledge_graph");expect(prompt).toContain("knowledge_gallery");expect(prompt).toContain("knowledge_wiki_page");expect(prompt).toContain("evidence://ID");expect(prompt).toContain("只使用本轮实际声明的工具");
});
