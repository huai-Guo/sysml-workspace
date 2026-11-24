import type { SysMLViewIR, SysMLViewNode, SysMLViewEdge } from "../types";

export interface DxfExportOptions {
  includeFrame?: boolean;
  scale?: number;
  nodePositions?: Map<string, { x: number; y: number; width: number; height: number }>;
}

export class DxfExporter {
  public static export(viewIR: SysMLViewIR, options: DxfExportOptions = {}): string {
    const scale = options.scale || 1.0;
    const includeFrame = options.includeFrame ?? true;
    const positions = options.nodePositions;

    let handleId = 0x30;
    const nextHandle = () => (handleId++).toString(16).toUpperCase();

    // Map screen Y to CAD Y (negative Y preserves downward orientation)
    const toCAD = (x: number, y: number): [number, number] => [
      Math.round(x * scale * 100) / 100,
      Math.round(-y * scale * 100) / 100,
    ];

    const lines: string[] = [];
    const emit = (...tokens: (string | number)[]) => {
      for (const t of tokens) lines.push(String(t));
    };

    // 1. HEADER SECTION
    emit("0", "SECTION", "2", "HEADER");
    emit("9", "$ACADVER", "1", "AC1015"); // AutoCAD 2000
    emit("9", "$INSUNITS", "70", "4"); // Millimeters
    emit("0", "ENDSEC");

    // 2. TABLES SECTION
    emit("0", "SECTION", "2", "TABLES");

    // Layer Table
    emit("0", "TABLE", "2", "LAYER", "5", nextHandle(), "70", "7");

    const layers: { name: string; color: number }[] = [
      { name: "0", color: 7 }, // White
      { name: "L0_FRAME", color: 7 }, // White/Black for ISO border
      { name: "L1_DEFINITIONS", color: 5 }, // Blue
      { name: "L2_STRUCTURE", color: 3 }, // Green
      { name: "L3_BEHAVIOR", color: 2 }, // Yellow
      { name: "L4_CONNECTIONS", color: 6 }, // Magenta
      { name: "L5_REQUIREMENTS", color: 1 }, // Red
    ];

    for (const lyr of layers) {
      emit("0", "LAYER", "5", nextHandle(), "100", "AcDbSymbolTableRecord", "100", "AcDbLayerTableRecord");
      emit("2", lyr.name, "70", "0", "62", lyr.color, "6", "CONTINUOUS");
    }
    emit("0", "ENDTAB");
    emit("0", "ENDSEC");

    // 3. BLOCKS SECTION
    emit("0", "SECTION", "2", "BLOCKS");
    emit("0", "ENDSEC");

    // 4. ENTITIES SECTION
    emit("0", "SECTION", "2", "ENTITIES");

    // Helper: Polyline rectangle
    const emitBox = (x: number, y: number, w: number, h: number, layer: string) => {
      const [x1, y1] = toCAD(x, y);
      const [x2, y2] = toCAD(x + w, y + h);

      emit("0", "LWPOLYLINE", "5", nextHandle(), "100", "AcDbEntity", "8", layer);
      emit("100", "AcDbPolyline", "90", "4", "70", "1"); // closed
      emit("10", x1, "20", y1);
      emit("10", x2, "20", y1);
      emit("10", x2, "20", y2);
      emit("10", x1, "20", y2);
    };

    // Helper: Line
    const emitLine = (x1: number, y1: number, x2: number, y2: number, layer: string) => {
      const [p1x, p1y] = toCAD(x1, y1);
      const [p2x, p2y] = toCAD(x2, y2);
      emit("0", "LINE", "5", nextHandle(), "100", "AcDbEntity", "8", layer);
      emit("100", "AcDbLine", "10", p1x, "20", p1y, "30", "0.0", "11", p2x, "21", p2y, "31", "0.0");
    };

    // Helper: Single-line Text
    const emitText = (
      text: string,
      x: number,
      y: number,
      height: number,
      layer: string,
      align: "left" | "center" = "left",
    ) => {
      const [px, py] = toCAD(x, y);
      const clean = text.replace(/[\r\n]+/g, " ");
      emit("0", "TEXT", "5", nextHandle(), "100", "AcDbEntity", "8", layer);
      emit("100", "AcDbText", "10", px, "20", py, "30", "0.0", "40", Math.max(8, height * scale));
      emit("1", clean);
      if (align === "center") {
        emit("72", "1", "11", px, "21", py, "31", "0.0");
      }
    };

    // 4.1 Render Nodes
    let minGraphX = Infinity;
    let minGraphY = Infinity;
    let maxGraphX = -Infinity;
    let maxGraphY = -Infinity;

    for (const node of viewIR.nodes) {
      const pos = positions?.get(node.id) || {
        x: 60,
        y: 60,
        width: 180,
        height: 80,
      };

      minGraphX = Math.min(minGraphX, pos.x);
      minGraphY = Math.min(minGraphY, pos.y);
      maxGraphX = Math.max(maxGraphX, pos.x + pos.width);
      maxGraphY = Math.max(maxGraphY, pos.y + pos.height);

      const layer = node.layer || "L2_STRUCTURE";

      // Node boundary
      emitBox(pos.x, pos.y, pos.width, pos.height, layer);

      // Header divider line (at 28px)
      emitLine(pos.x, pos.y + 26, pos.x + pos.width, pos.y + 26, layer);

      // Stereotype and label text
      const stText = `«${node.stereotype || node.kind}»`;
      emitText(stText, pos.x + 8, pos.y + 10, 8, layer);
      emitText(node.name, pos.x + 8, pos.y + 22, 11, layer);

      // Compartments text
      let compY = pos.y + 38;
      for (const comp of node.compartments || []) {
        for (const item of comp.items.slice(0, 4)) {
          emitText(item.text, pos.x + 10, compY, 8, layer);
          compY += 12;
        }
      }

      // EPLAN Ports with pin stubs & labels
      for (const port of node.ports || []) {
        const side = port.sideHint || "W";
        let pinStartX = pos.x;
        let pinStartY = pos.y + pos.height / 2;
        let pinEndX = pinStartX;
        let pinEndY = pinStartY;

        if (side === "W") {
          pinStartX = pos.x;
          pinEndX = pos.x - 12;
        } else if (side === "E") {
          pinStartX = pos.x + pos.width;
          pinEndX = pos.x + pos.width + 12;
        } else if (side === "N") {
          pinStartY = pos.y;
          pinEndY = pos.y - 12;
        } else if (side === "S") {
          pinStartY = pos.y + pos.height;
          pinEndY = pos.y + pos.height + 12;
        }

        emitLine(pinStartX, pinStartY, pinEndX, pinEndY, "L4_CONNECTIONS");
        emitText(port.name, pinEndX, pinEndY - 2, 7, "L4_CONNECTIONS");
      }
    }

    // 4.2 Render Edges (Orthogonal Polylines)
    for (const edge of viewIR.edges || []) {
      const srcNodePos = positions?.get(edge.sourceId) || { x: 60, y: 60, width: 180, height: 80 };
      const tgtNodePos = positions?.get(edge.targetId) || { x: 300, y: 60, width: 180, height: 80 };

      const sx = srcNodePos.x + srcNodePos.width;
      const sy = srcNodePos.y + srcNodePos.height / 2;
      const tx = tgtNodePos.x;
      const ty = tgtNodePos.y + tgtNodePos.height / 2;
      const midX = (sx + tx) / 2;

      const layer = edge.layer || "L4_CONNECTIONS";

      // 3-segment orthogonal line
      emit("0", "LWPOLYLINE", "5", nextHandle(), "100", "AcDbEntity", "8", layer);
      emit("100", "AcDbPolyline", "90", "4", "70", "0"); // open polyline
      const [p1x, p1y] = toCAD(sx, sy);
      const [p2x, p2y] = toCAD(midX, sy);
      const [p3x, p3y] = toCAD(midX, ty);
      const [p4x, p4y] = toCAD(tx, ty);
      emit("10", p1x, "20", p1y);
      emit("10", p2x, "20", p2y);
      emit("10", p3x, "20", p3y);
      emit("10", p4x, "20", p4y);

      // Edge label
      if (edge.label) {
        emitText(edge.label, midX + 4, (sy + ty) / 2, 8, layer);
      }
    }

    // 4.3 Render ISO Sheet Frame & Title Block (if requested)
    if (includeFrame) {
      if (!isFinite(minGraphX)) {
        minGraphX = 50;
        minGraphY = 50;
        maxGraphX = 750;
        maxGraphY = 550;
      }

      const frameMargin = 40;
      const fx = Math.min(0, minGraphX - frameMargin);
      const fy = Math.min(0, minGraphY - frameMargin);
      const fw = Math.max(800, maxGraphX - fx + frameMargin);
      const fh = Math.max(600, maxGraphY - fy + frameMargin);

      // Outer border
      emitBox(fx, fy, fw, fh, "L0_FRAME");
      // Inner margin border
      emitBox(fx + 10, fy + 10, fw - 20, fh - 20, "L0_FRAME");

      // Zone ticks A-F along left and right
      const zoneLetters = ["A", "B", "C", "D", "E", "F"];
      const zoneH = (fh - 20) / zoneLetters.length;
      for (let i = 0; i < zoneLetters.length; i++) {
        emitText(zoneLetters[i], fx + 3, fy + 10 + i * zoneH + zoneH / 2, 8, "L0_FRAME");
        emitText(zoneLetters[i], fx + fw - 8, fy + 10 + i * zoneH + zoneH / 2, 8, "L0_FRAME");
      }

      // Zone ticks 1-8 along top and bottom
      const zoneW = (fw - 20) / 8;
      for (let i = 1; i <= 8; i++) {
        emitText(String(i), fx + 10 + (i - 1) * zoneW + zoneW / 2, fy + 7, 8, "L0_FRAME");
        emitText(String(i), fx + 10 + (i - 1) * zoneW + zoneW / 2, fy + fh - 3, 8, "L0_FRAME");
      }

      // Title Block in bottom-right corner
      const tbW = 240;
      const tbH = 60;
      const tbx = fx + fw - 10 - tbW;
      const tby = fy + fh - 10 - tbH;

      emitBox(tbx, tby, tbW, tbH, "L0_FRAME");
      emitLine(tbx, tby + 20, tbx + tbW, tby + 20, "L0_FRAME");
      emitLine(tbx, tby + 40, tbx + tbW, tby + 40, "L0_FRAME");

      emitText(`${viewIR.rootPackageName} - ${viewIR.viewType.toUpperCase()}`, tbx + 8, tby + 14, 10, "L0_FRAME");
      emitText(`NODES: ${viewIR.summary.displayedNodes}   EDGES: ${viewIR.summary.displayedEdges}`, tbx + 8, tby + 34, 8, "L0_FRAME");
      emitText(`SHA: ${viewIR.sourceSha256.slice(0, 10)}...   CAD R2000`, tbx + 8, tby + 52, 7, "L0_FRAME");
    }

    emit("0", "ENDSEC");
    emit("0", "EOF");

    return lines.join("\n") + "\n";
  }
}
