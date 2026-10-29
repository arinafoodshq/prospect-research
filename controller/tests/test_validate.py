"""Validation tiers, sandbox, schema, budget-adjacent rules."""

import tempfile
import unittest
from pathlib import Path

from controller import state, validate


def mkstate(root, **kw):
    obj = Path(root) / "objective.md"
    obj.write_text("obj\n## Approval note\nok 2026-10-28\n")
    st = state.new_run(str(obj), root, **kw)
    return st


def call(name, **args):
    return {"call_id": "c1", "name": name, "arguments": args}


class TestValidate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.st = mkstate(self.tmp.name, test_allowlist=["run-my-tests"], shell_allowlist=["git status"])

    def tearDown(self):
        self.tmp.cleanup()

    def v(self, name, **args):
        return validate.validate_call(call(name, **args), self.st)

    def test_unknown_tool_forbidden(self):
        verdict, tier, _ = self.v("dev.nope")
        self.assertEqual((verdict, tier), ("rejected", "forbidden"))

    def test_read_auto(self):
        (Path(self.tmp.name) / "a.txt").write_text("hi")
        self.assertEqual(self.v("dev.read_file", path="a.txt")[:2], ("approved", "auto"))

    def test_escape_rejected(self):
        for bad in ("../x", "..\\x", "/etc/hosts", "C:\\Windows\\x"):
            verdict, tier, reason = self.v("dev.read_file", path=bad)
            self.assertEqual(verdict, "rejected", bad)
            self.assertIn("outside_root", reason, bad)

    def test_secret_paths_forbidden(self):
        for bad in (".env", ".dev.vars", "sub/.env", "k.pem", ".runs/x/run.json"):
            verdict, tier, reason = self.v("dev.write_file", path=bad, content="z")
            self.assertEqual(verdict, "rejected", bad)

    def test_unread_overwrite_rejected(self):
        (Path(self.tmp.name) / "a.txt").write_text("hi")
        verdict, _, reason = self.v("dev.write_file", path="a.txt", content="new")
        self.assertEqual(verdict, "rejected")
        self.assertIn("unread_overwrite", reason)

    def test_write_after_read_approved(self):
        (Path(self.tmp.name) / "a.txt").write_text("hi")
        self.st["files_read"].append("a.txt")
        self.assertEqual(self.v("dev.write_file", path="a.txt", content="new")[:2], ("approved", "auto"))

    def test_tests_allowlist(self):
        self.assertEqual(self.v("dev.run_tests", command="run-my-tests")[:2], ("approved", "auto"))
        verdict, _, _ = self.v("dev.run_tests", command="rm everything")
        self.assertEqual(verdict, "rejected")

    def test_shell_tiers(self):
        self.assertEqual(self.v("dev.run_shell", command="git status")[:2], ("approved", "auto"))
        verdict, tier, _ = self.v("dev.run_shell", command="pip install x")
        self.assertEqual((verdict, tier), ("approved", "approval"))

    def test_shell_destructive_forbidden(self):
        verdict, tier, reason = self.v("dev.run_shell", command="git reset --hard")
        self.assertEqual((verdict, tier), ("rejected", "forbidden"))

    def test_shell_background_forbidden(self):
        verdict, _, _ = self.v("dev.run_shell", command="sleep 5 &")
        self.assertEqual(verdict, "rejected")

    def test_complete_once_then_approval(self):
        crit = [{"criterion": "c", "verdict": "pass", "evidence": "t1"}]
        self.assertEqual(self.v("dev.complete_objective", criteria=crit)[:2], ("approved", "approval"))
        self.st["completed_claimed"] = True
        verdict, _, _ = self.v("dev.complete_objective", criteria=crit)
        self.assertEqual(verdict, "rejected")

    def test_complete_schema(self):
        verdict, _, _ = self.v("dev.complete_objective", criteria=[{"criterion": "c"}])
        self.assertEqual(verdict, "rejected")


if __name__ == "__main__":
    unittest.main()
