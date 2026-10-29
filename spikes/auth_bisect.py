"""Diagnose the client.py 401: start from the known-good S-0 shape, add back
client.py elements one at a time. Prints status per case. Never prints the key."""

import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from controller import registry  # noqa: E402

TINY = [{"role": "user", "content": [{"type": "input_text", "text": "Say ok."}]}]


def attempt(label, body):
    key = os.environ.get("MODEL_API_KEY", "")
    req = urllib.request.Request(
        "https://api.meta.ai/v1/responses",
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode())
        out = payload.get("output", [])
        n = sum(1 for i in out if i.get("type") == "message")
        print(f"CASE {label}: 200 messages={n} status={payload.get('status')}", flush=True)
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode()[:200]
        except OSError:
            detail = ""
        print(f"CASE {label}: HTTP {e.code} {detail}", flush=True)
    except OSError as e:
        print(f"CASE {label}: TRANSPORT {str(e)[:150]}", flush=True)


def main():
    base = {"model": "muse-spark-1.3", "input": TINY}
    attempt("1-minimal", dict(base))
    attempt("2-instructions", {**base, "instructions": "Be brief."})
    attempt("3-tools", {**base, "tools": registry.tool_definitions(), "tool_choice": "auto"})
    attempt("4-reasoning", {**base, "reasoning": {"effort": "low"}})
    attempt("5-store", {**base, "store": True})
    long_instr = open("system_instructions.md", encoding="utf-8").read() + "\n" + open(
        "objective.md", encoding="utf-8").read()[:2000]
    attempt("6-long-instructions", {**base, "instructions": long_instr})
    attempt("7-full-client-shape", {
        "model": "muse-spark-1.3", "instructions": long_instr, "input": TINY,
        "tools": registry.tool_definitions(), "tool_choice": "auto",
        "reasoning": {"effort": "low"}, "store": True,
    })


if __name__ == "__main__":
    main()
