import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const stub = (f: string) => fileURLToPath(new URL(`./tests/stubs/${f}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Unit tests run in plain node: stub the workerd-only modules.
      "cloudflare:workers": stub("workers.ts"),
      "@cloudflare/containers": stub("containers.ts"),
    },
  },
  test: {
    // smtp-relay/ is a plain Node service tested with node --test, not vitest.
    exclude: ["node_modules", "smtp-relay/**"],
  },
});
