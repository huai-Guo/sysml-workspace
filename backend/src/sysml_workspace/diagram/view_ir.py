from __future__ import annotations

import re
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


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
    if "Action" in kind:
        return "action"
    if "Requirement" in kind:
        return "requirement"
    if "Constraint" in kind:
        return "constraint"
    if kind.endswith("Definition"):
        return "definition"
    return "usage"


def _stereotype_for(kind: str) -> str:
    mapping = {
        "Package": "«package»",
        "LibraryPackage": "«package»",
        "PartDefinition": "«part def»",
        "PartUsage": "«part»",
        "ItemDefinition": "«item def»",
        "ItemUsage": "«item»",
        "PortDefinition": "«port def»",
        "PortUsage": "«port»",
        "ActionDefinition": "«action def»",
        "ActionUsage": "«action»",
        "StateDefinition": "«state def»",
        "StateUsage": "«state»",
        "RequirementDefinition": "«req def»",
        "RequirementUsage": "«requirement»",
        "ConstraintDefinition": "«constraint def»",
        "ConstraintUsage": "«constraint»",
        "InterfaceDefinition": "«interface def»",
        "InterfaceUsage": "«interface»",
        "ConnectionUsage": "«connection»",
        "FlowConnectionUsage": "«flow»",
    }
    if kind in mapping:
        return mapping[kind]
    if kind.endswith("Definition"):
        base = kind[:-10].lower()
        return f"«{base} def»"
    if kind.endswith("Usage"):
        base = kind[:-5].lower()
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


class ViewProjectionEngine:
    """Projects SysML semantic model into ViewIR v2 graphs for 4 standard views."""

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
        self.entities = {e["id"]: e for e in raw_entities}
        self.relations = semantic_model.get("relations", [])

        # Build parent-children index
        self.children: dict[str | None, list[dict[str, Any]]] = {}
        for e in raw_entities:
            self.children.setdefault(e.get("owner_id"), []).append(e)

        # Detect root package name
        self.root_package_name = self._find_root_package_name()

    def _find_root_package_name(self) -> str:
        if self.root_id and self.root_id in self.entities:
            root = self.entities[self.root_id]
            return root.get("name") or root.get("qualified_name") or "Root"
        # Find top level package
        top_packages = [
            e
            for e in self.entities.values()
            if e.get("kind") in {"Package", "LibraryPackage"} and not e.get("owner_id")
        ]
        if top_packages:
            return top_packages[0].get("name") or "RootPackage"
        # Fallback to any top level named element
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

    def _extract_type_label(self, entity: dict[str, Any]) -> str | None:
        types = entity.get("types")
        if isinstance(types, list) and types:
            labels = [
                t.get("label") or t.get("name") or t.get("id")
                for t in types
                if isinstance(t, dict) and (t.get("label") or t.get("name"))
            ]
            if labels:
                return f": {', '.join(labels)}"
        return None

    def _extract_ports(
        self, entity: dict[str, Any], side_counter: dict[str, int]
    ) -> list[SysMLPort]:
        ports: list[SysMLPort] = []
        port_children = [
            c
            for c in self.children.get(entity["id"], [])
            if "Port" in c.get("kind", "") and c.get("name")
        ]
        for idx, child in enumerate(port_children):
            direction = child.get("direction")
            type_label = self._extract_type_label(child)
            type_name = type_label.lstrip(": ") if type_label else None
            conjugated = "~" in (type_name or "") or "~" in (child.get("name") or "")

            # EPLAN/CAD pin side assignment
            if direction == "in":
                side = "W"
            elif direction == "out":
                side = "E"
            elif direction == "inout":
                side = "S" if idx % 2 == 0 else "N"
            else:
                # Alternate between W and E
                side = "W" if idx % 2 == 0 else "E"

            loc = child.get("location")
            line = loc.get("line") if isinstance(loc, dict) else None

            port_id = child.get("qualified_name") or f"{self._node_anchor_id(entity)}.{child['name']}"
            ports.append(
                SysMLPort(
                    id=port_id,
                    name=child["name"],
                    typeName=type_name,
                    direction=direction if direction in {"in", "out", "inout"} else None,
                    conjugated=conjugated,
                    sideHint=side,
                    line=line,
                )
            )
        return ports

    def _build_compartments(
        self, entity: dict[str, Any], include_ports: bool = False
    ) -> list[Compartment]:
        compartments: list[Compartment] = []
        child_elements = self.children.get(entity["id"], [])

        # Attributes
        attrs = [
            c
            for c in child_elements
            if "Attribute" in c.get("kind", "") and c.get("name")
        ]
        if attrs:
            items = []
            for a in attrs:
                t = self._extract_type_label(a) or ""
                loc = a.get("location")
                line = loc.get("line") if isinstance(loc, dict) else None
                items.append(
                    CompartmentItem(
                        id=self._node_anchor_id(a),
                        text=f"{a['name']}{t}",
                        line=line,
                    )
                )
            compartments.append(
                Compartment(id="attributes", title="attributes", items=items)
            )

        # Ports (if general view lists them in compartment)
        if include_ports:
            ports = [
                c
                for c in child_elements
                if "Port" in c.get("kind", "") and c.get("name")
            ]
            if ports:
                items = []
                for p in ports:
                    t = self._extract_type_label(p) or ""
                    d = f"[{p.get('direction')}] " if p.get("direction") else ""
                    loc = p.get("location")
                    line = loc.get("line") if isinstance(loc, dict) else None
                    items.append(
                        CompartmentItem(
                            id=self._node_anchor_id(p),
                            text=f"{d}{p['name']}{t}",
                            line=line,
                        )
                    )
                compartments.append(Compartment(id="ports", title="ports", items=items))

        # Constraints
        constraints = [
            c
            for c in child_elements
            if "Constraint" in c.get("kind", "") and c.get("name")
        ]
        if constraints:
            items = []
            for c in constraints:
                loc = c.get("location")
                line = loc.get("line") if isinstance(loc, dict) else None
                items.append(
                    CompartmentItem(
                        id=self._node_anchor_id(c),
                        text=c["name"],
                        line=line,
                    )
                )
            compartments.append(
                Compartment(id="constraints", title="constraints", items=items)
            )

        # Actions
        actions = [
            c
            for c in child_elements
            if "Action" in c.get("kind", "") and c.get("name")
        ]
        if actions:
            items = []
            for a in actions:
                loc = a.get("location")
                line = loc.get("line") if isinstance(loc, dict) else None
                items.append(
                    CompartmentItem(
                        id=self._node_anchor_id(a),
                        text=a["name"],
                        line=line,
                    )
                )
            compartments.append(Compartment(id="actions", title="actions", items=items))

        # Documentation / doc
        doc_children = [
            c
            for c in child_elements
            if "Doc" in c.get("kind", "") or "Comment" in c.get("kind", "")
        ]
        if doc_children:
            items = []
            for d in doc_children:
                text = d.get("name") or "/* doc */"
                loc = d.get("location")
                line = loc.get("line") if isinstance(loc, dict) else None
                items.append(
                    CompartmentItem(
                        id=self._node_anchor_id(d),
                        text=text,
                        line=line,
                    )
                )
            compartments.append(Compartment(id="doc", title="doc", items=items))

        return compartments

    def project_general_view(self) -> SysMLViewIR:
        """General structural view showing packages, definitions, usages, and relationships."""
        nodes: list[SysMLViewNode] = []
        edges: list[SysMLViewEdge] = []
        node_id_set: set[str] = set()
        semantic_to_anchor: dict[str, str] = {}

        # Elements to include as explicit diagram boxes:
        # Package, PartDefinition, ItemDefinition, PortDefinition, ActionDefinition,
        # StateDefinition, RequirementDefinition, ConstraintDefinition, InterfaceDefinition,
        # and PartUsage (top or 1st/2nd level).
        candidate_entities: list[dict[str, Any]] = []
        for e in self.entities.values():
            if not e.get("name"):
                continue
            kind = e.get("kind", "")
            # Skip port usages and attribute usages from being top-level nodes in General view;
            # they are rendered inside compartments.
            if kind in {"PortUsage", "AttributeUsage", "Doc", "Comment"}:
                continue
            candidate_entities.append(e)

        for e in candidate_entities:
            anchor_id = self._node_anchor_id(e)
            node_id_set.add(anchor_id)
            semantic_to_anchor[e["id"]] = anchor_id

            shape_cat = _classify_shape_category(e.get("kind", ""))
            parent_id = None
            raw_owner_id = e.get("owner_id")
            if raw_owner_id and raw_owner_id in self.entities:
                owner = self.entities[raw_owner_id]
                # Only nest if owner is also a candidate node
                if owner.get("name") and owner.get("kind") not in {
                    "PortUsage",
                    "AttributeUsage",
                }:
                    parent_id = self._node_anchor_id(owner)

            compartments = self._build_compartments(e, include_ports=True)
            node = SysMLViewNode(
                id=anchor_id,
                semanticId=e["id"],
                qualifiedName=e.get("qualified_name") or anchor_id,
                name=e["name"],
                kind=e.get("kind", ""),
                shapeCategory=shape_cat,
                stereotype=_stereotype_for(e.get("kind", "")),
                typeLabel=self._extract_type_label(e),
                parentId=parent_id,
                layer=_layer_for(shape_cat, e.get("kind", "")),
                compartments=compartments,
                ports=[],
                sourceLocation=self._extract_source_location(e),
            )
            nodes.append(node)

        # Edges for General view:
        # Specialization, Subclassification, Satisfy, Verify, Dependency, ConnectionUsage
        for r in self.relations:
            r_kind = r.get("kind", "")
            if r_kind == "ownership":
                # Ownership is expressed via parentId container nesting, no cross-screen lines!
                continue

            src_ref = r.get("source", {})
            tgt_ref = r.get("target", {})
            src_sem_id = src_ref.get("id")
            tgt_sem_id = tgt_ref.get("id")

            src_node_id = semantic_to_anchor.get(src_sem_id)
            tgt_node_id = semantic_to_anchor.get(tgt_sem_id)

            if not src_node_id or not tgt_node_id or src_node_id == tgt_node_id:
                continue

            edge_kind: Literal[
                "specialization",
                "composition",
                "connection",
                "flow",
                "transition",
                "satisfy",
                "verify",
                "dependency",
            ] = "dependency"
            edge_layer: Literal[
                "L1_Definitions", "L3_Behavior", "L4_Connections", "L5_Requirements"
            ] = "L1_Definitions"
            label = None

            if r_kind in {"Specialization", "Subclassification"}:
                edge_kind = "specialization"
                label = "«specialize»"
                edge_layer = "L1_Definitions"
            elif "Satisfy" in r_kind:
                edge_kind = "satisfy"
                label = "«satisfy»"
                edge_layer = "L5_Requirements"
            elif "Verify" in r_kind:
                edge_kind = "verify"
                label = "«verify»"
                edge_layer = "L5_Requirements"
            elif "Connection" in r_kind or "Connector" in r_kind:
                edge_kind = "connection"
                edge_layer = "L4_Connections"
            elif "Transition" in r_kind:
                edge_kind = "transition"
                edge_layer = "L3_Behavior"

            edges.append(
                SysMLViewEdge(
                    id=r.get("id") or f"e-{len(edges)}",
                    kind=edge_kind,
                    sourceId=src_node_id,
                    targetId=tgt_node_id,
                    label=label,
                    layer=edge_layer,
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
            viewType="general",
            nodes=nodes,
            edges=edges,
            summary=summary,
        )

    def project_interconnection_view(self) -> SysMLViewIR:
        """Internal Block / Architecture Interconnection view.

        Emphasizes container nesting of parts, boundary pin ports, and orthogonal connections.
        """
        nodes: list[SysMLViewNode] = []
        edges: list[SysMLViewEdge] = []
        semantic_to_anchor: dict[str, str] = {}
        port_to_owner: dict[str, str] = {}  # port_id or semantic_id -> part_node_id
        semantic_to_port_id: dict[str, str] = {}  # semantic_id or port_id -> port_id

        # Target entities: PartUsage, ItemUsage. If none found, fallback to PartDefinition.
        part_entities = [
            e
            for e in self.entities.values()
            if e.get("kind") in {"PartUsage", "ItemUsage"} and e.get("name")
        ]
        if not part_entities:
            part_entities = [
                e
                for e in self.entities.values()
                if e.get("kind") in {"PartDefinition", "ItemDefinition"} and e.get("name")
            ]

        # Also find root container if any
        all_included = {e["id"]: e for e in part_entities}

        side_counter: dict[str, int] = {}
        for e in part_entities:
            anchor_id = self._node_anchor_id(e)
            semantic_to_anchor[e["id"]] = anchor_id

            shape_cat = _classify_shape_category(e.get("kind", ""))
            parent_id = None
            raw_owner_id = e.get("owner_id")
            if raw_owner_id and raw_owner_id in all_included:
                parent_id = self._node_anchor_id(all_included[raw_owner_id])

            ports = self._extract_ports(e, side_counter)
            for p in ports:
                port_to_owner[p.id] = anchor_id
                semantic_to_port_id[p.id] = p.id
                # Map port semantic id as well
                for child in self.children.get(e["id"], []):
                    if child.get("name") == p.name:
                        port_to_owner[child["id"]] = anchor_id
                        semantic_to_port_id[child["id"]] = p.id

            compartments = self._build_compartments(e, include_ports=False)
            node = SysMLViewNode(
                id=anchor_id,
                semanticId=e["id"],
                qualifiedName=e.get("qualified_name") or anchor_id,
                name=e["name"],
                kind=e.get("kind", ""),
                shapeCategory=shape_cat,
                stereotype=_stereotype_for(e.get("kind", "")),
                typeLabel=self._extract_type_label(e),
                parentId=parent_id,
                layer="L2_Structure",
                compartments=compartments,
                ports=ports,
                sourceLocation=self._extract_source_location(e),
            )
            nodes.append(node)

        # Edges: connections and flows
        for r in self.relations:
            r_kind = r.get("kind", "")
            if not ("Connection" in r_kind or "Connector" in r_kind or "Flow" in r_kind):
                continue

            src_ref = r.get("source", {})
            tgt_ref = r.get("target", {})
            src_id = src_ref.get("id")
            tgt_id = tgt_ref.get("id")

            # Check if endpoints are ports or nodes
            src_node_id = semantic_to_anchor.get(src_id) or port_to_owner.get(src_id)
            tgt_node_id = semantic_to_anchor.get(tgt_id) or port_to_owner.get(tgt_id)

            if not src_node_id or not tgt_node_id or src_node_id == tgt_node_id:
                continue

            src_port_id = semantic_to_port_id.get(src_id)
            tgt_port_id = semantic_to_port_id.get(tgt_id)

            edges.append(
                SysMLViewEdge(
                    id=r.get("id") or f"conn-{len(edges)}",
                    kind="flow" if "Flow" in r_kind else "connection",
                    sourceId=src_node_id,
                    sourcePortId=src_port_id,
                    targetId=tgt_node_id,
                    targetPortId=tgt_port_id,
                    label=r.get("name"),
                    layer="L4_Connections",
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
            viewType="interconnection",
            nodes=nodes,
            edges=edges,
            summary=summary,
        )

    def project_state_view(self) -> SysMLViewIR:
        """State machine diagram view focusing on states and transitions."""
        nodes: list[SysMLViewNode] = []
        edges: list[SysMLViewEdge] = []
        semantic_to_anchor: dict[str, str] = {}

        state_entities = [
            e
            for e in self.entities.values()
            if ("State" in e.get("kind", "")) and e.get("name")
        ]

        # If no states found, fallback to action elements or show an informational node
        if not state_entities:
            state_entities = [
                e
                for e in self.entities.values()
                if "Action" in e.get("kind", "") and e.get("name")
            ]

        for e in state_entities:
            anchor_id = self._node_anchor_id(e)
            semantic_to_anchor[e["id"]] = anchor_id

            parent_id = None
            raw_owner_id = e.get("owner_id")
            if raw_owner_id and raw_owner_id in semantic_to_anchor:
                parent_id = semantic_to_anchor[raw_owner_id]

            compartments = self._build_compartments(e, include_ports=False)
            node = SysMLViewNode(
                id=anchor_id,
                semanticId=e["id"],
                qualifiedName=e.get("qualified_name") or anchor_id,
                name=e["name"],
                kind=e.get("kind", ""),
                shapeCategory="state",
                stereotype=_stereotype_for(e.get("kind", "")),
                parentId=parent_id,
                layer="L3_Behavior",
                compartments=compartments,
                ports=[],
                sourceLocation=self._extract_source_location(e),
            )
            nodes.append(node)

        # Transitions
        for r in self.relations:
            if "Transition" in r.get("kind", ""):
                src_id = semantic_to_anchor.get(r.get("source", {}).get("id"))
                tgt_id = semantic_to_anchor.get(r.get("target", {}).get("id"))
                if src_id and tgt_id:
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
        """Requirements diagram view focusing on requirements and verify/satisfy trace edges."""
        nodes: list[SysMLViewNode] = []
        edges: list[SysMLViewEdge] = []
        semantic_to_anchor: dict[str, str] = {}

        req_entities = [
            e
            for e in self.entities.values()
            if "Requirement" in e.get("kind", "") and e.get("name")
        ]

        # Also include any parts/actions that satisfy or verify these requirements
        related_entity_ids: set[str] = set()
        for r in self.relations:
            r_kind = r.get("kind", "")
            if "Satisfy" in r_kind or "Verify" in r_kind:
                src = r.get("source", {}).get("id")
                tgt = r.get("target", {}).get("id")
                if src:
                    related_entity_ids.add(src)
                if tgt:
                    related_entity_ids.add(tgt)

        combined_entities = {e["id"]: e for e in req_entities}
        for eid in related_entity_ids:
            if eid in self.entities and self.entities[eid].get("name"):
                combined_entities[eid] = self.entities[eid]

        for e in combined_entities.values():
            anchor_id = self._node_anchor_id(e)
            semantic_to_anchor[e["id"]] = anchor_id

            shape_cat = _classify_shape_category(e.get("kind", ""))
            parent_id = None
            raw_owner_id = e.get("owner_id")
            if raw_owner_id and raw_owner_id in semantic_to_anchor:
                parent_id = semantic_to_anchor[raw_owner_id]

            compartments = self._build_compartments(e, include_ports=False)
            node = SysMLViewNode(
                id=anchor_id,
                semanticId=e["id"],
                qualifiedName=e.get("qualified_name") or anchor_id,
                name=e["name"],
                kind=e.get("kind", ""),
                shapeCategory=shape_cat,
                stereotype=_stereotype_for(e.get("kind", "")),
                parentId=parent_id,
                layer="L5_Requirements",
                compartments=compartments,
                ports=[],
                sourceLocation=self._extract_source_location(e),
            )
            nodes.append(node)

        for r in self.relations:
            r_kind = r.get("kind", "")
            src_id = semantic_to_anchor.get(r.get("source", {}).get("id"))
            tgt_id = semantic_to_anchor.get(r.get("target", {}).get("id"))
            if not src_id or not tgt_id or src_id == tgt_id:
                continue

            if "Satisfy" in r_kind:
                edges.append(
                    SysMLViewEdge(
                        id=r.get("id") or f"sat-{len(edges)}",
                        kind="satisfy",
                        sourceId=src_id,
                        targetId=tgt_id,
                        label="«satisfy»",
                        layer="L5_Requirements",
                    )
                )
            elif "Verify" in r_kind:
                edges.append(
                    SysMLViewEdge(
                        id=r.get("id") or f"ver-{len(edges)}",
                        kind="verify",
                        sourceId=src_id,
                        targetId=tgt_id,
                        label="«verify»",
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
