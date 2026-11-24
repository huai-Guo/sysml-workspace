import type { SysMLViewIR, NodeLayoutPosition } from "../types";
import { JsonExporter, type WorkbenchProjectData } from "./json_exporter";

export interface SvgExportOptions {
  includeMetadata?: boolean;
  includeFrame?: boolean;
  sysmlSource?: string;
  theme?: string;
  sidecarPositions?: Record<string, NodeLayoutPosition>;
  nodePositions?: Map<string, { x: number; y: number; width: number; height: number }>;
}

export class SvgExporter {
  public static export(
    svgElement: SVGElement,
    viewIR: SysMLViewIR,
    options: SvgExportOptions = {},
  ): string {
    const clone = svgElement.cloneNode(true) as SVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

    // 1. Calculate bounding box of all nodes
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    if (options.nodePositions && options.nodePositions.size > 0) {
      for (const pos of options.nodePositions.values()) {
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + pos.width);
        maxY = Math.max(maxY, pos.y + pos.height);
      }
    } else {
      for (const node of viewIR.nodes) {
        minX = Math.min(minX, 60);
        minY = Math.min(minY, 60);
        maxX = Math.max(maxX, 240);
        maxY = Math.max(maxY, 140);
      }
    }

    if (!isFinite(minX)) {
      minX = 50;
      minY = 50;
      maxX = 750;
      maxY = 550;
    }

    const includeFrame = options.includeFrame ?? false;
    const padding = includeFrame ? 60 : 36;
    const contentW = maxX - minX;
    const contentH = maxY - minY;

    const totalWidth = includeFrame
      ? Math.max(1000, contentW + padding * 2 + 60)
      : Math.max(400, contentW + padding * 2);
    const totalHeight = includeFrame
      ? Math.max(700, contentH + padding * 2 + 80)
      : Math.max(300, contentH + padding * 2);

    const shiftX = -minX + padding + (includeFrame ? 20 : 0);
    const shiftY = -minY + padding + (includeFrame ? 20 : 0);

    // 2. Reset viewport transform to clean translate
    const viewport = clone.querySelector(".x6-graph-svg-viewport") || clone.querySelector("g");
    if (viewport) {
      viewport.setAttribute("transform", `translate(${shiftX}, ${shiftY})`);
    }

    // Set SVG root attributes
    clone.setAttribute("width", String(Math.round(totalWidth)));
    clone.setAttribute("height", String(Math.round(totalHeight)));
    clone.setAttribute("viewBox", `0 0 ${Math.round(totalWidth)} ${Math.round(totalHeight)}`);

    // 3. Render vector ISO sheet frame & title block if requested
    if (includeFrame && typeof document !== "undefined") {
      const frameG = document.createElementNS("http://www.w3.org/2000/svg", "g");
      frameG.setAttribute("class", "iso-sheet-frame-vector");

      const w = totalWidth;
      const h = totalHeight;

      // Outer border
      const outerRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      outerRect.setAttribute("x", "6");
      outerRect.setAttribute("y", "6");
      outerRect.setAttribute("width", String(w - 12));
      outerRect.setAttribute("height", String(h - 12));
      outerRect.setAttribute("fill", "none");
      outerRect.setAttribute("stroke", "#334155");
      outerRect.setAttribute("stroke-width", "2");
      frameG.appendChild(outerRect);

      // Inner margin border
      const innerRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      innerRect.setAttribute("x", "20");
      innerRect.setAttribute("y", "20");
      innerRect.setAttribute("width", String(w - 40));
      innerRect.setAttribute("height", String(h - 40));
      innerRect.setAttribute("fill", "none");
      innerRect.setAttribute("stroke", "#334155");
      innerRect.setAttribute("stroke-width", "1");
      frameG.appendChild(innerRect);

      // Top & Bottom Zones (1 through 8)
      const zoneW = (w - 40) / 8;
      for (let i = 1; i <= 8; i++) {
        const zx = 20 + (i - 0.5) * zoneW;

        const tTop = document.createElementNS("http://www.w3.org/2000/svg", "text");
        tTop.setAttribute("x", String(zx));
        tTop.setAttribute("y", "15");
        tTop.setAttribute("text-anchor", "middle");
        tTop.setAttribute("font-size", "9");
        tTop.setAttribute("fill", "#64748b");
        tTop.textContent = String(i);
        frameG.appendChild(tTop);

        const tBot = document.createElementNS("http://www.w3.org/2000/svg", "text");
        tBot.setAttribute("x", String(zx));
        tBot.setAttribute("y", String(h - 8));
        tBot.setAttribute("text-anchor", "middle");
        tBot.setAttribute("font-size", "9");
        tBot.setAttribute("fill", "#64748b");
        tBot.textContent = String(i);
        frameG.appendChild(tBot);
      }

      // Left & Right Zones (A through F)
      const zoneLetters = ["A", "B", "C", "D", "E", "F"];
      const zoneH = (h - 40) / zoneLetters.length;
      for (let i = 0; i < zoneLetters.length; i++) {
        const zy = 20 + (i + 0.5) * zoneH + 3;

        const tLeft = document.createElementNS("http://www.w3.org/2000/svg", "text");
        tLeft.setAttribute("x", "13");
        tLeft.setAttribute("y", String(zy));
        tLeft.setAttribute("text-anchor", "middle");
        tLeft.setAttribute("font-size", "9");
        tLeft.setAttribute("fill", "#64748b");
        tLeft.textContent = zoneLetters[i];
        frameG.appendChild(tLeft);

        const tRight = document.createElementNS("http://www.w3.org/2000/svg", "text");
        tRight.setAttribute("x", String(w - 7));
        tRight.setAttribute("y", String(zy));
        tRight.setAttribute("text-anchor", "middle");
        tRight.setAttribute("font-size", "9");
        tRight.setAttribute("fill", "#64748b");
        tRight.textContent = zoneLetters[i];
        frameG.appendChild(tRight);
      }

      // Parameterized Title Block in Bottom-Right
      const tbW = 260;
      const tbH = 70;
      const tbx = w - 20 - tbW;
      const tby = h - 20 - tbH;

      const tbBox = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      tbBox.setAttribute("x", String(tbx));
      tbBox.setAttribute("y", String(tby));
      tbBox.setAttribute("width", String(tbW));
      tbBox.setAttribute("height", String(tbH));
      tbBox.setAttribute("fill", "#0d1219");
      tbBox.setAttribute("stroke", "#334155");
      tbBox.setAttribute("stroke-width", "1");
      frameG.appendChild(tbBox);

      // Title line
      const tbLine1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tbLine1.setAttribute("x1", String(tbx));
      tbLine1.setAttribute("y1", String(tby + 26));
      tbLine1.setAttribute("x2", String(tbx + tbW));
      tbLine1.setAttribute("y2", String(tby + 26));
      tbLine1.setAttribute("stroke", "#334155");
      tbLine1.setAttribute("stroke-width", "1");
      frameG.appendChild(tbLine1);

      // Detail line
      const tbLine2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tbLine2.setAttribute("x1", String(tbx));
      tbLine2.setAttribute("y1", String(tby + 48));
      tbLine2.setAttribute("x2", String(tbx + tbW));
      tbLine2.setAttribute("y2", String(tby + 48));
      tbLine2.setAttribute("stroke", "#334155");
      tbLine2.setAttribute("stroke-width", "1");
      frameG.appendChild(tbLine2);

      // Title Text
      const tTitle = document.createElementNS("http://www.w3.org/2000/svg", "text");
      tTitle.setAttribute("x", String(tbx + 8));
      tTitle.setAttribute("y", String(tby + 17));
      tTitle.setAttribute("font-size", "11");
      tTitle.setAttribute("font-weight", "bold");
      tTitle.setAttribute("fill", "#f8fafc");
      tTitle.textContent = `${viewIR.rootPackageName} · ${viewIR.viewType.toUpperCase()}`;
      frameG.appendChild(tTitle);

      // Nodes & Edges count
      const tStats = document.createElementNS("http://www.w3.org/2000/svg", "text");
      tStats.setAttribute("x", String(tbx + 8));
      tStats.setAttribute("y", String(tby + 39));
      tStats.setAttribute("font-size", "9");
      tStats.setAttribute("fill", "#94a3b8");
      tStats.textContent = `NODES: ${viewIR.summary.displayedNodes}    EDGES: ${viewIR.summary.displayedEdges}`;
      frameG.appendChild(tStats);

      // SHA & Date
      const tSha = document.createElementNS("http://www.w3.org/2000/svg", "text");
      tSha.setAttribute("x", String(tbx + 8));
      tSha.setAttribute("y", String(tby + 61));
      tSha.setAttribute("font-size", "8");
      tSha.setAttribute("fill", "#64748b");
      const shaShort = viewIR.sourceSha256 ? viewIR.sourceSha256.slice(0, 10) : "";
      tSha.textContent = `SHA: ${shaShort}…    ${new Date().toISOString().slice(0, 10)}`;
      frameG.appendChild(tSha);

      clone.appendChild(frameG);
    }

    // Embed workbench metadata snapshot if requested
    if (options.includeMetadata !== false && typeof document !== "undefined") {
      const projectJson = JsonExporter.exportProject(viewIR, options.sysmlSource || "", {
        activeTheme: options.theme,
        sidecarPositions: options.sidecarPositions,
      });

      const metadata = document.createElementNS("http://www.w3.org/2000/svg", "metadata");
      metadata.setAttribute("id", "sysml-workbench-data");

      const script = document.createElement("script");
      script.setAttribute("type", "application/json");
      script.textContent = projectJson;
      metadata.appendChild(script);

      clone.insertBefore(metadata, clone.firstChild);
    }

    // Embed inline standard font style
    if (typeof document !== "undefined") {
      const defs = clone.querySelector("defs") || document.createElementNS("http://www.w3.org/2000/svg", "defs");
      const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
      styleEl.textContent = `
        text { font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace; }
        .x6-node text { user-select: none; }
      `;
      defs.appendChild(styleEl);
      if (!clone.contains(defs)) {
        clone.insertBefore(defs, clone.firstChild);
      }
    }

    if (typeof XMLSerializer !== "undefined") {
      const serializer = new XMLSerializer();
      return serializer.serializeToString(clone);
    }

    return (clone as any).outerHTML || "";
  }
}
