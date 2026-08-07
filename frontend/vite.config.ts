/// <reference types="vitest/config" />
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      // jsdom defaults to http://localhost:3000/, but .env.test sets
      // VITE_API_BASE_URL=http://localhost/api (no port). MSW resolves
      // relative handler paths (e.g. "/api/seasons") against `location.href`,
      // so the origins must match or requests are reported as unhandled.
      jsdom: { url: "http://localhost/" },
    },
    globals: true,
    setupFiles: "./vitest.setup.ts",
    css: true,
  },
});
