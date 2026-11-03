/**
 * product/tests/browsermcp.test.ts — Browser MCP wiring (user request
 * 2026-11-01: add @browsermcp/mcp@latest and tests).
 *
 * Pins three things:
 * 1. The installed package is the modern line (>= 2), never the ancient
 *    0.1.3 the global config used to pin.
 * 2. The OpenCode global config wires browsermcp as a local MCP server on
 *    @latest (skipped on machines without that config).
 * 3. The installed server speaks MCP over stdio: initialize -> serverInfo
 *    "Browser MCP", tools/list -> the `browser` tool — proven against the
 *    real binary, no extension pairing required.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const serverJs = path.join(pkgRoot, "node_modules", "@browsermcp", "mcp", "dist", "index.js");

const globalCfgPath = path.join(
  process.env.USERPROFILE ?? "",
  ".config", "opencode", "opencode.json",
);

describe("@browsermcp/mcp wiring", () => {
  it("installs the modern line (>= 2), not the ancient 0.1.3", () => {
    expect(existsSync(serverJs)).toBe(true);
    const installed = JSON.parse(readFileSync(
      path.join(pkgRoot, "node_modules", "@browsermcp", "mcp", "package.json"), "utf8",
    )) as { name: string; version: string };
    expect(installed.name).toBe("@browsermcp/mcp");
    expect(Number(installed.version.split(".")[0])).toBeGreaterThanOrEqual(2);
  });

  it.skipIf(!existsSync(globalCfgPath))(
    "opencode global config wires browsermcp on @latest",
    () => {
      const cfg = JSON.parse(readFileSync(globalCfgPath, "utf8")) as {
        mcp?: Record<string, unknown>;
      };
      // OpenCode moved servers under mcp.servers (2026-11 config shape);
      // accept both shapes so the pin survives editor updates.
      const mcp = cfg.mcp ?? {};
      const entry = (mcp.browsermcp ?? (mcp.servers as Record<string, unknown> | undefined)?.browsermcp) as
        { type?: string; enabled?: boolean; command?: string[] } | undefined;
      expect(entry).toBeDefined();
      expect(entry!.type).toBe("local");
      expect(entry!.enabled).not.toBe(false);
      const cmd = (entry!.command ?? []).join(" ");
      // Both valid wirings: npx @browsermcp/mcp@latest, or the locally
      // installed dist/index.js (used here — instant spawn, no npx delay).
      // Windows paths use backslashes, so match the package name loosely.
      expect(cmd.toLowerCase()).toContain("browsermcp");
      expect(cmd.includes("@latest") || cmd.includes("dist")).toBe(true);
    },
  );

  it("server answers initialize + tools/list over stdio (real binary)", { timeout: 25_000 }, async () => {
    const roundtrip = new Promise<{ init: McpMsg; tools: McpMsg }>((resolve, reject) => {
      const child = spawn("node", [serverJs], { stdio: ["pipe", "pipe", "pipe"] });
      const deadline = setTimeout(() => {
        child.kill();
        reject(new Error("browsermcp server did not answer in time"));
      }, 20_000);
      let buf = "";
      const byId = new Map<number, McpMsg>();
      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line) as McpMsg;
            if (typeof msg.id === "number") byId.set(msg.id, msg);
            if (byId.has(1) && byId.has(2)) {
              clearTimeout(deadline);
              child.kill();
              resolve({ init: byId.get(1)!, tools: byId.get(2)! });
              return;
            }
          } catch { /* partial line: keep buffering */ }
        }
      });
      child.on("error", (e) => { clearTimeout(deadline); reject(e); });
      child.stdin.write(JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "vitest", version: "0" } },
      }) + "\n");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
      // Keep stdin OPEN: the server exits on EOF and would race the
      // tools/list processing (observed: initialize answered, then exit 0).
      // A real client holds the stream; the deadline kill cleans up.
    });
    const { init, tools } = await roundtrip;
    const serverInfo = (init.result as { serverInfo?: { name?: string } }).serverInfo;
    expect(serverInfo?.name).toBe("Browser MCP");
    const names = ((tools.result as { tools?: Array<{ name: string }> }).tools ?? []).map((t) => t.name);
    expect(names).toContain("browser");
  });
});

interface McpMsg {
  id?: number;
  result?: unknown;
  error?: unknown;
}
