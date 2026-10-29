"""Part A tool definitions. Must match tools.md Part A (contract-tested)."""

READ = {
    "type": "function",
    "name": "dev.read_file",
    "description": "Read a repo-relative text file, paginated. Use before editing.",
    "parameters": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Repo-relative file path."},
            "offset": {"type": "integer", "description": "1-based start line.", "default": 1},
            "limit": {"type": "integer", "description": "Max lines (1-2000).", "default": 500},
        },
        "required": ["path"],
        "additionalProperties": False,
    },
}

LIST = {
    "type": "function",
    "name": "dev.list_dir",
    "description": "List names, kinds, and sizes in a repo directory (one level).",
    "parameters": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Repo-relative dir.", "default": "."},
        },
        "required": [],
        "additionalProperties": False,
    },
}

WRITE = {
    "type": "function",
    "name": "dev.write_file",
    "description": "Create or fully overwrite a repo file (max 200KB). Overwriting requires having read the file this run.",
    "parameters": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Repo-relative file path."},
            "content": {"type": "string", "description": "Complete file content."},
        },
        "required": ["path", "content"],
        "additionalProperties": False,
    },
}

EDIT = {
    "type": "function",
    "name": "dev.edit_file",
    "description": "Replace one exact text match (must occur exactly once).",
    "parameters": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Repo-relative file path."},
            "find": {"type": "string", "description": "Exact text to replace."},
            "replace": {"type": "string", "description": "Replacement text."},
        },
        "required": ["path", "find", "replace"],
        "additionalProperties": False,
    },
}

TESTS = {
    "type": "function",
    "name": "dev.run_tests",
    "description": "Run a project test command from the run's test allowlist.",
    "parameters": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Allowlisted test command."},
            "timeout_s": {"type": "integer", "description": "Timeout 1-600.", "default": 300},
        },
        "required": ["command"],
        "additionalProperties": False,
    },
}

SHELL = {
    "type": "function",
    "name": "dev.run_shell",
    "description": "Run a local shell command. Needs human approval unless on the informational mini-allowlist. No backgrounding or destructive git ops.",
    "parameters": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Command to run."},
            "timeout_s": {"type": "integer", "description": "Timeout 1-600.", "default": 120},
            "cwd": {"type": "string", "description": "Repo-relative cwd.", "default": "."},
        },
        "required": ["command"],
        "additionalProperties": False,
    },
}

COMPLETE = {
    "type": "function",
    "name": "dev.complete_objective",
    "description": "Claim the objective is complete, with per-criterion evidence. Raises a human approval gate; callable once.",
    "parameters": {
        "type": "object",
        "properties": {
            "criteria": {
                "type": "array",
                "description": "Per-criterion verdicts.",
                "items": {
                    "type": "object",
                    "properties": {
                        "criterion": {"type": "string"},
                        "verdict": {"type": "string", "enum": ["pass", "fail", "partial"]},
                        "evidence": {"type": "string"},
                    },
                    "required": ["criterion", "verdict", "evidence"],
                },
            },
        },
        "required": ["criteria"],
        "additionalProperties": False,
    },
}


def tool_definitions():
    """Return the Part A tool list in registry order."""
    return [READ, LIST, WRITE, EDIT, TESTS, SHELL, COMPLETE]
