import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkExtendedEdge } from "elkjs/lib/elk-api";
import type { SysMLViewIR, SysMLViewNode, NodeLayoutPosition } from "./types";

const elk = new ELK();

export function estimateNodeDimensions(
  node: SysMLViewNode,
  isCompound: boolean = false,
): { width: number; height: number; topPadding: number } {
  // Base width on title length
  const labelLength = (node.name + (node.typeLabel || "")).length;
  let width = Math.max(180, labelLength * 9 + 40);

  // Compartments
  let compHeight = 0;
  if (node.compartments && node.compartments.length > 0) {
    for (const comp of node.compartments) {
      compHeight += 24; // Compartment header
      compHeight += comp.items.length * 18; // Items
      for (const item of comp.items) {
        if (item.text.length * 8 + 30 > width) {
          width = Math.max(width, item.text.length * 8 + 30);
        }
      }
    }
    compHeight += 8; // Bottom padding
  }

  // topPadding = header (44px) + compHeight + 20px spacing
  const topPadding = Math.max(56, 44 + compHeight + 20);

  let height = 44 + compHeight;

  // Ensure minimum height if ports are present
  if (node.ports && node.ports.length > 0) {
    height = Math.max(height, 80 + node.ports.length * 15);
  }

  if (isCompound) {
    // Compound container: do NOT clamp width with Math.min(360, width)
    width = Math.max(300, width);
    height = Math.max(120, topPadding + 60);
  } else {
    // Leaf node
    width = Math.min(360, Math.max(width, 180));
    height = Math.max(height, 56);
  }

  return { width, height, topPadding };
}

export interface ElkLayoutResult {
  positions: Map<string, NodeLayoutPosition>;
  width: number;
  height: number;
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

  // Pass 2: build children hierarchy with fully populated nodeMap
  const childrenMap = new Map<string | null, SysMLViewNode[]>();
  for (const node of viewIR.nodes) {
    const pId = node.parentId && nodeMap.has(node.parentId) ? node.parentId : null;
    if (!childrenMap.has(pId)) {
      childrenMap.set(pId, []);
    }
    childrenMap.get(pId)!.push(node);
  }

  // Recursive ELK node constructor
  function buildElkNode(node: SysMLViewNode): ElkNode {
    const childNodes = childrenMap.get(node.id) || [];
    const isCompound = childNodes.length > 0;
    const { width, height, topPadding } = estimateNodeDimensions(node, isCompound);

    const elkNode: ElkNode = {
      id: node.id,
      width,
      height,
      layoutOptions: isCompound
        ? {
            "elk.padding": `[top=${topPadding},left=30,bottom=30,right=30]`,
            "elk.spacing.nodeNode": "40",
            "elk.direction": "RIGHT",
          }
        : {
            "elk.padding": "[top=16,left=16,bottom=16,right=16]",
            "elk.spacing.nodeNode": "35",
          },
    };

    if (childNodes.length > 0) {
      elkNode.children = childNodes.map((child) => buildElkNode(child));
    }

    if (node.ports && node.ports.length > 0) {
      elkNode.ports = node.ports.map((port) => {
        let side = "WEST";
        if (port.sideHint === "E") side = "EAST";
        else if (port.sideHint === "N") side = "NORTH";
        else if (port.sideHint === "S") side = "SOUTH";

        return {
          id: port.id,
          width: 10,
          height: 10,
          layoutOptions: {
            "elk.port.side": side,
            "elk.port.borderOffset": "-5",
          },
        };
      });
    }

    return elkNode;
  }

  // Top-level nodes (parentId is null or not in model)
  const topNodes = viewIR.nodes.filter(
    (n) => !n.parentId || !nodeMap.has(n.parentId),
  );

  const elkEdges: ElkExtendedEdge[] = (viewIR.edges || [])
    .filter((e) => nodeMap.has(e.sourceId) && nodeMap.has(e.targetId))
    .map((e) => ({
      id: e.id,
      sources: [e.sourcePortId ? e.sourcePortId : e.sourceId],
      targets: [e.targetPortId ? e.targetPortId : e.targetId],
    }));

  const rootElkGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "45",
      "elk.layered.spacing.nodeNodeBetweenLayers": "65",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
    },
    children: topNodes.map((node) => buildElkNode(node)),
    edges: elkEdges,
  };

  try {
    const layouted = await elk.layout(rootElkGraph);

    // Recursively collect absolute positions
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

    return {
      positions,
      width: Number(layouted.width) || 1200,
      height: Number(layouted.height) || 800,
    };
  } catch (err) {
    // Fallback simple grid if ELK fails
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
