import type { Graph, Node, Edge } from "@antv/x6/es";
import type { SysMLViewNode } from "./types";
import {
  compileHierarchicalElement,
  GRAMMAR_SPECS,
  normalizeCreatableKind,
  type CompileElementRequest,
} from "./sysml_grammar";

const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SemanticEditorOptions {
  getSource: () => string;
  applySource: (newSource: string, skipConfirm?: boolean) => void;
  showNotice?: (message: string) => void;
  isExpandedCompound?: (nodeId: string) => boolean;
  onOptimisticInsert?: (
    req: CompileElementRequest,
    position?: { x: number; y: number },
  ) => void;
  onOptimisticRename?: (nodeId: string, oldName: string, newName: string) => void;
  onOptimisticDelete?: (cellIds: string[]) => void;
}

export class SemanticEditor {
  private graph?: Graph;
  private getSource: () => string;
  private applySource: (newSource: string, skipConfirm?: boolean) => void;
  private showNotice?: (message: string) => void;
  private isExpandedCompound?: (nodeId: string) => boolean;
  private onOptimisticInsert?: (
    req: CompileElementRequest,
    position?: { x: number; y: number },
  ) => void;
  private onOptimisticRename?: (nodeId: string, oldName: string, newName: string) => void;
  private onOptimisticDelete?: (cellIds: string[]) => void;
  private connectionCounter = 0;
  private inlineEditorEl?: HTMLInputElement;

  constructor(options: SemanticEditorOptions) {
    this.getSource = options.getSource;
    this.applySource = options.applySource;
    this.showNotice = options.showNotice;
    this.isExpandedCompound = options.isExpandedCompound;
    this.onOptimisticInsert = options.onOptimisticInsert;
    this.onOptimisticRename = options.onOptimisticRename;
    this.onOptimisticDelete = options.onOptimisticDelete;
  }

  public attachGraph(graph: Graph): void {
    this.graph = graph;

    // 1. Edge connected event (Magnetic port-to-port wiring)
    graph.on("edge:connected", ({ isNew, edge }) => {
      if (!isNew) return;
      this.handleEdgeConnected(edge);
    });

    // 2. Node double click for inline rename (suppressed on expanded compound containers)
    graph.on("node:dblclick", ({ node, e }) => {
      e.stopPropagation();
      if (this.isExpandedCompound?.(node.id)) {
        return;
      }
      this.startInlineRename(node);
    });
  }

  // --- Reverse Compilation Logic ---

  /**
   * Compiles an element insertion into SysML v2 source text following strict containment grammar.
   */
  public compileElement(
    source: string,
    kind: string,
    name: string,
    ownerName?: string,
    extra?: {
      typeName?: string;
      direction?: "in" | "out" | "inout" | "";
      conjugated?: boolean;
    },
  ): string {
    return compileHierarchicalElement(source, {
      kind: normalizeCreatableKind(kind),
      name,
      parentQualifiedName: ownerName,
      typeName: extra?.typeName,
      direction: extra?.direction,
      conjugated: extra?.conjugated,
    });
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

    let stmt = "";
    if (relType === "transition") {
      stmt = `transition ${connName} first ${srcStr} then ${tgtStr};`;
    } else if (relType === "satisfy") {
      stmt = `satisfy ${tgtStr} by ${srcStr};`;
    } else {
      stmt = `connection ${connName} connect ${srcStr} to ${tgtStr};`;
    }

    if (ownerName) {
      const targetOwner = ownerName.includes("::") ? ownerName.split("::").pop()! : ownerName;
      const ownerRegex = new RegExp(
        `([ \\t]*)(?:part\\s+def|part|package|state\\s+def|state)\\s+${targetOwner}\\b[^{;]*\\{`,
        "m",
      );
      const match = ownerRegex.exec(source);
      if (match) {
        const childIndent = `${match[1]}    `;
        const insertIndex = match.index + match[0].length;
        return (
          source.slice(0, insertIndex) +
          `\n${childIndent}${stmt}` +
          source.slice(insertIndex)
        );
      }
    }

    const lastBrace = source.lastIndexOf("}");
    if (lastBrace !== -1) {
      return (
        source.slice(0, lastBrace) +
        `    ${stmt}\n` +
        source.slice(lastBrace)
      );
    }

    return `${source}\n${stmt}\n`;
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

    const connRegex = new RegExp(
      `^[ \\t]*(?:connection|transition|satisfy)\\s+[^;]*\\b${elementName}\\b[^;]*;\\r?\\n?`,
      "gm",
    );
    let cleaned = source.replace(connRegex, (matched) => {
      reasons.push(`已自动清理引用 '${elementName}' 的连线: ${matched.trim()}`);
      return "";
    });

    const blockStartRegex = new RegExp(
      `^[ \\t]*(?:package|part\\s+def|part|port\\s+def|item\\s+def|port|attribute|item|state\\s+def|state|action\\s+def|action|requirement\\s+def|requirement)\\s+${elementName}\\b[^{;]*\\{`,
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
        `^[ \\t]*(?:(?:in|out|inout)\\s+)?(?:part\\s+def|part|port\\s+def|item\\s+def|port|attribute|item|state\\s+def|state|action\\s+def|action|requirement\\s+def|requirement)\\s+${elementName}\\b[^;]*;\\r?\\n?`,
        "m",
      );
      if (lineRegex.test(cleaned)) {
        cleaned = cleaned.replace(lineRegex, "");
        found = true;
      }
    }

    if (!found) {
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

    const curSource = this.getSource();
    do {
      this.connectionCounter++;
    } while (new RegExp(`\\bc_${this.connectionCounter}\\b`).test(curSource));
    const connName = `c_${this.connectionCounter}`;

    const resolvePath = (cell: any, portId?: string): string[] => {
      const data = cell.getData() as { viewNode?: SysMLViewNode } | undefined;
      const vn = data?.viewNode;
      const nodeName = vn?.name || cell.id;

      if (portId) {
        const vnPort = vn?.ports?.find((p) => p.id === portId);
        if (vnPort && vnPort.name) {
          return [nodeName, vnPort.name];
        }
        const ports = cell.getPorts ? cell.getPorts() : [];
        const portItem = ports.find((p: any) => p.id === portId);
        const portName = portItem?.attrs?.portLabel?.text || portId;
        return [nodeName, portName];
      }
      return [nodeName];
    };

    const srcPath = resolvePath(sourceCell, sourcePortId);
    const tgtPath = resolvePath(targetCell, targetPortId);

    const srcVn = (sourceCell.getData() as { viewNode?: SysMLViewNode } | undefined)?.viewNode;
    const tgtVn = (targetCell.getData() as { viewNode?: SysMLViewNode } | undefined)?.viewNode;

    // Emit connection inside common parent block (e.g. `vehicle`) so nested child references resolve cleanly!
    let commonOwner: string | undefined;
    if (srcVn?.parentId && srcVn.parentId === tgtVn?.parentId && this.graph) {
      const parentCell = this.graph.getCellById(srcVn.parentId);
      const parentVn = (parentCell?.getData() as { viewNode?: SysMLViewNode } | undefined)?.viewNode;
      commonOwner = parentVn?.qualifiedName || parentVn?.name;
    }

    const relType: "connection" | "transition" | "satisfy" =
      srcVn?.shapeCategory === "state" && tgtVn?.shapeCategory === "state"
        ? "transition"
        : tgtVn?.shapeCategory === "requirement"
          ? "satisfy"
          : "connection";

    try {
      const newSource = this.compileConnection(
        curSource,
        connName,
        srcPath,
        tgtPath,
        relType,
        commonOwner,
      );
      edge.setData({ ...(edge.getData() || {}), connName });
      this.showNotice?.(`已生成连线: ${connName} (${srcPath.join(".")} → ${tgtPath.join(".")})`);
      this.applySource(newSource, true);
    } catch (err: any) {
      edge.remove();
      this.showNotice?.(`连线语法生成失败: ${err.message}`);
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
    input.style.left = `${clientPos.x - containerRect.left + 8}px`;
    input.style.top = `${clientPos.y - containerRect.top + 8}px`;
    input.style.width = `${Math.max(100, size.width - 24)}px`;

    let committed = false;
    const commitRename = () => {
      if (committed) return;
      committed = true;
      const newName = input.value.trim();
      input.remove();
      this.inlineEditorEl = undefined;

      if (!newName || newName === oldName) return;

      try {
        const curSource = this.getSource();
        const updatedSource = this.compileRename(curSource, oldName, newName);
        this.onOptimisticRename?.(node.id, oldName, newName);
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
        committed = true;
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
    const deletedIds: string[] = [];

    for (const cell of selectedCells) {
      if (cell.isNode()) {
        const data = cell.getData() as { viewNode?: SysMLViewNode } | undefined;
        const name = data?.viewNode?.name || cell.id;
        const result = this.compileDelete(curSource, name);
        if (result.safe) {
          curSource = result.newSource;
          deletedIds.push(cell.id);
        }
      } else if (cell.isEdge()) {
        const edgeData = cell.getData() as { connName?: string } | undefined;
        const edgeId = edgeData?.connName || cell.id;
        const connRegex = new RegExp(`^[ \\t]*(?:connection|transition)\\s+${edgeId}\\b[^;]*;\\r?\\n?`, "gm");
        curSource = curSource.replace(connRegex, "");
        deletedIds.push(cell.id);
      }
    }

    if (deletedIds.length > 0) {
      this.onOptimisticDelete?.(deletedIds);
      this.showNotice?.(`已移除 ${deletedIds.length} 个选中图元（后台正在校验同步）`);
      this.applySource(curSource, true);
    }
  }

  public handleInsertElement(
    kindOrReq: string | CompileElementRequest,
    name?: string,
    ownerId?: string,
    position?: { x: number; y: number },
  ): void {
    const req: CompileElementRequest =
      typeof kindOrReq === "string"
        ? {
            kind: normalizeCreatableKind(kindOrReq),
            name: name || "element_1",
            parentQualifiedName: ownerId,
          }
        : kindOrReq;

    const curSource = this.getSource();
    try {
      const newSource = compileHierarchicalElement(curSource, req);
      this.onOptimisticInsert?.(req, position);
      const spec = GRAMMAR_SPECS[normalizeCreatableKind(req.kind)];
      const ownerLabel =
        req.parentQualifiedName && req.parentQualifiedName !== "__root__"
          ? `（位于 ${req.parentQualifiedName}）`
          : "";
      this.showNotice?.(`已新建 ${spec.shortLabel} ${req.name}${ownerLabel}`);
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
