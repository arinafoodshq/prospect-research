"""Spike S-0: single search-grounding probe (specs/evaluation.md section 5).

Reads MODEL_API_KEY from the environment (never prints it). Makes exactly one
Responses API call, prints verification proofs, saves the response body only as
the first product fixture. No headers or keys are persisted.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

OUT = Path("product/tests/fixtures/s0_ikeja_venues.json")


def main():
    key = os.environ.get("MODEL_API_KEY", "")
    if not key:
        print("S0_ABORT=missing_key")
        return 1
    body = {
        "model": "muse-spark-1.3",
        "instructions": "You are a business research assistant. Answer only from web search results and cite every factual claim.",
        "input": [
            {"role": "user", "content": [{"type": "input_text", "text": (
                "Name three corporate event venues in Ikeja, Lagos, Nigeria, "
                "each with its website. Cite every venue."
            )}]}
        ],
        "tools": [{
            "type": "web_search",
            "search_context_size": "low",
            "user_location": {"type": "approximate", "country": "NG",
                             "region": "Lagos", "city": "Ikeja",
                             "timezone": "Africa/Lagos"},
        }],
        "include": ["web_search_call.results"],
        "max_tool_calls": 3,
        "store": True,
    }
    req = urllib.request.Request(
        "https://api.meta.ai/v1/responses",
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode()[:500]
        except OSError:
            detail = ""
        print(f"S0_HTTP_ERROR={e.code} {detail}")
        return 1
    except OSError as e:
        print(f"S0_TRANSPORT_ERROR={str(e)[:200]}")
        return 1

    output = payload.get("output", [])
    calls = [i for i in output if i.get("type") == "web_search_call"]
    results = [r for c in calls for r in (c.get("results") or [])]
    cites, spans_ok = [], True
    for item in output:
        if item.get("type") != "message":
            continue
        for block in item.get("content", []):
            text = block.get("text", "")
            for ann in block.get("annotations", []) or []:
                if ann.get("type") != "url_citation":
                    continue
                cites.append(ann)
                s, e = ann.get("start_index", -1), ann.get("end_index", -1)
                if not (0 <= s < e <= len(text)):
                    spans_ok = False
    usage = payload.get("usage", {}) or {}
    tin, tout = usage.get("input_tokens", 0), usage.get("output_tokens", 0)
    cost = tin / 1e6 * 1.25 + tout / 1e6 * 4.25 + len(calls) * 0.0025
    print(f"S0_STATUS={payload.get('status')}")
    print(f"S0_SEARCH_CALLS={len(calls)} " + ",".join(c.get("status", "?") for c in calls))
    print(f"S0_RESULTS={len(results)}")
    for r in results[:6]:
        print(f"S0_URL={r.get('url')}")
    print(f"S0_CITATIONS={len(cites)} S0_SPANS_OK={spans_ok}")
    print(f"S0_TOKENS_IN={tin} S0_TOKENS_OUT={tout} S0_COST_EST={cost:.4f}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"S0_FIXTURE_SAVED={OUT.as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
