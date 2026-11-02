> 历史功能交付记录：其中的 Nacos、原父工程和部署说明仅描述旧环境。当前独立工程的启动、配置及构建方式以 [README.md](README.md) 为准。

# Workflow 3.5 integration (V14)

Frontend and deployment instructions: `D:/Work/Code/AiCode/NebuWorkAgent/docs/workflow-integration-delivery.md`.

2026-10-16: optional ordered `definition.input_presets` is passed through unchanged by the existing definition/validation endpoints. Task creation continues to persist the user's final `input`, not a preset envelope. No Java business API or schema migration is required. `WorkflowIntegrationTest` now covers presets, revision forwarding, edited inputs, idempotency and account boundaries. Upgrade the 3.5 definition validator before deploying the new frontend; see `D:/Work/Code/AiCode/NebuWorkAgent/docs/workflow-input-presets-delivery.md`. These checks remain for the user to execute.

Apply `src/main/resources/db/migration/V14__workflow_integration.sql` after V13. Configure designated unified actor IDs in `nebu.workflow.admin-ids`. Optional `nebu.workflow.enabled`, `nebu.workflow.base-url`, `nebu.workflow.api-key` only bootstrap the singleton until administrators save the Settings page. Default disabled, root `http://127.0.0.1:8765`, request timeout 15000 ms. Credentials use the existing `nebu.models.encryption-key` with a separate Workflow encryption context.

All management is authenticated through the unified session filter and account ownership. No browser-provided remote origins, cookies or credentials are forwarded. The HTTP client rejects redirects. Creation is durable, fenced and uses stable upstream identities/commands. Ordinary task execution is explicit; interrupted remote runs are never automatically resumed. A remote task created before a failed start remains available for manual control.

Settings, definitions, sources, task actions and downloads use `/api/workflow/settings`, `/api/workflows`, `/api/workflow-tasks`; browser saves use POST. Downloads stream only after the artifact is found in the owned workflow's artifact list. Shared expert/SOP definitions retain account-local remote associations. Existing SOP definitions are not converted or executed.

New `WorkflowIntegrationTest` uses isolated H2 and a mocked HTTP client. The implementation session did not execute tests, builds, migrations or services.
