"""System A development controller entrypoint (see specs/agent-loop.md).

Usage:
    python loop.py --objective objective.md [--run-id ID] [--resume]
"""

import argparse
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from controller import budgets, client as apiclient, execute, gates, registry, report, state, validate

MAX_REJECTS = 3
MAX_PLAIN = 2

BUDGET_KEYS = ("turns", "wall_s", "cost_usd", "tokens")


def parse_budget_block(objective_text):
    """Parse the machine-readable ```budget block from objective.md.

    Returns a dict of caps, or None when no block is present (caller falls
    back to loop defaults). Raises ValueError with a clear message when the
    block is malformed or carries unknown keys; the caller refuses to start.
    """
    import re as _re
    opens = [m for m in _re.finditer(r"^```budget[ \t]*$", objective_text, _re.M)]
    if not opens:
        return None
    if len(opens) > 1:
        raise ValueError("refusing to start: multiple ```budget blocks found (expected exactly one)")
    start = opens[0].end()
    close = _re.search(r"^```[ \t]*$", objective_text[start:], _re.M)
    if close is None:
        raise ValueError("refusing to start: unclosed ```budget block (missing closing ``` fence)")
    body = objective_text[start:start + close.start()]
    caps = {}
    for lineno, raw in enumerate(body.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"refusing to start: malformed budget line {lineno}: {raw.strip()!r} (expected key=value)")
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key not in BUDGET_KEYS:
            raise ValueError(
                f"refusing to start: unknown budget key {key!r} (allowed: {', '.join(BUDGET_KEYS)})")
        if key in caps:
            raise ValueError(f"refusing to start: duplicate budget key {key!r}")
        try:
            if key == "cost_usd":
                parsed = float(value)
            else:
                if not _re.fullmatch(r"[0-9]+", value):
                    raise ValueError(value)
                parsed = int(value)
        except (ValueError, TypeError):
            raise ValueError(
                f"refusing to start: malformed budget value for {key!r}: {value!r}")
        if not parsed > 0:
            raise ValueError(f"refusing to start: budget value for {key!r} must be > 0, got {value!r}")
        caps[key] = parsed
    missing = [k for k in BUDGET_KEYS if k not in caps]
    if missing:
        raise ValueError(
            f"refusing to start: ```budget block missing required keys: {', '.join(missing)}")
    return caps


def build_instructions(ctx, run_state, follow_note=""):
    warn = budgets.warnings(run_state)
    parts = [
        ctx["system_instructions"],
        "\n# Objective\n" + ctx["objective_text"],
        "\n# Run state\n"
        f"turn={run_state['turns']} spent=${run_state['cost_usd_est']:.4f} "
        f"tokens={run_state['tokens_in'] + run_state['tokens_out']}",
    ]
    if warn:
        parts.append("BUDGET WARNING (>=80%): " + ", ".join(warn) + ". Converge now.")
    if follow_note:
        parts.append(follow_note)
    return "\n".join(parts)


def run_turn(run_state, ctx, api):
    """One lifecycle turn. Returns 'continue', 'gate', or 'stop:<reason>'."""
    note = ctx.pop("resume_note", "")
    instructions = build_instructions(ctx, run_state, note)
    prev = run_state["response_ids"][-1] if run_state["response_ids"] else None
    if prev and not ctx.get("followups"):
        # Chained turns need non-empty input (the server rejects []); carry the
        # resume/gate note as a user message so the model repeats approved calls.
        ctx["followups"] = [{"role": "user", "content": [{"type": "input_text",
            "text": note or "Continue with the next tool call."}]}]
    try:
        resp, _ = _create_with_recovery(run_state, ctx, api, instructions, prev)
    except apiclient.ApiError as e:
        if e.retryable:
            state.set_status(run_state, "paused", f"api unavailable: {e}")
            return "stop:paused"
        state.set_status(run_state, "failed", f"api error: {e}")
        return "stop:failed"
    ctx["followups"] = None
    run_state["response_ids"].append(resp["id"])
    run_state["tokens_in"] += resp["usage"]["in"]
    run_state["tokens_out"] += resp["usage"]["out"]
    run_state["cost_usd_est"] += budgets.estimate_cost(resp["usage"]["in"], resp["usage"]["out"])

    if resp["refused"]:
        state.append_turn(run_state, {"response_id": resp["id"], "refusal": resp["text"]})
        state.set_status(run_state, "failed", "model refused")
        return "stop:failed"

    results = []
    for call in resp["tool_calls"]:
        verdict, tier, reason = validate.validate_call(call, run_state)
        if verdict == "rejected":
            results.append({"call": call, "rejected": reason, "tier": tier})
            continue
        if tier == "approval":
            if call["name"] == "dev.complete_objective":
                out = execute.execute_call(call, run_state)
                results.append({"call": call, "result": out})
                state.append_turn(run_state, {"response_id": resp["id"], "results": _summarize(results)})
                return _completion_gate(run_state, call)
            results.append({"call": call, "gated": reason})
            _raise_tool_gate(run_state, call, reason)
            state.append_turn(run_state, {"response_id": resp["id"], "results": _summarize(results)})
            return "gate"
        out = execute.execute_call(call, run_state)
        results.append({"call": call, "result": out})

    turn = state.append_turn(run_state, {"response_id": resp["id"], "text": resp["text"][:2000], "results": _summarize(results)})
    ctx["followups"] = _outputs(resp["tool_calls"], results)
    rejects = sum(1 for r in results if "rejected" in r)
    run_state["_rejects"] = (run_state.get("_rejects", 0) + rejects) if rejects else 0
    if rejects and run_state["_rejects"] > MAX_REJECTS:
        state.set_status(run_state, "failed", "repeated validation rejections")
        return "stop:failed"
    if not resp["tool_calls"]:
        run_state["_plain"] = run_state.get("_plain", 0) + 1
        if run_state["_plain"] > MAX_PLAIN:
            state.set_status(run_state, "failed", "model stopped calling tools")
            return "stop:failed"
    else:
        run_state["_plain"] = 0
    return "continue"


def should_continue(run_state):
    if run_state["status"] in ("completed", "failed", "budget_exhausted", "stopped", "awaiting_approval", "paused"):
        return run_state["status"]
    hit = budgets.check(run_state)
    if hit:
        return hit
    return None


NOT_FOUND = "not found or expired"


def _cap_args(args):
    """Cap large arg strings for replay, keeping valid JSON (best-effort history)."""
    capped = {}
    for k, v in (args or {}).items():
        if isinstance(v, str) and len(v) > 4000:
            capped[k] = f"[omitted-for-replay:{len(v)}-chars]"
        else:
            capped[k] = v
    return capped


def _summarize(results):
    slim = []
    for r in results:
        c = r["call"]
        if "rejected" in r:
            slim.append({"tool": c["name"], "rejected": r["rejected"]})
        elif "gated" in r:
            slim.append({"tool": c["name"], "gated": True})
        else:
            out = r["result"].get("output", r["result"].get("error", ""))
            out = out if isinstance(out, str) else json.dumps(out)
            slim.append({"tool": c["name"], "call_id": c.get("call_id", ""),
                         "args": c.get("arguments", {}),
                         "ok": r["result"].get("ok"), "output": out[:32768]})
    return slim


def rebuild_input(run_state):
    """Rebuild a stateless input array from the transcript (recovery path)."""
    items = [{"role": "user", "content": [{"type": "input_text", "text": "Begin."}]}]
    tpath = Path(state.run_dir(run_state["root"], run_state["run_id"])) / "transcript.jsonl"
    try:
        lines = tpath.read_text(encoding="utf-8").splitlines()
    except OSError:
        return items
    for line in lines:
        try:
            turn = json.loads(line)
        except json.JSONDecodeError:
            continue
        calls, outs = [], []
        for r in turn.get("results", []):
            if "rejected" in r or "gated" in r or "tool" not in r:
                continue
            cid = r.get("call_id", "")
            calls.append({"type": "function_call", "call_id": cid, "name": r["tool"],
                          "arguments": json.dumps(_cap_args(r.get("args", {})))})
            outs.append({"type": "function_call_output", "call_id": cid,
                         "output": json.dumps(r.get("output", ""))[:8000]})
        items += calls + outs
    return items


def _create_with_recovery(run_state, ctx, api, instructions, prev):
    """Create with retries for stored-response lag, then transcript rebuild."""
    import time as _t
    tools = registry.tool_definitions()
    try:
        return api.create(instructions, tools, prev, ctx.get("followups")), False
    except apiclient.ApiError as e:
        if not (e.status == 400 and NOT_FOUND in str(e)):
            raise
        last = e
    for wait in (2, 5):
        _t.sleep(wait)
        try:
            return api.create(instructions, tools, prev, ctx.get("followups")), False
        except apiclient.ApiError as e2:
            if not (e2.status == 400 and NOT_FOUND in str(e2)):
                raise
            last = e2
    try:
        resp = api.create(instructions, tools, None, rebuild_input(run_state))
    except apiclient.ApiError:
        raise last
    run_state["rebuilt_count"] = run_state.get("rebuilt_count", 0) + 1
    return resp, True


def _outputs(calls, results):
    items = []
    for call, res in zip(calls, results):
        if "result" in res:
            items.append({"type": "function_call_output", "call_id": call.get("call_id", ""),
                          "output": json.dumps(res["result"], default=str)[:4000]})
        elif "rejected" in res:
            items.append({"type": "function_call_output", "call_id": call.get("call_id", ""),
                          "output": json.dumps({"rejected": res["rejected"]})})
    return items


def _raise_tool_gate(run_state, call, reason):
    fp = validate.fingerprint(call["name"], call.get("arguments", {}))
    gates.raise_gate(
        run_state,
        question=f"Approve tool call {call['name']}?",
        context={"reason": reason, "call": call},
        proposed={"action": "execute", "fingerprint": fp},
    )


def resolve_gate(run_state, ans):
    """Apply a gate answer. Approved execute-gates run the pending call NOW and
    seed its output, because the server requires tool output for every
    function_call before the chained turn. Returns (note, seed_followups)."""
    gate = run_state.get("pending_gate") or {}
    ctx = gate.get("context", {})
    prop = gate.get("proposed", {})
    if ans["decision"] == "deny":
        if prop.get("action") == "complete":
            run_state["completed_claimed"] = False  # model may re-claim later
        call = ctx.get("call")
        if call:
            out = {"denied": "human denied this action; choose another way."}
            state.append_turn(run_state, {"gate": "denied", "results": [{
                "tool": call["name"], "call_id": call.get("call_id", ""),
                "args": call.get("arguments", {}), "denied": True, "output": out}]})
            seed = [{"type": "function_call_output", "call_id": call.get("call_id", ""),
                     "output": json.dumps(out)}]
        else:
            state.append_turn(run_state, {"gate": "denied", "pending": ctx})
            seed = None
        gates.clear_gate(run_state)
        return "Human gate decision: denied.", seed
    apply_answer(run_state, ans)
    if prop.get("action") == "execute" and ctx.get("call"):
        call = ctx["call"]
        verdict, tier, reason = validate.validate_call(call, run_state)
        if verdict == "approved" and tier == "auto":
            out = execute.execute_call(call, run_state)
        else:
            out = {"ok": False, "error": f"post-approval validation: {reason}"}
        state.append_turn(run_state, {"gate_executed": True,
            "results": _summarize([{"call": call, "result": out}])})
        seed = [{"type": "function_call_output", "call_id": call.get("call_id", ""),
                 "output": json.dumps(out, default=str)[:8000]}]
        return "Human gate decision: approved and executed.", seed
    return "Human gate decision: approved.", None


def _completion_gate(run_state, call):
    run_state["completed_claimed"] = True
    criteria = (call.get("arguments", {}) or {}).get("criteria", [])
    run_state["completion_verdicts"] = [
        {"criterion": c.get("criterion"), "verdict": c.get("verdict"),
         "evidence": c.get("evidence")}
        for c in criteria if isinstance(c, dict)
    ]
    state.save(run_state)
    gates.raise_gate(
        run_state,
        question="Accept objective completion claim?",
        context={"claim": call.get("arguments", {}), "call": call},
        proposed={"action": "complete"},
    )
    return "gate"


def apply_answer(run_state, ans):
    gate = run_state["pending_gate"] or {}
    ctx = gate.get("context", {})
    if ans["decision"] == "deny":
        state.append_turn(run_state, {"gate": "denied", "pending": ctx})
        gates.clear_gate(run_state)
        return "denied"
    prop = gate.get("proposed", {})
    if prop.get("action") == "execute" and prop.get("fingerprint"):
        run_state["gate_approvals"].append(prop["fingerprint"])
    if prop.get("action") == "complete":
        run_state["gate_approvals"].append("complete")
    gates.clear_gate(run_state)
    return "approved"


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--objective", required=True)
    ap.add_argument("--run-id", default=None)
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--allow-tests", default="", help="Comma-separated test allowlist")
    ap.add_argument("--allow-shell", default="", help="Comma-separated informational shell allowlist")
    args = ap.parse_args(argv)

    root = Path(__file__).resolve().parent
    sys_instr = (root / "system_instructions.md").read_text(encoding="utf-8")
    objective_text = (root / args.objective).read_text(encoding="utf-8")
    if "Approval note" in objective_text and "PENDING" in objective_text:
        print("refusing to start: objective approval note is PENDING", file=sys.stderr)
        return 1

    import os

    key = os.environ.get("MODEL_API_KEY", "")
    if not key:
        print("MODEL_API_KEY is not set", file=sys.stderr)
        return 1

    if args.resume:
        if not args.run_id:
            print("--resume needs --run-id", file=sys.stderr)
            return 1
        try:
            run_state = state.load_run(str(root), args.run_id)
        except ValueError as e:
            print(f"abort: {e}", file=sys.stderr)
            return 1
        if not state.verify_objective(run_state):
            print("abort: objective changed since run start", file=sys.stderr)
            return 1
        ans = gates.read_answer(run_state)
        if run_state["status"] == "awaiting_approval" and ans is None:
            print("awaiting decision.json in the run directory", file=sys.stderr)
            return 1
        note, seed = "", None
        if ans is not None:
            note, seed = resolve_gate(run_state, ans)
            if run_state.get("gate_approvals", []) and run_state["gate_approvals"][-1] == "complete":
                return _finish(run_state, "completed")
    else:
        try:
            budget_caps = parse_budget_block(objective_text)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 1
        run_state = state.new_run(
            args.objective, str(root),
            test_allowlist=[c for c in args.allow_tests.split(",") if c],
            shell_allowlist=[c for c in args.allow_shell.split(",") if c],
            budget_overrides=budget_caps,
        )
        note = ""

    ctx = {"system_instructions": sys_instr, "objective_text": objective_text,
           "followups": seed if args.resume else None, "resume_note": note}
    api = apiclient.ResponsesClient(api_key=key)
    try:
        while True:
            stop = should_continue(run_state)
            if stop:
                return _finish(run_state, stop)
            nxt = run_turn(run_state, ctx, api)
            if nxt == "gate":
                print(f"paused: gate raised, run {run_state['run_id']}")
                return 0
            if nxt.startswith("stop:"):
                return _finish(run_state, nxt[5:])
    except KeyboardInterrupt:
        state.set_status(run_state, "stopped", "user interrupt")
        report.write_report(run_state, verdicts=run_state.get("completion_verdicts"))
        print(f"stopped: run {run_state['run_id']}")
        return 0


def _finish(run_state, reason):
    if reason.startswith("budget_"):
        state.set_status(run_state, "budget_exhausted", reason)
    elif reason in ("completed", "failed", "paused", "stopped"):
        if run_state["status"] not in ("completed", "failed", "paused", "stopped"):
            state.set_status(run_state, reason)
    report.write_report(run_state, verdicts=run_state.get("completion_verdicts"))
    print(f"finished: {reason} run={run_state['run_id']} turns={run_state['turns']} cost=${run_state['cost_usd_est']:.4f}")
    return 0 if run_state["status"] in ("completed", "paused", "budget_exhausted", "stopped") else 1


if __name__ == "__main__":
    sys.exit(main())
