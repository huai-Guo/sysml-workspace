import { Graph, Node, Edge } from "@antv/x6/es";
import type {
  SysMLViewIR,
  SysMLViewNode,
  SysMLViewEdge,
  CanvasThemeId,
  ViewType,
  SourceLocation,
} from "./types";
import { resolveTheme, type ThemeStyles } from "./themes";
import { LayoutSidecar } from "./sidecar";
import { runElkLayout } from "./elk_layout";
import {
  registerSysMLShapes,
  SYSML_NODE_NAME,
  buildNodeAttrs,
  buildPortItems,
} from "./shapes";

export interface CanvasEngineOptions {
  theme?: CanvasThemeId;
  onSelect?: (loc?: SourceLocation) => void;
  sessionKey?: string;
}

export class SysMLCanvasEngine {
  private container: HTMLElement;
  private graph: Graph;
  private sidecar: LayoutSidecar;
  private currentViewIR?: SysMLViewIR;
  private allViews?: Record<string, SysMLViewIR>;
  private themeId: CanvasThemeId = "auto";
  private currentThemeStyles: ThemeStyles;
  private onSelect?: (loc?: SourceLocation) => void;
  private sheetFrameEl?: HTMLElement;

  constructor(container: HTMLElement, options: CanvasEngineOptions = {}) {
    this.container = container;
    this.themeId = options.theme || "auto";
    this.currentThemeStyles = resolveTheme(this.themeId);
    this.onSelect = options.onSelect;
    this.sidecar = new LayoutSidecar(options.sessionKey || "default");

    registerSysMLShapes();

    // Create mount element for Graph if not present
    let graphMount = container.querySelector<HTMLElement>(".x6-graph-mount");
    if (!graphMount) {
      graphMount = document.createElement("div");
      graphMount.className = "x6-graph-mount";
      graphMount.style.width = "100%";
      graphMount.style.height = "100%";
      graphMount.style.position = "relative";
      container.appendChild(graphMount);
    }

    this.graph = new Graph({
      container: graphMount,
      autoResize: true,
      panning: {
        enabled: true,
        eventTypes: ["leftMouseDown", "mouseWheel"],
      },
      mousewheel: {
        enabled: true,
        zoomAtMousePosition: true,
        minScale: 0.1,
        maxScale: 3.5,
      },
      grid: {
        visible: true,
        type: "dot",
        size: 10,
        args: {
          color: this.currentThemeStyles.gridColor,
          thickness: 1,
        },
      },
      connecting: {
        router: {
          name: "manhattan",
          args: {
            padding: 12,
            step: 10,
          },
        },
        connector: {
          name: "jumpover",
          args: {
            type: "arc",
            size: 6,
          },
        },
        anchor: "center",
        connectionPoint: "boundary",
        allowBlank: false,
        allowLoop: false,
        allowMulti: true,
        highlight: true,
      },
      interacting: {
        nodeMovable: true,
        edgeMovable: false,
        edgeLabelMovable: true,
      },
    });

    this.applyThemeStyles();
    this.bindEvents();
  }

  private bindEvents(): void {
    // Save manual node movement to LayoutSidecar
    this.graph.on("node:moved", ({ node }) => {
      const pos = node.getPosition();
      const size = node.getSize();
      this.sidecar.set(node.id, {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        userMoved: true,
      });
    });

    this.graph.on("node:resized", ({ node }) => {
      const pos = node.getPosition();
      const size = node.getSize();
      this.sidecar.set(node.id, {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        userMoved: true,
      });
    });

    // Node click to highlight source location in CodeMirror
    this.graph.on("node:click", ({ node }) => {
      const data = node.getData() as { sourceLocation?: SourceLocation } | undefined;
      if (data && data.sourceLocation && this.onSelect) {
        this.onSelect(data.sourceLocation);
      }
    });

    // Spacebar pan toggle
    let spaceDown = false;
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !spaceDown && (e.target as HTMLElement)?.tagName !== "INPUT" && (e.target as HTMLElement)?.tagName !== "TEXTAREA") {
        spaceDown = true;
        this.graph.enablePanning();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        spaceDown = false;
      }
    });
  }

  public setScope(sessionKey: string): void {
    this.sidecar.setScope(sessionKey);
  }

  public setTheme(themeId: CanvasThemeId): void {
    this.themeId = themeId;
    this.currentThemeStyles = resolveTheme(themeId);
    this.applyThemeStyles();
    if (this.currentViewIR) {
      this.refreshNodeAndEdgeStyles();
    }
  }

  public getTheme(): CanvasThemeId {
    return this.themeId;
  }

  private applyThemeStyles(): void {
    const theme = this.currentThemeStyles;
    this.container.style.backgroundColor = theme.canvasBg;

    if (theme.gridColor && theme.gridColor !== "transparent") {
      this.graph.showGrid();
      this.graph.drawGrid({
        type: "dot",
        args: { color: theme.gridColor, thickness: 1 },
      });
    } else {
      this.graph.hideGrid();
    }

    this.renderOrUpdateIsoFrame();
  }

  private renderOrUpdateIsoFrame(): void {
    const existing = this.container.querySelector(".iso-sheet-frame");
    if (existing) existing.remove();

    if (!this.currentThemeStyles.isIso || !this.currentViewIR) return;

    const frame = document.createElement("div");
    frame.className = "iso-sheet-frame";
    frame.style.position = "absolute";
    frame.style.inset = "8px";
    frame.style.border = "2px solid #000000";
    frame.style.pointerEvents = "none";
    frame.style.boxSizing = "border-box";
    frame.style.zIndex = "5";

    // Inner margin frame
    const inner = document.createElement("div");
    inner.style.position = "absolute";
    inner.style.inset = "14px";
    inner.style.border = "1px solid #000000";

    // Parametric Title Block at bottom right
    const titleBlock = document.createElement("div");
    titleBlock.style.position = "absolute";
    titleBlock.style.bottom = "0";
    titleBlock.style.right = "0";
    titleBlock.style.width = "280px";
    titleBlock.style.height = "75px";
    titleBlock.style.borderTop = "1.5px solid #000000";
    titleBlock.style.borderLeft = "1.5px solid #000000";
    titleBlock.style.backgroundColor = "#ffffff";
    titleBlock.style.padding = "6px 10px";
    titleBlock.style.fontFamily = "ui-monospace, monospace";
    titleBlock.style.fontSize = "10px";
    titleBlock.style.color = "#000000";
    titleBlock.style.lineHeight = "1.4";

    const dateStr = new Date().toISOString().slice(0, 10);
    const shaShort = this.currentViewIR.sourceSha256.slice(0, 10);
    titleBlock.innerHTML = `
      <div style="font-weight: bold; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 3px; margin-bottom: 3px;">
        ${this.currentViewIR.rootPackageName} · ${this.currentViewIR.viewType.toUpperCase()}
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span>NODES: ${this.currentViewIR.summary.displayedNodes}</span>
        <span>EDGES: ${this.currentViewIR.summary.displayedEdges}</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span>SHA: ${shaShort}…</span>
        <span>${dateStr}</span>
      </div>
    `;

    inner.appendChild(titleBlock);
    frame.appendChild(inner);
    this.container.appendChild(frame);
    this.sheetFrameEl = frame;
  }

  public async render(
    viewIR: SysMLViewIR,
    allViews?: Record<string, SysMLViewIR>,
  ): Promise<void> {
    this.currentViewIR = viewIR;
    if (allViews) {
      this.allViews = allViews;
    }

    this.graph.clearCells();

    // 1. Run ELK layout
    const elkResult = await runElkLayout(viewIR);

    const theme = this.currentThemeStyles;
    const nodeCells = new Map<string, Node>();
    const nodeDataMap = new Map<string, SysMLViewNode>();

    // 2. Instantiate and add nodes
    for (const node of viewIR.nodes) {
      nodeDataMap.set(node.id, node);

      // Model-Layout Separation:
      // If user previously moved this node, honor manual position from LayoutSidecar!
      const sidecarPos = this.sidecar.get(node.id);
      const elkPos = elkResult.positions.get(node.id) || {
        x: 60,
        y: 60,
        width: 180,
        height: 60,
      };

      const finalX = sidecarPos?.userMoved ? sidecarPos.x : elkPos.x;
      const finalY = sidecarPos?.userMoved ? sidecarPos.y : elkPos.y;
      const finalWidth = sidecarPos?.width || elkPos.width;
      const finalHeight = sidecarPos?.height || elkPos.height;

      const attrs = buildNodeAttrs(node, theme);
      const portItems = buildPortItems(node, theme);

      const cell = this.graph.createNode({
        id: node.id,
        shape: SYSML_NODE_NAME,
        x: finalX,
        y: finalY,
        width: finalWidth,
        height: finalHeight,
        attrs: attrs as any,
        ports: {
          items: portItems as any,
        },
        data: {
          sourceLocation: node.sourceLocation,
          qualifiedName: node.qualifiedName,
          kind: node.kind,
        },
      });

      nodeCells.set(node.id, cell);
      this.graph.addNode(cell);

      // Record in sidecar if not set yet
      if (!sidecarPos) {
        this.sidecar.set(node.id, {
          x: finalX,
          y: finalY,
          width: finalWidth,
          height: finalHeight,
          userMoved: false,
        });
      }
    }

    // 3. Establish container parent-child nesting in X6
    for (const node of viewIR.nodes) {
      if (node.parentId && nodeCells.has(node.parentId)) {
        const parentCell = nodeCells.get(node.parentId)!;
        const childCell = nodeCells.get(node.id)!;
        parentCell.addChild(childCell);
      }
    }

    // 4. Instantiate and add edges
    for (const edge of viewIR.edges || []) {
      if (!nodeCells.has(edge.sourceId) || !nodeCells.has(edge.targetId)) {
        continue;
      }

      const edgeAttrs = this.buildEdgeAttrs(edge, theme);

      this.graph.addEdge({
        id: edge.id,
        source: edge.sourcePortId
          ? { cell: edge.sourceId, port: edge.sourcePortId }
          : { cell: edge.sourceId },
        target: edge.targetPortId
          ? { cell: edge.targetId, port: edge.targetPortId }
          : { cell: edge.targetId },
        router: {
          name: "manhattan",
          args: { padding: 12, step: 10 },
        },
        connector: {
          name: "jumpover",
          args: { type: "arc", size: 6 },
        },
        attrs: edgeAttrs,
        labels: edge.label
          ? [
              {
                attrs: {
                  text: {
                    text: edge.label,
                    fill: theme.edge.textColor,
                    fontSize: 11,
                    fontFamily: "ui-monospace, monospace, sans-serif",
                  },
                  rect: {
                    fill: theme.node.fill,
                    rx: 3,
                    ry: 3,
                  },
                },
              },
            ]
          : [],
      });
    }

    // 5. Fit view smoothly
    this.graph.zoomToFit({ padding: 36, maxScale: 1.2 });
    this.renderOrUpdateIsoFrame();
  }

  private buildEdgeAttrs(
    edge: SysMLViewEdge,
    theme: ThemeStyles,
  ): Record<string, unknown> {
    let stroke = theme.edge.connectionStroke;
    let strokeDasharray = "none";
    let targetMarker: Record<string, unknown> = {
      name: "classic",
      size: 7,
      fill: stroke,
    };

    if (edge.kind === "flow") {
      stroke = theme.edge.flowStroke;
      targetMarker = { name: "classic", size: 7, fill: stroke };
    } else if (edge.kind === "satisfy" || edge.kind === "verify") {
      stroke = theme.edge.satisfyStroke;
      strokeDasharray = "5 5";
      targetMarker = { name: "classic", size: 7, fill: stroke };
    } else if (edge.kind === "specialization") {
      stroke = theme.edge.specializationStroke;
      targetMarker = {
        name: "path",
        d: "M 0 0 L 10 -5 L 10 5 Z",
        fill: theme.canvasBg,
        stroke,
        strokeWidth: 1.5,
      };
    } else if (edge.kind === "transition") {
      stroke = theme.edge.transitionStroke;
      targetMarker = { name: "classic", size: 7, fill: stroke };
    }

    return {
      line: {
        stroke,
        strokeWidth: theme.edge.strokeWidth,
        strokeDasharray,
        targetMarker,
      },
    };
  }

  private refreshNodeAndEdgeStyles(): void {
    if (!this.currentViewIR) return;
    const theme = this.currentThemeStyles;

    for (const node of this.currentViewIR.nodes) {
      const cell = this.graph.getCellById(node.id);
      if (cell && cell.isNode()) {
        const attrs = buildNodeAttrs(node, theme);
        cell.setAttrs(attrs as any);
      }
    }

    for (const edge of this.currentViewIR.edges) {
      const cell = this.graph.getCellById(edge.id);
      if (cell && cell.isEdge()) {
        const attrs = this.buildEdgeAttrs(edge, theme);
        cell.setAttrs(attrs as any);
      }
    }
  }

  public switchView(viewType: ViewType): boolean {
    if (this.allViews && this.allViews[viewType]) {
      this.render(this.allViews[viewType], this.allViews);
      return true;
    }
    return false;
  }

  public zoomIn(): void {
    this.graph.zoom(0.2);
  }

  public zoomOut(): void {
    this.graph.zoom(-0.2);
  }

  public zoomFit(): void {
    this.graph.zoomToFit({ padding: 36, maxScale: 1.5 });
  }

  public resetLayout(): void {
    this.sidecar.clear();
    if (this.currentViewIR) {
      this.render(this.currentViewIR, this.allViews);
    }
  }

  public destroy(): void {
    if (this.sheetFrameEl) this.sheetFrameEl.remove();
    this.graph.dispose();
  }
}
