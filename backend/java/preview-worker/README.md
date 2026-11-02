# File preview worker

Java 17 standalone process; unrelated to the task/model execution Worker. Java's `nebu.files.enabled` and New2's `FILE_TRANSFERS_ENABLED` default off. Apply Java V27/V28 and upgrade New2 before activation. V27 is immutable; V28 adds the account lease column and unique index.

```sh
export PREVIEW_API_URL=https://internal-java-host/environment/nwaa
export PREVIEW_WORKER_KEY='<same private 32+ character key configured in Java>'
docker compose build
docker compose up -d
```

The API URL includes the existing Java environment/context prefix. Keep it on a private network. Do not put the key in the browser or commit a populated `.env`.

Defaults: one job, 4 CPU, 16 GiB RAM, JVM heap 8 GiB, scratch quota 64 GiB and timeout 60 minutes. `PREVIEW_TIMEOUT_MS`, `PREVIEW_SCRATCH_BYTES` and Compose resources are configurable. Set the matching Java timeout. Every instance needs its own scratch volume with a host filesystem quota; a process lock prevents simultaneous use, and restart removes abandoned `job-*` directories. SQL leases fence stale workers. SQLite's trusted JNI library is extracted to `/work/.native`, since Docker tmpfs normally has `noexec`.

The entrypoint installs IPv4/IPv6 egress rejection for converter UID 10002. LibreOffice drops to that UID, receives no API credentials, runs with a fresh high-security profile and cannot contact linked resources. The Java process retains authenticated internal HTTP access. Read-only root, limited capabilities, no-new-privileges and pids/memory/CPU limits are included in Compose. Keep these options when moving to another scheduler; fail startup if equivalent isolation cannot be installed.

`mvn test` checks streamed CSV, HSSF/XSSF cache values and coordinates, actual PDF text indexes, blocked XML entities and bounded CSV fields. `FormatAcceptance` is an opt-in test class for generated small/large Office documents and exact 2 GiB CSV, not a production business-file importer. The frontend repository's `docs/file-preview-delivery.md` contains cross-repository rollout and validation records.
