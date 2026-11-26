import type { SysMLViewIR, NodeLayoutPosition } from "../types";
import { JsonExporter } from "./json_exporter";

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

    const padding = 36;
    const contentW = maxX - minX;
    const contentH = maxY - minY;

    const totalWidth = Math.max(400, contentW + padding * 2);
    const totalHeight = Math.max(300, contentH + padding * 2);

    const shiftX = -minX + padding;
    const shiftY = -minY + padding;

    // 2. Reset viewport transform to clean translate
    const viewport = clone.querySelector(".x6-graph-svg-viewport") || clone.querySelector("g");
    if (viewport) {
      viewport.setAttribute("transform", `translate(${shiftX}, ${shiftY})`);
    }

    // Set SVG root attributes
    clone.setAttribute("width", String(Math.round(totalWidth)));
    clone.setAttribute("height", String(Math.round(totalHeight)));
    clone.setAttribute("viewBox", `0 0 ${Math.round(totalWidth)} ${Math.round(totalHeight)}`);

    // 3. Embed metadata snapshot for lossless round-trip recovery
    if (options.includeMetadata !== false && typeof document !== "undefined") {
      const metadata = document.createElementNS("http://www.w3.org/2000/svg", "metadata");
      metadata.setAttribute("id", "sysml-workbench-metadata");

      const positionsObj: Record<string, NodeLayoutPosition> = {};
      if (options.nodePositions) {
        for (const [id, pos] of options.nodePositions.entries()) {
          positionsObj[id] = { ...pos };
        }
      }

      const jsonStr = JsonExporter.exportProject(
        viewIR,
        options.sysmlSource || "",
        {
          activeTheme: options.theme || "cad-blueprint",
          sidecarPositions: options.sidecarPositions || positionsObj,
        },
      );

      const cdata = document.createCDATASection(jsonStr);
      metadata.appendChild(cdata);
      clone.insertBefore(metadata, clone.firstChild);
    }

    return clone.outerHTML;
  }
}
