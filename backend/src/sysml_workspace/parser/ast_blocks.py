"""
Comment/string-safe lexical brace-block scanner and diagnostic scope locator for SysML v2.

Provides a deterministic fallback when Xtext cannot construct a complete EMF AST due to
severe syntax errors, and fuses with `ValidatorMain`'s `partial_model` offsets whenever
available to locate the minimum enclosing scope for scoped repair.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Iterable

from .contracts import SysMLDiagnostic


@dataclass(frozen=True, slots=True)
class SysMLBlockSpan:
    kind: str
    name: str
    qualified_name: str
    parent_qualified_name: str | None
    depth: int
    start_offset: int
    end_offset: int
    start_line: int
    end_line: int
    is_block: bool
    indent: str
    source_origin: str = "lexical_fallback"

    def slice_text(self, source: str) -> str:
        return source[self.start_offset : self.end_offset]


_REJECT_PREFIX_RE = re.compile(
    r"^(?:connection|connect|flow|transition|first|then|satisfy|verify|import|alias|comment|doc|entry|do|exit|bind|succession)\b"
)
_MODIFIER_RE = re.compile(
    r"^(?:(?:public|private|protected|abstract|variation|individual|ref|readonly|derived|in|out|inout)\s+)+"
)

_HEADER_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^package\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "Package"),
    (re.compile(r"^part\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "PartDefinition"),
    (re.compile(r"^port\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "PortDefinition"),
    (re.compile(r"^item\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "ItemDefinition"),
    (re.compile(r"^attribute\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "AttributeDefinition"),
    (re.compile(r"^state\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "StateDefinition"),
    (re.compile(r"^action\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "ActionDefinition"),
    (re.compile(r"^constraint\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "ConstraintDefinition"),
    (re.compile(r"^requirement\s+def\s+(?:<[^>]+>\s*)?([A-Za-z_][A-Za-z0-9_]*)\b"), "RequirementDefinition"),
    (re.compile(r"^verification\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "VerificationCaseDefinition"),
    (re.compile(r"^part\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "PartUsage"),
    (re.compile(r"^port\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "PortUsage"),
    (re.compile(r"^(?:exhibit\s+)?state\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "StateUsage"),
    (re.compile(r"^(?:perform\s+)?action\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "ActionUsage"),
    (re.compile(r"^constraint\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "ConstraintUsage"),
    (re.compile(r"^requirement\s+(?:<[^>]+>\s*)?([A-Za-z_][A-Za-z0-9_]*)\b"), "RequirementUsage"),
    (re.compile(r"^verification\s+([A-Za-z_][A-Za-z0-9_]*)\b"), "VerificationCaseUsage"),
)


def _mask_comments_and_strings(source: str) -> str:
    chars = list(source)
    i = 0
    n = len(chars)
    while i < n:
        c = chars[i]
        nxt = chars[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            chars[i] = " "
            chars[i + 1] = " "
            i += 2
            while i < n and chars[i] != "\n":
                if chars[i] != "\r":
                    chars[i] = " "
                i += 1
            continue
        if c == "/" and nxt == "*":
            chars[i] = " "
            chars[i + 1] = " "
            i += 2
            while i < n and not (chars[i] == "*" and i + 1 < n and chars[i + 1] == "/"):
                if chars[i] not in {"\n", "\r"}:
                    chars[i] = " "
                i += 1
            if i + 1 < n:
                chars[i] = " "
                chars[i + 1] = " "
                i += 2
            continue
        if c == '"':
            chars[i] = " "
            i += 1
            while i < n and chars[i] != '"':
                if chars[i] == "\\" and i + 1 < n:
                    chars[i] = " "
                    chars[i + 1] = " "
                    i += 2
                    continue
                if chars[i] not in {"\n", "\r"}:
                    chars[i] = " "
                i += 1
            if i < n:
                chars[i] = " "
                i += 1
            continue
        i += 1
    return "".join(chars)


def _line_starts(source: str) -> list[int]:
    starts = [0]
    for idx, ch in enumerate(source):
        if ch == "\n":
            starts.append(idx + 1)
    return starts


def _offset_to_line(offset: int, starts: list[int]) -> int:
    lo, hi = 0, len(starts) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if starts[mid] <= offset:
            lo = mid + 1
        else:
            hi = mid - 1
    return max(1, hi + 1)


def _classify_header(header_text: str) -> tuple[str, str] | None:
    clean = re.sub(r"\s+", " ", header_text).strip()
    if not clean or _REJECT_PREFIX_RE.match(clean):
        return None
    stripped = _MODIFIER_RE.sub("", clean)
    for pattern, kind in _HEADER_PATTERNS:
        m = pattern.match(stripped)
        if m:
            return kind, m.group(1)
    return None


def scan_sysml_blocks(source: str) -> list[SysMLBlockSpan]:
    """Scan SysML v2 source into brace-balanced container/declaration spans (1-based lines)."""
    masked = _mask_comments_and_strings(source)
    starts = _line_starts(source)
    results: list[dict[str, Any]] = []
    stack: list[dict[str, Any] | None] = []

    def _indent_at(offset: int) -> str:
        line_start = offset
        while line_start > 0 and source[line_start - 1] != "\n":
            line_start -= 1
        k = line_start
        while k < len(source) and source[k] in {" ", "\t"}:
            k += 1
        return source[line_start:k]

    def _active_parent() -> dict[str, Any] | None:
        for item in reversed(stack):
            if item is not None:
                return item
        return None

    stmt_start = 0
    for i, ch in enumerate(masked):
        if ch == "{":
            header_slice = masked[stmt_start:i]
            m_ws = re.search(r"\S", header_slice)
            header_start = stmt_start + m_ws.start() if m_ws else stmt_start
            parsed = _classify_header(header_slice)
            if parsed is not None:
                kind, name = parsed
                parent = _active_parent()
                qname = f"{parent['qualified_name']}::{name}" if parent else name
                entry = {
                    "kind": kind,
                    "name": name,
                    "qualified_name": qname,
                    "parent_qualified_name": parent["qualified_name"] if parent else None,
                    "depth": (parent["depth"] + 1) if parent else 0,
                    "start_offset": header_start,
                    "end_offset": len(source),
                    "is_block": True,
                    "indent": _indent_at(header_start),
                }
                results.append(entry)
                stack.append(entry)
            else:
                stack.append(None)
            stmt_start = i + 1
        elif ch == "}":
            popped = stack.pop() if stack else None
            if popped is not None:
                popped["end_offset"] = i + 1
            stmt_start = i + 1
        elif ch == ";":
            header_slice = masked[stmt_start:i]
            m_ws = re.search(r"\S", header_slice)
            header_start = stmt_start + m_ws.start() if m_ws else stmt_start
            parsed = _classify_header(header_slice)
            if parsed is not None:
                kind, name = parsed
                parent = _active_parent()
                qname = f"{parent['qualified_name']}::{name}" if parent else name
                results.append(
                    {
                        "kind": kind,
                        "name": name,
                        "qualified_name": qname,
                        "parent_qualified_name": parent["qualified_name"] if parent else None,
                        "depth": (parent["depth"] + 1) if parent else 0,
                        "start_offset": header_start,
                        "end_offset": i + 1,
                        "is_block": False,
                        "indent": _indent_at(header_start),
                    }
                )
            stmt_start = i + 1

    spans: list[SysMLBlockSpan] = []
    for r in results:
        spans.append(
            SysMLBlockSpan(
                kind=r["kind"],
                name=r["name"],
                qualified_name=r["qualified_name"],
                parent_qualified_name=r["parent_qualified_name"],
                depth=r["depth"],
                start_offset=r["start_offset"],
                end_offset=r["end_offset"],
                start_line=_offset_to_line(r["start_offset"], starts),
                end_line=_offset_to_line(max(r["start_offset"], r["end_offset"] - 1), starts),
                is_block=r["is_block"],
                indent=r["indent"],
                source_origin="lexical_fallback",
            )
        )
    return spans


def _spans_from_partial_model(source: str, partial_model: dict[str, Any] | None) -> list[SysMLBlockSpan]:
    if not partial_model or not isinstance(partial_model.get("entities"), list):
        return []
    starts = _line_starts(source)
    entities = partial_model["entities"]
    by_id = {e.get("id"): e for e in entities if isinstance(e, dict) and e.get("id")}

    def _depth(ent: dict[str, Any]) -> int:
        d = 0
        cur = ent.get("owner_id")
        seen: set[str] = set()
        while cur and cur in by_id and cur not in seen:
            seen.add(cur)
            d += 1
            cur = by_id[cur].get("owner_id")
        return d

    spans: list[SysMLBlockSpan] = []
    for ent in entities:
        if not isinstance(ent, dict):
            continue
        loc = ent.get("location")
        name = ent.get("name")
        if not isinstance(loc, dict) or not name:
            continue
        offset = loc.get("offset")
        length = loc.get("length")
        if not isinstance(offset, int) or not isinstance(length, int) or length <= 0:
            continue
        end_offset = min(len(source), offset + length)
        if offset < 0 or offset >= len(source):
            continue
        owner = by_id.get(ent.get("owner_id"))
        line_start = offset
        while line_start > 0 and source[line_start - 1] != "\n":
            line_start -= 1
        k = line_start
        while k < len(source) and source[k] in {" ", "\t"}:
            k += 1
        spans.append(
            SysMLBlockSpan(
                kind=str(ent.get("kind") or "Element"),
                name=str(name),
                qualified_name=str(ent.get("qualified_name") or name),
                parent_qualified_name=str(owner.get("qualified_name")) if owner and owner.get("qualified_name") else None,
                depth=_depth(ent),
                start_offset=offset,
                end_offset=end_offset,
                start_line=_offset_to_line(offset, starts),
                end_line=_offset_to_line(max(offset, end_offset - 1), starts),
                is_block="{" in source[offset:end_offset],
                indent=source[line_start:k],
                source_origin="partial_ast",
            )
        )
    return spans


def locate_enclosing_block(
    source: str,
    *,
    line: int | None = None,
    offset: int | None = None,
    partial_model: dict[str, Any] | None = None,
    prefer_container: bool = True,
) -> SysMLBlockSpan | None:
    """
    Find the narrowest enclosing SysML block for a diagnostic location.
    Uses `partial_model` (real Xtext AST offsets) first, falling back to lexical brace scanning.
    """
    candidates_ast = _spans_from_partial_model(source, partial_model)
    candidates_lex = scan_sysml_blocks(source)

    def _pick(spans: list[SysMLBlockSpan]) -> SysMLBlockSpan | None:
        matched: list[SysMLBlockSpan] = []
        for s in spans:
            if offset is not None:
                if s.start_offset <= offset <= s.end_offset:
                    matched.append(s)
            elif line is not None:
                if s.start_line <= line <= s.end_line:
                    matched.append(s)
        if not matched:
            return None
        if prefer_container:
            blocks = [m for m in matched if m.is_block]
            if blocks:
                matched = blocks
        # Narrowest span (deepest nesting, smallest character length)
        matched.sort(key=lambda m: (-m.depth, m.end_offset - m.start_offset))
        return matched[0]

    return _pick(candidates_ast) or _pick(candidates_lex)


def locate_diagnostic_scopes(
    source: str,
    diagnostics: Iterable[SysMLDiagnostic],
    *,
    partial_model: dict[str, Any] | None = None,
) -> list[tuple[SysMLDiagnostic, SysMLBlockSpan | None]]:
    """Map every error/warning diagnostic to its minimum enclosing SysML block span."""
    return [
        (
            diag,
            locate_enclosing_block(
                source,
                line=diag.line,
                offset=diag.offset,
                partial_model=partial_model,
            ),
        )
        for diag in diagnostics
    ]
