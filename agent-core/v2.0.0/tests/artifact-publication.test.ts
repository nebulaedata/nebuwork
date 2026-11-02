import { expect, it, vi } from "vitest";
import { resolveArtifactPublication } from "../src/artifact-publication.js";
import { EngineError, type Artifact, type Principal } from "../src/contracts.js";

const principal: Principal = { service: "test", tenantId: "tenant", ownerId: "owner", projects: ["project"], scopes: ["engine:*"] };

it("does not turn database or authorization failures into a new artifact", async () => {
  for (const failure of [new Error("database unavailable"), new EngineError(403, "forbidden", "access revoked")]) {
    const store = { artifact: vi.fn().mockRejectedValue(failure) };
    await expect(resolveArtifactPublication(store, principal, "project", { mode: "update", artifactId: "existing", baseVersion: 1 })).rejects.toBe(failure);
  }
});

it("does not append a version to an artifact in another project", async () => {
  const store = { artifact: vi.fn().mockResolvedValue({ id: "existing", projectId: "other-project", version: 1 } as Artifact) };
  await expect(resolveArtifactPublication(store, principal, "project", { mode: "update", artifactId: "existing", baseVersion: 1 })).rejects.toMatchObject({ status: 404, code: "not_found" });
});
