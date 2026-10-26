import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { testTimeout: 120000, hookTimeout: 60000, include: ["src/**/*.test.ts"] },
});
