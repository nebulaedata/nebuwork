import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { secureUuidPlugin } from './tooling/secure-uuid.mjs';

const uuidHelper = new URL('./src/lib/uuid.js', import.meta.url);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const prefix = (env.VITE_API_PREFIX || '/nebulaedev').replace(/\/+$/, '');
  const proxy = {
    [prefix]: {
      target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:18080',
      changeOrigin: false,
      xfwd: true,
    },
  };
  return {
    build: {
      outDir: "dist/client",
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
      // Keep UUID normalization active during development as well as production builds.
      exclude: ['monaco-editor', 'pdfjs-dist', 'pptx-preview'],
    },
    server: {
      port: 5173,
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      // Preserve browser Host/Origin and cookies through the Docker dev gateway.
      proxy,
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [react(), secureUuidPlugin(uuidHelper)],
    worker: { plugins: () => [secureUuidPlugin(uuidHelper)] },
    preview: { proxy },
  };
});
