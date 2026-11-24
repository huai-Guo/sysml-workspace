import type { WorkbenchProjectData } from "../exporters/json_exporter";
import { DrawioParser, type DrawioParseResult } from "./drawio_parser";

export type ImportResult =
  | { kind: "sysml"; source: string }
  | { kind: "workbench"; project: WorkbenchProjectData }
  | { kind: "drawio"; result: DrawioParseResult }
  | { kind: "unknown"; error: string };

export class CanvasImporter {
  public static async importFile(file: File): Promise<ImportResult> {
    const text = await file.text();
    return CanvasImporter.importContent(file.name, text);
  }

  public static importContent(filename: string, content: string): ImportResult {
    const lowerName = filename.toLowerCase();

    // 1. SysML / KerML code
    if (lowerName.endsWith(".sysml") || lowerName.endsWith(".kerml")) {
      return { kind: "sysml", source: content };
    }

    // 2. SysML Workbench Project JSON
    if (lowerName.endsWith(".json")) {
      try {
        const parsed = JSON.parse(content);
        if (parsed.schemaVersion === "2.0" && typeof parsed.sysmlSource === "string") {
          return { kind: "workbench", project: parsed as WorkbenchProjectData };
        }
      } catch (err: any) {
        return { kind: "unknown", error: `JSON 解析失败: ${err.message}` };
      }
    }

    // 3. Draw.io / XML
    if (
      lowerName.endsWith(".drawio") ||
      lowerName.endsWith(".xml") ||
      content.includes("<mxfile") ||
      content.includes("<mxGraphModel")
    ) {
      try {
        const drawioResult = DrawioParser.parse(content);
        return { kind: "drawio", result: drawioResult };
      } catch (err: any) {
        return { kind: "unknown", error: `Draw.io 解析失败: ${err.message}` };
      }
    }

    // 4. SVG with embedded metadata snapshot
    if (lowerName.endsWith(".svg") || content.includes("<svg")) {
      try {
        // Universal match for <metadata id="sysml-workbench-data"> ... <script type="application/json"> ... </script>
        const metaMatch = content.match(
          /<metadata[^>]*id=["']sysml-workbench-data["'][^>]*>[\s\S]*?<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>[\s\S]*?<\/metadata>/i,
        );
        if (metaMatch && metaMatch[1]) {
          const parsed = JSON.parse(metaMatch[1]);
          if (parsed.schemaVersion === "2.0" && typeof parsed.sysmlSource === "string") {
            return { kind: "workbench", project: parsed as WorkbenchProjectData };
          }
        }
      } catch (err: any) {
        // Fall through
      }
      return { kind: "unknown", error: "SVG 文件中未找到可恢复的 SysML 工程元数据快照" };
    }

    // Default fallback: If it starts with package or part def, treat as SysML source
    if (content.includes("package ") || content.includes("part def ") || content.includes("part ")) {
      return { kind: "sysml", source: content };
    }

    return { kind: "unknown", error: `不支持的文件格式: ${filename}` };
  }
}
