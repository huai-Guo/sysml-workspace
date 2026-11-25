import { Graph } from "@antv/x6/es";
import type { SysMLViewNode } from "./types";
import type { ThemeStyles } from "./themes";

export const SYSML_NODE_NAME = "sysml-node";

// Register custom SysML Node shape in X6
export function registerSysMLShapes(): void {
  try {
    Graph.registerNode(
      SYSML_NODE_NAME,
      {
        inherit: "rect",
        markup: [
          {
            tagName: "rect",
            selector: "packageTab",
          },
          {
            tagName: "rect",
            selector: "body",
          },
          {
            tagName: "rect",
            selector: "header",
          },
          {
            tagName: "text",
            selector: "stereotype",
          },
          {
            tagName: "text",
            selector: "title",
          },
          {
            tagName: "line",
            selector: "divider",
          },
          {
            tagName: "text",
            selector: "compartments",
          },
          {
            tagName: "text",
            selector: "foldBtn",
          },
          {
            tagName: "text",
            selector: "collapseBtn",
          },
          {
            tagName: "text",
            selector: "drillBtn",
          },
        ],
        attrs: {
          packageTab: {
            ref: "body",
            refX: 0,
            refY: -16,
            width: 80,
            height: 16,
            rx: 3,
            ry: 3,
            fill: "#1e2c40",
            stroke: "#38bdf8",
            strokeWidth: 1.5,
            display: "none",
          },
          body: {
            refWidth: "100%",
            refHeight: "100%",
            fill: "#131b26",
            stroke: "#38bdf8",
            strokeWidth: 1.5,
            rx: 0,
            ry: 0,
          },
          header: {
            refWidth: "100%",
            height: 38,
            fill: "#1a2434",
            stroke: "none",
          },
          stereotype: {
            refX: "50%",
            refY: 8,
            textAnchor: "middle",
            dominantBaseline: "central",
            fontSize: 10,
            fontFamily: "ui-monospace, monospace, sans-serif",
            fill: "#94a3b8",
            text: "«part»",
          },
          title: {
            refX: "50%",
            refY: 24,
            textAnchor: "middle",
            dominantBaseline: "central",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "Inter, system-ui, sans-serif",
            fill: "#f8fafc",
            text: "NodeName",
          },
          divider: {
            refX: 0,
            refY: 38,
            refWidth: "100%",
            stroke: "#273549",
            strokeWidth: 1,
          },
          compartments: {
            refX: 12,
            refY: 48,
            textAnchor: "start",
            dominantBaseline: "hanging",
            fontSize: 11,
            lineHeight: 18,
            fontFamily: "ui-monospace, monospace, sans-serif",
            fill: "#94a3b8",
            text: "",
          },
          foldBtn: {
            ref: "header",
            refX: "100%",
            refX2: -16,
            refY: 20,
            textAnchor: "middle",
            dominantBaseline: "central",
            fontSize: 11,
            fontFamily: "ui-monospace, monospace, sans-serif",
            fill: "#94a3b8",
            cursor: "pointer",
            text: "▾",
            display: "none",
          },
          collapseBtn: {
            ref: "header",
            refX: "100%",
            refX2: -36,
            refY: 20,
            textAnchor: "middle",
            dominantBaseline: "central",
            fontSize: 11,
            fontWeight: "bold",
            fontFamily: "ui-monospace, monospace, sans-serif",
            fill: "#94a3b8",
            cursor: "pointer",
            text: "[-]",
            display: "none",
          },
          drillBtn: {
            ref: "header",
            refX: "100%",
            refX2: -16,
            refY: 20,
            textAnchor: "middle",
            dominantBaseline: "central",
            fontSize: 12,
            fontFamily: "ui-monospace, monospace, sans-serif",
            fill: "#94a3b8",
            cursor: "pointer",
            text: "⤢",
            display: "none",
          },
        },
        ports: {
          groups: {
            W: {
              position: "left",
              markup: [
                { tagName: "line", selector: "stub" },
                { tagName: "rect", selector: "pin" },
              ],
              attrs: {
                stub: {
                  x1: -10,
                  y1: 0,
                  x2: 0,
                  y2: 0,
                  strokeWidth: 1.5,
                },
                pin: {
                  width: 8,
                  height: 8,
                  x: -14,
                  y: -4,
                  magnet: true,
                  strokeWidth: 1.5,
                },
                text: {
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace, sans-serif",
                },
              },
              label: {
                position: {
                  name: "left",
                  args: { x: -16 },
                },
              },
            },
            E: {
              position: "right",
              markup: [
                { tagName: "line", selector: "stub" },
                { tagName: "rect", selector: "pin" },
              ],
              attrs: {
                stub: {
                  x1: 0,
                  y1: 0,
                  x2: 10,
                  y2: 0,
                  strokeWidth: 1.5,
                },
                pin: {
                  width: 8,
                  height: 8,
                  x: 6,
                  y: -4,
                  magnet: true,
                  strokeWidth: 1.5,
                },
                text: {
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace, sans-serif",
                },
              },
              label: {
                position: {
                  name: "right",
                  args: { x: 16 },
                },
              },
            },
            N: {
              position: "top",
              markup: [
                { tagName: "line", selector: "stub" },
                { tagName: "rect", selector: "pin" },
              ],
              attrs: {
                stub: {
                  x1: 0,
                  y1: -10,
                  x2: 0,
                  y2: 0,
                  strokeWidth: 1.5,
                },
                pin: {
                  width: 8,
                  height: 8,
                  x: -4,
                  y: -14,
                  magnet: true,
                  strokeWidth: 1.5,
                },
                text: {
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace, sans-serif",
                },
              },
              label: {
                position: {
                  name: "top",
                  args: { y: -16 },
                },
              },
            },
            S: {
              position: "bottom",
              markup: [
                { tagName: "line", selector: "stub" },
                { tagName: "rect", selector: "pin" },
              ],
              attrs: {
                stub: {
                  x1: 0,
                  y1: 0,
                  x2: 0,
                  y2: 10,
                  strokeWidth: 1.5,
                },
                pin: {
                  width: 8,
                  height: 8,
                  x: -4,
                  y: 6,
                  magnet: true,
                  strokeWidth: 1.5,
                },
                text: {
                  fontSize: 11,
                  fontFamily: "ui-monospace, monospace, sans-serif",
                },
              },
              label: {
                position: {
                  name: "bottom",
                  args: { y: 16 },
                },
              },
            },
          },
        },
      },
      true,
    );
  } catch (err) {
    // If already registered, ignore
  }
}

export interface BuildNodeAttrsOptions {
  depth?: number;
  isCompound?: boolean;
  isCollapsed?: boolean;
  lodTier?: "macro" | "meso" | "micro";
  scale?: number;
}

export function buildNodeAttrs(
  node: SysMLViewNode,
  theme: ThemeStyles,
  options: BuildNodeAttrsOptions = {},
): Record<string, unknown> {
  const isDefinition = node.shapeCategory === "definition";
  const isUsage = node.shapeCategory === "usage";
  const isPackage = node.shapeCategory === "package";
  const isState = node.shapeCategory === "state";
  const isReq = node.shapeCategory === "requirement";

  // Corner radiuses per SysML standard
  let rx = 0;
  let ry = 0;
  if (isUsage) {
    rx = 8;
    ry = 8;
  } else if (isState) {
    rx = 16;
    ry = 16;
  } else if (isDefinition || isPackage || isReq) {
    rx = 0;
    ry = 0;
  }

  // Stroke color per semantic layer
  let stroke = theme.node.stroke;
  if (isReq) {
    stroke = theme.edge.satisfyStroke;
  } else if (isPackage) {
    stroke = theme.node.packageTabFill || theme.node.stroke;
  }

  // Depth-based cavity brightness tint
  const depth = options.depth || 0;
  let bodyFill = theme.node.fill;
  let headerFill = theme.node.headerFill;

  if (theme.name.includes("Blueprint")) {
    const shades = ["#131b26", "#172130", "#1c283a", "#223046"];
    const headerShades = ["#1a2434", "#1f2d42", "#24354e", "#2b3e5b"];
    bodyFill = shades[Math.min(depth, shades.length - 1)];
    headerFill = headerShades[Math.min(depth, headerShades.length - 1)];
  } else if (theme.name.includes("Clean")) {
    const shades = ["#ffffff", "#f8fafc", "#f1f5f9", "#e2e8f0"];
    const headerShades = ["#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8"];
    bodyFill = shades[Math.min(depth, shades.length - 1)];
    headerFill = headerShades[Math.min(depth, headerShades.length - 1)];
  } else {
    // Paper Clean B&W
    const shades = ["#ffffff", "#fdfdfd", "#f8f8f8", "#f4f4f4"];
    const headerShades = ["#f8fafc", "#f1f5f9", "#e2e8f0", "#cbd5e1"];
    bodyFill = shades[Math.min(depth, shades.length - 1)];
    headerFill = headerShades[Math.min(depth, headerShades.length - 1)];
  }

  // Build compartments text
  const compLines: string[] = [];
  if (node.compartments && node.compartments.length > 0) {
    for (const comp of node.compartments) {
      compLines.push(`— ${comp.title} —`);
      for (const item of comp.items) {
        compLines.push(`  ${item.text}`);
      }
    }
  }
  const compartmentsText = compLines.join("\n");
  const hasCompartments = compLines.length > 0;

  // Title with type label if present
  const titleText = node.name + (node.typeLabel ? ` ${node.typeLabel}` : "");

  // LOD compensations
  const lod = options.lodTier || "meso";
  const scale = options.scale || 1.0;
  const isMacro = lod === "macro";
  const compTitleSize = isMacro ? Math.min(26, Math.round(13 / Math.max(scale, 0.35))) : 13;
  const compStrokeWidth = isMacro ? Math.min(4, Math.max(1.5, 1.5 / Math.max(scale, 0.5))) : theme.node.strokeWidth;

  const isCompound = options.isCompound ?? false;
  const isCollapsed = options.isCollapsed ?? false;

  return {
    packageTab: {
      display: isPackage ? "block" : "none",
      fill: theme.node.packageTabFill,
      stroke: stroke,
      strokeWidth: compStrokeWidth,
    },
    body: {
      fill: bodyFill,
      stroke: stroke,
      strokeWidth: compStrokeWidth,
      rx,
      ry,
    },
    header: {
      fill: headerFill,
      rx: rx > 0 ? rx : 0,
      ry: ry > 0 ? ry : 0,
      display: "block",
    },
    stereotype: {
      fill: theme.node.textSecondary,
      text: isMacro ? "" : node.stereotype || `«${node.kind}»`,
      display: isMacro ? "none" : "block",
    },
    title: {
      fill: theme.node.textPrimary,
      text: titleText,
      fontSize: compTitleSize,
    },
    divider: {
      stroke: theme.node.dividerColor,
      strokeWidth: compStrokeWidth,
      display: hasCompartments && !node.collapsed && !isMacro && !isCollapsed ? "block" : "none",
    },
    compartments: {
      fill: theme.node.textSecondary,
      text: compartmentsText,
      display: hasCompartments && !node.collapsed && !isMacro && !isCollapsed ? "block" : "none",
    },
    foldBtn: {
      fill: theme.node.textSecondary,
      text: node.collapsed ? "▸" : "▾",
      display: hasCompartments && !isCompound && !isMacro ? "block" : "none",
    },
    collapseBtn: {
      display: isCompound ? "block" : "none",
      fill: theme.node.textSecondary,
      text: isCollapsed ? "[+]" : "[-]",
    },
    drillBtn: {
      display: isCompound ? "block" : "none",
      fill: theme.node.textSecondary,
      text: "⤢",
    },
  };
}

export function buildPortItems(
  node: SysMLViewNode,
  theme: ThemeStyles,
  options: BuildNodeAttrsOptions = {},
): Record<string, unknown>[] {
  if (!node.ports || node.ports.length === 0) return [];

  const isMacro = options.lodTier === "macro";
  const isMicro = options.lodTier === "micro";

  return node.ports.map((port) => {
    const group = port.sideHint || "W";
    const dirSymbol =
      port.direction === "in"
        ? "▶"
        : port.direction === "out"
          ? "◀"
          : port.direction === "inout"
            ? "◆"
            : "▫";
    const conjPrefix = port.conjugated ? "~" : "";
    const conjBadge = port.conjugated ? " [~]" : "";
    const typeSuffix = port.typeName ? `: ${port.typeName}` : "";

    let portLabel = `${dirSymbol} ${conjPrefix}${port.name}`;
    if (isMicro) {
      portLabel = `${dirSymbol} ${conjPrefix}${port.name}${typeSuffix}${conjBadge}`;
    } else if (isMacro) {
      portLabel = ""; // In bird's-eye view, hide port labels to avoid noise
    }

    return {
      id: port.id,
      group,
      attrs: {
        stub: {
          stroke: theme.port.stroke,
          strokeWidth: 1.5,
        },
        pin: {
          fill: theme.port.fill,
          stroke: theme.port.stroke,
          strokeWidth: 1.5,
        },
        text: {
          text: portLabel,
          fill: theme.port.textColor,
          display: isMacro ? "none" : "block",
        },
      },
    };
  });
}
