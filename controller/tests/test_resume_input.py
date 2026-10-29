"""Chained turns without tool outputs must still send non-empty input."""

import json
import tempfile
import unittest
from pathlib import Path

import loop
from controller import state


class CapClient:
    def __init__(self):
        self.seen = []

    def create(self, instructions, tools, prev, followups=None):
        self.seen.append((prev, followups))
        return {"id": "r9", "tool_calls": [], "text": "ok",
                "refused": False, "usage": {"in": 1, "out": 1}}


class TestResumeInput(unittest.TestCase):
    def test_gate_resume_sends_note_as_input(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        (root / "objective.md").write_text("do it\n")
        st = state.new_run(str(root / "objective.md"), str(root))
        st["response_ids"].append("resp_old")
        api = CapClient()
        ctx = {"system_instructions": "sys", "objective_text": "obj",
               "followups": None, "resume_note": "Human gate decision: approved."}
        self.assertEqual(loop.run_turn(st, ctx, api), "continue")
        prev, fol = api.seen[0]
        self.assertEqual(prev, "resp_old")
        self.assertTrue(fol)
        self.assertIn("approved", json.dumps(fol))


if __name__ == "__main__":
    unittest.main()
