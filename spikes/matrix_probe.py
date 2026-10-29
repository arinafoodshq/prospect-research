"""Full matrix: same dict object through both transports; swapped bodies."""

import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
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


def post_send(cli, body):
    try:
        cli._post("/responses", body)
        return "200"
    except apiclient.ApiError as e:
        return f"HTTP {e.status}"


def main():
    key = os.environ.get("MODEL_API_KEY", "")
    cli = apiclient.ResponsesClient(api_key=key)
    tiny = [{"role": "user", "content": [{"type": "input_text", "text": "Say ok."}]}]
    tools = registry.tool_definitions()
    shared = {"model": "muse-spark-1.3", "instructions": "Say ok.",
              "tools": tools, "tool_choice": "auto", "reasoning": {"effort": "low"},
              "store": True, "input": tiny}
    print(f"RAW_SHARED={raw_send(shared)}", flush=True)
    print(f"POST_SHARED={post_send(cli, shared)}", flush=True)


if __name__ == "__main__":
    main()
