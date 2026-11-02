import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(root, process.argv[2] || "agent-hub-proto-update");

const mappings = [
  ["mock.js", "apps/web/src/data/mock.js"],
  ["icons.js", "apps/web/src/shared/icons.js"],
  ["styles.css", "apps/web/src/styles.css"],
  ["assets/logo.svg", "apps/web/public/assets/logo.svg"],
  ["assets/avatar.png", "apps/web/public/assets/avatar.png"],
];

for (const [source, target] of mappings) {
  const targetPath = resolve(root, target);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(resolve(sourceRoot, source), targetPath);
}

process.stdout.write(`Synced ${mappings.length} prototype files from ${sourceRoot}\n`);
