from __future__ import annotations

import re
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


# Implied KerML / SysML v2 standard library base supertypes injected by OMG Pilot.
# Eclipse SysON suppresses these implicit metaclasses so untyped `part vehicle` renders as
# `vehicle` rather than `vehicle : Part`, while preserving explicit scalar/domain types (`Real`, `ISQ::*`).
_IMPLICIT_STDLIB_QUALIFIED_TYPES: set[str] = {
    "Base::Anything",
    "Base::things",
    "Objects::Object",
    "Objects::BinaryLinkObject",
    "Objects::LinkObject",
    "Occurrences::Occurrence",
    "Occurrences::Life",
    "Items::Item",
    "Parts::Part",
    "Ports::Port",
    "Connections::Connection",
    "Connections::BinaryConnection",
    "Interfaces::Interface",
    "Interfaces::BinaryInterface",
    "Allocations::Allocation",
    "Flows::Flow",
    "Flows::Message",
    "Actions::Action",
    "Actions::TransitionAction",
    "Performances::Performance",
    "States::StateAction",
    "States::StateTransitionAction",
    "Calculations::Calculation",
    "Constraints::ConstraintCheck",
    "Requirements::RequirementCheck",
    "Cases::Case",
    "AnalysisCases::AnalysisCase",
    "VerificationCases::VerificationCase",
    "UseCases::UseCase",
    "Views::View",
    "Viewpoints::Viewpoint",
    "Renderings::Rendering",
    "Metadata::MetadataItem",
    "Attributes::AttributeValue",
}

_IMPLICIT_STDLIB_SIMPLE_LABELS: set[str] = {
    "Anything",
    "Object",
    "BinaryLinkObject",
    "Occurrence",
    "Item",
    "Part",
    "Port",
    "Connection",
    "BinaryConnection",
    "Interface",
    "BinaryInterface",
    "Allocation",
    "Flow",
    "Action",
    "StateAction",
    "StateTransitionAction",
    "ConstraintCheck",
    "RequirementCheck",
}

# Authored elements that represent internal features, annotations, or edges rather than box nodes.
_NON_NODE_KINDS: set[str] = {
    "Namespace",
    "PortUsage",
    "AttributeUsage",
    "EnumerationUsage",
    "ReferenceUsage",
    "EventOccurrenceUsage",
    "PayloadFeature",
    "FlowEnd",
    "Multiplicity",
    "MultiplicityRange",
    "Feature",
    "FeaturePath",
    "FeatureValue",
    "FeatureTyping",
    "ConjugatedPortTyping",
    "Subclassification",
    "Specialization",
    "Subsetting",
    "ReferenceSubsetting",
    "CrossSubsetting",
    "Redefinition",
    "FeatureChaining",
    "Doc",
    "Documentation",
    "Comment",
    "TextualRepresentation",
    "Annotation",
    "Import",
    "NamespaceImport",
    "MembershipImport",
    "Expose",
    "NamespaceExpose",
    "MembershipExpose",
    "ConnectionUsage",
    "FlowUsage",
    "FlowConnectionUsage",
    "SuccessionFlowUsage",
    "InterfaceUsage",
    "AllocationUsage",
    "BinaryConnectionUsage",
    "ConnectorAsUsage",
    "BindingConnector",
    "BindingConnectorAsUsage",
    "Succession",
    "SuccessionAsUsage",
    "TransitionUsage",
    "SatisfyRequirementUsage",
    "AssertConstraintUsage",
    "Dependency",
}


class SourceLocation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    line: int | None = None
    offset: int | None = None
    length: int | None = None


class CompartmentItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    text: str
    line: int | None = None


SysMLCompartmentItem = CompartmentItem


class Compartment(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Literal["attributes", "ports", "parts", "constraints", "actions", "doc"]
    title: str
    items: list[CompartmentItem] = Field(default_factory=list)


SysMLCompartment = Compartment


class SysMLPort(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    name: str
    typeName: str | None = None
    direction: Literal["in", "out", "inout"] | None = None
    conjugated: bool = False
    sideHint: Literal["N", "S", "E", "W"] | None = None
    line: int | None = None


class SysMLViewNode(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    semanticId: str
    qualifiedName: str
    name: str
    kind: str
    shapeCategory: Literal[
        "definition", "usage", "package", "state", "action", "requirement", "constraint"
    ]
    stereotype: str
    typeLabel: str | None = None
    parentId: str | None = None
    layer: Literal[
        "L1_Definitions", "L2_Structure", "L3_Behavior", "L4_Connections", "L5_Requirements"
    ]
    compartments: list[Compartment] = Field(default_factory=list)
    ports: list[SysMLPort] = Field(default_factory=list)
    sourceLocation: SourceLocation | None = None


class SysMLViewEdge(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    kind: Literal[
        "specialization",
        "composition",
        "connection",
        "flow",
        "transition",
        "satisfy",
        "verify",
        "dependency",
    ]
    sourceId: str
    sourcePortId: str | None = None
    targetId: str
    targetPortId: str | None = None
    label: str | None = None
    layer: Literal["L1_Definitions", "L3_Behavior", "L4_Connections", "L5_Requirements"]
    sourceLocation: SourceLocation | None = None


class SysMLViewSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")
    displayedNodes: int
    displayedEdges: int
    omittedElements: int


class SysMLViewIR(BaseModel):
    model_config = ConfigDict(extra="ignore")
    schemaVersion: Literal["2.0"] = "2.0"
    sourceSha256: str
    rootPackageName: str
    viewType: Literal["general", "interconnection", "state", "requirements"]
    nodes: list[SysMLViewNode] = Field(default_factory=list)
    edges: list[SysMLViewEdge] = Field(default_factory=list)
    summary: SysMLViewSummary


def _classify_shape_category(
    kind: str,
) -> Literal["definition", "usage", "package", "state", "action", "requirement", "constraint"]:
    if kind in {"Package", "LibraryPackage"}:
        return "package"
    if "State" in kind:
        return "state"
    if "Requirement" in kind or "Concern" in kind or "VerificationCase" in kind:
        return "requirement"
    if "Constraint" in kind:
        return "constraint"
    if "Action" in kind or "Calculation" in kind or "UseCase" in kind or "AnalysisCase" in kind:
        return "action"
    if kind.endswith("Definition"):
        return "definition"
    return "usage"


def _stereotype_for(kind: str) -> str:
    mapping = {
        "Package": "«package»",
        "LibraryPackage": "«library»",
        "PartDefinition": "«part def»",
        "PartUsage": "«part»",
        "ItemDefinition": "«item def»",
        "ItemUsage": "«item»",
        "PortDefinition": "«port def»",
        "PortUsage": "«port»",
        "AttributeDefinition": "«attribute def»",
        "EnumerationDefinition": "«enum def»",
        "ActionDefinition": "«action def»",
        "ActionUsage": "«action»",
        "PerformActionUsage": "«perform»",
        "AcceptActionUsage": "«accept»",
        "SendActionUsage": "«send»",
        "CalculationDefinition": "«calc def»",
        "CalculationUsage": "«calc»",
        "StateDefinition": "«state def»",
        "StateUsage": "«state»",
        "ExhibitStateUsage": "«exhibit state»",
        "RequirementDefinition": "«requirement def»",
        "RequirementUsage": "«requirement»",
        "ConcernDefinition": "«concern def»",
        "ConcernUsage": "«concern»",
        "VerificationCaseDefinition": "«verification def»",
        "VerificationCaseUsage": "«verification»",
        "UseCaseDefinition": "«use case def»",
        "UseCaseUsage": "«use case»",
        "AnalysisCaseDefinition": "«analysis def»",
        "AnalysisCaseUsage": "«analysis»",
        "ConstraintDefinition": "«constraint def»",
        "ConstraintUsage": "«constraint»",
        "InterfaceDefinition": "«interface def»",
        "InterfaceUsage": "«interface»",
        "AllocationDefinition": "«allocation def»",
        "AllocationUsage": "«allocation»",
        "ConnectionDefinition": "«connection def»",
        "ConnectionUsage": "«connection»",
        "FlowDefinition": "«flow def»",
        "FlowUsage": "«flow»",
        "FlowConnectionUsage": "«flow»",
    }
    if kind in mapping:
        return mapping[kind]
    if kind.endswith("Definition"):
        base = re.sub(r"(?<!^)(?=[A-Z])", " ", kind[:-10]).lower()
        return f"«{base} def»"
    if kind.endswith("Usage"):
        base = re.sub(r"(?<!^)(?=[A-Z])", " ", kind[:-5]).lower()
        return f"«{base}»"
    return f"«{kind.lower()}»"


def _layer_for(shape_category: str, kind: str) -> Literal[
    "L1_Definitions", "L2_Structure", "L3_Behavior", "L4_Connections", "L5_Requirements"
]:
    if shape_category == "requirement":
        return "L5_Requirements"
    if shape_category in {"state", "action"}:
        return "L3_Behavior"
    if shape_category in {"package", "definition"}:
        return "L1_Definitions"
    return "L2_Structure"


def _clean_doc_text(raw: str) -> str:
    cleaned = re.sub(r"^/\*+|\*+/$", "", raw.strip()).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if len(cleaned) > 54:
        return cleaned[:53].rstrip() + "…"
    return cleaned


def _invert_direction(
    direction: str | None,
) -> Literal["in", "out", "inout"] | None:
    if direction == "in":
        return "out"
    if direction == "out":
        return "in"
    if direction == "inout":
        return "inout"
    return None


class ViewProjectionEngine:
    """Projects SysML v2 semantic AST into Eclipse SysON-aligned ViewIR v2 graphs."""

    def __init__(
        self,
        semantic_model: dict[str, Any],
        source_sha256: str,
        root_id: str | None = None,
    ):
        self.model = semantic_model
        self.source_sha256 = source_sha256
        self.root_id = root_id

        raw_entities = semantic_model.get("entities", [])
        self.entities: dict[str, dict[str, Any]] = {e["id"]: e for e in raw_entities if "id" in e}
        self.relations: list[dict[str, Any]] = semantic_model.get("relations", [])

        # Name index for resolving definitions when conjugated port references lack internal IDs
        self.defs_by_name: dict[str, dict[str, Any]] = {}
        for e in raw_entities:
            kind = e.get("kind", "")
            if kind.endswith("Definition") and e.get("name"):
                self.defs_by_name[e["name"]] = e
                if e.get("qualified_name"):
                    self.defs_by_name[e["qualified_name"]] = e

        # Build parent-children index
        self.children: dict[str | None, list[dict[str, Any]]] = {}
        for e in raw_entities:
            self.children.setdefault(e.get("owner_id"), []).append(e)

        # Build feature chaining index (preserving declaration order!) and reference subsetting index
        self.chains: dict[str, list[str]] = {}
        self.ref_subsets: dict[str, str] = {}
        self.conjugated_port_ids: set[str] = set()
        self.supertypes: dict[str, list[str]] = {}
        self.state_subaction_ids: set[str] = set()

        for e in raw_entities:
            # Record state internal entry/do/exit action IDs so they render inside state compartments
            for key in ("entry_action_id", "do_action_id", "exit_action_id"):
                act_id = e.get(key)
                if isinstance(act_id, str):
                    self.state_subaction_ids.add(act_id)
            # Fallback if Java AST was from older build: PerformActionUsage directly inside StateUsage
            if e.get("kind") in {"PerformActionUsage", "AcceptActionUsage", "SendActionUsage"}:
                owner = self.entities.get(e.get("owner_id") or "")
                if owner and "State" in owner.get("kind", ""):
                    self.state_subaction_ids.add(e["id"])

            # Also seed chains from entity.chaining_features if present
            cf_list = e.get("chaining_features")
            if isinstance(cf_list, list) and cf_list:
                chain_ids = [
                    cf["id"]
                    for cf in cf_list
                    if isinstance(cf, dict) and cf.get("id")
                ]
                if chain_ids:
                    self.chains[e["id"]] = chain_ids

        for r in self.relations:
            r_kind = r.get("kind", "")
            src = r.get("source", {}).get("id")
            tgt = r.get("target", {}).get("id")
            if r_kind == "FeatureChaining" and src and tgt:
                existing = self.chains.setdefault(src, [])
                if tgt not in existing:
                    existing.append(tgt)
            elif r_kind == "ReferenceSubsetting" and src and tgt:
                self.ref_subsets[src] = tgt
            elif r_kind == "ConjugatedPortTyping" and src:
                self.conjugated_port_ids.add(src)
            elif r_kind in {"Specialization", "Subclassification"} and src and tgt:
                self.supertypes.setdefault(src, []).append(tgt)

        self.root_package_name = self._find_root_package_name()

    def _find_root_package_name(self) -> str:
        if self.root_id and self.root_id in self.entities:
            root = self.entities[self.root_id]
            return root.get("name") or root.get("qualified_name") or "Root"
        for e in self.entities.values():
            if e.get("kind") in {"Package", "LibraryPackage"} and e.get("name"):
                owner = self.entities.get(e.get("owner_id") or "")
                if not owner or not owner.get("name"):
                    return e["name"]
        top_named = [e for e in self.entities.values() if not e.get("owner_id") and e.get("name")]
        if top_named:
            return top_named[0].get("name") or "SysMLModel"
        return "SysMLModel"

    def _node_anchor_id(self, entity: dict[str, Any]) -> str:
        return entity.get("qualified_name") or entity.get("id") or "unknown"

    def _extract_source_location(self, entity: dict[str, Any]) -> SourceLocation | None:
        loc = entity.get("location")
        if isinstance(loc, dict):
            return SourceLocation(
                line=loc.get("line"),
                offset=loc.get("offset"),
                length=loc.get("length"),
            )
        return None

    def _is_explicit_user_type(self, t: dict[str, Any]) -> bool:
        if not isinstance(t, dict):
            return False
        if t.get("implied") is True:
            return False
        qname = (t.get("name") or "").strip()
        label = (t.get("label") or "").strip()
        if t.get("external") is True:
            if qname in _IMPLICIT_STDLIB_QUALIFIED_TYPES:
                return False
            if "::" in qname and qname in _IMPLICIT_STDLIB_QUALIFIED_TYPES:
                return False
            if not qname and label in _IMPLICIT_STDLIB_SIMPLE_LABELS:
                return False
        return bool(label or qname)

    def _clean_type_display_name(self, t: dict[str, Any]) -> str:
        raw = (t.get("original_label") or t.get("label") or t.get("name") or "").strip()
        raw = raw.strip("'\"")
        if "::" in raw:
            raw = raw.split("::")[-1].strip("'\"")
        return raw.lstrip("~").strip()

    def _extract_type_label(
        self, entity: dict[str, Any], include_multiplicity: bool = True
    ) -> str | None:
        types = entity.get("types")
        labels: list[str] = []
        if isinstance(types, list):
            for t in types:
                if not self._is_explicit_user_type(t):
                    continue
                clean = self._clean_type_display_name(t)
                if clean and clean not in labels:
                    labels.append(clean)

        mult = (entity.get("multiplicity") or "").strip() if include_multiplicity else ""
        if mult and not mult.startswith("["):
            mult = f"[{mult}]"

        if labels and mult:
            return f": {', '.join(labels)} {mult}"
        if labels:
            return f": {', '.join(labels)}"
        if mult:
            return mult
        return None

    def _infer_port_def_direction(
        self, def_entity: dict[str, Any] | None, visited: set[str] | None = None
    ) -> Literal["in", "out", "inout"] | None:
        if not def_entity:
            return None
        visited = visited or set()
        did = def_entity.get("id")
        if not did or did in visited:
            return None
        visited.add(did)

        dirs: set[str] = set()
        for child in self.children.get(did, []):
            d = child.get("direction")
            if d in {"in", "out", "inout"}:
                dirs.add(d)

        if not dirs:
            for sup_id in self.supertypes.get(did, []):
                sup_dir = self._infer_port_def_direction(self.entities.get(sup_id), visited)
                if sup_dir:
                    dirs.add(sup_dir)

        if "inout" in dirs or ("in" in dirs and "out" in dirs):
            return "inout"
        if "out" in dirs:
            return "out"
        if "in" in dirs:
            return "in"
        return None

    def _resolve_port_info(
        self, port_entity: dict[str, Any]
    ) -> tuple[str | None, Literal["in", "out", "inout"] | None, bool]:
        """Returns (clean_type_name, effective_direction, is_conjugated) following SysON rules."""
        conjugated = port_entity["id"] in self.conjugated_port_ids or "~" in (
            port_entity.get("name") or ""
        )
        type_name: str | None = None
        port_def_entity: dict[str, Any] | None = None

        for t in port_entity.get("types", []):
            if not isinstance(t, dict):
                continue
            raw_label = (t.get("label") or t.get("name") or "").strip()
            if t.get("conjugated") is True or "~" in raw_label:
                conjugated = True
            if not self._is_explicit_user_type(t) and not conjugated:
                continue

            clean_name = self._clean_type_display_name(t)
            if clean_name and clean_name not in _IMPLICIT_STDLIB_SIMPLE_LABELS:
                type_name = clean_name

            orig_id = t.get("original_id") or t.get("id")
            if orig_id and orig_id in self.entities:
                port_def_entity = self.entities[orig_id]
            elif clean_name and clean_name in self.defs_by_name:
                port_def_entity = self.defs_by_name[clean_name]

        explicit_dir = port_entity.get("direction")
        if explicit_dir in {"in", "out", "inout"}:
            eff_dir: Literal["in", "out", "inout"] | None = explicit_dir
            if conjugated:
                eff_dir = _invert_direction(eff_dir)
        else:
            def_dir = self._infer_port_def_direction(port_def_entity)
            eff_dir = _invert_direction(def_dir) if (conjugated and def_dir) else def_dir

        return type_name, eff_dir, conjugated

    def _collect_all_ports_for_entity(self, entity: dict[str, Any]) -> list[dict[str, Any]]:
        """Collects direct PortUsages, plus inherited PortUsages from typed definitions & supertypes."""
        seen_names: set[str] = set()
        result: list[dict[str, Any]] = []

        def add_ports_from(owner_id: str, visited_types: set[str]) -> None:
            if owner_id in visited_types:
                return
            visited_types.add(owner_id)
            for c in self.children.get(owner_id, []):
                if c.get("kind") == "PortUsage" and c.get("name") and c["name"] not in seen_names:
                    seen_names.add(c["name"])
                    result.append(c)
            for sup_id in self.supertypes.get(owner_id, []):
                add_ports_from(sup_id, visited_types)

        visited: set[str] = set()
        add_ports_from(entity["id"], visited)

        if entity.get("kind") in {"PartUsage", "ItemUsage", "ActionUsage"}:
            for t in entity.get("types", []):
                t_id = t.get("original_id") or t.get("id")
                if t_id and t_id in self.entities:
                    add_ports_from(t_id, visited)
                else:
                    clean = self._clean_type_display_name(t)
                    if clean in self.defs_by_name:
                        add_ports_from(self.defs_by_name[clean]["id"], visited)

        return result

    def _extract_ports(self, entity: dict[str, Any]) -> list[SysMLPort]:
        ports: list[SysMLPort] = []
        port_children = self._collect_all_ports_for_entity(entity)
        anchor = self._node_anchor_id(entity)

        for idx, child in enumerate(port_children):
            type_name, eff_dir, conjugated = self._resolve_port_info(child)
            loc = child.get("location")
            line = loc.get("line") if isinstance(loc, dict) else None

            if eff_dir == "in":
                side: Literal["N", "S", "E", "W"] = "W"
            elif eff_dir == "out":
                side = "E"
            elif eff_dir == "inout":
                side = "S" if idx % 2 == 0 else "N"
            else:
                side = self._heuristic_side_from_name(child["name"], idx)

            ports.append(
                SysMLPort(
                    id=f"{anchor}.{child['name']}",
                    name=child["name"],
                    typeName=type_name,
                    direction=eff_dir,
                    conjugated=conjugated,
                    sideHint=side,
                    line=line,
                )
            )
        return ports

    @staticmethod
    def _heuristic_side_from_name(
        name: str, idx: int
    ) -> Literal["N", "S", "E", "W"]:
        lower = name.lower()
        if any(
            tok in lower
            for tok in ("out", "tx", "send", "emit", "supply", "source", "signal", "drive")
        ) and not lower.endswith("in"):
            return "E"
        if any(tok in lower for tok in ("in", "rx", "recv", "ctrl", "cmd", "sink", "req")):
            return "W"
        return "W" if idx % 2 == 0 else "E"

    @staticmethod
    def _finalize_port_sides_by_topology(
        nodes: list[SysMLViewNode], edges: list[SysMLViewEdge]
    ) -> None:
        """Aligns boundary port sides with actual connection/flow topology (SysON left-to-right flow).

        Source ports orient to 'E' (right) and target ports orient to 'W' (left) unless explicitly
        constrained otherwise, eliminating U-turn wire loops and label collisions.
        """
        out_counts: dict[str, int] = {}
        in_counts: dict[str, int] = {}
        for edge in edges:
            if edge.kind in {"connection", "flow"}:
                if edge.sourcePortId:
                    out_counts[edge.sourcePortId] = out_counts.get(edge.sourcePortId, 0) + 1
                if edge.targetPortId:
                    in_counts[edge.targetPortId] = in_counts.get(edge.targetPortId, 0) + 1

        for node in nodes:
            for port in node.ports:
                outs = out_counts.get(port.id, 0)
                ins = in_counts.get(port.id, 0)
                if outs > 0 and ins == 0:
                    port.sideHint = "E"
                elif ins > 0 and outs == 0:
                    port.sideHint = "W"
                elif outs > 0 and ins > 0:
                    port.sideHint = "E" if outs >= ins else "W"

    def _resolve_connection_endpoint(
        self,
        ep_id: str | None,
        semantic_to_anchor: dict[str, str],
        port_to_owner: dict[str, str],
        semantic_to_port_id: dict[str, str],
        node_ports_map: dict[str, set[str]],
    ) -> tuple[str | None, str | None]:
        if not ep_id:
            return None, None

        # Follow ReferenceSubsetting hops (e.g., SatisfyRequirementUsage / FlowEnd subsetting a chain)
        visited_hops: set[str] = set()
        curr = ep_id
        while curr in self.ref_subsets and curr not in self.chains and curr not in semantic_to_anchor:
            if curr in visited_hops:
                break
            visited_hops.add(curr)
            curr = self.ref_subsets[curr]

        if curr in semantic_to_anchor:
            return semantic_to_anchor[curr], None
        if curr in port_to_owner:
            return port_to_owner[curr], semantic_to_port_id.get(curr)

        chained = self.chains.get(curr) or self.chains.get(ep_id) or []
        if chained:
            # Walk ordered chain (e.g. [vehicle, battery, powerOut, pwr]) to pick innermost visible node + port
            resolved_node: str | None = None
            resolved_port_name: str | None = None
            for cid in chained:
                if cid in semantic_to_anchor:
                    resolved_node = semantic_to_anchor[cid]
                ent = self.entities.get(cid, {})
                if ent.get("kind") == "PortUsage" and ent.get("name"):
                    resolved_port_name = ent["name"]

            if resolved_node and resolved_port_name:
                candidate_port_id = f"{resolved_node}.{resolved_port_name}"
                if candidate_port_id in node_ports_map.get(resolved_node, set()):
                    return resolved_node, candidate_port_id
                return resolved_node, candidate_port_id
            if resolved_node:
                return resolved_node, None

        # Fallback: climb ownership to nearest visible node
        ent = self.entities.get(curr)
        depth = 0
        while ent and depth < 16:
            depth += 1
            oid = ent.get("owner_id")
            if oid and oid in semantic_to_anchor:
                anchor = semantic_to_anchor[oid]
                if ent.get("kind") == "PortUsage" and ent.get("name"):
                    cand = f"{anchor}.{ent['name']}"
                    if cand in node_ports_map.get(anchor, set()):
                        return anchor, cand
                return anchor, None
            ent = self.entities.get(oid or "")

        return None, None

    def _build_compartments(
        self,
        entity: dict[str, Any],
        include_ports: bool = False,
        include_parts_summary: bool = False,
    ) -> list[Compartment]:
        compartments: list[Compartment] = []
        child_elements = self.children.get(entity["id"], [])
        ent_kind = entity.get("kind", "")

        # 1. Attributes (including EnumerationUsage literals for EnumerationDefinition, and directed items inside PortDefinition)
        attr_items: list[CompartmentItem] = []
        if ent_kind == "EnumerationDefinition":
            for c in child_elements:
                if c.get("kind") == "EnumerationUsage" and c.get("name"):
                    loc = c.get("location")
                    attr_items.append(
                        CompartmentItem(
                            id=self._node_anchor_id(c),
                            text=c["name"],
                            line=loc.get("line") if isinstance(loc, dict) else None,
                        )
                    )
        elif ent_kind == "PortDefinition":
            for c in child_elements:
                if c.get("kind") in {"ItemUsage", "AttributeUsage", "ReferenceUsage"} and c.get("name"):
                    d = f"{c['direction']} " if c.get("direction") else ""
                    t = self._extract_type_label(c) or ""
                    val = f" = {c['value_text']}" if c.get("value_text") else ""
                    loc = c.get("location")
                    attr_items.append(
                        CompartmentItem(
                            id=self._node_anchor_id(c),
                            text=f"{d}{c['name']}{t}{val}",
                            line=loc.get("line") if isinstance(loc, dict) else None,
                        )
                    )
        else:
            for a in child_elements:
                if "Attribute" in a.get("kind", "") and a.get("name"):
                    d = f"{a['direction']} " if a.get("direction") else ""
                    t = self._extract_type_label(a) or ""
                    val = f" = {a['value_text']}" if a.get("value_text") else ""
                    loc = a.get("location")
                    attr_items.append(
                        CompartmentItem(
                            id=self._node_anchor_id(a),
                            text=f"{d}{a['name']}{t}{val}",
                            line=loc.get("line") if isinstance(loc, dict) else None,
                        )
                    )

        if attr_items:
            comp_title = (
                "enums"
                if ent_kind == "EnumerationDefinition"
                else "directed items"
                if ent_kind == "PortDefinition"
                else "attributes"
            )
            compartments.append(
                Compartment(id="attributes", title=comp_title, items=attr_items)
            )

        # 2. Ports compartment (SysON General View lists ports cleanly inside Definitions)
        if include_ports:
            ports = [
                c
                for c in child_elements
                if c.get("kind") == "PortUsage" and c.get("name")
            ]
            if ports:
                p_items: list[CompartmentItem] = []
                for p in ports:
                    type_name, eff_dir, conjugated = self._resolve_port_info(p)
                    dir_prefix = f"{eff_dir} " if eff_dir else ""
                    conj_mark = "~" if conjugated else ""
                    type_str = f" : {conj_mark}{type_name}" if type_name else (" ~" if conjugated else "")
                    mult = f" {p['multiplicity']}" if p.get("multiplicity") else ""
                    loc = p.get("location")
                    p_items.append(
                        CompartmentItem(
                            id=self._node_anchor_id(p),
                            text=f"{dir_prefix}{p['name']}{type_str}{mult}",
                            line=loc.get("line") if isinstance(loc, dict) else None,
                        )
                    )
                compartments.append(Compartment(id="ports", title="ports", items=p_items))

        # 3. Parts summary compartment (optional when subparts are not expanded as child nodes)
        if include_parts_summary:
            subparts = [
                c
                for c in child_elements
                if c.get("kind") in {"PartUsage", "ItemUsage"} and c.get("name")
            ]
            if subparts:
                sp_items: list[CompartmentItem] = []
                for sp in subparts:
                    t = self._extract_type_label(sp) or ""
                    loc = sp.get("location")
                    sp_items.append(
                        CompartmentItem(
                            id=self._node_anchor_id(sp),
                            text=f"{sp['name']}{t}",
                            line=loc.get("line") if isinstance(loc, dict) else None,
                        )
                    )
                compartments.append(Compartment(id="parts", title="parts", items=sp_items))

        # 4. State entry / do / exit behaviors or owned actions
        if "State" in ent_kind:
            state_act_items: list[CompartmentItem] = []
            role_map = {
                entity.get("entry_action_id"): "entry",
                entity.get("do_action_id"): "do",
                entity.get("exit_action_id"): "exit",
            }
            used_ids: set[str] = set()
            for act_id, role in role_map.items():
                if act_id and act_id in self.entities:
                    act_ent = self.entities[act_id]
                    used_ids.add(act_id)
                    act_name = act_ent.get("name") or role
                    loc = act_ent.get("location")
                    state_act_items.append(
                        CompartmentItem(
                            id=self._node_anchor_id(act_ent),
                            text=f"{role} / {act_name}",
                            line=loc.get("line") if isinstance(loc, dict) else None,
                        )
                    )
            for c in child_elements:
                if (
                    c["id"] not in used_ids
                    and c["id"] in self.state_subaction_ids
                    and c.get("name")
                ):
                    loc = c.get("location")
                    state_act_items.append(
                        CompartmentItem(
                            id=self._node_anchor_id(c),
                            text=f"do / {c['name']}",
                            line=loc.get("line") if isinstance(loc, dict) else None,
                        )
                    )
            if state_act_items:
                compartments.append(
                    Compartment(id="actions", title="behaviors", items=state_act_items)
                )
        else:
            actions = [
                c
                for c in child_elements
                if "Action" in c.get("kind", "")
                and c.get("kind") != "TransitionUsage"
                and c["id"] not in self.state_subaction_ids
                and c.get("name")
            ]
            # Only list actions in compartment if this node is a Definition without nested action boxes
            if actions and ent_kind.endswith("Definition"):
                a_items = []
                for a in actions:
                    t = self._extract_type_label(a) or ""
                    loc = a.get("location")
                    a_items.append(
                        CompartmentItem(
                            id=self._node_anchor_id(a),
                            text=f"{a['name']}{t}",
                            line=loc.get("line") if isinstance(loc, dict) else None,
                        )
                    )
                compartments.append(Compartment(id="actions", title="actions", items=a_items))

        # 5. Constraints
        constraints = [
            c
            for c in child_elements
            if "Constraint" in c.get("kind", "")
            and c.get("kind") != "SatisfyRequirementUsage"
            and c.get("name")
        ]
        if constraints:
            c_items = []
            for c in constraints:
                loc = c.get("location")
                c_items.append(
                    CompartmentItem(
                        id=self._node_anchor_id(c),
                        text=c["name"],
                        line=loc.get("line") if isinstance(loc, dict) else None,
                    )
                )
            compartments.append(
                Compartment(id="constraints", title="constraints", items=c_items)
            )

        # 6. Requirement ID & Documentation / Specification text
        doc_items: list[CompartmentItem] = []
        req_id = entity.get("req_id")
        if isinstance(req_id, str) and req_id.strip():
            doc_items.append(
                CompartmentItem(
                    id=f"{self._node_anchor_id(entity)}.reqId",
                    text=f"id = \"{req_id.strip()}\"",
                    line=(entity.get("location") or {}).get("line"),
                )
            )

        req_text = entity.get("req_text")
        if isinstance(req_text, str) and req_text.strip():
            doc_items.append(
                CompartmentItem(
                    id=f"{self._node_anchor_id(entity)}.reqText",
                    text=_clean_doc_text(req_text),
                    line=(entity.get("location") or {}).get("line"),
                )
            )
        else:
            doc_children = [
                c
                for c in child_elements
                if c.get("kind") in {"Doc", "Documentation", "Comment"}
            ]
            for d in doc_children:
                raw_body = d.get("body") or d.get("name") or ""
                text = _clean_doc_text(raw_body) if raw_body.strip() else ""
                if not text:
                    continue
                loc = d.get("location")
                doc_items.append(
                    CompartmentItem(
                        id=self._node_anchor_id(d),
                        text=text,
                        line=loc.get("line") if isinstance(loc, dict) else None,
                    )
                )

        if doc_items:
            compartments.append(Compartment(id="doc", title="doc", items=doc_items))

        return compartments

    def _is_candidate_box_entity(self, e: dict[str, Any]) -> bool:
        if not e.get("name"):
            return False
        kind = e.get("kind", "")
        if kind in _NON_NODE_KINDS:
            return False
        if "Connection" in kind or "Connector" in kind:
            return False
        if e["id"] in self.state_subaction_ids:
            return False
        owner = self.entities.get(e.get("owner_id") or "")
        if owner and owner.get("kind") in {
            "PortDefinition",
            "AttributeDefinition",
            "EnumerationDefinition",
        }:
            return False
        return True

    @staticmethod
    def _format_flow_or_conn_label(r: dict[str, Any], is_flow: bool) -> str | None:
        name = (r.get("name") or "").strip()
        payload = (r.get("payload") or "").strip()
        if is_flow:
            if payload and name:
                return f"{name} : {payload}"
            if payload:
                return f"«flow» {payload}"
            if name:
                return name
            return None
        return name or None

    def project_general_view(self) -> SysMLViewIR:
        """Eclipse SysON General View: clean structural definitions + nested system architecture.

        Key SysON distinctions:
        - `Definition` cards (`part def`, `port def`, `item def`) present owned `ports`, `attributes`,
          and `directed items` inside structured horizontal compartments with ZERO dangling border pins.
        - `Usage` blocks (`part b : Battery`) mount compact boundary port squares when participating in
          architecture assembly, avoiding duplicate internal/external port clutter.
        """
        nodes: list[SysMLViewNode] = []
        edges: list[SysMLViewEdge] = []
        node_id_set: set[str] = set()
        semantic_to_anchor: dict[str, str] = {}
        port_to_owner: dict[str, str] = {}
        semantic_to_port_id: dict[str, str] = {}
        node_ports_map: dict[str, set[str]] = {}

        top_package_ids = {
            e["id"]
            for e in self.entities.values()
            if e.get("kind") in {"Package", "LibraryPackage"}
            and (
                not e.get("owner_id")
                or (
                    e["owner_id"] in self.entities
                    and not self.entities[e["owner_id"]].get("name")
                )
            )
        }

        candidate_entities = [
            e
            for e in self.entities.values()
            if e["id"] not in top_package_ids and self._is_candidate_box_entity(e)
        ]
        candidate_ids = {e["id"] for e in candidate_entities}

        for e in candidate_entities:
            anchor_id = self._node_anchor_id(e)
            node_id_set.add(anchor_id)
            semantic_to_anchor[e["id"]] = anchor_id

            kind = e.get("kind", "")
            shape_cat = _classify_shape_category(kind)

            parent_id: str | None = None
            raw_owner_id = e.get("owner_id")
            if raw_owner_id and raw_owner_id in candidate_ids:
                parent_id = self._node_anchor_id(self.entities[raw_owner_id])

            is_definition_like = shape_cat in {"definition", "package", "requirement", "constraint"}

            # SysON rule: Definitions display ports cleanly inside compartments, not as dangling pins.
            if is_definition_like:
                ports: list[SysMLPort] = []
                compartments = self._build_compartments(e, include_ports=True)
            else:
                ports = self._extract_ports(e)
                compartments = self._build_compartments(e, include_ports=False)

            port_ids_for_node: set[str] = set()
            for p in ports:
                port_ids_for_node.add(p.id)
                port_to_owner[p.id] = anchor_id
                semantic_to_port_id[p.id] = p.id
                for child in self.children.get(e["id"], []):
                    if child.get("name") == p.name:
                        port_to_owner[child["id"]] = anchor_id
                        semantic_to_port_id[child["id"]] = p.id
            node_ports_map[anchor_id] = port_ids_for_node

            nodes.append(
                SysMLViewNode(
                    id=anchor_id,
                    semanticId=e["id"],
                    qualifiedName=e.get("qualified_name") or anchor_id,
                    name=e["name"],
                    kind=kind,
                    shapeCategory=shape_cat,
                    stereotype=_stereotype_for(kind),
                    typeLabel=self._extract_type_label(e),
                    parentId=parent_id,
                    layer=_layer_for(shape_cat, kind),
                    compartments=compartments,
                    ports=ports,
                    sourceLocation=self._extract_source_location(e),
                )
            )

        seen_transitions: set[tuple[str, str]] = set()

        for r in self.relations:
            r_kind = r.get("kind", "")
            if r_kind in {
                "ownership",
                "FeatureTyping",
                "ConjugatedPortTyping",
                "FeatureChaining",
                "ReferenceSubsetting",
                "Subsetting",
                "Redefinition",
                "CrossSubsetting",
            }:
                continue

            is_flow = "Flow" in r_kind
            is_conn = (
                is_flow
                or "Connection" in r_kind
                or "Connector" in r_kind
                or r_kind in {"InterfaceUsage", "AllocationUsage"}
            )
            if is_conn:
                src_node_id, src_port_id = self._resolve_connection_endpoint(
                    r.get("source", {}).get("id"),
                    semantic_to_anchor,
                    port_to_owner,
                    semantic_to_port_id,
                    node_ports_map,
                )
                tgt_node_id, tgt_port_id = self._resolve_connection_endpoint(
                    r.get("target", {}).get("id"),
                    semantic_to_anchor,
                    port_to_owner,
                    semantic_to_port_id,
                    node_ports_map,
                )
                if (
                    src_node_id
                    and tgt_node_id
                    and src_node_id in node_id_set
                    and tgt_node_id in node_id_set
                    and not (src_node_id == tgt_node_id and src_port_id == tgt_port_id)
                ):
                    edges.append(
                        SysMLViewEdge(
                            id=r.get("id") or f"conn-{len(edges)}",
                            kind="flow" if is_flow else "connection",
                            sourceId=src_node_id,
                            sourcePortId=src_port_id,
                            targetId=tgt_node_id,
                            targetPortId=tgt_port_id,
                            label=self._format_flow_or_conn_label(r, is_flow),
                            layer="L4_Connections",
                        )
                    )
                continue

            if "Satisfy" in r_kind or "Verify" in r_kind:
                src_node_id, _ = self._resolve_connection_endpoint(
                    r.get("source", {}).get("id"),
                    semantic_to_anchor,
                    port_to_owner,
                    semantic_to_port_id,
                    node_ports_map,
                )
                tgt_node_id, _ = self._resolve_connection_endpoint(
                    r.get("target", {}).get("id"),
                    semantic_to_anchor,
                    port_to_owner,
                    semantic_to_port_id,
                    node_ports_map,
                )
                if src_node_id and tgt_node_id and src_node_id != tgt_node_id:
                    is_sat = "Satisfy" in r_kind
                    edges.append(
                        SysMLViewEdge(
                            id=r.get("id") or f"req-{len(edges)}",
                            kind="satisfy" if is_sat else "verify",
                            sourceId=src_node_id,
                            targetId=tgt_node_id,
                            label="«satisfy»" if is_sat else "«verify»",
                            layer="L5_Requirements",
                        )
                    )
                continue

            src_node_id = semantic_to_anchor.get(r.get("source", {}).get("id"))
            tgt_node_id = semantic_to_anchor.get(r.get("target", {}).get("id"))
            if not src_node_id or not tgt_node_id or src_node_id == tgt_node_id:
                continue

            if r_kind in {"Specialization", "Subclassification"}:
                edges.append(
                    SysMLViewEdge(
                        id=r.get("id") or f"spec-{len(edges)}",
                        kind="specialization",
                        sourceId=src_node_id,
                        targetId=tgt_node_id,
                        label=None,
                        layer="L1_Definitions",
                    )
                )
            elif "Transition" in r_kind or r_kind == "SuccessionAsUsage":
                pair = (src_node_id, tgt_node_id)
                if r_kind == "SuccessionAsUsage" and pair in seen_transitions:
                    continue
                seen_transitions.add(pair)
                edges.append(
                    SysMLViewEdge(
                        id=r.get("id") or f"trans-{len(edges)}",
                        kind="transition",
                        sourceId=src_node_id,
                        targetId=tgt_node_id,
                        label=r.get("name"),
                        layer="L3_Behavior",
                    )
                )
            elif r_kind == "Dependency":
                edges.append(
                    SysMLViewEdge(
                        id=r.get("id") or f"dep-{len(edges)}",
                        kind="dependency",
                        sourceId=src_node_id,
                        targetId=tgt_node_id,
                        label=r.get("name") or "«dependency»",
                        layer="L1_Definitions",
                    )
                )

        self._finalize_port_sides_by_topology(nodes, edges)

        # SysON cleanliness: on Usage nodes with zero connected ports in General View,
        # move unconnected ports into a tidy compartment instead of protruding boundary pins
        connected_ports = {
            pid
            for edge in edges
            for pid in (edge.sourcePortId, edge.targetPortId)
            if pid
        }
        for node in nodes:
            if node.ports and not any(p.id in connected_ports for p in node.ports):
                # Only demote if the node itself has no port edges in General View
                ent = self.entities.get(node.semanticId)
                if ent:
                    node.compartments = self._build_compartments(ent, include_ports=True)
                node.ports = []

        summary = SysMLViewSummary(
            displayedNodes=len(nodes),
            displayedEdges=len(edges),
            omittedElements=max(0, len(self.entities) - len(nodes)),
        )

        return SysMLViewIR(
            schemaVersion="2.0",
            sourceSha256=self.source_sha256,
            rootPackageName=self.root_package_name,
            viewType="general",
            nodes=nodes,
            edges=edges,
            summary=summary,
        )

    def project_interconnection_view(self) -> SysMLViewIR:
        """Eclipse SysON Interconnection View (IBD): pure composite part assembly, border ports & flows.

        Excludes uninstantiated blueprint definitions (`port def`, standalone `part def`) when part
        usages exist, while preserving owning composite `PartDefinition` containers (e.g. `part def System { part a; part b; }`).
        """
        nodes: list[SysMLViewNode] = []
        edges: list[SysMLViewEdge] = []
        semantic_to_anchor: dict[str, str] = {}
        port_to_owner: dict[str, str] = {}
        semantic_to_port_id: dict[str, str] = {}
        node_ports_map: dict[str, set[str]] = {}

        part_usages = [
            e
            for e in self.entities.values()
            if e.get("kind") in {"PartUsage", "ItemUsage"}
            and e.get("name")
            and self._is_candidate_box_entity(e)
            and self.entities.get(e.get("owner_id") or "", {}).get("kind") != "PortDefinition"
        ]

        all_included: dict[str, dict[str, Any]] = {e["id"]: e for e in part_usages}

        if part_usages:
            # Include owning composite PartDefinition containers (e.g. `part def Vehicle { part engine; }`)
            for e in list(part_usages):
                curr_owner_id = e.get("owner_id")
                while curr_owner_id and curr_owner_id in self.entities:
                    owner_ent = self.entities[curr_owner_id]
                    if owner_ent.get("kind") in {"PartDefinition", "PartUsage"} and owner_ent.get("name"):
                        all_included[curr_owner_id] = owner_ent
                    curr_owner_id = owner_ent.get("owner_id")
        else:
            # Fallback if model only defines PartDefinitions without usages
            for e in self.entities.values():
                if e.get("kind") in {"PartDefinition", "ItemDefinition"} and e.get("name"):
                    all_included[e["id"]] = e

        for e in all_included.values():
            anchor_id = self._node_anchor_id(e)
            semantic_to_anchor[e["id"]] = anchor_id

            kind = e.get("kind", "")
            shape_cat = _classify_shape_category(kind)
            parent_id: str | None = None
            raw_owner_id = e.get("owner_id")
            if raw_owner_id and raw_owner_id in all_included:
                parent_id = self._node_anchor_id(all_included[raw_owner_id])

            is_enclosing_def = kind.endswith("Definition") and any(
                c.get("owner_id") == e["id"] and c["id"] in all_included
                for c in all_included.values()
            )
            ports = [] if is_enclosing_def else self._extract_ports(e)
            port_ids_for_node: set[str] = set()
            for p in ports:
                port_ids_for_node.add(p.id)
                port_to_owner[p.id] = anchor_id
                semantic_to_port_id[p.id] = p.id
                for child in self.children.get(e["id"], []):
                    if child.get("name") == p.name:
                        port_to_owner[child["id"]] = anchor_id
                        semantic_to_port_id[child["id"]] = p.id
            node_ports_map[anchor_id] = port_ids_for_node

            compartments = self._build_compartments(e, include_ports=False)
            nodes.append(
                SysMLViewNode(
                    id=anchor_id,
                    semanticId=e["id"],
                    qualifiedName=e.get("qualified_name") or anchor_id,
                    name=e["name"],
                    kind=kind,
                    shapeCategory=shape_cat,
                    stereotype=_stereotype_for(kind),
                    typeLabel=self._extract_type_label(e),
                    parentId=parent_id,
                    layer="L2_Structure",
                    compartments=compartments,
                    ports=ports,
                    sourceLocation=self._extract_source_location(e),
                )
            )

        node_id_set = {n.id for n in nodes}

        for r in self.relations:
            r_kind = r.get("kind", "")
            is_flow = "Flow" in r_kind
            if not (
                is_flow
                or "Connection" in r_kind
                or "Connector" in r_kind
                or r_kind in {"InterfaceUsage", "AllocationUsage"}
            ):
                continue

            src_node_id, src_port_id = self._resolve_connection_endpoint(
                r.get("source", {}).get("id"),
                semantic_to_anchor,
                port_to_owner,
                semantic_to_port_id,
                node_ports_map,
            )
            tgt_node_id, tgt_port_id = self._resolve_connection_endpoint(
                r.get("target", {}).get("id"),
                semantic_to_anchor,
                port_to_owner,
                semantic_to_port_id,
                node_ports_map,
            )

            if (
                not src_node_id
                or not tgt_node_id
                or (src_node_id == tgt_node_id and src_port_id == tgt_port_id)
                or src_node_id not in node_id_set
                or tgt_node_id not in node_id_set
            ):
                continue

            edges.append(
                SysMLViewEdge(
                    id=r.get("id") or f"conn-{len(edges)}",
                    kind="flow" if is_flow else "connection",
                    sourceId=src_node_id,
                    sourcePortId=src_port_id,
                    targetId=tgt_node_id,
                    targetPortId=tgt_port_id,
                    label=self._format_flow_or_conn_label(r, is_flow),
                    layer="L4_Connections",
                )
            )

        self._finalize_port_sides_by_topology(nodes, edges)

        summary = SysMLViewSummary(
            displayedNodes=len(nodes),
            displayedEdges=len(edges),
            omittedElements=max(0, len(self.entities) - len(nodes)),
        )

        return SysMLViewIR(
            schemaVersion="2.0",
            sourceSha256=self.source_sha256,
            rootPackageName=self.root_package_name,
            viewType="interconnection",
            nodes=nodes,
            edges=edges,
            summary=summary,
        )

    def project_state_view(self) -> SysMLViewIR:
        """Eclipse SysON State Transition View: nested state machines, entry/do/exit behaviors & transitions."""
        nodes: list[SysMLViewNode] = []
        edges: list[SysMLViewEdge] = []
        semantic_to_anchor: dict[str, str] = {}

        state_entities = [
            e
            for e in self.entities.values()
            if "State" in e.get("kind", "") and e.get("name") and self._is_candidate_box_entity(e)
        ]

        if not state_entities:
            state_entities = [
                e
                for e in self.entities.values()
                if "Action" in e.get("kind", "")
                and e.get("name")
                and self._is_candidate_box_entity(e)
            ]

        included_ids = {e["id"] for e in state_entities}
        for e in state_entities:
            semantic_to_anchor[e["id"]] = self._node_anchor_id(e)

        for e in state_entities:
            anchor_id = semantic_to_anchor[e["id"]]
            parent_id = None
            raw_owner_id = e.get("owner_id")
            if raw_owner_id and raw_owner_id in included_ids:
                parent_id = semantic_to_anchor[raw_owner_id]

            kind = e.get("kind", "")
            shape_cat: Literal["state", "action"] = "state" if "State" in kind else "action"
            compartments = self._build_compartments(e, include_ports=False)
            nodes.append(
                SysMLViewNode(
                    id=anchor_id,
                    semanticId=e["id"],
                    qualifiedName=e.get("qualified_name") or anchor_id,
                    name=e["name"],
                    kind=kind,
                    shapeCategory=shape_cat,
                    stereotype=_stereotype_for(kind),
                    typeLabel=self._extract_type_label(e),
                    parentId=parent_id,
                    layer="L3_Behavior",
                    compartments=compartments,
                    ports=[],
                    sourceLocation=self._extract_source_location(e),
                )
            )

        # Prefer rich TransitionUsage edges over synthetic SuccessionAsUsage duplicates
        seen_pairs: set[tuple[str, str]] = set()
        sorted_rels = sorted(
            self.relations,
            key=lambda rel: 0 if "Transition" in rel.get("kind", "") else 1,
        )
        for r in sorted_rels:
            r_kind = r.get("kind", "")
            if "Transition" in r_kind or r_kind in {"SuccessionAsUsage", "Succession"}:
                src_id = semantic_to_anchor.get(r.get("source", {}).get("id"))
                tgt_id = semantic_to_anchor.get(r.get("target", {}).get("id"))
                if src_id and tgt_id and src_id != tgt_id:
                    pair = (src_id, tgt_id)
                    if r_kind != "TransitionUsage" and pair in seen_pairs:
                        continue
                    seen_pairs.add(pair)
                    edges.append(
                        SysMLViewEdge(
                            id=r.get("id") or f"trans-{len(edges)}",
                            kind="transition",
                            sourceId=src_id,
                            targetId=tgt_id,
                            label=r.get("name"),
                            layer="L3_Behavior",
                        )
                    )

        summary = SysMLViewSummary(
            displayedNodes=len(nodes),
            displayedEdges=len(edges),
            omittedElements=max(0, len(self.entities) - len(nodes)),
        )

        return SysMLViewIR(
            schemaVersion="2.0",
            sourceSha256=self.source_sha256,
            rootPackageName=self.root_package_name,
            viewType="state",
            nodes=nodes,
            edges=edges,
            summary=summary,
        )

    def project_requirements_view(self) -> SysMLViewIR:
        """Eclipse SysON Requirements View: requirement specs, IDs, doc blocks & satisfy/verify traces."""
        nodes: list[SysMLViewNode] = []
        edges: list[SysMLViewEdge] = []
        semantic_to_anchor: dict[str, str] = {}

        # Map all candidate entities first so feature-chained `satisfy req by vehicle.battery` resolves
        all_candidates = {
            e["id"]: e
            for e in self.entities.values()
            if self._is_candidate_box_entity(e)
        }
        all_candidate_anchors = {eid: self._node_anchor_id(e) for eid, e in all_candidates.items()}
        anchor_to_eid = {anc: eid for eid, anc in all_candidate_anchors.items()}

        req_entities = {
            eid: e
            for eid, e in all_candidates.items()
            if any(k in e.get("kind", "") for k in ("Requirement", "Concern", "VerificationCase"))
        }

        resolved_trace_edges: list[tuple[dict[str, Any], str, str, bool]] = []
        for r in self.relations:
            r_kind = r.get("kind", "")
            if not ("Satisfy" in r_kind or "Verify" in r_kind):
                continue
            src_anc, _ = self._resolve_connection_endpoint(
                r.get("source", {}).get("id"),
                all_candidate_anchors,
                {},
                {},
                {},
            )
            tgt_anc, _ = self._resolve_connection_endpoint(
                r.get("target", {}).get("id"),
                all_candidate_anchors,
                {},
                {},
                {},
            )
            if src_anc and tgt_anc and src_anc != tgt_anc:
                resolved_trace_edges.append((r, src_anc, tgt_anc, "Satisfy" in r_kind))
                for anc in (src_anc, tgt_anc):
                    eid = anchor_to_eid.get(anc)
                    if eid and eid in all_candidates:
                        req_entities[eid] = all_candidates[eid]

        for eid, e in req_entities.items():
            semantic_to_anchor[eid] = self._node_anchor_id(e)

        for eid, e in req_entities.items():
            anchor_id = semantic_to_anchor[eid]
            kind = e.get("kind", "")
            shape_cat = _classify_shape_category(kind)
            parent_id = None
            raw_owner_id = e.get("owner_id")
            if raw_owner_id and raw_owner_id in semantic_to_anchor:
                parent_id = semantic_to_anchor[raw_owner_id]

            compartments = self._build_compartments(e, include_ports=False)
            nodes.append(
                SysMLViewNode(
                    id=anchor_id,
                    semanticId=eid,
                    qualifiedName=e.get("qualified_name") or anchor_id,
                    name=e["name"],
                    kind=kind,
                    shapeCategory=shape_cat,
                    stereotype=_stereotype_for(kind),
                    typeLabel=self._extract_type_label(e),
                    parentId=parent_id,
                    layer="L5_Requirements" if shape_cat == "requirement" else _layer_for(shape_cat, kind),
                    compartments=compartments,
                    ports=[],
                    sourceLocation=self._extract_source_location(e),
                )
            )

        for r, src_anc, tgt_anc, is_sat in resolved_trace_edges:
            edges.append(
                SysMLViewEdge(
                    id=r.get("id") or f"trace-{len(edges)}",
                    kind="satisfy" if is_sat else "verify",
                    sourceId=src_anc,
                    targetId=tgt_anc,
                    label="«satisfy»" if is_sat else "«verify»",
                    layer="L5_Requirements",
                )
            )

        summary = SysMLViewSummary(
            displayedNodes=len(nodes),
            displayedEdges=len(edges),
            omittedElements=max(0, len(self.entities) - len(nodes)),
        )

        return SysMLViewIR(
            schemaVersion="2.0",
            sourceSha256=self.source_sha256,
            rootPackageName=self.root_package_name,
            viewType="requirements",
            nodes=nodes,
            edges=edges,
            summary=summary,
        )

    def project(self, view_type: str = "general") -> SysMLViewIR:
        if view_type == "interconnection":
            return self.project_interconnection_view()
        if view_type == "state":
            return self.project_state_view()
        if view_type == "requirements":
            return self.project_requirements_view()
        return self.project_general_view()

    def project_all(self) -> dict[str, SysMLViewIR]:
        return {
            "general": self.project_general_view(),
            "interconnection": self.project_interconnection_view(),
            "state": self.project_state_view(),
            "requirements": self.project_requirements_view(),
        }
