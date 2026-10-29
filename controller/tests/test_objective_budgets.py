"""Objective ```budget block parsing/enforcement + gate-roundtrip verdicts."""

import tempfile
import unittest
from pathlib import Path

import loop
from controller import budgets, state


VALID = """# objective.md

Do things.

```budget
turns=25
wall_s=1800
cost_usd=4.00
tokens=300000
```
"""


class TestBudgetBlock(unittest.TestCase):
    def test_valid_parsed(self):
        caps = loop.parse_budget_block(VALID)
        self.assertEqual(
            caps, {"turns": 25, "wall_s": 1800, "cost_usd": 4.0, "tokens": 300000})

    def test_missing_falls_back_to_defaults(self):
        self.assertIsNone(loop.parse_budget_block("no block here\n"))
        with tempfile.TemporaryDirectory() as tmp:
            obj = Path(tmp) / "objective.md"
            obj.write_text("do it\n")
            st = state.new_run(str(obj), tmp, budget_overrides=None)
            self.assertEqual(st["budgets"], budgets.DEFAULTS)

    def test_unknown_key_refuses(self):
        text = VALID.replace("tokens=300000", "tokens=300000\nfrobnicate=1")
        with self.assertRaisesRegex(ValueError, "unknown budget key"):
            loop.parse_budget_block(text)

    def test_malformed_value_refuses(self):
        with self.assertRaisesRegex(ValueError, "malformed budget value"):
            loop.parse_budget_block(VALID.replace("turns=25", "turns=many"))
        with self.assertRaisesRegex(ValueError, "must be > 0"):
            loop.parse_budget_block(VALID.replace("turns=25", "turns=0"))

    def test_missing_key_refuses(self):
        text = VALID.replace("tokens=300000\n", "")
        with self.assertRaisesRegex(ValueError, "missing required keys"):
            loop.parse_budget_block(text)

    def test_unclosed_and_multiple_refuse(self):
        with self.assertRaisesRegex(ValueError, "unclosed"):
            loop.parse_budget_block(VALID.rsplit("```", 1)[0])
        with self.assertRaisesRegex(ValueError, "multiple"):
            loop.parse_budget_block(VALID + VALID)

    def test_custom_cap_enforced_not_defaults(self):
        caps = loop.parse_budget_block(VALID)
        with tempfile.TemporaryDirectory() as tmp:
            obj = Path(tmp) / "objective.md"
            obj.write_text("do it\n")
            st = state.new_run(str(obj), tmp, budget_overrides=caps)
            self.assertEqual(st["budgets"]["turns"], 25)
            st["turns"] = 25
            self.assertEqual(budgets.check(st), "budget_turns")
            st["turns"] = 24
            self.assertIsNone(budgets.check(st))


class TestGateRoundtripVerdicts(unittest.TestCase):
    def test_verdicts_appear_in_report(self):
        import json

        import loop as loopmod
        from controller import gates

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "objective.md").write_text("do it\n")
            st = state.new_run(str(root / "objective.md"), str(root))
            call = {"name": "dev.complete_objective", "arguments": {
                "criteria": [{"criterion": "done", "verdict": "pass",
                              "evidence": "t2"}]}}
            self.assertEqual(loopmod._completion_gate(st, call), "gate")
            # verdicts stored in run state at gate-raise time; survive reload
            back = state.load_run(str(root), st["run_id"])
            self.assertEqual(
                back["completion_verdicts"],
                [{"criterion": "done", "verdict": "pass", "evidence": "t2"}])
            gates.answer_path(back).write_text(json.dumps({"decision": "approve"}))
            self.assertEqual(
                loopmod.apply_answer(back, gates.read_answer(back)), "approved")
            self.assertEqual(loopmod._finish(back, "completed"), 0)
            text = (state.run_dir(str(root), back["run_id"])
                    / "completion_report.md").read_text()
            self.assertIn("## Acceptance verdicts", text)
            self.assertIn("[pass] done: t2", text)


if __name__ == "__main__":
    unittest.main()
