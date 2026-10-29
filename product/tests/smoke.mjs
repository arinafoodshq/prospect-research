/* smoke.mjs â€” dependency-free load smoke for the UI shell.
 * Reads api.js + app.js, stubs exactly the DOM surface they touch (anything
 * else throws loudly), boots both scripts, and walks the full flow:
 * onboard -> confirm(profile) -> progress -> shortlist -> drafts
 * -> decide (one approve + one reject) -> status, plus back-nav both ways.
 * Exits non-zero with a message on any failure.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiSrc = fs.readFileSync(path.join(here, "..", "public", "api.js"), "utf8");
const appSrc = fs.readFileSync(path.join(here, "..", "public", "app.js"), "utf8");

function fail(msg) {
  console.error("SMOKE FAIL: " + msg);
  process.exit(1);
}
function ok(cond, msg) {
  if (!cond) fail(msg);
  console.log("smoke ok: " + msg);
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function unesc(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/* ---- Minimal fake DOM: only what api.js/app.js touch. Anything else throws. */
function makeClassList() {
  const s = new Set();
  return {
    toggle(name, force) {
      if (force === undefined) { if (s.has(name)) s.delete(name); else s.add(name); }
      else if (force) s.add(name); else s.delete(name);
    },
    add(name) { s.add(name); },
    contains(name) { return s.has(name); },
  };
}

class FakeEl {
  constructor(tag, id) {
    this.tagName = (tag || "div").toUpperCase();
    this.id = id || "";
    this.hidden = false;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = "";
    this.classList = makeClassList();
    this.value = "";
    this.textContent = "";
    this._html = "";
    this._listeners = {};
    this._q = {};
    this._guessInputs = [];
    this._attrs = {};
  }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
    this._html = String(html);
    this.children = [];
    this._q = {};
    this._guessInputs = [];
    // Draft card: materialise subject/body inputs + decision badge.
    const subj = this._html.match(/data-field="subject"[^>]*value="([^"]*)"/);
    const body = this._html.match(/data-field="body"[^>]*>([\s\S]*?)<\/textarea>/);
    if (subj || body) {
      const si = new FakeEl("input");
      si.value = subj ? unesc(subj[1]) : "";
      const bi = new FakeEl("textarea");
      bi.value = body ? unesc(body[1]) : "";
      const badge = new FakeEl("span");
      const m = this._html.match(/<span class="decision ([^"]*)">\[([\s\S]*?)\]<\/span>/);
      badge.textContent = m ? "[" + unesc(m[2]) + "]" : "";
      badge.className = "decision " + (m ? unesc(m[1]) : "");
      this._q['[data-field="subject"]'] = si;
      this._q['[data-field="body"]'] = bi;
      this._q[".decision"] = badge;
    }
    // Profile confirm: materialise assumed-guess inputs (data-idx).
    const re = /<input[^>]*data-idx="(\d+)"[^>]*value="([^"]*)"[^>]*>/g;
    let mm;
    while ((mm = re.exec(this._html))) {
      const inp = new FakeEl("input");
      inp.setAttribute("data-idx", mm[1]);
      inp.value = unesc(mm[2]);
      this._guessInputs.push(inp);
    }
  }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  appendChild(child) { this.children.push(child); return child; }
  querySelector(sel) {
    if (this._q[sel]) return this._q[sel];
    if (sel === "li") return this.children[0] || null;
    fail("querySelector(" + sel + ") hit unimplemented stub on #" + (this.id || this.tagName));
  }
  querySelectorAll(sel) {
    if (sel === "li") return this.children.slice();
    if (sel === "input[data-idx]") return this._guessInputs.slice();
    fail("querySelectorAll(" + sel + ") hit unimplemented stub on #" + (this.id || this.tagName));
  }
}

const IDS = [
  "view-onboard", "view-profile", "view-progress", "view-shortlist", "view-drafts", "view-status",
  "step-nav", "onboard-error", "onboard-form",
  "f-businessName", "f-site", "f-description", "f-q1", "f-q2", "f-q3", "f-q4", "f-q5",
  "profile-fields", "progress-steps", "progress-label", "progress-fill", "progress-budget",
  "prospect-list", "evidence-body", "evidence-hint", "draft-list", "status-board",
  "demo-banner", "mode-line",
  "btn-back-onboard", "btn-confirm-profile", "btn-to-drafts", "btn-to-status",
  "btn-back-shortlist", "btn-back-drafts", "btn-restart", "btn-restart-progress",
];
const els = {};
for (const id of IDS) {
  const tag = id.startsWith("view-") ? "section" : id.startsWith("btn-") ? "button"
    : id === "onboard-form" ? "form" : id === "profile-fields" ? "dl"
    : id === "prospect-list" || id === "progress-steps" ? "ol" : "div";
  els[id] = new FakeEl(tag, id);
}
els["step-nav"].querySelectorAll = () => ["onboard", "profile", "progress", "shortlist", "drafts", "status"].map((v) => ({
  getAttribute: (k) => (k === "data-view" ? v : null),
  classList: makeClassList(),
}));

const documentStub = new Proxy({
  getElementById(id) {
    if (!els[id]) fail("getElementById(" + JSON.stringify(id) + ") is outside the known DOM surface");
    return els[id];
  },
  createElement(tag) { return new FakeEl(tag); },
  readyState: "complete",
  addEventListener() {},
  querySelectorAll() { return []; },
}, {
  get(t, p) {
    if (p in t) return t[p];
    fail("document." + String(p) + " is outside the stubbed DOM surface");
  },
});

const windowStub = { location: { search: "" }, scrollTo() {} };

const sandbox = {
  document: documentStub,
  window: windowStub,
  location: windowStub.location,
  setInterval, clearInterval, setTimeout, clearTimeout,
  Promise, URLSearchParams, encodeURIComponent, JSON, Math, Object, Array, String, Number, parseInt,
  console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(apiSrc, sandbox, { filename: "api.js" });
if (!sandbox.window.ApiLayer) fail("api.js did not install window.ApiLayer");
vm.runInContext(appSrc, sandbox, { filename: "app.js" });

function fire(el, type, evt) {
  const fns = el._listeners[type] || [];
  let out;
  for (const fn of fns) out = fn.call(el, evt || {});
  return out;
}
function visible(id) { return els[id].hidden === false; }
const evt = (extra) => Object.assign({ preventDefault() {}, target: {} }, extra || {});

/* ---- Walk the flow. */
ok(visible("view-onboard"), "boots on the onboard view");

els["f-businessName"].value = "Adaeze Catering Services";
els["f-site"].value = "";
els["f-description"].value = "Office lunch packs for 20-200 staff around Ikeja GRA.";
els["f-q1"].value = "";
els["f-q3"].value = "";
await fire(els["onboard-form"], "submit", evt());
await tick(); await tick();
ok(visible("view-profile"), "submit onboard -> profile confirm view");

{
  const guesses = els["profile-fields"].querySelectorAll("input[data-idx]");
  ok(guesses.length >= 2, guesses.length + " assumed field(s) editable inline");
  guesses[0].value = "Ikeja + Yaba (edited inline)";
}
// Capture what confirmBrief receives to prove inline edits stick.
let confirmedProfile = null;
{
  const MockApi = sandbox.window.ApiLayer.MockApi;
  const orig = MockApi.prototype.confirmBrief;
  MockApi.prototype.confirmBrief = function (profile) {
    confirmedProfile = JSON.parse(JSON.stringify(profile));
    return orig.call(this, profile);
  };
}
await fire(els["btn-confirm-profile"], "click", evt());
await new Promise((r) => setTimeout(r, 2100)); // mock runProgress ticks (~1.75s)
await tick(); await tick();
ok(confirmedProfile && confirmedProfile.fields.some((f) => f.value === "Ikeja + Yaba (edited inline)"),
  "inline guess edit reaches confirmBrief");
ok(visible("view-shortlist"), "confirm -> progress -> shortlist view");
ok(els["prospect-list"].children.length === 6, "shortlist shows 6 prospects, saw " + els["prospect-list"].children.length);
ok(els["evidence-body"].innerHTML.length > 20, "selecting a prospect shows evidence");

await fire(els["btn-to-drafts"], "click", evt());
await tick(); await tick();
ok(visible("view-drafts"), "shortlist -> drafts view");
ok(els["draft-list"].children.length === 4, "drafts view lists 4 drafts, saw " + els["draft-list"].children.length);

{
  const drafts = els["draft-list"].children;
  const clickOn = async (div, act) => {
    const fns = div._listeners.click || [];
    for (const fn of fns) await fn.call(div, { target: { dataset: { act } } });
    await tick();
  };
  await clickOn(drafts[0], "approve");
  await clickOn(drafts[1], "reject");
  const badge0 = drafts[0].querySelector(".decision").textContent;
  const badge1 = drafts[1].querySelector(".decision").textContent;
  ok(/approved/.test(badge0), "first draft badge shows approved (" + badge0 + ")");
  ok(/rejected/.test(badge1), "second draft badge shows rejected (" + badge1 + ")");
}

await fire(els["btn-to-status"], "click", evt());
await tick();
ok(visible("view-status"), "drafts -> status board view");
{
  await tick();
  const cols = els["status-board"].children.filter((c) => c.className === "column");
  ok(cols.length === 5, "status board has 5 columns incl. deferred (no sent column), saw " + cols.length);
  const all = cols.map((c) => c.innerHTML).join("\n");
  ok(!/\bsent\b/i.test(all), "no 'sent' concept anywhere on the draft board");
  const campaigns = els["status-board"].children.filter((c) => c.className === "campaigns");
  ok(campaigns.length === 1, "campaigns monitor section renders on the status board");
  ok(/Ikeja offices/.test(campaigns[0].innerHTML), "campaigns section lists the demo campaign");
  ok(!/ready to send/i.test(all), "no 'ready to send' copy on the board");
  ok(!/Nothing here\./.test(all), "no dead-end 'Nothing here.' microcopy");
  const followCol = cols.find((c) => /Follow-ups/.test(c.innerHTML));
  ok(!!followCol, "follow-ups column exists");
  const approvedName = els["draft-list"].children[0].innerHTML.match(/To: ([^<]*)/)[1].trim();
  const occurrences = followCol.innerHTML.split(approvedName).length - 1;
  ok(occurrences === 1, "approved draft appears exactly once as a manual follow-up (saw " + occurrences + ")");
  ok(/manual/i.test(followCol.innerHTML), "follow-ups column is honest that nothing is sent");
}

await fire(els["btn-back-drafts"], "click", evt());
await tick();
ok(visible("view-drafts"), "status -> back to drafts");
await fire(els["btn-back-shortlist"], "click", evt());
await tick();
ok(visible("view-shortlist"), "drafts -> back to shortlist");

/* ---- Live-mode RealApi adapter checks (stubbed fetch, zero network). */
{
  const calls = [];
  const canned = {
    "POST /api/profiles": { id: "bp_9", name: "Adaeze Catering", website_url: null, description: "Office lunch packs",
      services: [], value_proposition: "", target_market: "Office admin", service_area: { note: "Ikeja" },
      constraints: { order_size: "20-200", exclusions: "" },
      provenance: { name: "stated", description: "stated", target_market: "stated", service_area: "stated", constraints: "stated" },
      status: "draft", version: 1, confirmed_at: null, created_at: "2026-01-01T00:00:00.000Z" },
    "POST /api/profiles/bp_9/answers": {},
    "POST /api/profiles/bp_9/confirm": {},
    "POST /api/runs": { id: "run_9", status: "created" },
    "POST /api/runs/run_9/start": { id: "run_9", status: "awaiting_approval" },
    "GET /api/runs/run_9": [{ id: "run_9", status: "discovering" }, { id: "run_9", status: "awaiting_approval" }],
    "GET /api/runs/run_9/prospects": { run_id: "run_9", prospects: [{ id: "pr_9", run_id: "run_9", name: "Brightline Ltd", category: "Logistics", location: { area: "Ikeja GRA" }, status: "shortlisted", rank: 1 }] },
    "GET /api/prospects/pr_9": { prospect: { id: "pr_9", name: "Brightline Ltd" }, assessments: [{ fit_rating: 4, supporting_evidence_ids: ["ev_9"], rationale: "Strong fit: lunch rota" }], evidence: [{ id: "ev_9", quote: "weekday lunch rota", source_url: "https://brightline.ng/about", source_type: "fetched_page" }], contact_routes: [] },
    "GET /api/runs/run_9/drafts": { run_id: "run_9", drafts: [{ id: "dr_9", prospect_id: "pr_9", subject: "Lunches", body: "Hi [ev_9]", status: "draft" }] },
    "PATCH /api/drafts/dr_9": { draft: { id: "dr_9", status: "draft", edited_by_human: 1 } },
    "POST /api/drafts/dr_9/decision": { draft: { id: "dr_9", status: "approved" } },
  };
  const fetchStub = async (url, opts) => {
    const method = (opts && opts.method) || "GET";
    const key = method + " " + String(url).split("?")[0];
    calls.push({ key, body: opts && opts.body ? JSON.parse(opts.body) : undefined });
    let body = canned[key];
    if (Array.isArray(body)) body = body.length > 1 ? body.shift() : body[0];
    if (body === undefined) throw new Error("unstubbed live call " + key);
    return { ok: true, status: 200, json: async () => body };
  };
  const liveSandbox = { location: { search: "?live=1" }, fetch: fetchStub, setTimeout, clearTimeout, setInterval, clearInterval, Promise, URLSearchParams, encodeURIComponent, JSON, console };
  liveSandbox.globalThis = liveSandbox;
  liveSandbox.window = liveSandbox;
  vm.createContext(liveSandbox);
  vm.runInContext(apiSrc, liveSandbox, { filename: "api.js/live" });
  const api = liveSandbox.ApiLayer.selectApi();
  ok(api.mode === "live", "selectApi picks RealApi on ?live=1");

  const created = await api.createProfile({ businessName: "Adaeze Catering", site: "", description: "Office lunch packs", q1: "Ikeja", q2: "20-200", q3: "Office admin", q4: "", q5: "" });
  const profilePost = calls.find((c) => c.key === "POST /api/profiles");
  ok(profilePost && profilePost.body.name === "Adaeze Catering", "createProfile posts backend field names");
  ok(created.profile.id === "bp_9" && created.profile.fields.length >= 5, "createProfile adapts the profile row to fields");
  ok(created.profile.fields.every((f) => f.key && ("value" in f) && f.provenance), "every field has key/value/provenance");

  const confirmed = await api.confirmBrief(created.profile);
  ok(confirmed.runId === "run_9", "confirmBrief returns the started run id");
  for (const k of ["POST /api/profiles/bp_9/answers", "POST /api/profiles/bp_9/confirm", "POST /api/runs", "POST /api/runs/run_9/start"]) {
    ok(calls.some((c) => c.key === k), "confirmBrief calls " + k);
  }
  const answersPost = calls.find((c) => c.key === "POST /api/profiles/bp_9/answers");
  ok(answersPost && answersPost.body.answers && answersPost.body.answers.service_area.note === "Ikeja", "confirmBrief nests service_area answers");

  let lastTick = null;
  const finished = await api.runProgress("run_9", (t) => { lastTick = t; });
  ok(finished.status === "awaiting_approval", "runProgress resolves at awaiting_approval");
  ok(lastTick && lastTick.done === lastTick.total, "runProgress ticks to completion");

  const short = await api.getShortlist("run_9");
  ok(short.prospects.length === 1 && short.prospects[0].score === 80, "shortlist maps fit_rating 4 to score 80");
  ok(short.prospects[0].area === "Ikeja GRA", "shortlist area comes from prospect location");

  const det = await api.getEvidence("pr_9");
  ok(det.prospect.name === "Brightline Ltd", "getEvidence keeps the prospect name");
  ok(det.evidence.length === 1 && det.evidence[0].source === "https://brightline.ng/about", "getEvidence maps quote/source/type");

  const dl = await api.getDrafts("run_9");
  ok(dl.drafts.length === 1 && dl.drafts[0].id === "dr_9" && dl.drafts[0].prospectId === "pr_9", "getDrafts keeps draft id + prospect id");
  ok(dl.drafts[0].status === "pending", "undecided server draft maps to pending");

  await api.decideDraft("dr_9", "edited", { subject: "S", body: "B", edited: true });
  ok(calls.some((c) => c.key === "PATCH /api/drafts/dr_9"), "save-edit PATCHes the draft");
  await api.decideDraft("dr_9", "approved", { subject: "S", body: "B", edited: false });
  const dec = calls.find((c) => c.key === "POST /api/drafts/dr_9/decision");
  ok(dec && dec.body.decision === "approved", "approve POSTs the decision");
}

console.log("SMOKE PASS: onboard->confirm->progress->shortlist->drafts->decide->status + back-nav + live adapters");
process.exit(0);
