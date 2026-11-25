import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api";
import type { SysMLViewIR, SysMLViewNode, NodeLayoutPosition } from "./types";

const elk = new ELK();

function measureTextWidth(str: string, asciiCharPx: number): number {
  let total = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    total += code > 0x2e80 ? asciiCharPx * 1.85 : asciiCharPx;
  }
  return Math.ceil(total);
}

export function estimateNodeDimensions(
  node: SysMLViewNode,
  isCompound: boolean = false,
): { width: number; height: number; topPadding: number } {
  const cleanType = node.typeLabel
    ? node.typeLabel.trim().startsWith(":") || node.typeLabel.trim().startsWith("[")
      ? ` ${node.typeLabel.trim()}`
      : ` : ${node.typeLabel.trim()}`
    : "";
  const fullTitle = `${node.name}${cleanType}`;
  const stereo = node.stereotype || `«${node.kind}»`;

  // Account for compound [-]/⤢ action buttons on the right of the header
  const headerButtonsWidth = isCompound ? 64 : 28;
  let width = Math.max(
    168,
    measureTextWidth(fullTitle, 8.2) + headerButtonsWidth,
    measureTextWidth(stereo, 6.8) + 36,
  );

  // SysON Compartments: exact line count matching shapes.ts (lineHeight = 17, startY = 46)
  let totalLines = 0;
  if (node.compartments && node.compartments.length > 0) {
    node.compartments.forEach((comp, idx) => {
      if (idx > 0) {
        totalLines += 1; // Spacer row for horizontal compartment divider
      }
      totalLines += 1; // Compartment title row
      totalLines += comp.items.length;
      for (const item of comp.items) {
        const displayLen = Math.min(item.text.length, 44);
        const sample = item.text.slice(0, displayLen);
        width = Math.max(width, measureTextWidth(`  ${sample}`, 7.3) + 28);
      }
    });
  }

  const compHeight = totalLines > 0 ? totalLines * 17 + 14 : 0;

  // Header height is 40px; topPadding reserves cavity clearance below header + parent compartments
  const topPadding = Math.max(58, 44 + compHeight + (totalLines > 0 ? 18 : 14));
  let height = 42 + compHeight;

  // Ensure vertical breathing room per side so port squares & labels above wires never collide
  if (node.ports && node.ports.length > 0) {
    const sideCounts: Record<string, number> = { W: 0, E: 0, N: 0, S: 0 };
    for (const p of node.ports) {
      const s = p.sideHint || "W";
      sideCounts[s] = (sideCounts[s] || 0) + 1;
    }
    const maxVerticalSidePorts = Math.max(sideCounts.W, sideCounts.E, 1);
    height = Math.max(height, 44 + maxVerticalSidePorts * 30);

    const maxHorizontalSidePorts = Math.max(sideCounts.N, sideCounts.S, 0);
    if (maxHorizontalSidePorts > 0) {
      width = Math.max(width, 60 + maxHorizontalSidePorts * 90);
    }
  }

  if (isCompound) {
    width = Math.max(300, width);
    height = Math.max(120, topPadding + 60);
  } else {
    width = Math.min(360, Math.max(width, 168));
    height = Math.max(height, 54);
  }

  return { width, height, topPadding };
}

export interface ElkLayoutResult {
  positions: Map<string, NodeLayoutPosition>;
  width: number;
  height: number;
}

function catalogSortRank(node: SysMLViewNode): number {
  const k = node.kind;
  if (k === "Package" || k === "LibraryPackage") return 0;
  if (k === "AttributeDefinition" || k === "EnumerationDefinition" || k === "ItemDefinition") return 1;
  if (k === "PortDefinition" || k === "InterfaceDefinition") return 2;
  if (k === "PartDefinition") return 3;
  return 4;
}

export async function runElkLayout(viewIR: SysMLViewIR): Promise<ElkLayoutResult> {
  const positions = new Map<string, NodeLayoutPosition>();
  if (!viewIR.nodes || viewIR.nodes.length === 0) {
    return { positions, width: 800, height: 600 };
  }

  // Pass 1: populate nodeMap completely to eliminate ordering dependencies
  const nodeMap = new Map<string, SysMLViewNode>();
  for (const node of viewIR.nodes) {
    nodeMap.set(node.id, node);
  }

  // Pass 2: build children hierarchy
  const childrenMap = new Map<string | null, SysMLViewNode[]>();
  for (const node of viewIR.nodes) {
    const pId = node.parentId && nodeMap.has(node.parentId) ? node.parentId : null;
    if (!childrenMap.has(pId)) {
      childrenMap.set(pId, []);
    }
    childrenMap.get(pId)!.push(node);
  }

  const validEdges = (viewIR.edges || []).filter(
    (e) => nodeMap.has(e.sourceId) && nodeMap.has(e.targetId),
  );

  // Track which top-level subtrees participate in any edges or compound nesting
  const connectedNodeIds = new Set<string>();
  for (const e of validEdges) {
    let currSrc: string | null | undefined = e.sourceId;
    while (currSrc && nodeMap.has(currSrc)) {
      connectedNodeIds.add(currSrc);
      currSrc = nodeMap.get(currSrc)!.parentId;
    }
    let currTgt: string | null | undefined = e.targetId;
    while (currTgt && nodeMap.has(currTgt)) {
      connectedNodeIds.add(currTgt);
      currTgt = nodeMap.get(currTgt)!.parentId;
    }
  }

  const topNodes = viewIR.nodes.filter(
    (n) => !n.parentId || !nodeMap.has(n.parentId),
  );

  // Partition top-level nodes into:
  // 1) Isolated leaf catalog nodes (unconnected Definitions / standalone cards)
  // 2) Active structural/behavioral topology nodes (compound containers or edge-connected nodes)
  const isolatedCatalogNodes: SysMLViewNode[] = [];
  const activeTopNodes: SysMLViewNode[] = [];

  for (const n of topNodes) {
    const hasChildren = (childrenMap.get(n.id) || []).length > 0;
    const hasEdges = connectedNodeIds.has(n.id);
    if (!hasChildren && !hasEdges && topNodes.length >= 2) {
      isolatedCatalogNodes.push(n);
    } else {
      activeTopNodes.push(n);
    }
  }

  // Recursive ELK node builder with strict FIXED_SIDE port constraints & compact SysON cavity padding
  function buildElkNode(node: SysMLViewNode): ElkNode {
    const childNodes = childrenMap.get(node.id) || [];
    const isCompound = childNodes.length > 0;
    const { width, height, topPadding } = estimateNodeDimensions(node, isCompound);

    // Check if direct children carry W/E boundary ports to reserve clean label margin inside cavity
    const childrenHaveWestPorts = childNodes.some((c) =>
      (c.ports || []).some((p) => (p.sideHint || "W") === "W"),
    );
    const childrenHaveEastPorts = childNodes.some((c) =>
      (c.ports || []).some((p) => p.sideHint === "E"),
    );
    const leftPad = childrenHaveWestPorts ? 84 : 40;
    const rightPad = childrenHaveEastPorts ? 84 : 40;

    const elkNode: ElkNode = {
      id: node.id,
      width,
      height,
      layoutOptions: isCompound
        ? {
            "elk.algorithm": "layered",
            "elk.direction": "RIGHT",
            "elk.portConstraints": "FIXED_SIDE",
            "elk.padding": `[top=${topPadding},left=${leftPad},bottom=32,right=${rightPad}]`,
            "elk.spacing.nodeNode": "42",
            "elk.layered.spacing.nodeNodeBetweenLayers": "96",
            "elk.spacing.portPort": "22",
            "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
          }
        : {
            "elk.portConstraints": "FIXED_SIDE",
            "elk.spacing.portPort": "22",
            "elk.padding": "[top=14,left=14,bottom=14,right=14]",
          },
    };

    if (childNodes.length > 0) {
      elkNode.children = childNodes.map((child) => buildElkNode(child));
    }

    if (node.ports && node.ports.length > 0) {
      elkNode.ports = node.ports.map((port, idx) => {
        let side = "WEST";
        if (port.sideHint === "E") side = "EAST";
        else if (port.sideHint === "N") side = "NORTH";
        else if (port.sideHint === "S") side = "SOUTH";

        return {
          id: port.id,
          width: 12,
          height: 12,
          layoutOptions: {
            "elk.port.side": side,
            "elk.port.index": String(idx),
            "elk.port.borderOffset": "-6",
          },
        };
      });
    }

    return elkNode;
  }

  try {
    let activeGraphWidth = 0;
    let activeGraphHeight = 0;

    // Step A: Layout active connected / compound architecture via ELK layered
    if (activeTopNodes.length > 0) {
      const elkEdges: ElkExtendedEdge[] = validEdges.map((e) => ({
        id: e.id,
        sources: [e.sourcePortId ? e.sourcePortId : e.sourceId],
        targets: [e.targetPortId ? e.targetPortId : e.targetId],
      }));

      const isHierarchyVertical =
        viewIR.viewType === "general" &&
        validEdges.length > 0 &&
        validEdges.every((e) => e.kind === "specialization" || e.kind === "composition");

      const rootElkGraph: ElkNode = {
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": isHierarchyVertical ? "UP" : "RIGHT",
          "elk.spacing.nodeNode": "44",
          "elk.layered.spacing.nodeNodeBetweenLayers": "92",
          "elk.edgeRouting": "ORTHOGONAL",
          "elk.hierarchyHandling": "INCLUDE_CHILDREN",
          "elk.separateConnectedComponents": "true",
          "elk.spacing.componentComponent": "48",
          "elk.padding": "[top=36,left=40,bottom=36,right=40]",
        },
        children: activeTopNodes.map((node) => buildElkNode(node)),
        edges: elkEdges,
      };

      const layouted = await elk.layout(rootElkGraph);
      activeGraphWidth = Number(layouted.width) || 0;
      activeGraphHeight = Number(layouted.height) || 0;

      function collectPositions(
        item: Record<string, unknown>,
        offsetParentX: number = 0,
        offsetParentY: number = 0,
      ) {
        const currentX = offsetParentX + (Number(item.x) || 0);
        const currentY = offsetParentY + (Number(item.y) || 0);
        const width = Number(item.width) || 180;
        const height = Number(item.height) || 60;

        if (item.id && item.id !== "root") {
          positions.set(String(item.id), {
            x: currentX,
            y: currentY,
            width,
            height,
          });
        }

        if (Array.isArray(item.children)) {
          for (const child of item.children) {
            collectPositions(
              child as Record<string, unknown>,
              currentX,
              currentY,
            );
          }
        }
      }

      collectPositions(layouted);
    }

    // Step B: Arrange isolated Definition/Catalog cards in a neat multi-column SysON catalog grid
    // (Placed cleanly above the active assembly so definitions & system structure never collide or sprawl)
    if (isolatedCatalogNodes.length > 0) {
      const sortedCatalog = [...isolatedCatalogNodes].sort(
        (a, b) => catalogSortRank(a) - catalogSortRank(b),
      );
      const dims = sortedCatalog.map((n) => ({
        node: n,
        ...estimateNodeDimensions(n, false),
      }));

      const maxCols = Math.min(
        sortedCatalog.length,
        activeGraphWidth > 820 ? 4 : 3,
      );
      const colGap = 28;
      const rowGap = 24;
      const startX = 40;
      let curY = 36;
      let maxCatalogRight = startX;

      for (let i = 0; i < dims.length; i += maxCols) {
        const rowSlice = dims.slice(i, i + maxCols);
        let curX = startX;
        let rowHeight = 0;
        for (const item of rowSlice) {
          positions.set(item.node.id, {
            x: curX,
            y: curY,
            width: item.width,
            height: item.height,
          });
          curX += item.width + colGap;
          rowHeight = Math.max(rowHeight, item.height);
        }
        maxCatalogRight = Math.max(maxCatalogRight, curX - colGap);
        curY += rowHeight + rowGap;
      }

      const catalogBottom = curY - rowGap;

      // Shift active architecture down cleanly below the Definition Catalog band
      if (activeTopNodes.length > 0) {
        const shiftY = catalogBottom + 44 - 36; // active graph already had top=36 padding
        for (const [id, pos] of positions.entries()) {
          if (!sortedCatalog.some((c) => c.id === id)) {
            pos.y += shiftY;
          }
        }
        activeGraphHeight += shiftY;
      } else {
        activeGraphHeight = catalogBottom + 40;
      }
      activeGraphWidth = Math.max(activeGraphWidth, maxCatalogRight + 40);
    }

    return {
      positions,
      width: Math.max(activeGraphWidth, 800),
      height: Math.max(activeGraphHeight, 500),
    };
  } catch (err) {
    console.warn("ELK layout failed, falling back to simple grid:", err);
    let curX = 60;
    let curY = 60;
    let rowH = 0;
    for (const node of viewIR.nodes) {
      const isCompound = (childrenMap.get(node.id) || []).length > 0;
      const { width, height } = estimateNodeDimensions(node, isCompound);
      positions.set(node.id, { x: curX, y: curY, width, height });
      curX += width + 50;
      rowH = Math.max(rowH, height);
      if (curX > 1000) {
        curX = 60;
        curY += rowH + 50;
        rowH = 0;
      }
    }
    return { positions, width: 1200, height: Math.max(curY + 150, 600) };
  }
}
