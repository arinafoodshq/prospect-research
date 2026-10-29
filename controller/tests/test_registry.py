"""Contract: registry output matches tools.md Part A snapshot."""

import json
import unittest
from pathlib import Path

from controller import registry

FIX = Path(__file__).parent / "fixtures" / "part_a_registry.json"


class TestRegistryContract(unittest.TestCase):
    def test_matches_snapshot(self):
        snap = json.loads(FIX.read_text())["tools"]
        want = {t["name"]: t for t in snap}
        got = registry.tool_definitions()
        self.assertEqual([t["name"] for t in got], [t["name"] for t in snap])
        for t in got:
            w = want[t["name"]]
            self.assertEqual(t["type"], "function")
            self.assertTrue(t["description"], t["name"])
            self.assertEqual(
                set(t["parameters"].get("required", [])),
                set(w.get("required", [])), t["name"])
            for p, spec in w.get("parameters", {}).items():
                self.assertIn(p, t["parameters"]["properties"], (t["name"], p))
                self.assertEqual(
                    t["parameters"]["properties"][p].get("type"),
                    spec.get("type"), (t["name"], p))


if __name__ == "__main__":
    unittest.main()
