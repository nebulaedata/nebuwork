# Internal NebuWork system MCP

The independent `src/platform-mcp-main.ts` process implements stateless Streamable HTTP on `/mcp`, using the pinned official TypeScript SDK 1.32.1 and protocol 2025-11-25. It has no business database client or Docker mount. Java owns schemas, grants, scopes, operations and controlled resources.

Build with `npm run build`; run `npm run start:platform-mcp`, or enable the `platform-mcp` deployment profile in `deploy/compose.yml`. Configure `BUSINESS_API_URL`, `PLATFORM_MCP_SERVICE_KEY` (independent, at least 32 characters), `PLATFORM_MCP_HOST` (default 127.0.0.1), and `PLATFORM_MCP_PORT` (default 42120). Only expose it on the intended internal network. Java's `nebu.platform-mcp.url` must be reachable from Workers, and `nebu.platform-mcp.service-key` must match.

`GET /health/live` is process liveness. MCP is POST-only; browser origins and missing run authorization are rejected. Tool schemas come only from Java's current intersected grant. The Worker obtains a short-lived opaque token, keeps it out of model context and checkpoints, and forwards its durable `callId` in protocol metadata. There is no user-supplied identity field in tool inputs.

Enabled new manifests use `mcp__nebuwork__nw_*` tools and suppress overlapping native business tools. Workspace, collaboration and third-party MCP remain unchanged. Old manifests have no `platformMcp` field and keep their original behavior. Resume compares the frozen catalog, reauthorizes cached results, and looks up original operations before any recovery. Unknown remote results remain unknown rather than causing blind resubmission.

`tests/platform-mcp.test.ts` uses the official client over HTTP. The opt-in `tests/platform-mcp-acceptance.ts`, together with Java's `PlatformMcpAcceptanceHostTest`, uses isolated infrastructure and a scripted HTTP model to test the full Java/Worker/MCP path, cross-workbench task creation, S3 output and a draft Agent memory. It is explicitly a scripted-model integration check; final real-model acceptance requires the designated account/resources.

For the full 172-tool catalogue, Java API/configuration, V22 rollout, retained manual actions and acceptance boundaries, see the frontend repository's `docs/platform-mcp-delivery.md` and generated `docs/platform-mcp-tools.md`. Regenerate its catalogue from Java's `PlatformMcpAdapterTest` output; do not maintain another business tool registry in this repository.
