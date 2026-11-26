from __future__ import annotations

from dataclasses import asdict, dataclass
import re
from typing import Any, Literal

_SAFE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class SemanticCommandError(ValueError):
    pass


@dataclass(frozen=True)
class SemanticCommandPlan:
    kind: str
    parent_id: str | None
    textual_content: str
    description: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class CreateConnectionCommand:
    parent_id: str | None
    name: str
    source_path: tuple[str, ...]
    target_path: tuple[str, ...]
    kind: Literal["create_connection"] = "create_connection"


@dataclass(frozen=True)
class CreateOwnedElementCommand:
    owner_id: str | None
    element_type: str  # package, part_def, part, port, state, requirement
    name: str
    type_ref: str | None = None
    kind: Literal["create_owned_element"] = "create_owned_element"


@dataclass(frozen=True)
class RenameElementCommand:
    element_id: str
    old_name: str
    new_name: str
    kind: Literal["rename_element"] = "rename_element"


@dataclass(frozen=True)
class DeleteElementCommand:
    element_id: str
    kind: Literal["delete_element"] = "delete_element"


@dataclass(frozen=True)
class DeleteAudit:
    safe: bool
    reasons: tuple[str, ...]


class SemanticCommandCompiler:
    """Compile canvas-originated semantic editing commands to SysML v2 textual snippets."""

    def compile_connection(self, command: CreateConnectionCommand) -> SemanticCommandPlan:
        self._validate_name(command.name, "connection name")
        source = self._feature_path(command.source_path, "source")
        target = self._feature_path(command.target_path, "target")

        textual = f"connection {command.name} connect {source} to {target};"
        return SemanticCommandPlan(
            kind=command.kind,
            parent_id=command.parent_id,
            textual_content=textual,
            description=f"Connect {source} to {target} as {command.name}",
        )

    def compile_element(self, command: CreateOwnedElementCommand) -> SemanticCommandPlan:
        self._validate_name(command.name, f"{command.element_type} name")
        etype = command.element_type.lower()
        tref = f" : {command.type_ref}" if command.type_ref else ""

        if etype in {"package"}:
            textual = f"package {command.name} {{\n}}"
        elif etype in {"part_def", "partdefinition"}:
            textual = f"part def {command.name};"
        elif etype in {"part", "partusage"}:
            textual = f"part {command.name}{tref};"
        elif etype in {"port", "portusage"}:
            textual = f"port {command.name}{tref};"
        elif etype in {"state", "stateusage"}:
            textual = f"state {command.name};"
        elif etype in {"requirement", "requirementusage"}:
            textual = f"requirement {command.name} {{\n    doc /* requirement doc */\n}}"
        else:
            textual = f"{etype} {command.name}{tref};"

        return SemanticCommandPlan(
            kind=command.kind,
            parent_id=command.owner_id,
            textual_content=textual,
            description=f"Create {command.element_type} {command.name}",
        )

    def _feature_path(self, path: tuple[str, ...], role: str) -> str:
        if not path:
            raise SemanticCommandError(f"{role} feature path is empty")
        for segment in path:
            self._validate_name(segment, f"{role} path segment")
        return ".".join(path)

    @staticmethod
    def _validate_name(value: str, role: str) -> None:
        if not _SAFE_NAME.fullmatch(value):
            raise SemanticCommandError(f"{role} {value!r} is not a valid SysML identifier")


def audit_delete(
    snapshot: dict[str, Any],
    target_id: str,
) -> DeleteAudit:
    """Audit whether an element can safely be deleted without dangling references."""
    elements = snapshot.get("entities", []) or snapshot.get("elements", [])
    relations = snapshot.get("relations", []) or snapshot.get("relationships", [])
    by_id = {e.get("id"): e for e in elements}
    target = by_id.get(target_id)
    reasons: list[str] = []

    if target is None:
        return DeleteAudit(False, ("Target element not found in semantic snapshot.",))

    for element in elements:
        if element.get("id") == target_id:
            continue
        if element.get("owner_id") == target_id or element.get("parentId") == target_id:
            reasons.append(f"Element owns child {element.get('name') or element.get('id')}.")
        for field in ("types", "typeRef", "chaining_features"):
            val = element.get(field)
            if _has_ref(val, target_id):
                reasons.append(f"Element {element.get('name')} references target through {field}.")

    for rel in relations:
        src = rel.get("source", {})
        tgt = rel.get("target", {})
        if isinstance(src, dict) and src.get("id") == target_id:
            reasons.append(f"Relationship {rel.get('id')} has target as source.")
        elif isinstance(tgt, dict) and tgt.get("id") == target_id:
            reasons.append(f"Relationship {rel.get('id')} has target as target.")

    return DeleteAudit(not reasons, tuple(dict.fromkeys(reasons)))


def _has_ref(value: Any, expected_id: str) -> bool:
    if isinstance(value, str):
        return value == expected_id
    if isinstance(value, (list, tuple, set)):
        return any(_has_ref(item, expected_id) for item in value)
    if isinstance(value, dict):
        if value.get("id") == expected_id:
            return True
        return any(_has_ref(item, expected_id) for item in value.values())
    return False
