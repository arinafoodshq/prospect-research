"""Approval-gate pause/answer mechanics."""

import json
import time
from pathlib import Path

from .state import run_dir, save, set_status

DECISIONS = ("approve", "deny")


def raise_gate(state, question, context, proposed, options=("approve", "deny")):
    gate = {
        "question": question,
        "context": context,
        "proposed": proposed,
        "options": list(options),
        "raised_at": time.time(),
    }
    state["pending_gate"] = gate
    d = run_dir(state["root"], state["run_id"])
    (d / "gate.json").write_text(json.dumps(gate, indent=2), encoding="utf-8")
    set_status(state, "awaiting_approval")
    return gate


def answer_path(state):
    return run_dir(state["root"], state["run_id"]) / "decision.json"


def read_answer(state):
    """Return decision dict or None when no valid answer file is present."""
    p = answer_path(state)
    try:
        ans = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(ans, dict) or ans.get("decision") not in DECISIONS:
        return None
    return ans


def clear_gate(state):
    state["pending_gate"] = None
    set_status(state, "running")
    save(state)
