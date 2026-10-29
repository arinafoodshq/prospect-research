"""Gate raise/answer/clear mechanics."""

import json
import tempfile
import unittest
from pathlib import Path

from controller import gates, state


class TestGates(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        obj = Path(self.tmp.name) / "objective.md"
        obj.write_text("do it\n")
        self.st = state.new_run(str(obj), self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_raise_and_answer(self):
        self.assertIsNone(gates.read_answer(self.st))
        gates.raise_gate(self.st, "ok?", {"c": 1}, {"action": "execute"})
        self.assertEqual(self.st["status"], "awaiting_approval")
        gates.answer_path(self.st).write_text(json.dumps({"decision": "approve"}))
        self.assertEqual(gates.read_answer(self.st), {"decision": "approve"})
        gates.clear_gate(self.st)
        self.assertEqual(self.st["status"], "running")
        self.assertIsNone(self.st["pending_gate"])

    def test_bad_answer_ignored(self):
        gates.answer_path(self.st).write_text(json.dumps({"decision": "maybe"}))
        self.assertIsNone(gates.read_answer(self.st))


if __name__ == "__main__":
    unittest.main()
