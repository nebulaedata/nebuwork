import { defineConfig } from "@playwright/test";
import path from "node:path";

const testPort = process.env.NEBULAE_E2E_PORT ?? "18765";

const python =
  process.env.NEBULAE_PYTHON ??
  path.resolve(
    "..",
    ".venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    baseURL: process.env.NEBULAE_E2E_URL ?? `http://127.0.0.1:${testPort}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.NEBULAE_BROWSER_PATH,
      // Match the desktop UI: headless Chromium otherwise hides every scrollbar.
      ignoreDefaultArgs: ["--hide-scrollbars"],
    },
  },
  webServer: process.env.NEBULAE_E2E_URL
    ? undefined
    : {
        command: `"${python}" ../tests/serve_e2e.py`,
        url: `http://127.0.0.1:${testPort}/api/v1/health`,
        reuseExistingServer: false,
        timeout: 30000,
      },
});
