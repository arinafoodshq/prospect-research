"""Pin the 401: send loop.py's EXACT turn-1 body via raw urllib AND via
controller.client, and dump request metadata (never the key)."""

import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import loop  # noqa: E402
from controller import client as apiclient, registry  # noqa: E402


def raw_send(body):
    key = os.environ.get("MODEL_API_KEY", "")
    req = urllib.request.Request(
        "https://api.meta.ai/v1/responses",
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return f"200 status={json.loads(resp.read().decode()).get('status')}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code} {e.read().decode()[:150]}"


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys_instr = open(os.path.join(root, "system_instructions.md"), encoding="utf-8").read()
    obj_text = open(os.path.join(root, "objective.md"), encoding="utf-8").read()
    fake_state = {"turns": 0, "started_at": 0.0, "cost_usd_est": 0.0,
                  "tokens_in": 0, "tokens_out": 0, "budgets": dict(loop.budgets.DEFAULTS)}
    import time
    fake_state["started_at"] = time.time()
    instructions = loop.build_instructions(
        {"system_instructions": sys_instr, "objective_text": obj_text}, fake_state)
    print(f"INSTR_CHARS={len(instructions)}")
    body = {
        "model": "muse-spark-1.3", "instructions": instructions,
        "input": [{"role": "user", "content": [{"type": "input_text", "text": "Begin."}]}],
        "tools": registry.tool_definitions(), "tool_choice": "auto",
        "reasoning": {"effort": "low"}, "store": True,
    }
    print(f"RAW_URLLIB={raw_send(body)}", flush=True)
    import hashlib
    key = os.environ.get("MODEL_API_KEY", "")
    print(f"KEYLEN={len(key)} URL=https://api.meta.ai/v1/responses")
    cli_dbg = apiclient.ResponsesClient(api_key=key)
    dbg_body = {"model": "muse-spark-1.3", "input": "ping"}
    r1 = urllib.request.Request(
        "https://api.meta.ai/v1/responses", data=json.dumps(dbg_body).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST")
    r2 = urllib.request.Request(
        cli_dbg.base_url + "/responses", data=json.dumps(dbg_body).encode(),
        headers={"Authorization": f"Bearer {cli_dbg.api_key}", "Content-Type": "application/json"},
        method="POST")
    for label, r in (("RAW", r1), ("CLIENT", r2)):
        auth = r.get_header("Authorization") or ""
        print(f"{label} url={r.full_url} method={r.get_method()} "
              f"auth_scheme={auth[:7]!r} auth_len={len(auth)} "
              f"body_sha={hashlib.sha256(r.data).hexdigest()[:12]}")
    cli = apiclient.ResponsesClient(api_key=key)
    print(f"CLIENT_BASE={cli.base_url} MODEL={cli.model} EFFORT={cli.reasoning_effort}")
    try:
        resp = cli.create(instructions, registry.tool_definitions(), None, None)
        print(f"CLIENT_CREATE=200 id={resp['id']} calls={len(resp['tool_calls'])}")
    except apiclient.ApiError as e:
        print(f"CLIENT_CREATE=ApiError {e}")


if __name__ == "__main__":
    main()
