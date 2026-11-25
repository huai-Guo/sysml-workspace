import { Graph } from "@antv/x6/es";
import type { SysMLPort, SysMLViewNode } from "./types";
import type { ThemeStyles } from "./themes";

export const SYSML_NODE_NAME = "sysml-node";

export function truncateCompartmentLine(text: string, maxChars: number = 44): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1).trimEnd() + "…";
}

/**
 * Formats external port label text consistently across initial render and 3-tier LOD transitions.
 * - `inout` uses `◆`
 * - `in` / `out` orient arrows consistently with the port's boundary wall (`W`, `E`, `N`, `S`)
 * - untyped (`direction == null`) omits fake box glyphs for a clean SysON label
 */
export function formatSysMLPortLabel(
  port: SysMLPort,
  lodTier: "macro" | "meso" | "micro" = "meso",
): string {
  if (lodTier === "macro") {
    return "";
  }

  const side = port.sideHint || "W";
  let dirPrefix = "";
  if (port.direction === "inout") {
    dirPrefix = "◆ ";
  } else if (port.direction === "in") {
    dirPrefix = side === "E" ? "← " : side === "N" ? "↓ " : side === "S" ? "↑ " : "→ ";
  } else if (port.direction === "out") {
    dirPrefix = side === "W" ? "← " : side === "N" ? "↑ " : side === "S" ? "↓ " : "→ ";
  }

  const conjPrefix = port.conjugated ? "~" : "";
  if (lodTier === "micro") {
    const typeSuffix = port.typeName
      ? `: ${port.conjugated ? "~" : ""}${port.typeName}`
      : "";
    return `${dirPrefix}${port.name}${typeSuffix}`;
  }

  return `${dirPrefix}${conjPrefix}${port.name}`;
}

export function formatPortPinGlyph(port: SysMLPort): string {
  const side = port.sideHint || "W";
  if (port.direction === "inout") {
    return side === "N" || side === "S" ? "↕" : "↔";
  }
  if (port.direction === "in") {
    return side === "E" ? "←" : side === "N" ? "↓" : side === "S" ? "↑" : "→";
  }
  if (port.direction === "out") {
    return side === "W" ? "←" : side === "N" ? "↑" : side === "S" ? "↓" : "→";
  }
  return port.conjugated ? "~" : "";
}

// Register custom Eclipse SysON-inspired Node & Border Port shapes in X6
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
            tagName: "rect",
            selector: "divider",
          },
          {
            tagName: "path",
            selector: "compartmentDividers",
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
            tagName: "text",
            selector: "compartments",
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
            refY: -15,
            width: 84,
            height: 15,
            rx: 2,
            ry: 2,
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
            refX: 0.75,
            refY: 0.75,
            refWidth: "100%",
            refWidth2: -1.5,
            height: 39,
            fill: "#1a2434",
            stroke: "none",
          },
          divider: {
            refX: 0,
            refY: 40,
            refWidth: "100%",
            height: 1,
            fill: "#273549",
            stroke: "none",
          },
          compartmentDividers: {
            d: "",
            stroke: "#273549",
            strokeWidth: 1,
            fill: "none",
            display: "none",
          },
          stereotype: {
            refX: "50%",
            refY: 10,
            textAnchor: "middle",
            dominantBaseline: "central",
            fontSize: 10,
            fontStyle: "italic",
            fontFamily: "Inter, system-ui, sans-serif",
            fill: "#94a3b8",
            text: "«part»",
          },
          title: {
            refX: "50%",
            refY: 26,
            textAnchor: "middle",
            dominantBaseline: "central",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "Inter, system-ui, sans-serif",
            fill: "#f8fafc",
            text: "NodeName",
          },
          compartments: {
            refX: 11,
            refY: 46,
            textAnchor: "start",
            textVerticalAnchor: "top",
            fontSize: 11,
            lineHeight: 17,
            fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
            fill: "#94a3b8",
            text: "",
          },
          collapseBtn: {
            ref: "header",
            refX: "100%",
            refX2: -34,
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
            refX2: -14,
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
            // SysON boundary square port (12x12 straddling border) + label offset ABOVE wire corridor
            W: {
              position: "left",
              markup: [
                { tagName: "rect", selector: "pin" },
                { tagName: "text", selector: "dirGlyph" },
              ],
              attrs: {
                pin: {
                  width: 12,
                  height: 12,
                  x: -6,
                  y: -6,
                  rx: 1.5,
                  ry: 1.5,
                  magnet: true,
                  strokeWidth: 1.5,
                },
                dirGlyph: {
                  x: 0,
                  y: 0.5,
                  textAnchor: "middle",
                  dominantBaseline: "central",
                  fontSize: 8.5,
                  fontWeight: 700,
                  fontFamily: "Inter, system-ui, sans-serif",
                  pointerEvents: "none",
                },
                text: {
                  fontSize: 10.5,
                  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                  paintOrder: "stroke fill",
                  strokeWidth: 3,
                  strokeLinejoin: "round",
                },
              },
              label: {
                position: {
                  name: "left",
                  args: { x: -10, y: -12 },
                },
              },
            },
            E: {
              position: "right",
              markup: [
                { tagName: "rect", selector: "pin" },
                { tagName: "text", selector: "dirGlyph" },
              ],
              attrs: {
                pin: {
                  width: 12,
                  height: 12,
                  x: -6,
                  y: -6,
                  rx: 1.5,
                  ry: 1.5,
                  magnet: true,
                  strokeWidth: 1.5,
                },
                dirGlyph: {
                  x: 0,
                  y: 0.5,
                  textAnchor: "middle",
                  dominantBaseline: "central",
                  fontSize: 8.5,
                  fontWeight: 700,
                  fontFamily: "Inter, system-ui, sans-serif",
                  pointerEvents: "none",
                },
                text: {
                  fontSize: 10.5,
                  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                  paintOrder: "stroke fill",
                  strokeWidth: 3,
                  strokeLinejoin: "round",
                },
              },
              label: {
                position: {
                  name: "right",
                  args: { x: 10, y: -12 },
                },
              },
            },
            N: {
              position: "top",
              markup: [
                { tagName: "rect", selector: "pin" },
                { tagName: "text", selector: "dirGlyph" },
              ],
              attrs: {
                pin: {
                  width: 12,
                  height: 12,
                  x: -6,
                  y: -6,
                  rx: 1.5,
                  ry: 1.5,
                  magnet: true,
                  strokeWidth: 1.5,
                },
                dirGlyph: {
                  x: 0,
                  y: 0.5,
                  textAnchor: "middle",
                  dominantBaseline: "central",
                  fontSize: 8.5,
                  fontWeight: 700,
                  fontFamily: "Inter, system-ui, sans-serif",
                  pointerEvents: "none",
                },
                text: {
                  fontSize: 10.5,
                  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                  textAnchor: "start",
                  paintOrder: "stroke fill",
                  strokeWidth: 3,
                  strokeLinejoin: "round",
                },
              },
              label: {
                position: {
                  name: "top",
                  args: { x: 9, y: -11 },
                },
              },
            },
            S: {
              position: "bottom",
              markup: [
                { tagName: "rect", selector: "pin" },
                { tagName: "text", selector: "dirGlyph" },
              ],
              attrs: {
                pin: {
                  width: 12,
                  height: 12,
                  x: -6,
                  y: -6,
                  rx: 1.5,
                  ry: 1.5,
                  magnet: true,
                  strokeWidth: 1.5,
                },
                dirGlyph: {
                  x: 0,
                  y: 0.5,
                  textAnchor: "middle",
                  dominantBaseline: "central",
                  fontSize: 8.5,
                  fontWeight: 700,
                  fontFamily: "Inter, system-ui, sans-serif",
                  pointerEvents: "none",
                },
                text: {
                  fontSize: 10.5,
                  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                  textAnchor: "start",
                  paintOrder: "stroke fill",
                  strokeWidth: 3,
                  strokeLinejoin: "round",
                },
              },
              label: {
                position: {
                  name: "bottom",
                  args: { x: 9, y: 13 },
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
  nodeWidth?: number;
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
  const isAction = node.shapeCategory === "action";
  const isReq = node.shapeCategory === "requirement";

  // Corner radiuses per OMG SysML v2 / Eclipse SysON notation:
  // - Definition / Package / Requirement: sharp 0px corners
  // - Part/Item Usage: soft 6px corners
  // - Action Usage: rounded 10px corners
  // - State: stadium/pill 16px corners
  let rx = 0;
  let ry = 0;
  if (isUsage) {
    rx = 4;
    ry = 4;
  } else if (isAction) {
    rx = 10;
    ry = 10;
  } else if (isState) {
    rx = 16;
    ry = 16;
  } else if (isDefinition || isPackage || isReq) {
    rx = 0;
    ry = 0;
  }

  // Semantic border stroke color
  let stroke = theme.node.stroke;
  if (isReq) {
    stroke = theme.edge.satisfyStroke;
  } else if (isState) {
    stroke = theme.edge.transitionStroke;
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
    const shades = ["#ffffff", "#fdfdfd", "#f8f8f8", "#f4f4f4"];
    const headerShades = ["#f8fafc", "#f1f5f9", "#e2e8f0", "#cbd5e1"];
    bodyFill = shades[Math.min(depth, shades.length - 1)];
    headerFill = headerShades[Math.min(depth, headerShades.length - 1)];
  }

  const lod = options.lodTier || "meso";
  const scale = options.scale || 1.0;
  const isMacro = lod === "macro";
  const isMicro = lod === "micro";

  // Build SysON-style structured compartments + inter-compartment horizontal divider lines
  const compLines: string[] = [];
  const dividerYOffsets: number[] = [];
  const lineHeight = 17;
  const startY = 46;

  if (node.compartments && node.compartments.length > 0) {
    node.compartments.forEach((comp, idx) => {
      if (idx > 0) {
        // Reserve a clean spacer row for the horizontal compartment divider rule
        dividerYOffsets.push(startY + compLines.length * lineHeight + Math.round(lineHeight * 0.45));
        compLines.push("");
      }
      compLines.push(`${comp.title}`);
      for (const item of comp.items) {
        const displayItem = isMicro ? item.text : truncateCompartmentLine(item.text, 44);
        compLines.push(`  ${displayItem}`);
      }
    });
  }

  const compartmentsText = compLines.join("\n");
  const hasCompartments = compLines.length > 0;

  const cleanTypeLabel = node.typeLabel
    ? node.typeLabel.trim().startsWith(":") || node.typeLabel.trim().startsWith("[")
      ? node.typeLabel.trim()
      : `: ${node.typeLabel.trim()}`
    : "";
  const titleText = node.name + (cleanTypeLabel ? ` ${cleanTypeLabel}` : "");

  const compTitleSize = isMacro ? Math.min(26, Math.round(13 / Math.max(scale, 0.35))) : 13;
  const compStrokeWidth = isMacro
    ? Math.min(4, Math.max(1.5, 1.5 / Math.max(scale, 0.5)))
    : theme.node.strokeWidth;

  const isCompound = options.isCompound ?? false;
  const isCollapsed = options.isCollapsed ?? false;
  const showComps = hasCompartments && !node.collapsed && !isMacro && !isCollapsed;

  const w = options.nodeWidth || 220;
  const subDividerPath =
    showComps && dividerYOffsets.length > 0
      ? dividerYOffsets.map((y) => `M 0 ${y} H ${w}`).join(" ")
      : "";

  return {
    packageTab: {
      display: isPackage ? "block" : "none",
      fill: theme.node.packageTabFill,
      stroke,
      strokeWidth: compStrokeWidth,
    },
    body: {
      fill: bodyFill,
      stroke,
      strokeWidth: compStrokeWidth,
      rx,
      ry,
    },
    header: {
      fill: headerFill,
      rx: rx > 0 ? Math.max(0, rx - 1) : 0,
      ry: ry > 0 ? Math.max(0, ry - 1) : 0,
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
      fill: theme.node.dividerColor,
      stroke: theme.node.dividerColor,
      height: 1,
      display: (showComps || (isCompound && !isCollapsed && !isMacro)) ? "block" : "none",
    },
    compartmentDividers: {
      d: subDividerPath,
      stroke: theme.node.dividerColor,
      display: subDividerPath ? "block" : "none",
    },
    compartments: {
      fill: theme.node.textSecondary,
      text: compartmentsText,
      textVerticalAnchor: "top",
      display: showComps ? "block" : "none",
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

  const lodTier = options.lodTier || "meso";
  const isMacro = lodTier === "macro";

  return node.ports.map((port) => {
    const group = port.sideHint || "W";
    const portLabel = formatSysMLPortLabel(port, lodTier);
    const pinGlyph = formatPortPinGlyph(port);

    // OMG SysML v2 / Eclipse SysON conjugation distinction:
    // - Standard port: clean node surface fill + accent border + accent arrow
    // - Conjugated (~) port: inverted accent fill + contrasting glyph
    const pinFill = port.conjugated ? theme.port.fill : theme.node.fill;
    const glyphFill = port.conjugated ? "#ffffff" : theme.port.stroke;

    return {
      id: port.id,
      group,
      attrs: {
        pin: {
          fill: pinFill,
          stroke: theme.port.stroke,
          strokeWidth: 1.5,
        },
        dirGlyph: {
          text: pinGlyph,
          fill: glyphFill,
          display: isMacro ? "none" : "block",
        },
        text: {
          text: portLabel,
          fill: theme.port.textColor,
          stroke: theme.canvasBg,
          strokeWidth: 3,
          paintOrder: "stroke fill",
          display: isMacro || !portLabel ? "none" : "block",
        },
      },
    };
  });
}
