from __future__ import annotations

from .state import DiagnosticState

GENERATION_SYSTEM_PROMPT = """You are a SysML v2 modeling assistant.
Return only complete SysML v2 source code.
Do not use Markdown fences.
Do not explain the code.
Prefer the smallest model that faithfully satisfies the request.
The result will be checked by a deterministic SysML validator."""

REPAIR_SYSTEM_PROMPT = """You repair SysML v2 source code.
Return only the complete corrected SysML v2 source.
Do not use Markdown fences.
Do not explain the changes.
Preserve the user's engineering intent and make the smallest safe correction.
CRITICAL: Always return the complete file starting with the root 'package <Name> { ... }' wrapper and all required 'port def' declarations. Never omit the outer package or return partial snippets.
The result will be checked again by a deterministic SysML validator."""

REVISION_SYSTEM_PROMPT = """You are an expert SysML v2 systems engineer revising an existing model.
Return only valid SysML v2 source code.
Do not use Markdown fences.
Do not explain the changes or output conversational commentary.
Faithfully implement all requested changes (adding new parts, ports, connections, or requirements) while preserving the existing model elements.
CRITICAL: You must return the COMPLETE SysML v2 file starting with the root 'package <Name> { ... }' wrapper and all required 'port def' declarations. Never omit the outer package or return partial snippets.
The result will be verified by a deterministic SysML v2 compiler."""


def build_generation_prompt(request: str) -> str:
    return f"""Engineering request:

{request}

Produce complete SysML v2 source only."""


def build_revision_prompt(
    *,
    request: str,
    source: str,
) -> str:
    return f"""User modification requirements:
{request.strip()}

Current SysML v2 model:
--- BEGIN SYSML ---
{source.strip()}
--- END SYSML ---

Instructions:
1. Revise and extend the SysML v2 model above to implement all requested modifications.
2. CRITICAL: You must return the COMPLETE file including the enclosing 'package' wrapper and all 'port def' declarations. Never omit the package declaration or return partial parts.
3. Keep all existing parts, ports, connections, and structure that do not conflict with the requirements.
4. Return ONLY the complete, updated SysML v2 source code."""


def build_repair_prompt(
    *,
    request: str,
    source: str,
    diagnostics: list[DiagnosticState],
) -> str:
    rendered = "\n".join(
        _render_diagnostic(index, diagnostic)
        for index, diagnostic in enumerate(
            diagnostics,
            start=1,
        )
    )
    intent = (
        request.strip()
        or "Repair the model so it passes validation."
    )

    return f"""Engineering intent:
{intent}

Current SysML source:
--- BEGIN SYSML ---
{source}
--- END SYSML ---

Deterministic validator diagnostics:
{rendered or "(no diagnostics provided)"}

Instructions:
1. Fix all validator diagnostics while preserving the user's engineering intent.
2. CRITICAL: Return the COMPLETE file starting with the root 'package <Name> { ... }' wrapper and all required 'port def' declarations. Never return partial snippets or omit the package wrapper.
3. Return the complete corrected SysML v2 source only."""


def _render_diagnostic(
    index: int,
    diagnostic: DiagnosticState,
) -> str:
    location = ""
    if diagnostic.get("line") is not None:
        location = f" line={diagnostic['line']}"
        if diagnostic.get("column") is not None:
            location += (
                f" column={diagnostic['column']}"
            )

    return (
        f"{index}. "
        f"[{diagnostic.get('kind', 'unknown')}/"
        f"{diagnostic.get('severity', 'unknown')}]"
        f"{location}: "
        f"{diagnostic.get('message', '')}"
    )
