import { z } from "zod";
import { EngineError, ID, id, type Principal } from "./contracts.js";
import type { Store } from "./store.js";

export const artifactPublicationFields = {
  mode: z.enum(["create", "update"]).optional().describe("create 新建；update 更新。省略时兼容旧请求，按更新目标判断。"),
  artifactId: ID.or(z.literal("")).nullable().optional().describe("仅更新时提供已有成果 ID；缺少或为空时新建成果。"),
  baseVersion: z.number().int().positive().nullable().optional().describe("仅更新时提供已有成果的当前版本；缺少时新建成果，不覆盖原成果。"),
};

type PublicationInput = {
  mode?: "create" | "update";
  artifactId?: string | null;
  baseVersion?: number | null;
};

// Missing update targets become independent version-one artifacts. Existing
// targets still go through addArtifact's transactional version/conflict checks.
export async function resolveArtifactPublication(
  store: Pick<Store, "artifact">,
  principal: Principal,
  projectId: string,
  input: PublicationInput,
): Promise<{ id: string; version: number }> {
  const create = () => ({ id: id(), version: 1 });
  const artifactId = input.artifactId?.trim();
  if (input.mode === "create" || !artifactId || !input.baseVersion) return create();
  let existing;
  try {
    existing = await store.artifact(principal, artifactId);
  } catch (error) {
    if (error instanceof EngineError && error.status === 404 && error.code === "not_found") return create();
    throw error;
  }
  if (existing.projectId !== projectId) throw new EngineError(404, "not_found", "原成果不属于当前项目");
  return { id: existing.id, version: input.baseVersion + 1 };
}

export const artifactPublicationInstructions = "简单查询、状态查看和普通问答直接在对话中回复，不要为了结束任务额外生成文件或发布成果。用户要求文件、报告、导出，或任务确实产生需要保存的交付文件时，使用 publish_artifact 发布，并在回复中使用 artifact://ID/version 引用。发布新成果使用 mode=create，省略 artifactId 和 baseVersion；更新使用 mode=update，并提供真实成果 ID 和当前 baseVersion。缺少 ID、缺少已有版本或目标成果不存在时，系统按新建处理，生成新 ID 和第 1 版。已有成果的版本冲突必须重新读取后处理，不得用新建绕过冲突。发布失败后根据错误修正参数，不得原样重复调用。";
