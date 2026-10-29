"""Transcript rebuild for stored-response recovery."""

import tempfile
import unittest
from pathlib import Path

import loop
from controller import state


class TestRebuild(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "objective.md").write_text("do it\n")
        self.st = state.new_run(str(self.root / "objective.md"), str(self.root))

    def tearDown(self):
        self.tmp.cleanup()

    def test_rebuild_shape_and_skip(self):
        state.append_turn(self.st, {"results": [
            {"tool": "dev.read_file", "call_id": "a1",
             "args": {"path": "x.md"}, "ok": True, "output": "hello"},
            {"tool": "dev.run_shell", "rejected": "nope"},
        ]})
        state.append_turn(self.st, {"gate": "denied"})
        items = loop.rebuild_input(self.st)
        self.assertEqual(items[0]["role"], "user")
        kinds = [i.get("type") for i in items[1:]]
        self.assertEqual(kinds, ["function_call", "function_call_output"])
        self.assertEqual(items[1]["call_id"], "a1")
        self.assertIn("x.md", items[1]["arguments"])

    def test_args_capped_valid_json(self):
        import json

        big = "z" * 9000
        state.append_turn(self.st, {"results": [
            {"tool": "dev.write_file", "call_id": "b2",
             "args": {"path": "f", "content": big}, "ok": True, "output": "ok"},
        ]})
        items = loop.rebuild_input(self.st)
        args = json.loads(items[1]["arguments"])
        self.assertIn("omitted-for-replay", args["content"])
        self.assertEqual(args["path"], "f")

    def test_missing_transcript(self):
        (state.run_dir(str(self.root), self.st["run_id"]) / "transcript.jsonl").unlink()
        items = loop.rebuild_input(self.st)
        self.assertEqual(len(items), 1)


if __name__ == "__main__":
    unittest.main()
