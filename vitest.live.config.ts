import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Live checks read their credentials from .env when it exists.
if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  test: {
    include: ["src/**/*.live.test.ts"],
  },
});
