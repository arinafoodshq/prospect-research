"""Budget tracking. Defaults per specs/agent-loop.md section 9."""

import time

DEFAULTS = {"turns": 40, "wall_s": 45 * 60, "cost_usd": 8.0, "tokens": 600_000}

# muse-spark-1.3 Standard rates, documented at dev.meta.ai pricing.
IN_PER_1M = 1.25
OUT_PER_1M = 4.25


def estimate_cost(tokens_in, tokens_out):
    return tokens_in / 1_000_000 * IN_PER_1M + tokens_out / 1_000_000 * OUT_PER_1M


def usage(state):
    """Return (turns, elapsed_s, cost, tokens) consumed."""
    caps = state["budgets"]
    elapsed = time.time() - state["started_at"]
    return (
        state["turns"],
        elapsed,
        state["cost_usd_est"],
        state["tokens_in"] + state["tokens_out"],
    )


def limits(state):
    caps = state["budgets"]
    return (caps["turns"], caps["wall_s"], caps["cost_usd"], caps["tokens"])


def warnings(state):
    """Names of budgets at >=80% but below 100%."""
    names = ("turns", "wall_s", "cost_usd", "tokens")
    return [n for n, u, cap in zip(names, usage(state), limits(state)) if cap > 0 and u >= 0.8 * cap and u < cap]


def exhausted(state):
    """Name of the first budget at 100%+, else None."""
    names = ("turns", "wall_s", "cost_usd", "tokens")
    for n, u, cap in zip(names, usage(state), limits(state)):
        if cap > 0 and u >= cap:
            return n
    return None


def check(state):
    """Return stop reason 'budget_<name>' when exhausted, else None."""
    hit = exhausted(state)
    return f"budget_{hit}" if hit else None
