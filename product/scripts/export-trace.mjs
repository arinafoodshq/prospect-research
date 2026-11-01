/**
 * product/scripts/export-trace.mjs — the model trace file (user request
 * 2026-11-01): fill a local, readable file with every model step — input,
 * process, output — so the owner can see exactly what the model was asked,
 * what it did, and what it returned, per phase, per run.
 *
 * Source: D1 (single source of truth). Model I/O heads come from audit_log
 * (model_call / model_error rows); full values come from the authoritative
 * tables (commercial_brief, plan, assessments, drafts). API rows show the
 * owner's typed input and what the product answered.
 *
 * Usage: node scripts/export-trace.mjs [outputPath]
 * Default output: C:\Users\User\Videos\prospect-trace.md (outside the repo —
 * System B runtime data never lives in the repo).
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT = process.argv[2] ?? "C:\\Users\\User\\Videos\\prospect-trace.md";

function d1(sql) {
  const raw = execSync(
    `npx wrangler d1 execute prospect_research --remote --json --command "${sql.replace(/"/g, "\\\"")}"`,
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed[0]?.results : parsed?.[0]?.results) ?? [];
}

function j(s) { try { return JSON.parse(s); } catch { return null; } }
function esc(s) { return String(s ?? "").replace(/</g, "&lt;"); }

const lines = [];
lines.push("# Prospect Research — model trace");
lines.push("");
lines.push(`Generated: ${new Date().toISOString()} · source: production D1 (audit_log + run tables)`);
lines.push("");

// --- runs overview -----------------------------------------------------------
const runs = d1("SELECT id, status, stop_reason, started_at, substr(consumed,1,300) AS consumed FROM research_run ORDER BY started_at DESC LIMIT 8");
lines.push("## Runs (newest first)");
lines.push("");
for (const r of runs) {
  lines.push(`- **${r.id}** — ${r.status}${r.stop_reason ? ` (${esc(r.stop_reason)})` : ""} — started ${r.started_at} — consumed: ${esc(r.consumed)}`);
}
lines.push("");

// --- model calls (input -> process -> output) --------------------------------
const calls = d1("SELECT ts, subject, summary FROM audit_log WHERE kind IN ('model_call','model_error') ORDER BY id DESC LIMIT 60");
lines.push("## Model steps (input → process → output), newest first");
lines.push("");
for (const c of calls) {
  const s = j(c.summary) ?? {};
  lines.push(`### ${c.ts} — ${c.subject}`);
  lines.push("");
  if (s.phase) lines.push(`- **Phase:** ${s.phase} · model ${s.model} · ${s.duration_ms}ms · tokens in ${s.input_tokens} / out ${s.output_tokens}`);
  if (s.tools) lines.push(`- **Tools offered:** ${Array.isArray(s.tools) ? s.tools.join(", ") : s.tools}`);
  if (s.error) {
    lines.push(`- **ERROR:** ${esc(s.error)}`);
  } else {
    lines.push("");
    lines.push("**Input (what the model was asked — goal head):**");
    lines.push("");
    lines.push("```");
    lines.push(esc(s.goal_head ?? ""));
    lines.push("```");
    lines.push("");
    lines.push("**Output (what the model returned — head):**");
    lines.push("");
    lines.push("```json");
    lines.push(esc(typeof s.output_head === "string" ? s.output_head : JSON.stringify(s.output_head)));
    lines.push("```");
  }
  lines.push("");
}

// --- full authoritative values for the newest run ----------------------------
const newest = runs[0];
if (newest) {
  const full = d1(`SELECT commercial_brief, plan, status, stop_reason FROM research_run WHERE id = '${newest.id}'`)[0];
  if (full?.commercial_brief) {
    lines.push(`## Full commercial brief — ${newest.id}`);
    lines.push("");
    lines.push("```json");
    lines.push(esc(full.commercial_brief));
    lines.push("```");
    lines.push("");
  }
  if (full?.plan) {
    lines.push(`## Full search plan — ${newest.id}`);
    lines.push("");
    lines.push("```json");
    lines.push(esc(full.plan));
    lines.push("```");
    lines.push("");
  }
  const props = d1(`SELECT id, name, status, category FROM prospect WHERE run_id = '${newest.id}' ORDER BY status, name`);
  if (props.length) {
    lines.push(`## Prospects — ${newest.id} (${props.length})`);
    lines.push("");
    for (const p of props) lines.push(`- ${p.status} — **${esc(p.name)}** (${esc(p.category)}) — ${p.id}`);
    lines.push("");
  }
  const drafts = d1(`SELECT d.subject, substr(d.body,1,600) AS body, d.status, p.name FROM outreach_draft d JOIN prospect p ON p.id = d.prospect_id WHERE p.run_id = '${newest.id}'`);
  if (drafts.length) {
    lines.push(`## Drafts — ${newest.id}`);
    lines.push("");
    for (const d of drafts) {
      lines.push(`### ${esc(d.name)} — ${d.status} — subject: ${esc(d.subject)}`);
      lines.push("");
      lines.push("```");
      lines.push(esc(d.body));
      lines.push("```");
      lines.push("");
    }
  }
}

// --- the owner's typed input + product answers (api_request POSTs) -----------
const apis = d1("SELECT ts, subject, summary FROM audit_log WHERE kind='api_request' AND subject LIKE 'POST%' ORDER BY id DESC LIMIT 40");
lines.push("## Owner input → product response (API, newest first)");
lines.push("");
for (const a of apis) {
  const s = j(a.summary) ?? {};
  lines.push(`### ${a.ts} — ${a.subject} → ${s.status}`);
  lines.push("");
  if (s.body) { lines.push("**Input:**"); lines.push(""); lines.push("```json"); lines.push(esc(s.body).slice(0, 2000)); lines.push("```"); lines.push(""); }
  if (s.res) { lines.push("**Output:**"); lines.push(""); lines.push("```json"); lines.push(esc(s.res).slice(0, 1200)); lines.push("```"); lines.push(""); }
}

writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`trace written: ${OUT} (${lines.length} lines)`);
