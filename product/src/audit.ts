/**
 * product/src/audit.ts — the audit trail (user requirement 2026-10-31):
 * collect a log of all user input, the functions called, the data passed,
 * and the output received, so issues can be audited after the fact.
 *
 * Rules:
 * - Never throws: an audit write must never break a user request.
 * - Never stores secrets: keys matching the redact list have their values
 *   replaced with "[redacted]" before anything is serialized (authorization
 *   headers, API keys, tokens, OAuth codes, cookies, passwords).
 * - Bounded: long strings truncate to 2000 chars, arrays to 20 items,
 *   objects to depth 6, and the serialized summary to ~6000 chars.
 * No `cloudflare:workers` imports (plain vitest/node).
 */

export interface AuditEvent {
  kind: string;
  run_id?: string | null;
  subject?: string | null;
  summary?: unknown;
}

const REDACT_KEYS = /authorization|api[_-]?key|secret|password|passwd|token|cookie|bearer|credential|code/i;

/** Deep-copy with redaction and bounds. Plain values pass through.
 * Strings that parse as JSON (request bodies arrive stringified) are
 * parsed and redacted structurally, so secrets inside them never store. */
export function redact(v: unknown, depth = 0): unknown {
  if (typeof v === "string") {
    if (v.length > 2000) return v.slice(0, 2000) + "…[truncated]";
    const head = v.slice(0, 4000);
    if ((head.startsWith("{") || head.startsWith("[")) && depth < 6) {
      try {
        return redact(JSON.parse(head), depth + 1);
      } catch { /* not JSON: keep the string */ }
    }
    return v;
  }
  if (v === null || typeof v !== "object") return v;
  if (depth >= 6) return "[depth-limit]";
  if (Array.isArray(v)) {
    const head = v.slice(0, 20).map((item) => redact(item, depth + 1));
    if (v.length > 20) head.push(`…[${v.length - 20} more]`);
    return head;
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.test(k) ? "[redacted]" : redact(val, depth + 1);
  }
  return out;
}

/** Compact JSON for storage; "" for nothing usable; never throws. */
export function auditSummary(summary: unknown): string {
  try {
    const json = JSON.stringify(redact(summary));
    if (!json || json === "{}") return "";
    return json.length > 6000 ? json.slice(0, 6000) + "…[truncated]" : json;
  } catch {
    return "";
  }
}

/** One audit row. Best-effort: every failure is swallowed. */
export async function auditEvent(
  db: { prepare(sql: string): { bind(...args: unknown[]): { run(): Promise<unknown> } } },
  ev: AuditEvent,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const summary = auditSummary(ev.summary);
    await db.prepare(
      "INSERT INTO audit_log (ts, kind, run_id, subject, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(now, ev.kind, ev.run_id ?? null, ev.subject ?? null, summary, now).run();
  } catch {
    /* audit is best-effort; never break the request it observes */
  }
}
