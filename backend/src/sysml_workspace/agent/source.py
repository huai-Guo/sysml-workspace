from __future__ import annotations

import re


def normalize_model_source(text: str) -> str:
    """Normalize a model response into plain SysML source."""
    if not text:
        return ""

    stripped = text.strip()

    # 1. Match code inside markdown code fences (```...```) anywhere in the text
    matches = re.findall(r"```(?:sysml|text)?\s*([\s\S]*?)```", stripped, re.IGNORECASE)
    if matches:
        # If multiple blocks, find one with SysML keywords
        for m in matches:
            content = m.strip()
            if any(k in content for k in ("package ", "part def ", "part ", "model ")):
                return content
        return matches[0].strip()

    # 2. Check unclosed fence
    if "```" in stripped:
        parts = stripped.split("```", 2)
        if len(parts) >= 2:
            candidate = parts[1]
            lines = candidate.splitlines()
            if lines and lines[0].strip().lower() in {"sysml", "text"}:
                candidate = "\n".join(lines[1:])
            return candidate.strip()

    # 3. Strip introductory greetings/chat before the root package / definition
    pkg_idx = stripped.find("package ")
    if pkg_idx > 0:
        stripped = stripped[pkg_idx:].strip()
    elif pkg_idx == -1:
        # If no package, find earliest root definition keyword
        earliest = len(stripped)
        for kw in ("part def ", "port def ", "model ", "item def "):
            k_idx = stripped.find(kw)
            if 0 <= k_idx < earliest:
                earliest = k_idx
        if 0 < earliest < len(stripped):
            stripped = stripped[earliest:].strip()

    # 4. Strip trailing chat commentary after final closing brace
    last_brace = stripped.rfind("}")
    if last_brace != -1 and last_brace < len(stripped) - 1:
        trailing = stripped[last_brace + 1:].strip()
        if trailing and any(w in trailing.lower() for w in ("note", "this model", "explanation", "here", "```", "hope")):
            stripped = stripped[:last_brace + 1].strip()

    return stripped
