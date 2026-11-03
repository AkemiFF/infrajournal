import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@infrajournal/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      "@infrajournal/documentation": fileURLToPath(
        new URL("./packages/documentation/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
