import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests run against a real PostgreSQL database (DATABASE_URL, e.g. residenceflow_test).
export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "tests/stubs/empty.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
