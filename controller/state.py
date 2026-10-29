"""Run-record persistence under .runs/<run_id>/."""

import hashlib
import json
import time
import uuid
from pathlib import Path

from . import budgets

RUNS_DIR = ".runs"
STATUSES = (
    "running",
    "awaiting_approval",
    "paused",
    "completed",
    "failed",
    "budget_exhausted",
    "stopped",
)


def run_dir(root, run_id):
    return Path(root) / RUNS_DIR / run_id


def objective_sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def new_run(objective_path, root, budget_overrides=None, test_allowlist=None, shell_allowlist=None):
    root = str(Path(root).resolve())
    run_id = uuid.uuid4().hex[:12]
    state = {
        "run_id": run_id,
        "root": root,
        "objective_path": str(objective_path),
        "objective_sha256": objective_sha(objective_path),
        "status": "running",
        "started_at": time.time(),
        "finished_at": None,
        "turns": 0,
        "tokens_in": 0,
        "tokens_out": 0,
        "cost_usd_est": 0.0,
        "budgets": {**budgets.DEFAULTS, **(budget_overrides or {})},
        "response_ids": [],
        "files_read": [],
        "gate_approvals": [],
        "completed_claimed": False,
        "pending_gate": None,
        "error": None,
        "test_allowlist": list(test_allowlist or []),
        "shell_allowlist": list(shell_allowlist or []),
    }
    d = run_dir(root, run_id)
    d.mkdir(parents=True, exist_ok=True)
    save(state)
    (d / "transcript.jsonl").touch()
    return state


def save(state):
    d = run_dir(state["root"], state["run_id"])
    d.mkdir(parents=True, exist_ok=True)
    (d / "run.json").write_text(json.dumps(state, indent=2), encoding="utf-8")


def load_run(root, run_id):
    """Load run.json; raise ValueError on missing/corrupt record (never repair)."""
    p = run_dir(root, run_id) / "run.json"
    try:
        state = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"unreadable run record {p}: {e}")
    if not isinstance(state, dict) or "objective_sha256" not in state:
        raise ValueError(f"invalid run record {p}")
    state["root"] = str(Path(root).resolve())
    return state


def verify_objective(state):
    """Return True when the objective file is unchanged since run start."""
    return objective_sha(state["objective_path"]) == state["objective_sha256"]


def append_turn(state, turn):
    turn = {"turn": state["turns"] + 1, "at": time.time(), **turn}
    d = run_dir(state["root"], state["run_id"])
    with (d / "transcript.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(turn) + "\n")
    state["turns"] += 1
    save(state)
    return turn


def set_status(state, status, error=None):
    assert status in STATUSES, status
    state["status"] = status
    state["error"] = error
    if status in ("completed", "failed", "budget_exhausted", "stopped"):
        state["finished_at"] = time.time()
    save(state)
