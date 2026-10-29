import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const stub = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "tests/stubs/workers.ts",
);

export default defineConfig({
  test: {
    alias: { "cloudflare:workers": stub },
  },
});
