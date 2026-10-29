"""Execution: file tools, redaction, truncation, sandboxed runs."""

import tempfile
import unittest
from pathlib import Path

from controller import execute, state


class TestExecute(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        obj = Path(self.tmp.name) / "objective.md"
        obj.write_text("do it\n")
        self.st = state.new_run(str(obj), self.tmp.name, test_allowlist=["echo hi"])

    def tearDown(self):
        self.tmp.cleanup()

    def run_call(self, name, **args):
        return execute.execute_call({"call_id": "c", "name": name, "arguments": args}, self.st)

    def test_write_read_edit(self):
        self.assertTrue(self.run_call("dev.write_file", path="a.txt", content="one\ntwo\n")["ok"])
        r = self.run_call("dev.read_file", path="a.txt")
        self.assertEqual(r["output"]["lines"], ["one", "two"])
        self.assertTrue(self.run_call("dev.edit_file", path="a.txt", find="two", replace="2")["ok"])
        self.assertIn("2", (Path(self.tmp.name) / "a.txt").read_text())

    def test_lf_endings_preserved(self):
        self.run_call("dev.write_file", path="a.txt", content="one\ntwo\n")
        raw = (Path(self.tmp.name) / "a.txt").read_bytes()
        self.assertNotIn(b"\r", raw)

    def test_unicode_output_survives(self):
        import sys

        cmd = f"\"{sys.executable}\" -c \"import sys; sys.stdout.buffer.write((chr(10003) + chr(8594)).encode())\""
        self.st["test_allowlist"].append(cmd)
        r = self.run_call("dev.run_tests", command=cmd)
        self.assertTrue(r["ok"])
        self.assertIn("✓", r["output"])

    def test_edit_mismatch(self):
        self.run_call("dev.write_file", path="a.txt", content="aaa aaa")
        self.assertEqual(self.run_call("dev.edit_file", path="a.txt", find="zzz", replace="q")["error"], "no_match")
        self.assertEqual(self.run_call("dev.edit_file", path="a.txt", find="aaa", replace="q")["error"], "ambiguous_match")

    def test_binary_rejected(self):
        (Path(self.tmp.name) / "b.bin").write_bytes(b"\x00\x01\x02\xff")
        self.assertEqual(self.run_call("dev.read_file", path="b.bin")["error"], "binary_rejected")

    def test_redact(self):
        dirty = "key: api_key=sk-abcdef123456 and Bearer abc.def.ghi password=hunter2"
        clean = execute.redact(dirty)
        self.assertNotIn("sk-abcdef", clean)
        self.assertNotIn("hunter2", clean)
        self.assertIn("[redacted]", clean)

    def test_run_tests_allowlist(self):
        self.assertTrue(self.run_call("dev.run_tests", command="echo hi")["ok"])
        self.assertEqual(self.run_call("dev.run_tests", command="evil")["error"], "command not on test allowlist")


if __name__ == "__main__":
    unittest.main()
