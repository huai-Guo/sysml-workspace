import type { SysMLViewIR, NodeLayoutPosition } from "../types";
import { JsonExporter, type WorkbenchProjectData } from "./json_exporter";

export interface SvgExportOptions {
  includeMetadata?: boolean;
  sysmlSource?: string;
  theme?: string;
  sidecarPositions?: Record<string, NodeLayoutPosition>;
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

    // Embed workbench metadata snapshot if requested
    if (options.includeMetadata !== false) {
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

    const serializer = new XMLSerializer();
    return serializer.serializeToString(clone);
  }
}
