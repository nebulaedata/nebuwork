# NebuWork quick deployment

[简体中文](README.md) · **English** · [Project home](../README.en.md)

This guide builds and starts a complete local development and evaluation environment from source using the bundled Docker Compose configuration: Web UI, Java backend, agent engine, Workflow, knowledge services, and infrastructure.

On Windows, start from the repository root:

```powershell
.\scripts\Start-Dev.ps1
.\scripts\Get-DevAccess.ps1
```

When startup completes, open [http://localhost:18080](http://localhost:18080) and sign in with the administrator account and generated initial password printed by the script. For Linux / macOS, use the Compose instructions below.

> This deployment is for development and evaluation. It uses HTTP by default and exposes some management ports. Public deployments need additional TLS, access controls, and network isolation. Supply your own model credentials and business data.

## 1. Prerequisites

- Get the complete repository source and open a terminal at the **repository root**, not inside `deploy/`.
- Install and start Docker Engine or Docker Desktop. Use **Linux containers** in Docker Desktop.
- Use Docker Compose v2 with support for `up --wait`.
- Ensure access to container registries and npm, Maven, Python, and Go build dependencies.
- Allocate memory and disk space for multiple services, image builds, and knowledge documents. Remote model APIs do not require a local model; account for local model resources separately.

Check Docker availability:

```text
docker info --format '{{.OSType}}'
docker compose version
```

The first command should return `linux`. Container builds provide the component toolchains; the host does not need Java, Node.js, Python, and Go installed together.

## 2. Start the services

Choose the instructions for your system. Both use `deploy/dev/.env` and separate `nebuwork-dev-*` volumes.

### Windows / PowerShell

```powershell
.\scripts\Start-Dev.ps1
.\scripts\Get-DevAccess.ps1
```

The script generates credentials, starts databases and middleware, initializes configuration, builds applications and the sandbox, starts services and migrations, and initializes the administrator and service connections.

The first start builds images; wait for successful completion. If images already exist and their source has not changed, use:

```powershell
.\scripts\Start-Dev.ps1 -NoBuild
```

### Linux / macOS / Bash

These steps follow the PowerShell startup sequence. Existing integrated validation uses Windows with Docker Desktop Linux containers; confirm image compatibility for other hosts and CPU architectures.

Generate credentials first, then edit ports and the bind address if needed:

```bash
set -e

docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$(pwd)/deploy/dev,target=/workspace/dev" \
  -w /workspace/dev node:22.19.0-slim node init.mjs

# Nginx Workers must read this authentication file, which contains a password hash.
chmod 644 deploy/dev/generated/workflow-ui.htpasswd
```

`--user` makes the generated files belong to the current user so Compose can read `.env`. Adjust read permissions only for the Nginx authentication file above; keep `.env` and other credential files private.

Continue in the same terminal:

```bash
set -e

component() {
  docker compose --env-file deploy/dev/.env -f deploy/dev/compose.component.yml "$@"
}
app() {
  docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml "$@"
}

component config --quiet
app config --quiet
component up -d --wait --wait-timeout 600 \
  mysql redis minio nacos knowledge-postgres knowledge-graph
component run --rm --no-deps init

docker build -t nebuwork-dev-sandbox:2.0.0 \
  -f agent-core/v2.0.0/deploy/sandbox.Dockerfile agent-core/v2.0.0
app build frontend backend engine-api1 workflow knowledge-v101 knowledge-v101-extraction
app up -d --wait --wait-timeout 900 \
  frontend backend engine-api1 engine-api2 engine-worker platform-mcp \
  workflow workflow-ui knowledge-v101 knowledge-v101-extraction
app run --rm --no-deps init
```

This starts two engine APIs and three Workers. The final `init` command registers application connections and must not be skipped.

Find login credentials in the generated `deploy/dev/.env`: `DEV_ADMIN_ACCOUNT` is the account and `DEV_ADMIN_PASSWORD` is its initial password. This file also contains other service secrets; do not publish or commit it.

## 3. Sign in and configure your first task

| Entry point | Default URL | Authentication |
| --- | --- | --- |
| NebuWork | [localhost:18080](http://localhost:18080) | `DEV_ADMIN_ACCOUNT` / `DEV_ADMIN_PASSWORD`; default account: `admin` |
| Native knowledge management UI | [localhost:18081](http://localhost:18081) | Separate development management entry point; prefer authorized knowledge access through the main application for daily use |
| Workflow management UI | [localhost:18082](http://localhost:18082) | `WORKFLOW_UI_ACCOUNT` / `WORKFLOW_UI_PASSWORD`; a separate password from NebuWork |

After changing the administrator password, the script and `.env` still show the initial one. Sign in with the new password. Normal restarts do not reset account passwords.

Configure the application in this order:

1. **Model**: Add an endpoint, model name, and API key in Settings → Model settings. Test the connection and choose a default model.
2. **Expert**: Create an expert with its role, knowledge, rules, or tools. Select Save and publish resources in the expert's Settings → Runtime settings.
3. **Workbench**: Define the business context, associate experts, and publish both business configuration and runtime resources. Mark capabilities as required only when connected and available.
4. **Project**: Create a project from a published workbench and add files and knowledge references.
5. **Task**: Submit a request, inspect execution and tool calls, and verify sources and outputs.

Knowledge features such as embeddings, generation, and OCR also need appropriate model configuration. Memory is not bundled in the default Compose environment. Service publishing, the extension market, and large-file preview have separate activation requirements; see the [development environment guide](dev/README.md).

## 4. Verify the deployment

Inspect both stacks from the repository root:

```text
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.component.yml ps --all
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml ps --all
```

Long-running services should be running, and services with health checks should report `healthy`. Initialization and migration containers normally exit after success. Services without health checks, including Workers, will not show a `healthy` label.

Check the frontend entry point:

```powershell
# Windows
curl.exe --fail http://localhost:18080/healthz
```

```bash
# Linux / macOS
curl --fail http://localhost:18080/healthz
```

This endpoint checks only the frontend entry point. Sign in, verify the model connection, and complete an actual task to validate the model and execution path.

Inspect service logs when needed:

```text
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml logs --tail 100 backend engine-api1 engine-worker
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.component.yml logs --tail 100 mysql nacos knowledge-postgres
```

## 5. Ports and LAN access

Edit the relevant entries in the existing `deploy/dev/.env`, then rerun startup to apply container port changes.

| Setting | Default | Purpose |
| --- | --- | --- |
| `DEV_BIND` | `0.0.0.0` | Bind address for Web and related published ports; use `127.0.0.1` for host-only access |
| `DEV_HTTP_PORT` | `18080` | NebuWork |
| `DEV_KNOWLEDGE_HTTP_PORT` | `18081` | Native knowledge management UI |
| `DEV_WORKFLOW_HTTP_PORT` | `18082` | Workflow management UI |

For LAN access, use `http://SERVER_LAN_IP:18080` and allow the connection through your firewall. `localhost` in a client browser refers to that client, not the remote server.

To change ports **before the first start**, Windows users can generate configuration separately:

```powershell
$devDirectory = (Resolve-Path .\deploy\dev).Path
docker run --rm --mount "type=bind,source=$devDirectory,target=/workspace/dev" -w /workspace/dev node:22.19.0-slim node init.mjs
```

Edit the generated `.env`, then run `Start-Dev.ps1`. On Linux / macOS, edit it after the credential generation step above. Do not create a partial `.env` without the generated secrets: the initializer does not backfill every first-run field.

See the [detailed deployment guide](dev/README.md#端口和凭据) for the full port list and management endpoints, including Nacos and MinIO.

## 6. Stop, start again, and update

### Stop while keeping data

```powershell
# Windows
.\scripts\Stop-Dev.ps1
```

```bash
# Linux / macOS
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml --profile preview stop
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.component.yml --profile preview stop
```

On Windows, start again with `Start-Dev.ps1 -NoBuild`. On Linux / macOS, repeat section 2; skip `docker build` and `app build` only if the required images exist and have not changed.

### Update the source

Back up `.env`, current Nacos configuration, and application volumes first. Review local changes before fetching your target version. A Git checkout can use `git pull --ff-only` to update its current tracking branch.

After a successful pull, rerun `Start-Dev.ps1` on Windows or the complete section 2 sequence on Linux / macOS, including image builds. A container restart or `-NoBuild` does not apply source changes. If preview Workers are enabled, continue using `-Preview`, or rebuild and start that profile separately.

Keep volumes and encryption keys together. Do not delete `.env` to reset configuration or run `down -v` against useful data. Database migrations can affect rollback, so plan updates using version notes and backups.

## 7. Optional large-file preview

Windows:

```powershell
.\scripts\Start-Dev.ps1 -Preview
```

On Linux / macOS, after the base services are running:

```bash
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml --profile preview build preview-worker
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml --profile preview up -d preview-worker
```

Also enable `nebu.files.enabled=true` in Nacos, under namespace `nebuwork-dev`, group `DEFAULT_GROUP`, and configuration `cccs-config-base-dev.yml`. Verify that the backend has applied the setting. Starting the container alone does not enable preview. Conversion requires `NET_ADMIN` and additional memory and temporary space.

## 8. Troubleshooting

| Symptom | Check |
| --- | --- |
| Docker is unavailable or not in Linux mode | Start Docker and check the active context and container mode |
| Image or dependency downloads fail | Inspect build logs, network access, registries, proxy settings, and disk space; rebuild after resolving the issue |
| A port is already in use | Change the corresponding `DEV_*_PORT` in `.env` and rerun startup |
| Linux cannot read `.env` | Check whether root created it; restore private access for the deployment user rather than making all credentials world-readable |
| Workflow login returns 500 | Check `workflow-ui` logs and read permissions on `generated/workflow-ui.htpasswd` |
| Initialization times out or a service is unhealthy | Read service and initialization logs, confirm infrastructure readiness, and rerun startup |
| The UI opens but model calls fail | Verify the endpoint, model name, key, and connectivity from the container; `localhost` inside a container refers to that container |
| A configured expert is missing from tasks | Check the project's business version and publication of the expert's own runtime resources |
| A request fails with zero Tokens | Check model bindings, the engine, and required capabilities; do not require memory before connecting a memory service |

For detailed configuration, account APIs, and validation records, see the [Docker development environment guide](dev/README.md).
