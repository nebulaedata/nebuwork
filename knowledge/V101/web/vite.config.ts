import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    proxy: {
      "/api": process.env.NEBULAEKNO_DEV_API_TARGET || "http://127.0.0.1:19080",
      "/health": process.env.NEBULAEKNO_DEV_API_TARGET || "http://127.0.0.1:19080",
    },
    watch: {
      usePolling: process.env.NEBULAEKNO_DEV_POLLING === "true",
      interval: 1000,
    },
  },
  build: { chunkSizeWarningLimit: 1400 },
});
