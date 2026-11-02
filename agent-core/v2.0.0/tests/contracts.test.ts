import { it, expect } from "vitest";
import { hash, safePath, validateManifest } from "../src/contracts.js";
const base = {
  schemaVersion: 1,
  tenantId: "t",
  ownerId: "u",
  projectId: "p",
  taskId: "task",
  resolvedAt: new Date().toISOString(),
  model: {
    providerId: "m",
    revision: "1",
    protocol: "openai-compatible",
    baseUrl: "http://localhost:8080/v1",
    model: "explicit",
    credentialRef: "key",
  },
};
it("rejects missing skills, conflicting AGENTS and escaping paths", () => {
  expect(() =>
    validateManifest({
      ...base,
      skills: [
        {
          id: "s",
          name: "s",
          description: "s",
          directory: "skills/s",
          revision: "1",
          required: true,
        },
      ],
    }),
  ).toThrow("SKILL.md");
  const resource = { sha256: hash("text"), size: 4, objectKey: "key" };
  expect(() =>
    validateManifest({
      ...base,
      files: [
        { ...resource, path: "agent.md" },
        { ...resource, path: "AGENTS.md" },
      ],
    }),
  ).toThrow("重复");
  for (const path of ["../x", "/etc/passwd", "C:\\secret", "a/../b", "./a"])
    expect(() => safePath(path)).toThrow();
});
it("requires explicit models and gives snapshots canonical hashes", () => {
  expect(() => validateManifest({ ...base, model: undefined })).toThrow();
  expect(hash({ a: 1, b: 2 })).toBe(hash({ b: 2, a: 1 }));
});
