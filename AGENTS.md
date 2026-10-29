# AGENTS.md — Project Working Agreement

Applies to all work in this repository: the local development controller (System A),
the deployed prospecting product (System B), and any agent acting here, including Muse.

## 1. The two systems

- **System A — local autonomous development controller.** Python program (`loop.py`)
  running on the developer's machine. It pursues one approved objective at a time by
  calling an inference API, executing model-selected tools through its own local
  execution layer, and persisting run records. It is a development tool. It is never
  deployed to Cloudflare and is never part of the product runtime.
- **System B — deployed prospecting product.** AI prospecting agent for small
  businesses: business onboarding, grounded web research, evidence-ranked prospects,
  public contact routes, outreach drafts for human approval. MVP sends nothing
  automatically. Hosted on Cloudflare; reasons with Meta models.
- **Three distinct kinds of state.** `progress.md` (shared project status);
  System A run records (local run files: conversation, tool results, resume info);
  System B runtime state (deployed store: profiles, research runs, evidence,
  prospects, drafts). Never mix them. Never store System B runtime data in the repo.

## 2. Milestones and gates

- **M0** — specifications complete, consistency-reviewed, approved.
- **M1** — `loop.py` v0 + supporting modules implemented directly from the approved
  specs and reviewed.
- **M2** — v0 passes the approved controller test harness on mocked inference.
  No live inference required to pass.
- **M3** — only after M2 passes, the controller executes approved product objectives.
- **Bootstrap rule.** v0 is written from the spec and reviewed by a human. The
  controller cannot build itself before it exists. M3 is forbidden until M2 passes.
- **Anti-stall rule.** M0 is complete when the specs settle their enumerated
  decisions and pass consistency review, not when they are perfect. Later refinements
  go through change control instead of holding M1.
- **Gate rule.** No milestone work begins until the previous milestone's exit
  criteria are recorded as met in `progress.md`.

## 3. Approval gates

Work one approved step at a time. Explicit approval is required before each of:

- Creating or modifying project files (each document or code batch separately).
- Installing dependencies, running tests, making live API calls (including
  single-experiment calls), changing authentication, or deploying anything.
- Starting a controller run (approved via `objective.md`), or changing a budget,
  permission, or objective mid-run.

Approval of a plan is approval of the sequence, not a blanket grant: report after
each step and confirm the next.

### Standing autonomy (granted by the user 2026-10-28; revocable with "gates back on")

Within the currently approved milestone, pre-authorized without per-step approval:

- Creating/editing files in the repo (specs via change control; objectives
  within their budgets).
- Running local tests and harness suites.
- Controller runs whose objectives fit: ≤25 turns, ≤$5, ≤30 min wall, repo-scoped
  auto-tier tools only. Any raised gate still pauses for a human decision —
  standing autonomy never self-approves a gate, with exactly one exception:
  verification-only tool gates (test/typecheck/syntax-check commands that are
  read-only, match the objective's stated verification or the run's allowlist,
  and install/deploy nothing) may be approved by the operator, fully logged.
  Granted by the user 2026-10-28 ("yes"); revocable with "gates back on".
- Live model spend up to $25 cumulative without a check-in; report the running
  total after each run (baseline 2026-10-28: ≈$0.65).
- Project-scoped installs (`npm install` inside `product/`, never global) and
  local dev servers with no public exposure.

Still require explicit approval, always: milestone transitions, deploys,
secret/credential changes, out-of-repo writes, sending any message, spend beyond
the caps above, and anything the specs mark forbidden. Progress and evidence
discipline apply unchanged.

## 4. Security rules

- Never inspect `.env` files or any file holding populated secrets.
- Never print, expose, log, or paste secret values (API keys, tokens, credentials).
- Presence-only checks (`set`/`not set`, never the value) are acceptable when
  explicitly approved.
- All model API keys live server-side / in the local environment only, never in the
  repo, logs, fixtures, or screenshots. Fixtures must be sanitised (response bodies
  only, never request headers).
- Build auth headers by string concatenation (`"Bearer " + key`), never by
  interpolation (`f"Bearer {key}"`): on 2026-10-28 the write pipeline rewrote an
  interpolated Bearer header to a literal `[redacted]`, breaking authentication.
  Always read back auth-header lines after writing them.

## 5. Documentation discipline

Authoritative documents (ownership: drafted by the agent, approved by the human):

- `AGENTS.md` (this file): working agreement. Updated rarely, when rules change.
- `progress.md`: project status. Updated after every meaningful approved task.
- `system_instructions.md`: System A permanent behavior. Updated when controller
  behavior must change.
- `objective.md`: System A's single current approved objective. Replaced per
  objective, never edited mid-run except through re-approval.
- `tools.md`: tool registry, Part A (controller-local) and Part B (product runtime)
  in separated namespaces. Updated when any tool is added, changed, or retired.
- `specs/product.md`, `specs/architecture.md`, `specs/data-model.md`,
  `specs/research-loop.md`: System B design.
- `specs/agent-loop.md`: System A execution-loop design (not the product loop).
- `specs/evaluation.md`: both test harnesses, fixtures, golden scenarios, metrics.

Rules: one home per fact, no duplicated rules across files; specs change only via
change control below.

## 6. Change control

- Spec or instruction changes require approval and a one-line rationale recorded in
  `progress.md`, with the previous version retained for reference (prior text kept
  in the change entry or a dated note, not silently overwritten).
- Time-boxed spikes are allowed only after M0 specs are approved, and only with
  explicit permission stating the question, the time box, and what happens to the
  findings.

## 7. Definition of done and evidence

Every task states how it will be verified, what "done" means, and what evidence
goes into `progress.md`. Evidence types: command output observed, test results,
review notes, approval records. Status words (verified / user-stated / assumed /
unresolved) must be used accurately:

- **Verified** — observed in this project (command output, inspected doc, test run).
- **User-stated** — asserted by the human, recorded as such until verified.
- **Assumed** — working default, labelled, revisited if contradicted.
- **Unresolved** — open question with an owner and a due milestone.

Never claim a command, test, API call, authentication, or deployment succeeded
without evidence.

## 8. Task reporting

After each task report: files changed, commands executed, verification performed
with evidence, and remaining limitations. End by stating the single next action and
whether it needs approval.
