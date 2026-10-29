"""Meta Responses API transport (urllib, stdlib-only)."""

import json
import time
import urllib.error
import urllib.request

BASE_URL = "https://api.meta.ai/v1"
RETRYABLE = (429, 500, 502, 503, 504)


class ApiError(Exception):
    def __init__(self, status, message, retryable):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.retryable = retryable


class ResponsesClient:
    def __init__(self, api_key, model="muse-spark-1.3", base_url=BASE_URL,
                 reasoning_effort="low", timeout_s=120):
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.reasoning_effort = reasoning_effort
        self.timeout_s = timeout_s

    def create(self, instructions, tools, previous_response_id=None, followups=None):
        body = {
            "model": self.model,
            "instructions": instructions,
            "tools": tools,
            "tool_choice": "auto",
            "reasoning": {"effort": self.reasoning_effort},
            "store": True,
        }
        # instructions carries the prompt; input holds tool outputs / first user turn.
        # The server rejects empty input, so chained turns without followups
        # carry a minimal prompt (loop.py normally supplies a richer note).
        if followups:
            body["input"] = followups
        elif previous_response_id:
            body["input"] = [{"role": "user",
                              "content": [{"type": "input_text", "text": "Continue."}]}]
        else:
            body["input"] = [
                {"role": "user", "content": [{"type": "input_text", "text": "Begin."}]}
            ]
        if previous_response_id:
            body["previous_response_id"] = previous_response_id
        data = self._post("/responses", body)
        return self.parse(data)

    @staticmethod
    def parse(data):
        """Normalize a Responses payload to {id, tool_calls, text, refused, usage}."""
        calls, texts, refused = [], [], False
        for item in data.get("output", []):
            t = item.get("type")
            if t == "function_call":
                try:
                    args = json.loads(item.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {"_raw": item.get("arguments")}
                calls.append({"call_id": item.get("call_id", ""), "name": item.get("name", ""), "arguments": args})
            elif t == "message":
                for block in item.get("content", []):
                    if block.get("type") == "output_text":
                        texts.append(block.get("text", ""))
                    if block.get("type") == "refusal":
                        refused = True
                        texts.append(block.get("refusal", ""))
        usage = data.get("usage", {}) or {}
        return {
            "id": data.get("id", ""),
            "tool_calls": calls,
            "text": "\n".join(texts),
            "refused": refused,
            "usage": {"in": usage.get("input_tokens", 0), "out": usage.get("output_tokens", 0)},
        }

    def _post(self, path, body, attempts=3):
        req = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + self.api_key, "Content-Type": "application/json"},
            method="POST",
        )
        last = None
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as e:
                try:
                    detail = e.read().decode()[:500]
                except OSError:
                    detail = ""
                if e.code in RETRYABLE and attempt < attempts - 1:
                    last = e
                    time.sleep(2 ** attempt)
                    continue
                raise ApiError(e.code, detail, e.code in RETRYABLE)
            except (TimeoutError, ConnectionError, OSError) as e:
                if attempt < attempts - 1:
                    last = e
                    time.sleep(2 ** attempt)
                    continue
                raise ApiError(0, str(e)[:200], True)
        raise ApiError(0, str(last)[:200], True)
