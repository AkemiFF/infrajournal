import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  shims: false,
  outDir: "dist",
  dts: false,
  external: ["yaml", "minimatch", "zod"],
});
