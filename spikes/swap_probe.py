"""Swap bodies between transports to isolate the 401 trigger."""

import hashlib
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
            return f"200 {json.loads(resp.read().decode()).get('status')}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}"


def main():
    key = os.environ.get("MODEL_API_KEY", "")
    cli = apiclient.ResponsesClient(api_key=key)
    tools = registry.tool_definitions()
    instr = "Say ok."
    tiny_in = [{"role": "user", "content": [{"type": "input_text", "text": "Say ok."}]}]

    # Rebuild EXACTLY what create() builds (copy of its logic)
    client_body = {"model": cli.model, "instructions": instr, "tools": tools,
                   "tool_choice": "auto", "reasoning": {"effort": cli.reasoning_effort},
                   "store": True, "input": tiny_in}
    probe_body = {"model": "muse-spark-1.3", "instructions": instr, "input": tiny_in,
                  "tools": tools, "tool_choice": "auto",
                  "reasoning": {"effort": "low"}, "store": True}
    b1 = json.dumps(client_body).encode()
    b2 = json.dumps(probe_body).encode()
    print(f"CLIENT_BODY_SHA={hashlib.sha256(b1).hexdigest()[:16]} LEN={len(b1)}")
    print(f"PROBE_BODY_SHA={hashlib.sha256(b2).hexdigest()[:16]} LEN={len(b2)}")
    print(f"RAW_SEND_CLIENT_BODY={raw_send(json.loads(b1))}", flush=True)
    try:
        cli._post("/responses", json.loads(b2))
        print("CLIENT_POST_PROBE_BODY=200", flush=True)
    except apiclient.ApiError as e:
        print(f"CLIENT_POST_PROBE_BODY={e}", flush=True)


if __name__ == "__main__":
    main()
