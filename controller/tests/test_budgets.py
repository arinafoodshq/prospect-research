"""Budget warnings, exhaustion, cost math."""

import time
import unittest

from controller import budgets


def st(turns=0, budget_turns=40, cost=0.0, budget_cost=8.0, toks=0, budget_toks=600_000):
    return {
        "turns": turns, "started_at": time.time(), "cost_usd_est": cost,
        "tokens_in": toks // 2, "tokens_out": toks - toks // 2,
        "budgets": {"turns": budget_turns, "wall_s": 10 ** 9, "cost_usd": budget_cost, "tokens": budget_toks},
    }


class TestBudgets(unittest.TestCase):
    def test_estimate(self):
        self.assertAlmostEqual(budgets.estimate_cost(1_000_000, 1_000_000), 5.50)

    def test_warnings_at_80(self):
        self.assertEqual(budgets.warnings(st(turns=32)), ["turns"])
        self.assertEqual(budgets.warnings(st(turns=10)), [])

    def test_exhausted(self):
        self.assertEqual(budgets.exhausted(st(turns=40)), "turns")
        self.assertIsNone(budgets.exhausted(st(turns=39)))
        self.assertEqual(budgets.check(st(cost=8.0)), "budget_cost_usd")


if __name__ == "__main__":
    unittest.main()
