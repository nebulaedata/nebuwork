import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { secureUuidPlugin } from './tooling/secure-uuid.mjs';

const uuidHelper = new URL('./src/uuid.js', import.meta.url);
export default defineConfig({
  plugins: [react(), secureUuidPlugin(uuidHelper)],
  worker: { plugins: () => [secureUuidPlugin(uuidHelper)] },
  optimizeDeps: { exclude: ['monaco-editor'] },
  server: { proxy: { "/api": "http://127.0.0.1:8765" } },
  build: {
    outDir: "../nebulae/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});
