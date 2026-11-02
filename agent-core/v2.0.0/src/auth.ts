import { jwtVerify, SignJWT } from "jose";
import { EngineError, type Principal } from "./contracts.js";
const key = (secret: string) => new TextEncoder().encode(secret);
export async function verify(
  token: string | undefined,
  secret: string,
): Promise<Principal> {
  try {
    const { payload } = await jwtVerify(
      (token ?? "").replace(/^Bearer /, ""),
      key(secret),
      {
        issuer: "nebuwork",
        audience: "nebu-agent-engine",
        algorithms: ["HS256"],
      },
    );
    if (
      typeof payload.sub !== "string" ||
      typeof payload.tenantId !== "string" ||
      typeof payload.ownerId !== "string" ||
      !Array.isArray(payload.projects) ||
      !Array.isArray(payload.scopes) ||
      !payload.projects.every((v) => typeof v === "string") ||
      !payload.scopes.every((v) => typeof v === "string")
    )
      throw new Error("claims");
    return {
      service: payload.sub,
      tenantId: payload.tenantId,
      ownerId: payload.ownerId,
      projects: payload.projects as string[],
      scopes: payload.scopes as string[],
    };
  } catch {
    throw new EngineError(401, "unauthorized", "服务认证无效或已过期");
  }
}
export async function sign(p: Principal, secret: string, expiresIn = "5m") {
  return new SignJWT({ ...p })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.service)
    .setIssuer("nebuwork")
    .setAudience("nebu-agent-engine")
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key(secret));
}
