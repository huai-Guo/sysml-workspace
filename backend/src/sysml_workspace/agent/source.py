from __future__ import annotations


def normalize_model_source(text: str) -> str:
    """Normalize a model response into plain SysML source."""

    stripped = text.strip()
    fence = chr(96) * 3

    if not stripped.startswith(fence):
        return stripped

    lines = stripped.splitlines()
    if (
        len(lines) < 3
        or not lines[-1].strip().startswith(fence)
    ):
        return stripped

    first = lines[0].strip().lower()
    if first not in {
        fence,
        fence + "sysml",
        fence + "text",
    }:
        return stripped

    return "\n".join(lines[1:-1]).strip()
