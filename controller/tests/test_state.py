"""Run records: roundtrip, hash pinning, transcript, statuses."""

import json
import tempfile
import unittest
from pathlib import Path

from controller import state


class TestState(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.obj = Path(self.tmp.name) / "objective.md"
        self.obj.write_text("do it\n")

    def tearDown(self):
        self.tmp.cleanup()

    def test_roundtrip(self):
        st = state.new_run(str(self.obj), self.tmp.name)
        st["turns"] = 3
        state.save(st)
        back = state.load_run(self.tmp.name, st["run_id"])
        self.assertEqual(back["turns"], 3)
        self.assertTrue(state.verify_objective(back))

    def test_hash_detects_change(self):
        st = state.new_run(str(self.obj), self.tmp.name)
        self.obj.write_text("changed\n")
        self.assertFalse(state.verify_objective(st))

    def test_corrupt_record_raises(self):
        st = state.new_run(str(self.obj), self.tmp.name)
        p = state.run_dir(self.tmp.name, st["run_id"]) / "run.json"
        p.write_text("{broken")
        with self.assertRaises(ValueError):
            state.load_run(self.tmp.name, st["run_id"])

    def test_append_and_status(self):
        st = state.new_run(str(self.obj), self.tmp.name)
        state.append_turn(st, {"x": 1})
        self.assertEqual(st["turns"], 1)
        state.set_status(st, "completed")
        self.assertIsNotNone(st["finished_at"])
        lines = (state.run_dir(self.tmp.name, st["run_id"]) / "transcript.jsonl").read_text().strip().splitlines()
        self.assertEqual(json.loads(lines[0])["x"], 1)


if __name__ == "__main__":
    unittest.main()
