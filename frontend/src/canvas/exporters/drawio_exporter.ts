import type { SysMLViewIR, SysMLViewNode, SysMLViewEdge } from "../types";

export interface DrawioExportOptions {
  sysmlSource?: string;
  nodePositions?: Map<string, { x: number; y: number; width: number; height: number }>;
}

export class DrawioExporter {
  public static export(viewIR: SysMLViewIR, options: DrawioExportOptions = {}): string {
    const rawSource = options.sysmlSource || "";
    const positions = options.nodePositions;

    const escapeXml = (str: string) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

    const xmlLines: string[] = [];
    const push = (line: string) => xmlLines.push(line);

    push(`<?xml version="1.0" encoding="UTF-8"?>`);
    push(
      `<mxfile host="Electron" modified="${new Date().toISOString()}" agent="SysML-Workbench" version="21.0.0" type="device">`,
    );
    push(
      `  <diagram id="sysml-${viewIR.viewType}" name="${escapeXml(viewIR.rootPackageName)} (${viewIR.viewType})">`,
    );
    push(
      `    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" background="#0d1219" math="0" shadow="0">`,
    );
    push(`      <root>`);
    push(`        <mxCell id="0" />`);

    // Root layer 1 with embedded sysmlSource metadata
    const encodedSource = encodeURIComponent(rawSource);
    push(
      `        <mxCell id="1" parent="0" sysmlSource="${encodedSource}" viewType="${viewIR.viewType}" rootPackage="${escapeXml(viewIR.rootPackageName)}" />`,
    );

    // 1. Export Nodes
    for (const node of viewIR.nodes) {
      const pos = positions?.get(node.id) || {
        x: 60,
        y: 60,
        width: 180,
        height: 80,
      };

      const hasParent = Boolean(node.parentId && viewIR.nodes.some((n) => n.id === node.parentId));
      const parentCellId = hasParent ? node.parentId! : "1";
      const style = DrawioExporter.buildNodeStyle(node);
      const label = DrawioExporter.buildNodeLabel(node);

      // For nested children, compute coordinates relative to parent cell
      let cellX = pos.x;
      let cellY = pos.y;
      if (hasParent && positions?.has(node.parentId!)) {
        const parentPos = positions.get(node.parentId!)!;
        cellX = pos.x - parentPos.x;
        cellY = pos.y - parentPos.y;
      }

      push(`        <UserObject id="${node.id}" label="${escapeXml(label)}" qualifiedName="${escapeXml(node.qualifiedName || node.name)}" kind="${node.kind}">`);
      push(`          <mxCell style="${escapeXml(style)}" vertex="1" parent="${parentCellId}">`);
      push(`            <mxGeometry x="${cellX}" y="${cellY}" width="${pos.width}" height="${pos.height}" as="geometry" />`);
      push(`          </mxCell>`);
      push(`        </UserObject>`);

      // Export Ports as small boundary cells if present
      for (const port of node.ports || []) {
        const portId = port.id;
        const side = port.sideHint || "W";
        let px = 0;
        let py = 0.5;
        if (side === "W") {
          px = 0;
          py = 0.5;
        } else if (side === "E") {
          px = 1;
          py = 0.5;
        } else if (side === "N") {
          px = 0.5;
          py = 0;
        } else if (side === "S") {
          px = 0.5;
          py = 1;
        }

        const portStyle = `shape=ellipse;whiteSpace=wrap;html=1;aspect=fixed;fillColor=#0284c7;strokeColor=#38bdf8;strokeWidth=1;fontSize=9;fontColor=#7dd3fc;`;
        push(`        <mxCell id="${portId}" value="${escapeXml(port.name)}" style="${escapeXml(portStyle)}" vertex="1" parent="${node.id}">`);
        push(`          <mxGeometry x="${px}" y="${py}" width="12" height="12" relative="1" as="geometry">`);
        push(`            <mxPoint x="-6" y="-6" as="offset" />`);
        push(`          </mxGeometry>`);
        push(`        </mxCell>`);
      }
    }

    // 2. Export Edges
    for (const edge of viewIR.edges || []) {
      const edgeStyle = DrawioExporter.buildEdgeStyle(edge);
      const edgeLabel = edge.label ? escapeXml(edge.label) : "";

      const sourceId = edge.sourcePortId || edge.sourceId;
      const targetId = edge.targetPortId || edge.targetId;

      push(`        <mxCell id="${edge.id}" value="${edgeLabel}" style="${escapeXml(edgeStyle)}" edge="1" parent="1" source="${sourceId}" target="${targetId}">`);
      push(`          <mxGeometry relative="1" as="geometry">`);
      push(`            <mxPoint as="offset" />`);
      push(`          </mxGeometry>`);
      push(`        </mxCell>`);
    }

    push(`      </root>`);
    push(`    </mxGraphModel>`);
    push(`  </diagram>`);
    push(`</mxfile>`);

    return xmlLines.join("\n");
  }

  private static buildNodeStyle(node: SysMLViewNode): string {
    const isDef = node.shapeCategory === "definition";
    const isPkg = node.shapeCategory === "package";
    const isState = node.shapeCategory === "state";
    const isReq = node.shapeCategory === "requirement";

    let shape = "shape=rectangle;whiteSpace=wrap;html=1;";
    let rounded = "rounded=1;arcSize=6;";
    let colors = "fillColor=#131b26;strokeColor=#38bdf8;strokeWidth=1.5;fontColor=#f1f5f9;";

    if (isDef) {
      rounded = "rounded=0;";
    } else if (isPkg) {
      shape = "shape=folder;tabWidth=50;tabHeight=18;tabPosition=left;html=1;";
      rounded = "rounded=0;";
      colors = "fillColor=#131b26;strokeColor=#38bdf8;strokeWidth=1.5;fontColor=#f1f5f9;";
    } else if (isState) {
      rounded = "rounded=1;arcSize=50;";
      colors = "fillColor=#131b26;strokeColor=#f59e0b;strokeWidth=1.5;fontColor=#f1f5f9;";
    } else if (isReq) {
      rounded = "rounded=0;";
      colors = "fillColor=#131b26;strokeColor=#ec4899;strokeWidth=1.5;fontColor=#f1f5f9;";
    }

    return `${shape}${rounded}${colors}align=center;verticalAlign=top;spacingTop=6;`;
  }

  private static buildNodeLabel(node: SysMLViewNode): string {
    const rawSt = (node.stereotype || node.kind || "").replace(/^[«<]+|[»>]+$/g, "");
    const st = rawSt ? `<i>&laquo;${rawSt}&raquo;</i><br/>` : "";
    const name = `<b>${node.name}</b>`;

    let comps = "";
    if (node.compartments && node.compartments.length > 0) {
      comps = "<hr/>";
      for (const comp of node.compartments) {
        for (const item of comp.items.slice(0, 3)) {
          comps += `<div style="text-align:left;font-size:10px;">${item.text}</div>`;
        }
      }
    }

    return `${st}${name}${comps}`;
  }

  private static buildEdgeStyle(edge: SysMLViewEdge): string {
    const isControl = edge.kind === "transition";
    const isReq = edge.kind === "satisfy" || edge.kind === "verify";

    let stroke = "strokeColor=#38bdf8;";
    let dash = "";
    if (isReq) {
      stroke = "strokeColor=#ec4899;";
      dash = "dashed=1;dashPattern=6 3;";
    } else if (isControl) {
      stroke = "strokeColor=#eab308;";
      dash = "dashed=1;dashPattern=4 4;";
    }

    return `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=1.5;${stroke}${dash}endArrow=block;endFill=1;`;
  }
}
