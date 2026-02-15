import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: "node22",
  platform: "node",
  outDir: "dist",
  minify: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
