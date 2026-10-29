# specs/agent-loop.md — Development Controller Execution Loop (System A)

- Status: draft for review (v0.1, 2026-10-28).
- Owner: System A only. Local Python controller (`loop.py`). Never deployed;
  never part of the product runtime. Product runtime loop is `specs/research-loop.md`.
- Machine-readable tool contracts: `tools.md` Part A (normative for schemas).

## 1. Overview

The development controller pursues one approved objective by looping: load
instructions, objective, and run state; call the inference API with tool
definitions; validate and execute the model-selected tool locally; persist results;
continue until completion, approval need, budget exhaustion, or unrecoverable error.
The model decides the next action. Code enforces permissions, validation, budgets,
secrets, persistence, and termination. No hardcoded action sequences; no simulated
agency.

## 2. Principles

1. **Model directs, code governs.** Every action originates from a model tool call;
   every execution passes validation, permission, and budget checks first.
2. **Evidence honesty.** The controller reports only what tools observed; run
   records distinguish observation from model assertion.
3. **Least privilege.** Read-only and repo-scoped writes are automatic; shell,
   network, and out-of-repo effects require allowlisting or human approval.
4. **Durable and resumable.** Every turn persists before the next begins; any
   interruption resumes without re-executing completed work.
5. **Budgets are hard.** Turn, token, cost, and time caps stop the run; partial
   progress is preserved and reported, never silently extended.
6. **Humans own objectives and approvals.** The controller never rewrites its
   objective, never self-approves a gate, never claims completion without verification.

## 3. Lifecycle

1. **Load.** Read `system_instructions.md`, `objective.md` (record its hash),
   the Part A tool registry, and the run record (new or resume). Abort if the
   objective hash changed mid-run: objectives are immutable during a run.
2. **Construct request.** `instructions` = system instructions + objective +
   compact state summary (turn count, budgets consumed, last results, open gate
   answers). `tools` = Part A function definitions. No `web_search` in v0.
3. **Call.** POST the Responses API (see §5). Record usage (tokens, cost estimate).
4. **Inspect.** Parse output items: tool calls, text, refusals, errors. Append the
   turn to the transcript before acting on it.
5. **Validate.** For each requested tool call, in order: schema-conformant
   arguments; permission tier (auto / approval / forbidden); path sandbox
   (repo-root confinement); budget sufficiency for the call. Any failure: skip
   execution, record the rejection, return the rejection to the model as the tool
   result (bounded re-ask budget, §9).
6. **Execute.** Run approved tools through the execution layer (§7) with timeouts;
   redact secret-shaped values from all persisted output.
7. **Persist.** Append tool results to the transcript, update run record
   (response-id chain, budgets, status). Then continue while: objective incomplete
   AND no gate pending AND budgets remain AND no stop condition.
8. **Stop and report.** On completion claim, gate need, budget, error, or user
   interrupt: persist final state, write `completion_report.md` in the run
   directory, exit with a machine-readable status. Pause/resume via §10.

## 4. Startup inputs

- `system_instructions.md` (behavior), `objective.md` (work + bounds + acceptance),
  `tools.md` Part A (contracts; code registry must match — enforced by contract
  test), approval/secret/honesty rules derived from `AGENTS.md` §§3–4, 7.
- CLI: `loop.py --objective objective.md [--run-id <id>] [--resume]`. Any other
  flags are forbidden in v0 (keeps the surface minimal).

## 5. Inference API (decision)

- **v0 calls the Meta Responses API directly** (`muse-spark-1.3`,
  `tool_choice: auto`), key from local environment only. Rationale: tool calling
  is verified in official docs; the controller needs model decisions, not an IDE.
- History via `previous_response_id` (server-managed). Run record stores the
  response-id chain. Fallback: rebuild the input array from the transcript if the
  chain is unavailable (expired/deleted); never silently restart history.
- `reasoning.effort` default `low` (cost control); an objective may raise it with
  recorded rationale. Stateless encrypted replay is not used in v0.
- **Muse Code / OpenCode integration is deferred** to a post-v0 spike that must
  establish real interface capabilities first. v0 assumes no coding-agent API.

## 6. Permissions model

- **Auto:** repo-scoped file reads; repo-scoped file writes/edits; directory
  listing; running the project's test commands; reading run records.
- **Approval (human gate, §10):** any shell command outside the test allowlist;
  any network access beyond the inference API; any path outside the repo root;
  deleting files; changing credentials or remotes.
- **Forbidden:** always rejected, never gated: reading secret files (`.env`,
  `.dev.vars`, key material); printing or transmitting secret values; disabling
  validation, budgets, or logging; modifying the objective, instructions, or
  approval rules mid-run.

## 7. Execution layer

- Tools execute in-process (file/state tools) or as subprocesses (shell/test tools).
- Sandbox: all paths resolved and confined under the repo root; symlinks outside
  rejected. Default subprocess timeout 120s (overridable per objective up to 600s).
- Stdout/stderr captured, truncated at 200KB per call (head + tail + sizes), scanned
  for secret-shaped values (`sk-`, `Bearer`, key-like assignments) and redacted
  before persistence. Exit codes and durations recorded.

## 8. Run records (System A state)

- Location: `.runs/<run_id>/` containing `run.json` (status, objective hash,
  response-id chain, budgets consumed, gate state), `transcript.jsonl` (one turn
  per line: request summary, response items, validation outcomes, tool results),
  `completion_report.md` (written at stop). Untracked (gitignored at M1 scaffold).
- `run.json` fields: `run_id`, `started_at`, `objective_path`, `objective_sha256`,
  `status` (running | awaiting_approval | paused | completed | failed |
  budget_exhausted | stopped), `turns`, `tokens_in`, `tokens_out`, `cost_usd_est`,
  `response_ids[]`, `pending_gate` (nullable), `error` (nullable).
- Completion is claimed only via the `dev.complete_objective` tool carrying
  per-acceptance-criterion evidence; the loop verifies mechanically checkable items,
  then pauses for human approval of the claim. There is no other completion path.

## 9. Budgets (machine-readable block; defaults when absent)

- Defaults (previous behavior, retained for reference when the objective carries
  no budget block): turns 40, wall-clock 45 min (2700s), cost estimate $8,
  tokens 600k in+out combined.
- [Change-controlled 2026-10-28: objectives carry a machine-readable budget
  block; `loop.py` parses and enforces it instead of treating budgets as
  advisory-only.] Format: a fenced block in `objective.md` —
  ```` ```budget ```` on its own line, then one `key=value` per line for exactly
  the keys `turns`, `wall_s`, `cost_usd`, `tokens` (all required, all > 0;
  `cost_usd` is a float, the rest integers; `#` lines and blanks ignored), then
  a closing ```` ``` ```` fence. Missing block falls back to the defaults above.
  Unknown keys, malformed values, missing keys, duplicate keys, multiple blocks,
  or an unclosed block refuse to start with a clear error. Parsed caps replace
  the defaults via the existing budget checks (warnings at >= 80%, stop at
  100% with status `budget_exhausted`).
- At 80% of any budget the state summary warns the model. At 100% the run stops
  with status `budget_exhausted`; partial work and transcript persist.
- Re-ask sub-budget: at most 3 validation rejections per tool call, at most 2
  consecutive no-tool text responses, then stop with reason recorded.

## 10. Approval gates and pause/resume

- Gate triggers: approval-tier tool requests; completion claims; ambiguous
  instruction conflicts; unrecoverable tool errors needing a human decision.
- On gate: persist status `awaiting_approval` + `pending_gate` (question, context,
  proposed action, options); exit 0 with gate notice. Human answers by writing the
  decision file (format in run dir); resume with `--resume --run-id`; the answer is
  applied at resume: approved execute-gates run the pending call immediately and
  seed its tool output into the next chained turn (the server requires output
  for every call); denials seed a denial output instead; a denied completion
  claim resets so the model may re-claim after more work.
  [Change 2026-10-28: resume-seeding after live 400 "No tool output found" on
  run 0e6a49085d8f. Previous text: answer fed as a system message.]
- Interruption (Ctrl-C, crash, API outage): transcript + `run.json` already durable;
  resume continues from the last response id; completed tool calls are never
  re-executed (transcript replay, not tool replay). Objective-hash mismatch on
  resume aborts with an error.

## 11. Errors and retries

- Inference 429/5xx/timeout: exponential backoff, 3 attempts, then pause with
  status and resume instructions (not failure — work is intact).
- Inference 400/401: stop immediately, report (config/auth problem, retry is futile).
  Exception: 400 `not found or expired` on `previous_response_id` (documented
  persistence lag, or genuine expiry after long gate waits): retry twice with
  2s/5s backoff, then once more via stateless transcript rebuild
  (`rebuild_input`, best-effort history with capped args); only then fail.
  [Change 2026-10-28: added after live run 7a860c957d6d hit persistence lag at
  turn 5. Previous text ended at "retry is futile" with no exception.]
- Malformed tool arguments: return the schema error to the model (counts toward
  re-ask sub-budget). Persistent malformation stops the run as failed with evidence.
- Refusals: stop and report the refusal verbatim; never route around it.
- Tool timeouts: one retry, then record failure and continue (model decides next).
- Corrupt run record: abort, report, never auto-repair state.

## 12. Completion reporting

`completion_report.md` contains: objective verdict per acceptance criterion with
evidence pointers (transcript lines, files changed, test output); files changed;
commands executed; verification performed; limitations; suggested next objective
(optional, never auto-started). In M1 the operator transfers the verdict to
`progress.md`; from M3 the controller may propose the `progress.md` edit only
through an approval gate.

## 13. Module breakdown (v0)

- `loop.py`: CLI + lifecycle orchestration (§3). Functions: `main()`,
  `run_turn(state) -> turn_result`, `should_continue(state) -> stop_reason|None`.
- `registry.py`: Part A tool definitions + JSON schemas (must match `tools.md`;
  contract-tested). Function: `tool_definitions() -> list`.
- `validate.py`: schema + permission + sandbox + budget checks. Function:
  `validate_call(call, state) -> approved|rejected(reason, tier)`.
- `execute.py`: tool implementations and subprocess handling. Function:
  `execute_call(call) -> tool_result` (timeout, capture, redact).
- `state.py`: run record + transcript persistence. Functions: `new_run()`,
  `load_run(id)`, `append_turn()`, `set_status()`.
- `budgets.py`: consumption tracking and estimates. Function: `check(state)`.
- `gates.py`: gate pause/answer mechanics. Functions: `raise_gate()`, `read_answer()`.
- `report.py`: completion report generation. Function: `write_report(state)`.
- `client.py`: Responses API transport (request build, retries, usage parse).

## 14. Acceptance of this spec (DoD)

Done when: lifecycle, API choice, permissions, budgets, gates, errors, resume, and
module interfaces are fully specified with no TBDs; every behavior names its
verification in `specs/evaluation.md` (controller harness); names match `tools.md`
Part A exactly; and you approve it. Evidence: approval in `progress.md`.

## 15. Version history

- v0.1 (2026-10-28): initial draft for review.
