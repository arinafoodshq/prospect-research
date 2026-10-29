"""Gate resolution seeds tool outputs so chained resume turns are valid."""

import tempfile
import unittest
from pathlib import Path

import loop
from controller import gates, state


def mkstate(tmp, gate):
    root = Path(tmp)
    (root / "objective.md").write_text("do it\n")
    (root / "a.txt").write_text("hi\n")
    st = state.new_run(str(root / "objective.md"), str(root))
    st["pending_gate"] = gate
    state.set_status(st, "awaiting_approval")
    return st


READ_CALL = {"call_id": "c9", "name": "dev.read_file",
             "arguments": {"path": "a.txt"}}


class TestResolveGate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def test_approve_executes_and_seeds(self):
        st = mkstate(self.tmp.name, {"question": "q", "context": {"call": READ_CALL},
                                     "proposed": {"action": "execute", "fingerprint": "x"}})
        note, seed = loop.resolve_gate(st, {"decision": "approve"})
        self.assertIn("executed", note)
        self.assertEqual(st["status"], "running")
        self.assertEqual(len(seed), 1)
        self.assertEqual(seed[0]["type"], "function_call_output")
        self.assertEqual(seed[0]["call_id"], "c9")
        self.assertIn("hi", seed[0]["output"])

    def test_deny_seeds_denial(self):
        st = mkstate(self.tmp.name, {"question": "q", "context": {"call": READ_CALL},
                                     "proposed": {"action": "execute", "fingerprint": "x"}})
        note, seed = loop.resolve_gate(st, {"decision": "deny"})
        self.assertIn("denied", note)
        self.assertEqual(seed[0]["call_id"], "c9")
        self.assertIn("denied", seed[0]["output"])

    def test_deny_completion_resets_claim(self):
        st = mkstate(self.tmp.name, {"question": "q",
                                     "context": {"claim": [], "call": READ_CALL},
                                     "proposed": {"action": "complete"}})
        st["completed_claimed"] = True
        _, seed = loop.resolve_gate(st, {"decision": "deny"})
        self.assertFalse(st["completed_claimed"])
        self.assertEqual(seed[0]["call_id"], "c9")

    def test_approve_completion_no_seed(self):
        st = mkstate(self.tmp.name, {"question": "q",
                                     "context": {"claim": [], "call": READ_CALL},
                                     "proposed": {"action": "complete"}})
        _, seed = loop.resolve_gate(st, {"decision": "approve"})
        self.assertIsNone(seed)
        self.assertIn("complete", st["gate_approvals"])


if __name__ == "__main__":
    unittest.main()
