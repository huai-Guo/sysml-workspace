import type { Graph, Node, Edge } from "@antv/x6/es";
import type { SysMLViewNode } from "./types";

const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SemanticEditorOptions {
  getSource: () => string;
  applySource: (newSource: string, skipConfirm?: boolean) => void;
  showNotice?: (message: string) => void;
}

export class SemanticEditor {
  private graph?: Graph;
  private getSource: () => string;
  private applySource: (newSource: string, skipConfirm?: boolean) => void;
  private showNotice?: (message: string) => void;
  private connectionCounter = 0;
  private inlineEditorEl?: HTMLInputElement;

  constructor(options: SemanticEditorOptions) {
    this.getSource = options.getSource;
    this.applySource = options.applySource;
    this.showNotice = options.showNotice;
  }

  public attachGraph(graph: Graph): void {
    this.graph = graph;

    // 1. Edge connected event (Magnetic port-to-port wiring)
    graph.on("edge:connected", ({ isNew, edge }) => {
      if (!isNew) return;
      this.handleEdgeConnected(edge);
    });

    // 2. Node double click for inline rename
    graph.on("node:dblclick", ({ node, e }) => {
      e.stopPropagation();
      this.startInlineRename(node);
    });
  }

  // --- Reverse Compilation Logic ---

  /**
   * Compiles an element insertion into SysML v2 source text.
   */
  public compileElement(
    source: string,
    kind: string,
    name: string,
    ownerName?: string,
  ): string {
    if (!IDENTIFIER_REGEX.test(name)) {
      throw new Error(`'${name}' 不是合法的 SysML 标识符（须以字母/下划线开头）`);
    }

    const k = kind.toLowerCase();
    let snippet = "";
    if (k === "package") {
      snippet = `package ${name} {\n}\n`;
    } else if (k === "part_def") {
      snippet = `    part def ${name} {\n    }\n`;
    } else if (k === "part") {
      snippet = `        part ${name};\n`;
    } else if (k === "port") {
      snippet = `        port ${name};\n`;
    } else if (k === "state") {
      snippet = `        state ${name};\n`;
    } else if (k === "action") {
      snippet = `        action ${name};\n`;
    } else if (k === "requirement") {
      snippet = `    requirement ${name} {\n        doc /* ${name} 需求规格说明 */\n    }\n`;
    } else {
      snippet = `        ${k} ${name};\n`;
    }

    // If an owner name is specified, insert inside the owner block
    if (ownerName) {
      const targetOwner = ownerName.includes("::") ? ownerName.split("::").pop()! : ownerName;
      const ownerRegex = new RegExp(
        `(?:part\\s+def|part|package|state|requirement)\\s+${targetOwner}\\b[^{]*\\{`,
        "m",
      );
      const match = ownerRegex.exec(source);
      if (match) {
        const insertIndex = match.index + match[0].length;
        return (
          source.slice(0, insertIndex) +
          "\n" +
          snippet +
          source.slice(insertIndex)
        );
      }
    }

    // Default: Insert before the last closing brace '}' if present, or at the end
    const lastBrace = source.lastIndexOf("}");
    if (lastBrace !== -1) {
      return (
        source.slice(0, lastBrace) +
        snippet +
        source.slice(lastBrace)
      );
    }

    return source + "\n" + snippet;
  }

  /**
   * Compiles a connection between ports or nodes into SysML v2 source text.
   */
  public compileConnection(
    source: string,
    connName: string,
    sourcePath: string[],
    targetPath: string[],
    relType: "connection" | "transition" | "satisfy" = "connection",
    ownerName?: string,
  ): string {
    if (!IDENTIFIER_REGEX.test(connName)) {
      throw new Error(`'${connName}' 不是合法的连接标识符`);
    }

    const srcStr = sourcePath.join(".");
    const tgtStr = targetPath.join(".");

    let snippet = "";
    if (relType === "transition") {
      snippet = `        transition ${connName} first ${srcStr} then ${tgtStr};\n`;
    } else if (relType === "satisfy") {
      snippet = `        satisfy ${tgtStr} by ${srcStr};\n`;
    } else {
      snippet = `        connection ${connName} connect ${srcStr} to ${tgtStr};\n`;
    }

    if (ownerName) {
      const targetOwner = ownerName.includes("::") ? ownerName.split("::").pop()! : ownerName;
      const ownerRegex = new RegExp(
        `(?:part\\s+def|part|package)\\s+${targetOwner}\\b[^{]*\\{`,
        "m",
      );
      const match = ownerRegex.exec(source);
      if (match) {
        const insertIndex = match.index + match[0].length;
        return (
          source.slice(0, insertIndex) +
          "\n" +
          snippet +
          source.slice(insertIndex)
        );
      }
    }

    const lastBrace = source.lastIndexOf("}");
    if (lastBrace !== -1) {
      return (
        source.slice(0, lastBrace) +
        snippet +
        source.slice(lastBrace)
      );
    }

    return source + "\n" + snippet;
  }

  /**
   * Replaces an identifier across the source code.
   */
  public compileRename(source: string, oldName: string, newName: string): string {
    if (!IDENTIFIER_REGEX.test(newName)) {
      throw new Error(`'${newName}' 不是合法的 SysML 标识符`);
    }
    if (oldName === newName) return source;

    const regex = new RegExp(`\\b${oldName}\\b`, "g");
    return source.replace(regex, newName);
  }

  /**
   * Safely deletes an element and any referencing connections.
   */
  public compileDelete(
    source: string,
    elementName: string,
  ): { safe: boolean; newSource: string; reasons: string[] } {
    const reasons: string[] = [];

    // Remove referencing connections first to avoid syntax dangling
    const connRegex = new RegExp(
      `^[ \\t]*(?:connection|transition|satisfy)\\s+[^;]*\\b${elementName}\\b[^;]*;\\r?\\n?`,
      "gm",
    );
    let cleaned = source.replace(connRegex, (matched) => {
      reasons.push(`已自动清理引用 '${elementName}' 的连线: ${matched.trim()}`);
      return "";
    });

    // Remove element definition or block using brace depth counting
    const blockStartRegex = new RegExp(
      `^[ \\t]*(?:package|part\\s+def|part|port\\s+def|port|state|action|requirement)\\s+${elementName}\\b[^{;]*\\{`,
      "m",
    );
    const startMatch = blockStartRegex.exec(cleaned);
    let found = false;

    if (startMatch) {
      const startIndex = startMatch.index;
      const openBraceIndex = cleaned.indexOf("{", startIndex);
      if (openBraceIndex !== -1) {
        let depth = 1;
        let i = openBraceIndex + 1;
        while (i < cleaned.length && depth > 0) {
          const char = cleaned[i];
          if (char === "{") depth++;
          else if (char === "}") depth--;
          i++;
        }
        if (depth === 0) {
          if (cleaned[i] === "\r" && cleaned[i + 1] === "\n") i += 2;
          else if (cleaned[i] === "\n") i += 1;
          cleaned = cleaned.slice(0, startIndex) + cleaned.slice(i);
          found = true;
        }
      }
    }

    if (!found) {
      const lineRegex = new RegExp(
        `^[ \\t]*(?:part\\s+def|part|port\\s+def|port|state|action|requirement)\\s+${elementName}\\b[^;]*;\\r?\\n?`,
        "m",
      );
      if (lineRegex.test(cleaned)) {
        cleaned = cleaned.replace(lineRegex, "");
        found = true;
      }
    }

    if (!found) {
      // Fallback matching any line declaring elementName
      const fallback = new RegExp(`^[ \\t]*.*\\b${elementName}\\b.*;\\r?\\n?`, "m");
      if (fallback.test(cleaned)) {
        cleaned = cleaned.replace(fallback, "");
        found = true;
      }
    }

    return {
      safe: found,
      newSource: cleaned,
      reasons,
    };
  }

  // --- Interactive Handlers ---

  private handleEdgeConnected(edge: Edge): void {
    const sourceCell = edge.getSourceCell();
    const targetCell = edge.getTargetCell();
    const sourcePortId = edge.getSourcePortId();
    const targetPortId = edge.getTargetPortId();

    if (!sourceCell || !targetCell) return;

    this.connectionCounter++;
    const connName = `c_${this.connectionCounter}`;

    const resolvePath = (cell: any, portId?: string): string[] => {
      const data = cell.getData() as { viewNode?: SysMLViewNode } | undefined;
      const vn = data?.viewNode;
      const nodeName = vn?.name || cell.id;

      if (portId) {
        // Prefer pure short port.name from data.viewNode.ports matching portId
        const vnPort = vn?.ports?.find((p) => p.id === portId);
        if (vnPort && vnPort.name) {
          return [nodeName, vnPort.name];
        }
        // Fallback to port item attrs or portId
        const ports = cell.getPorts ? cell.getPorts() : [];
        const portItem = ports.find((p: any) => p.id === portId);
        const portName = portItem?.attrs?.portLabel?.text || portId;
        return [nodeName, portName];
      }
      return [nodeName];
    };

    const srcPath = resolvePath(sourceCell, sourcePortId);
    const tgtPath = resolvePath(targetCell, targetPortId);

    const curSource = this.getSource();
    try {
      const newSource = this.compileConnection(
        curSource,
        connName,
        srcPath,
        tgtPath,
        "connection",
      );
      this.showNotice?.(`已生成连接: ${connName} connect ${srcPath.join(".")} to ${tgtPath.join(".")}`);
      this.applySource(newSource, true);
    } catch (err: any) {
      this.showNotice?.(`连线反向编译失败: ${err.message}`);
    }
  }

  public startInlineRename(node: Node): void {
    const data = node.getData() as { viewNode?: SysMLViewNode } | undefined;
    const oldName = data?.viewNode?.name || node.id;

    const pos = node.getPosition();
    const size = node.getSize();
    if (!this.graph) return;

    const container = this.graph.container;
    const clientPos = this.graph.localToClient(pos.x, pos.y);
    const containerRect = container.getBoundingClientRect();

    const input = document.createElement("input");
    input.type = "text";
    input.value = oldName;
    input.className = "inline-rename-input";
    input.style.position = "absolute";
    input.style.left = `${clientPos.x - containerRect.left + 8}px`;
    input.style.top = `${clientPos.y - containerRect.top + 8}px`;
    input.style.width = `${Math.max(100, size.width - 24)}px`;
    input.style.height = "24px";
    input.style.backgroundColor = "var(--bg-editor, #0f172a)";
    input.style.border = "1.5px solid var(--accent-blue, #38bdf8)";
    input.style.borderRadius = "4px";
    input.style.color = "var(--text-primary, #f1f5f9)";
    input.style.fontSize = "12px";
    input.style.fontWeight = "600";
    input.style.padding = "2px 6px";
    input.style.zIndex = "100";
    input.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.5)";

    const commitRename = () => {
      const newName = input.value.trim();
      input.remove();
      this.inlineEditorEl = undefined;

      if (!newName || newName === oldName) return;

      try {
        const curSource = this.getSource();
        const updatedSource = this.compileRename(curSource, oldName, newName);
        this.showNotice?.(`已重命名: ${oldName} → ${newName}`);
        this.applySource(updatedSource, true);
      } catch (err: any) {
        this.showNotice?.(`重命名失败: ${err.message}`);
      }
    };

    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitRename();
      } else if (e.key === "Escape") {
        input.remove();
        this.inlineEditorEl = undefined;
      }
    };

    input.onblur = () => {
      commitRename();
    };

    container.appendChild(input);
    input.focus();
    input.select();
    this.inlineEditorEl = input;
  }

  public handleDeleteSelected(): void {
    if (!this.graph) return;
    const selectedCells = this.graph.getSelectedCells();
    if (selectedCells.length === 0) return;

    let curSource = this.getSource();
    let count = 0;

    for (const cell of selectedCells) {
      if (cell.isNode()) {
        const data = cell.getData() as { viewNode?: SysMLViewNode } | undefined;
        const name = data?.viewNode?.name || cell.id;
        const result = this.compileDelete(curSource, name);
        if (result.safe) {
          curSource = result.newSource;
          count++;
        }
      } else if (cell.isEdge()) {
        const edgeId = cell.id;
        const connRegex = new RegExp(`^[ \\t]*connection\\s+${edgeId}\\b[^;]*;\\r?\\n?`, "gm");
        curSource = curSource.replace(connRegex, "");
        count++;
      }
    }

    if (count > 0) {
      this.showNotice?.(`安全删除: 已从 SysML 源码中移除 ${count} 个选中图元及关联连线`);
      this.applySource(curSource, true);
    }
  }

  public handleInsertElement(
    kind: string,
    name: string,
    ownerId?: string,
  ): void {
    const curSource = this.getSource();
    try {
      const newSource = this.compileElement(curSource, kind, name, ownerId);
      this.showNotice?.(`已新建 ${kind} ${name}`);
      this.applySource(newSource, true);
    } catch (err: any) {
      this.showNotice?.(`新建图元失败: ${err.message}`);
    }
  }

  public dispose(): void {
    if (this.inlineEditorEl) {
      this.inlineEditorEl.remove();
    }
  }
}
