"""Tool-call validation: schema, permissions, sandbox, budget."""

import hashlib
import json
from pathlib import Path, PurePosixPath

from . import budgets

FORBIDDEN_NAMES = {".env", ".dev.vars"}
FORBIDDEN_SUFFIXES = (".pem", ".key", ".pfx", ".p12")
RUNS_PREFIX = ".runs/"
BACKGROUND_TOKENS = (" &", "& ", "&&", "||", "nohup", "setsid", ";")
DESTRUCTIVE_PATTERNS = (
    "reset --hard",
    "push --force",
    "push -f",
    "filter-branch",
    "filter-repo",
    "reflog expire",
    "rm -rf /",
    "rm -rf ~",
    ":(){",
    "mkfs",
    "dd if=",
)

SCHEMAS = {
    "dev.read_file": (("path", str),),
    "dev.list_dir": (),
    "dev.write_file": (("path", str), ("content", str)),
    "dev.edit_file": (("path", str), ("find", str), ("replace", str)),
    "dev.run_tests": (("command", str),),
    "dev.run_shell": (("command", str),),
    "dev.complete_objective": (("criteria", list),),
}

MAX_FILE_BYTES = 200_000


def fingerprint(name, args):
    blob = json.dumps({"n": name, "a": args}, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _resolve(root, rel):
    """Resolve rel under root; return Path or None when escaping."""
    root = Path(root).resolve()
    try:
        p = (root / rel).resolve()
    except OSError:
        return None
    try:
        p.relative_to(root)
    except ValueError:
        return None
    return p


def _forbidden_path(rel):
    norm = rel.replace("\\", "/")
    while norm.startswith("./"):
        norm = norm[2:]
    norm = norm.lstrip("/")
    if norm.startswith(RUNS_PREFIX) or norm == ".runs":
        return True
    base = PurePosixPath(norm).name
    if base in FORBIDDEN_NAMES or base.endswith(FORBIDDEN_SUFFIXES):
        return True
    return False


def check_args(name, args):
    """Schema check. Returns (ok, reason)."""
    if name not in SCHEMAS:
        return False, f"unknown tool {name}"
    if not isinstance(args, dict):
        return False, "arguments must be an object"
    for field, typ in SCHEMAS[name]:
        if field not in args:
            return False, f"missing required argument {field}"
        if not isinstance(args[field], typ):
            return False, f"argument {field} must be {typ.__name__}"
    if name == "dev.complete_objective":
        for i, c in enumerate(args["criteria"]):
            if not isinstance(c, dict) or not {"criterion", "verdict", "evidence"} <= set(c):
                return False, f"criteria[{i}] needs criterion/verdict/evidence"
            if c["verdict"] not in ("pass", "fail", "partial"):
                return False, f"criteria[{i}] bad verdict"
    for key in ("timeout_s",):
        if key in args and not isinstance(args[key], int):
            return False, f"argument {key} must be integer"
    return True, ""


def validate_call(call, state):
    """Return (verdict, tier, reason). Tiers: auto/approval/forbidden."""
    name = call.get("name", "")
    args = call.get("arguments", {})
    ok, reason = check_args(name, args)
    if not ok:
        return ("rejected", "forbidden", reason)
    if name == "dev.complete_objective":
        if state.get("completed_claimed"):
            return ("rejected", "forbidden", "completion already claimed")
        return ("approved", "approval", "completion claims need human approval")
    if name in ("dev.read_file", "dev.list_dir", "dev.write_file", "dev.edit_file"):
        rel = args.get("path", ".")
        if _resolve(state["root"], rel) is None:
            return ("rejected", "forbidden", "outside_root")
        if name in ("dev.write_file", "dev.edit_file"):
            if _forbidden_path(rel):
                return ("rejected", "forbidden", "forbidden_path")
            if name == "dev.write_file":
                if len(args["content"].encode()) > MAX_FILE_BYTES:
                    return ("rejected", "forbidden", "too_large")
                target = _resolve(state["root"], rel)
                if target.exists() and rel not in state.get("files_read", []):
                    return ("rejected", "forbidden", "unread_overwrite")
        return ("approved", "auto", "")
    if name == "dev.run_tests":
        if args["command"] in state.get("test_allowlist", []):
            return ("approved", "auto", "")
        return ("rejected", "forbidden", "command not on test allowlist")
    if name == "dev.run_shell":
        cmd = args["command"]
        if any(p in cmd for p in DESTRUCTIVE_PATTERNS):
            return ("rejected", "forbidden", "destructive pattern")
        if any(t in f" {cmd} " for t in BACKGROUND_TOKENS):
            return ("rejected", "forbidden", "backgrounding not allowed")
        cwd = args.get("cwd", ".")
        if _resolve(state["root"], cwd) is None:
            return ("rejected", "forbidden", "outside_root")
        if cmd.strip() in state.get("shell_allowlist", []):
            return ("approved", "auto", "")
        if fingerprint(name, args) in state.get("gate_approvals", []):
            return ("approved", "auto", "gate-approved")
        return ("approved", "approval", "shell needs human approval")
    return ("rejected", "forbidden", f"no rule for {name}")
