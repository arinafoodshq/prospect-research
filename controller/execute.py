"""Tool execution with timeouts, truncation, and secret redaction."""

import re
import subprocess
from pathlib import Path

SECRET_PATTERNS = (
    re.compile(r"(?i)(api[_-]?key|token|secret|password|bearer)\s*[:=]\s*\S+"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{8,}"),
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/-]+=*"),
)
MAX_OUTPUT = 200_000


def redact(text):
    for pat in SECRET_PATTERNS:
        text = pat.sub("[redacted]", text)
    return text


def truncate(text):
    if len(text) <= MAX_OUTPUT:
        return text
    head = MAX_OUTPUT // 2
    return text[:head] + f"\n...[truncated {len(text) - MAX_OUTPUT} chars]...\n" + text[-head:]


def execute_call(call, state):
    """Run an approved call. Returns {ok, output} or {ok, error}."""
    name = call["name"]
    args = call.get("arguments", {})
    root = Path(state["root"])
    try:
        if name == "dev.read_file":
            return _read(root, state, args)
        if name == "dev.list_dir":
            return _list(root, args)
        if name == "dev.write_file":
            return _write(root, state, args)
        if name == "dev.edit_file":
            return _edit(root, args)
        if name == "dev.run_tests":
            return _run(root, args, state, kind="tests")
        if name == "dev.run_shell":
            return _run(root, args, state, kind="shell")
        if name == "dev.complete_objective":
            return {"ok": True, "output": {"claim": args["criteria"]}}
    except OSError as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}
    return {"ok": False, "error": f"no executor for {name}"}


def _read(root, state, args):
    p = (root / args["path"]).resolve()
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return {"ok": False, "error": "binary_rejected"}
    lines = text.splitlines()
    off = max(1, int(args.get("offset", 1))) - 1
    lim = min(2000, max(1, int(args.get("limit", 500))))
    if args["path"] not in state["files_read"]:
        state["files_read"].append(args["path"])
    return {"ok": True, "output": {"lines": lines[off:off + lim], "total": len(lines)}}


def _list(root, args):
    p = (root / args.get("path", ".")).resolve()
    if not p.is_dir():
        return {"ok": False, "error": "not_found"}
    entries = [{"name": e.name, "dir": e.is_dir(), "bytes": e.stat().st_size if e.is_file() else 0} for e in sorted(p.iterdir())]
    return {"ok": True, "output": {"entries": entries}}


def _write(root, state, args):
    p = (root / args["path"]).resolve()
    p.parent.mkdir(parents=True, exist_ok=True)
    existed = p.exists()
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(args["content"])
    if args["path"] not in state["files_read"]:
        state["files_read"].append(args["path"])
    return {"ok": True, "output": {"path": args["path"], "existed": existed}}


def _edit(root, args):
    p = (root / args["path"]).resolve()
    text = p.read_text(encoding="utf-8")
    count = text.count(args["find"])
    if count == 0:
        return {"ok": False, "error": "no_match"}
    if count > 1:
        return {"ok": False, "error": "ambiguous_match"}
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(text.replace(args["find"], args["replace"], 1))
    return {"ok": True, "output": {"path": args["path"]}}


def _run(root, args, state, kind):
    if kind == "tests" and args["command"] not in state.get("test_allowlist", []):
        return {"ok": False, "error": "command not on test allowlist"}
    timeout = min(600, max(1, int(args.get("timeout_s", 300 if kind == "tests" else 120))))
    cwd = (root / args.get("cwd", ".")).resolve()
    try:
        proc = subprocess.run(
            args["command"], shell=True, cwd=str(cwd), capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=timeout,
        )
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or "") + (e.stderr or "")
        return {"ok": False, "error": f"timeout after {timeout}s", "output": truncate(redact(out))}
    out = truncate(redact((proc.stdout or "") + (proc.stderr or "")))
    return {"ok": proc.returncode == 0, "output": out, "exit_code": proc.returncode}
