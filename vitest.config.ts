import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const sourceAliases = {
  "@found-in-space/shadowline":
    fileURLToPath(new URL(
      "./packages/shadowline/src/index.ts",
      import.meta.url,
    )),
  "@found-in-space/shadowline-astronomy-engine":
    fileURLToPath(new URL(
      "./packages/shadowline-astronomy-engine/src/index.ts",
      import.meta.url,
    )),
};

export default defineConfig({
  resolve: {
    alias: sourceAliases,
  },
  test: {
    testTimeout: 2_000,
    hookTimeout: 2_000,
    exclude: [
      "tests/browser/**",
      "tests/validation/**",
      "node_modules/**",
      "dist/**",
    ],
  },
});
