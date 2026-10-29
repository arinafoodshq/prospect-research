"""Golden controller scenarios S-A1..S-A5 with scripted mock inference."""

import json
import tempfile
import unittest
from pathlib import Path

import loop
from controller import gates, state


class FakeClient:
    def __init__(self, script):
        self.script = list(script)
        self.calls = 0

    def create(self, instructions, tools, prev, followups=None):
        self.calls += 1
        item = self.script.pop(0)
        return {"id": f"r{self.calls}", "tool_calls": item.get("calls", []),
                "text": item.get("text", ""), "refused": False,
                "usage": {"in": 10, "out": 10}}


def tc(name, **args):
    return {"call_id": "c1", "name": name, "arguments": args}


COMPLETE = tc("dev.complete_objective", criteria=[
    {"criterion": "done", "verdict": "pass", "evidence": "t2"}])


class ScenarioBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "objective.md").write_text("do it\n")
        (self.root / "note.txt").write_text("hello world\n")
        self.st = state.new_run(str(self.root / "objective.md"), str(self.root),
                                test_allowlist=["echo hi"])
        self.ctx = {"system_instructions": "sys", "objective_text": "obj", "followups": None}

    def tearDown(self):
        self.tmp.cleanup()

    def decide(self, verdict):
        p = gates.answer_path(self.st)
        p.write_text(json.dumps({"decision": verdict}))

    def drive(self, api, cap=10):
        """Replicates main(): gate-aware turn loop."""
        for _ in range(cap):
            stop = loop.should_continue(self.st)
            if stop:
                return loop._finish(self.st, stop)
            nxt = loop.run_turn(self.st, self.ctx, api)
            if nxt == "gate":
                return "gate"
            if nxt.startswith("stop:"):
                return loop._finish(self.st, nxt[5:])
        raise AssertionError("turn cap hit")


class TestScenarios(ScenarioBase):
    def test_sa1_doc_edit_gate_approve(self):
        api = FakeClient([
            {"calls": [tc("dev.read_file", path="note.txt")]},
            {"calls": [tc("dev.edit_file", path="note.txt", find="world", replace="there")]},
            {"calls": [COMPLETE]},
        ])
        self.assertEqual(self.drive(api), "gate")
        self.assertEqual(self.st["status"], "awaiting_approval")
        self.assertEqual(self.st["pending_gate"]["proposed"]["action"], "complete")
        self.decide("approve")
        self.assertEqual(loop.apply_answer(self.st, gates.read_answer(self.st)), "approved")
        self.assertEqual(loop._finish(self.st, "completed"), 0)
        self.assertEqual((self.root / "note.txt").read_text(), "hello there\n")
        self.assertEqual(api.calls, 3)  # nothing re-executed across the gate
        self.assertTrue((state.run_dir(str(self.root), self.st["run_id"]) / "completion_report.md").exists())

    def test_sa2_test_fix(self):
        api = FakeClient([
            {"calls": [tc("dev.run_tests", command="echo hi")]},
            {"calls": [tc("dev.edit_file", path="note.txt", find="world", replace="tested")]},
            {"calls": [COMPLETE]},
        ])
        self.assertEqual(self.drive(api), "gate")
        self.decide("approve")
        loop.apply_answer(self.st, gates.read_answer(self.st))
        self.assertEqual(loop._finish(self.st, "completed"), 0)
        self.assertIn("tested", (self.root / "note.txt").read_text())

    def test_sa3_shell_denied_then_completes(self):
        api = FakeClient([
            {"calls": [tc("dev.run_shell", command="pip install x")]},
            {"calls": [tc("dev.read_file", path="note.txt")]},
            {"calls": [COMPLETE]},
        ])
        self.assertEqual(self.drive(api), "gate")
        self.assertEqual(self.st["pending_gate"]["proposed"]["action"], "execute")
        self.decide("deny")
        self.assertEqual(loop.apply_answer(self.st, gates.read_answer(self.st)), "denied")
        self.assertEqual(self.st["status"], "running")
        self.assertEqual(self.drive(api), "gate")  # completion gate now
        self.decide("approve")
        loop.apply_answer(self.st, gates.read_answer(self.st))
        self.assertEqual(loop._finish(self.st, "completed"), 0)

    def test_sa4_budget_stop_preserves_work(self):
        self.st["budgets"]["turns"] = 2
        state.save(self.st)
        api = FakeClient([{"calls": [tc("dev.read_file", path="note.txt")]} for _ in range(3)])
        self.assertEqual(self.drive(api), 0)
        self.assertEqual(self.st["status"], "budget_exhausted")
        self.assertEqual(api.calls, 2)  # third response never consumed
        transcript = (state.run_dir(str(self.root), self.st["run_id"]) / "transcript.jsonl").read_text()
        self.assertEqual(len(transcript.strip().splitlines()), 2)

    def test_sa5_corrupt_record_aborts(self):
        p = state.run_dir(str(self.root), self.st["run_id"]) / "run.json"
        p.write_text("{broken")
        with self.assertRaises(ValueError):
            state.load_run(str(self.root), self.st["run_id"])


if __name__ == "__main__":
    unittest.main()
