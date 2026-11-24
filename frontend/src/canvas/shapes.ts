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

export function buildNodeAttrs(
  node: SysMLViewNode,
  theme: ThemeStyles,
): Record<string, unknown> {
  const isDefinition = node.shapeCategory === "definition";
  const isUsage = node.shapeCategory === "usage";
  const isPackage = node.shapeCategory === "package";
  const isState = node.shapeCategory === "state";
  const isReq = node.shapeCategory === "requirement";

  // Corner radiuses per OMG standard
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

  return {
    packageTab: {
      display: isPackage ? "block" : "none",
      fill: theme.node.packageTabFill,
      stroke: stroke,
      strokeWidth: theme.node.strokeWidth,
    },
    body: {
      fill: theme.node.fill,
      stroke: stroke,
      strokeWidth: theme.node.strokeWidth,
      rx,
      ry,
    },
    header: {
      fill: theme.node.headerFill,
      rx: rx > 0 ? rx : 0,
      ry: ry > 0 ? ry : 0,
      display: theme.isIso ? "none" : "block",
    },
    stereotype: {
      fill: theme.node.textSecondary,
      text: node.stereotype || `«${node.kind}»`,
    },
    title: {
      fill: theme.node.textPrimary,
      text: titleText,
    },
    divider: {
      stroke: theme.node.dividerColor,
      strokeWidth: theme.node.strokeWidth,
      display: hasCompartments && !node.collapsed ? "block" : "none",
    },
    compartments: {
      fill: theme.node.textSecondary,
      text: compartmentsText,
      display: hasCompartments && !node.collapsed ? "block" : "none",
    },
    foldBtn: {
      fill: theme.node.textSecondary,
      text: node.collapsed ? "▸" : "▾",
      display: hasCompartments ? "block" : "none",
    },
  };
}

export function buildPortItems(
  node: SysMLViewNode,
  theme: ThemeStyles,
): Record<string, unknown>[] {
  if (!node.ports || node.ports.length === 0) return [];

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
    const portLabel = `${dirSymbol} ${conjPrefix}${port.name}${typeSuffix}${conjBadge}`;

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
        },
      },
    };
  });
}
