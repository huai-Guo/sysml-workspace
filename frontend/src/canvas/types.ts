export type ViewType = "general" | "interconnection" | "state" | "requirements";

export type CanvasThemeId = "auto" | "cad-blueprint" | "syson-clean" | "iso-drafting";

export interface SourceLocation {
  line?: number;
  offset?: number;
  length?: number;
}

export interface CompartmentItem {
  id: string;
  text: string;
  line?: number;
}

export interface Compartment {
  id: "attributes" | "ports" | "parts" | "constraints" | "actions" | "doc";
  title: string;
  items: CompartmentItem[];
}

export interface SysMLPort {
  id: string;
  name: string;
  typeName?: string;
  direction?: "in" | "out" | "inout" | null;
  conjugated: boolean;
  sideHint?: "N" | "S" | "E" | "W";
  line?: number;
}

export interface SysMLViewNode {
  id: string;
  semanticId: string;
  qualifiedName: string;
  name: string;
  kind: string;
  shapeCategory: "definition" | "usage" | "package" | "state" | "action" | "requirement" | "constraint";
  stereotype: string;
  typeLabel?: string;
  parentId?: string | null;
  layer: "L1_Definitions" | "L2_Structure" | "L3_Behavior" | "L4_Connections" | "L5_Requirements";
  compartments: Compartment[];
  ports: SysMLPort[];
  sourceLocation?: SourceLocation;
}

export interface SysMLViewEdge {
  id: string;
  kind: "specialization" | "composition" | "connection" | "flow" | "transition" | "satisfy" | "verify" | "dependency";
  sourceId: string;
  sourcePortId?: string;
  targetId: string;
  targetPortId?: string;
  label?: string;
  layer: "L1_Definitions" | "L3_Behavior" | "L4_Connections" | "L5_Requirements";
  sourceLocation?: SourceLocation;
}

export interface SysMLViewSummary {
  displayedNodes: number;
  displayedEdges: number;
  omittedElements: number;
}

export interface SysMLViewIR {
  schemaVersion: "2.0";
  sourceSha256: string;
  rootPackageName: string;
  viewType: ViewType;
  nodes: SysMLViewNode[];
  edges: SysMLViewEdge[];
  summary: SysMLViewSummary;
}

export interface NodeLayoutPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  userMoved?: boolean;
}
