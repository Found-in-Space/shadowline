import { defineConfig } from "vitest/config";
import { sourceAliases } from "./vitest.config.js";

export default defineConfig({
  resolve: {
    alias: sourceAliases,
  },
  test: {
    include: ["tests/validation/**/*.validation.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
