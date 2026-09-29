import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Needs PostgreSQL (PG* env vars) and .bin/postgrest — see tests/integration/harness.ts
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
