"""Completion report generation."""

from pathlib import Path

from .state import run_dir


def write_report(state, verdicts=None):
    lines = [
        f"# Run {state['run_id']} — {state['status']}",
        "",
        f"Objective: {state['objective_path']} (sha {state['objective_sha256'][:12]})",
        f"Turns: {state['turns']}, tokens in/out: {state['tokens_in']}/{state['tokens_out']}, "
        f"cost est: ${state['cost_usd_est']:.4f}",
    ]
    if state.get("error"):
        lines += ["", f"Error: {state['error']}"]
    if verdicts:
        lines += ["", "## Acceptance verdicts"]
        for v in verdicts:
            lines.append(f"- [{v.get('verdict')}] {v.get('criterion')}: {v.get('evidence')}")
    lines += ["", "See transcript.jsonl for the full turn log."]
    text = "\n".join(lines) + "\n"
    (run_dir(state["root"], state["run_id"]) / "completion_report.md").write_text(text, encoding="utf-8")
    return text
