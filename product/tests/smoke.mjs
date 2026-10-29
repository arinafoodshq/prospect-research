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
  "view-landing", "view-onboard", "view-profile", "view-progress", "view-shortlist",
  "view-drafts", "view-status", "view-campaigns", "view-senders",
  "step-nav", "onboard-error", "onboard-form",
  "f-businessName", "f-description",
  "ob-first", "ob-chat", "ob-step", "ob-yousaid-text", "ob-question-wrap", "ob-question",
  "ob-answer", "ob-chips", "ob-done-wrap", "ob-fields", "ob-error",
  "btn-ob-continue", "btn-ob-skip", "btn-ob-finish", "btn-ob-exit", "btn-ob-edit-first",
  "profile-fields", "progress-steps", "progress-budget",
  "progress-kicker", "progress-eyebrow", "progress-title", "progress-note",
  "stat-found", "stat-opened", "stat-kept",
  "progress-setaside", "progress-setaside-empty", "progress-error",
  "btn-preview-progress", "btn-stop-progress",
  "prospect-list", "evidence-body", "evidence-hint", "draft-list", "drafts-note", "status-board",
  "shortlist-kicker", "shortlist-title", "shortlist-tabs", "shortlist-empty",
  "tab-ready", "tab-warm", "tab-look", "tab-ready-n", "tab-warm-n", "tab-look-n",
  "shortlist-count",
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

const startBtn = new FakeEl("button", "landing-cta");
const documentStub = new Proxy({
  getElementById(id) {
    if (!els[id]) fail("getElementById(" + JSON.stringify(id) + ") is outside the known DOM surface");
    return els[id];
  },
  createElement(tag) { return new FakeEl(tag); },
  readyState: "complete",
  addEventListener() {},
  querySelector(sel) {
    if (sel === ".site-header") return null; // header hidden-toggle is guarded
    fail("querySelector(" + sel + ") hit unimplemented stub on document");
  },
  querySelectorAll(sel) {
    if (sel === "[data-start]") return [startBtn];
    return [];
  },
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
ok(visible("view-landing"), "boots on the landing view");
await fire(startBtn, "click", evt());
ok(visible("view-onboard"), "landing CTA -> onboard view");

const DESCRIPTION = "We deliver packed lunches to offices in Ikeja and Yaba. Mostly 20 to 200 staff.";
els["f-businessName"].value = "Adaeze Catering Services";
els["f-description"].value = DESCRIPTION;
await fire(els["onboard-form"], "submit", evt());
await tick(); await tick();
ok(els["ob-first"].hidden === true && els["ob-chat"].hidden === false, "submit description -> chat view");
ok(els["ob-yousaid-text"].textContent === DESCRIPTION, "chat shows the first message back");
ok(/says yes/.test(els["ob-question"].textContent), "first follow-up asks the decision maker (" + els["ob-question"].textContent + ")");
ok(/data-chip="HR manager"/.test(els["ob-chips"].innerHTML), "answer chips render");
ok(/Asking you now/.test(els["ob-fields"].innerHTML), "understood panel marks the live question");

await fire(els["btn-ob-edit-first"], "click", evt());
ok(els["ob-first"].hidden === false && els["f-description"].value === DESCRIPTION, "Edit returns to the first message, text kept");
await fire(els["onboard-form"], "submit", evt());
await tick(); await tick();

els["ob-answer"].value = "HR manager";
await fire(els["btn-ob-continue"], "click", evt());
await tick(); await tick();
ok(/budget range/.test(els["ob-question"].textContent), "answering moves to the next missing fact (" + els["ob-question"].textContent + ")");
ok(/HR manager/.test(els["ob-fields"].innerHTML), "answer lands in the understood panel");

await fire(els["btn-ob-skip"], "click", evt());
await tick(); await tick();
ok(els["ob-done-wrap"].hidden === false, "skip on the last fact ends the chat");
ok(/Marked as a guess/.test(els["ob-fields"].innerHTML), "skipped field marked as a guess");
ok(/a guess/.test(els["ob-fields"].innerHTML), "inferred fields labelled a guess");

await fire(els["btn-ob-finish"], "click", evt());
await tick(); await tick();
ok(visible("view-profile"), "finish -> profile confirm view");

{
  const guesses = els["profile-fields"].querySelectorAll("input[data-idx]");
  ok(guesses.length >= 1, guesses.length + " assumed field(s) editable inline");
  guesses[0].value = "No site given (edited inline)";
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
const runDone = fire(els["btn-confirm-profile"], "click", evt());
await new Promise((r) => setTimeout(r, 1200)); // 3 of 5 mock ticks landed
await tick(); await tick();
ok(els["progress-kicker"].textContent === "SAMPLE RUN", "progress kicker marks the sample run");
ok(els["stat-found"].textContent === "25" && els["stat-opened"].textContent === "14" && els["stat-kept"].textContent === "3",
  "progress stats count found/opened/kept (" + els["stat-found"].textContent + "/" + els["stat-opened"].textContent + "/" + els["stat-kept"].textContent + ")");
ok(/Searched for offices/.test(els["progress-steps"].innerHTML), "finished steps render past-tense");
ok(/Opened each business/.test(els["progress-steps"].innerHTML), "page-open step completes in assessing");
ok(/class="active">Checking fit/.test(els["progress-steps"].innerHTML), "exactly the next step shows active");
ok(/Greenfield Clinic/.test(els["progress-setaside"].innerHTML), "set-aside panel names the dropped pick");
ok(/outside your target segment/.test(els["progress-setaside"].innerHTML), "set-aside panel gives the reason");
await fire(els["btn-preview-progress"], "click", evt());
await tick(); await tick();
ok(visible("view-shortlist"), "preview jumps to results so far mid-run");
ok(els["prospect-list"].children.length === 2, "preview shows only kept prospects, saw " + els["prospect-list"].children.length);
ok(els["tab-ready-n"].textContent === "2" && els["tab-warm-n"].textContent === "0",
  "preview tab counts match the partial list");
await runDone; // remaining ticks + completion
await tick(); await tick();
ok(confirmedProfile && confirmedProfile.fields.some((f) => f.value === "No site given (edited inline)"),
  "inline guess edit reaches confirmBrief");
ok(visible("view-shortlist"), "confirm -> progress -> shortlist view");
ok(els["tab-ready-n"].textContent === "2" && els["tab-warm-n"].textContent === "2" && els["tab-look-n"].textContent === "2",
  "tabs count 2/2/2 (" + els["tab-ready-n"].textContent + "/" + els["tab-warm-n"].textContent + "/" + els["tab-look-n"].textContent + ")");
ok(els["shortlist-title"].textContent === "6 buyers worth your time.", "title counts the shortlist");
ok(els["prospect-list"].children.length === 2, "ready tab lists 2 qualified, saw " + els["prospect-list"].children.length);
{
  const card = els["prospect-list"].children[0].innerHTML;
  ok(/STRONG FIT/.test(card), "card shows the fit badge");
  ok(/Why now/.test(card) && /How to reach them/.test(card), "card shows why-now and route");
  ok(/Source:/.test(card), "card cites its source");
  ok(/Still unconfirmed:/.test(card), "card lists open questions");
  ok(/Published, not yet checked/.test(card), "card labels the route honestly");
}
ok(els["evidence-body"].innerHTML.length > 20, "selecting a prospect shows evidence");
ok(els["shortlist-count"].textContent === "6 selected · nothing is sent yet", "sticky bar counts all selected");

const tabTarget = (t) => evt({ target: { getAttribute: (k) => (k === "data-tab" ? t : null) } });
await fire(els["shortlist-tabs"], "click", tabTarget("warm"));
await tick();
ok(els["prospect-list"].children.length === 2
  && /GOOD FIT, NO SIGNAL YET/.test(els["prospect-list"].children[0].innerHTML),
  "warm tab lists no-signal picks");
ok(/patient intro/.test(els["prospect-list"].children[0].innerHTML), "warm card suggests a patient intro");
await fire(els["shortlist-tabs"], "click", tabTarget("look"));
await tick();
ok(els["prospect-list"].children.length === 2
  && /NEEDS A LOOK/.test(els["prospect-list"].children[0].innerHTML),
  "look tab lists needs-review picks");
ok(/No published route found yet/.test(els["prospect-list"].children[0].innerHTML), "routeless card stays honest");
await fire(els["shortlist-tabs"], "click", tabTarget("ready"));
await tick();

{
  const li = els["prospect-list"].children[0];
  const fns = li._listeners.click || [];
  const untick = { target: { getAttribute: (k) => (k === "data-sel" ? "p01" : null), checked: false } };
  for (const fn of fns) await fn.call(li, untick);
}
await tick();
ok(els["shortlist-count"].textContent === "5 selected · nothing is sent yet", "unticking updates the sticky count");

await fire(els["btn-to-drafts"], "click", evt());
await tick(); await tick(); await tick();
ok(visible("view-drafts"), "shortlist -> drafts view");
ok(els["draft-list"].children.length === 1, "studio shows one message at a time");
{
  const html = els["draft-list"].children[0].innerHTML;
  ok(/MESSAGE 1 OF 3/.test(html), "studio pager counts the filtered drafts");
  ok(/Your note to Kingsway Tech Hub/.test(html), "studio names the first selected pick");
  ok(/Why this message/.test(html) && /A fact we found/.test(html), "studio explains the message");
  ok(/Approve and schedule/.test(html) && /Skip this one/.test(html), "studio has approve + skip actions");
  ok(/words\. (Short enough|Room for context)/.test(html), "studio counts words with guidance");
}
ok(/5 selected picks/.test(els["drafts-note"].textContent), "drafts note explains the filter");
ok(/No draft yet for Northgate Bank Branch, FitLife Gym Ikeja/.test(els["drafts-note"].textContent),
  "drafts note names selected picks without drafts");

{
  const studio = () => els["draft-list"].children[0];
  const clickOn = async (act, extra) => {
    const div = studio();
    const fns = div._listeners.click || [];
    for (const fn of fns) await fn.call(div, { target: { dataset: Object.assign({ act }, extra || {}) } });
    await tick(); await tick();
  };
  await clickOn("approve");
  ok(/approved/.test(studio().querySelector(".decision").textContent), "approve marks the draft approved");
  await clickOn("studio-next");
  ok(/MESSAGE 2 OF 3/.test(studio().innerHTML), "pager advances to the next message");
  ok(/Your note to St. Raphael Clinic/.test(studio().innerHTML), "pager shows the next pick");
  await clickOn("studio-tab", { id: "whatsapp" });
  ok(/No whatsapp version/.test(studio().innerHTML), "off-channel tab stays honest about the single variant");
  await clickOn("studio-tab", { id: "email" });
  ok(/Weekday lunches for/.test(studio().innerHTML), "email tab shows the subject line");
  await clickOn("studio-edit");
  studio().querySelector('[data-field="body"]').value = "Edited message body for the test.";
  await clickOn("studio-save");
  await tick();
  ok(/Edited message body for the test/.test(studio().innerHTML), "saved edit refreshes the draft text");
  await clickOn("skip");
  ok(/deferred/.test(studio().querySelector(".decision").textContent), "skip defers the draft");
  await clickOn("studio-prev");
  ok(/MESSAGE 1 OF 3/.test(studio().innerHTML), "pager goes back");
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
  const approvedName = els["draft-list"].children[0].innerHTML.match(/Your note to ([^.]*)/)[1].trim();
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

await fire(els["btn-stop-progress"], "click", evt());
await tick();
ok(visible("view-profile"), "stop returns to the brief");

/* ---- Live-mode RealApi adapter checks (stubbed fetch, zero network). */
{
  const calls = [];
  const canned = {
    "POST /api/onboard/turn": { fields: { offering: { value: "lunches", label: "inferred" } }, question: null, done: true, followups_used: 1 },
    "GET /api/runs/run_p": { id: "run_p", status: "assessing", stop_reason: null,
      commercial_brief: { primary_segment: { label: "Shops", industries: ["retail shops", "logistics firms"], geos: ["Lagos"] } },
      consumed: { searches: 10, fetches: 4 } },
    "GET /api/runs/run_p/prospects": { run_id: "run_p", prospects: [
      { id: "pp_1", name: "New Lead", status: "candidate" },
      { id: "pp_2", name: "Opening Ltd", status: "investigating" },
      { id: "pp_3", name: "Greenfield Clinic", status: "disqualified" },
      { id: "pp_4", name: "Kept Co", status: "shortlisted" }
    ] },
    "GET /api/prospects/pp_3": { prospect: { id: "pp_3", name: "Greenfield Clinic" },
      assessments: [{ fit_rating: 2, rationale: "Healthcare, outside the target segment. No weekday lunch rota found." }],
      evidence: [], contact_routes: [] },
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
    "GET /api/prospects/pr_9": { prospect: { id: "pr_9", name: "Brightline Ltd" }, assessments: [{ fit_rating: 4, supporting_evidence_ids: ["ev_9"], rationale: "Strong fit: lunch rota", verdict: "qualified", dimensions: { icp_fit: 5, problem: 4, readiness: 4, reachability: 3, confidence: 4 }, uncertainties: ["budget"], missing_info: ["decision maker"] }], evidence: [{ id: "ev_9", quote: "weekday lunch rota", source_url: "https://brightline.ng/about", source_type: "fetched_page" }], contact_routes: [{ channel: "email", value: "admin@brightline.ng", verification: "public_listing" }] },
    "GET /api/runs/run_9/drafts": { run_id: "run_9", drafts: [{ id: "dr_9", prospect_id: "pr_9", channel_suggestion: "email", subject: "Lunches", body: "Hi [ev_9]", next_action: "Offer a trial week.", status: "draft" }] },
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

  const turn = await api.onboardTurn({ text: "We deliver lunches", fields: {}, followups_used: 0 });
  const turnPost = calls.find((c) => c.key === "POST /api/onboard/turn");
  ok(turnPost && turnPost.body.text === "We deliver lunches" && turnPost.body.followups_used === 0, "onboardTurn posts text + fields + usage");
  ok(turn.done === true && turn.fields.offering.value === "lunches", "onboardTurn returns the turn result");

  const snap = await api.getProgressSnapshot("run_p");
  ok(snap.found === 4 && snap.opened === 3 && snap.kept === 1, "snapshot counts found/opened/kept from prospect statuses");
  ok(snap.searchLine === "retail shops and logistics firms in Lagos", "snapshot search line comes from the brief");
  ok(snap.searches === 10 && snap.fetches === 4, "snapshot carries consumed budgets");
  ok(snap.setAside.length === 1 && snap.setAside[0].name === "Greenfield Clinic", "snapshot lists disqualified picks");
  ok(snap.setAside[0].reason === "Healthcare, outside the target segment", "set-aside reason is the rationale first sentence");

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
  ok(short.prospects[0].verdict === "qualified" && short.prospects[0].readiness === 4,
    "shortlist maps verdict + readiness for tabs");
  ok(short.prospects[0].uncertainties.join("|") === "budget|decision maker", "shortlist joins uncertainties + missing_info");
  ok(short.prospects[0].routes.length === 1 && short.prospects[0].routes[0].value === "admin@brightline.ng",
    "shortlist maps contact routes");
  ok(short.prospects[0].sourceUrl === "https://brightline.ng/about", "shortlist keeps the first evidence url");

  const det = await api.getEvidence("pr_9");
  ok(det.prospect.name === "Brightline Ltd", "getEvidence keeps the prospect name");
  ok(det.evidence.length === 1 && det.evidence[0].source === "https://brightline.ng/about", "getEvidence maps quote/source/type");

  const dl = await api.getDrafts("run_9");
  ok(dl.drafts.length === 1 && dl.drafts[0].id === "dr_9" && dl.drafts[0].prospectId === "pr_9", "getDrafts keeps draft id + prospect id");
  ok(dl.drafts[0].status === "pending", "undecided server draft maps to pending");
  ok(dl.drafts[0].channel === "email" && dl.drafts[0].next_action === "Offer a trial week.",
    "getDrafts maps channel suggestion + next action for the studio");

  await api.decideDraft("dr_9", "edited", { subject: "S", body: "B", edited: true });
  ok(calls.some((c) => c.key === "PATCH /api/drafts/dr_9"), "save-edit PATCHes the draft");
  await api.decideDraft("dr_9", "approved", { subject: "S", body: "B", edited: false });
  const dec = calls.find((c) => c.key === "POST /api/drafts/dr_9/decision");
  ok(dec && dec.body.decision === "approved", "approve POSTs the decision");
}

console.log("SMOKE PASS: landing->chat->confirm->progress->shortlist->drafts->decide->status + back-nav + live adapters");
process.exit(0);
