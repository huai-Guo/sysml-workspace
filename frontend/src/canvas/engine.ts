import { Graph, Node, Edge } from "@antv/x6/es";
import { Snapline, History, MiniMap, Selection, Transform } from "@antv/x6/es/plugin";
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
import { CanvasRulers } from "./rulers";
import { CadStatusBar, type StatusBarState } from "./status_bar";
import { CadBoxSelection } from "./selection";
import { CadLayersPanel } from "./layers_panel";
import { SysMLPalette, type InsertElementEvent } from "./palette";
import { SemanticEditor } from "./semantic_editor";
import { DxfExporter, DrawioExporter, JsonExporter, SvgExporter, ImageExporter, type DxfExportOptions } from "./exporters";
import { CanvasImporter, type ImportResult } from "./importers";
import { CadCommandBar } from "./command_bar";

export interface CanvasEngineOptions {
  theme?: CanvasThemeId;
  onSelect?: (loc?: SourceLocation) => void;
  sessionKey?: string;
  getSource?: () => string;
  applySource?: (newSource: string, skipConfirm?: boolean) => void;
  showNotice?: (message: string) => void;
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
  private onKeyDownHandler!: (e: KeyboardEvent) => void;
  private onKeyUpHandler!: (e: KeyboardEvent) => void;
  private onPointerMoveHandler!: (e: PointerEvent) => void;
  private spaceDown = false;
  private sheetVisible = false;
  private orthoEnabled = true;

  private getSourceCallback?: () => string;
  private applySourceCallback?: (newSource: string, skipConfirm?: boolean) => void;
  private showNoticeCallback?: (message: string) => void;

  // CAD Precision Modules
  public rulers?: CanvasRulers;
  public statusBar?: CadStatusBar;
  public boxSelection?: CadBoxSelection;
  public layersPanel?: CadLayersPanel;
  public palette?: SysMLPalette;
  public semanticEditor?: SemanticEditor;
  public snaplinePlugin?: Snapline;
  public historyPlugin?: History;
  public miniMapPlugin?: MiniMap;
  public selectionPlugin?: Selection;
  public transformPlugin?: Transform;
  public commandBar?: CadCommandBar;

  constructor(container: HTMLElement, options: CanvasEngineOptions = {}) {
    this.container = container;
    this.themeId = options.theme || "auto";
    this.currentThemeStyles = resolveTheme(this.themeId);
    this.sheetVisible = this.currentThemeStyles.isIso;
    this.onSelect = options.onSelect;
    this.sidecar = new LayoutSidecar(options.sessionKey || "default");
    this.getSourceCallback = options.getSource;
    this.applySourceCallback = options.applySource;
    this.showNoticeCallback = options.showNotice;

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

    // Setup file drag-and-drop import onto canvas
    graphMount.addEventListener("dragover", (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });
    graphMount.addEventListener("drop", (e) => {
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        e.preventDefault();
        this.handleImportFile(files[0]);
      }
    });

    this.graph = new Graph({
      container: graphMount,
      autoResize: true,
      panning: {
        enabled: true,
        modifiers: "space",
        eventTypes: ["leftMouseDown", "mouseWheelDown"],
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
        vertexMovable: true,
        vertexAddable: true,
        vertexDeletable: true,
      },
    });

    // 1. Initialize X6 Plugins
    try {
      this.snaplinePlugin = new Snapline({ enabled: true, sharp: true, tolerance: 10 });
      this.graph.use(this.snaplinePlugin);
    } catch (e) {
      console.warn("Snapline plugin init warning:", e);
    }

    try {
      this.historyPlugin = new History({ enabled: true });
      this.graph.use(this.historyPlugin);
    } catch (e) {
      console.warn("History plugin init warning:", e);
    }

    try {
      this.selectionPlugin = new Selection({
        enabled: true,
        multiple: true,
        showNodeSelectionBox: true,
        movable: true,
      });
      this.graph.use(this.selectionPlugin);
    } catch (e) {
      console.warn("Selection plugin init warning:", e);
    }

    try {
      this.transformPlugin = new Transform({
        resizing: {
          enabled: true,
          minWidth: 40,
          minHeight: 30,
        },
      });
      this.graph.use(this.transformPlugin);
    } catch (e) {
      console.warn("Transform plugin init warning:", e);
    }

    // MiniMap mount
    try {
      let minimapMount = container.querySelector<HTMLElement>(".cad-minimap-container");
      if (!minimapMount) {
        minimapMount = document.createElement("div");
        minimapMount.className = "cad-minimap-container";
        minimapMount.style.position = "absolute";
        minimapMount.style.bottom = "32px";
        minimapMount.style.right = "10px";
        minimapMount.style.width = "160px";
        minimapMount.style.height = "100px";
        minimapMount.style.backgroundColor = "var(--bg-card, #131b26)";
        minimapMount.style.border = "1px solid var(--border-subtle, #273549)";
        minimapMount.style.borderRadius = "4px";
        minimapMount.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.4)";
        minimapMount.style.zIndex = "14";
        minimapMount.style.overflow = "hidden";
        container.appendChild(minimapMount);
      }
      this.miniMapPlugin = new MiniMap({
        container: minimapMount,
        width: 160,
        height: 100,
        padding: 8,
      });
      this.graph.use(this.miniMapPlugin);
    } catch (e) {
      console.warn("MiniMap plugin init warning:", e);
    }

    // 2. Initialize R2 CAD Precision Controls
    try {
      this.rulers = new CanvasRulers(container, this.graph);
    } catch (e) {
      console.warn("Rulers init warning:", e);
    }

    try {
      this.statusBar = new CadStatusBar(container, {
        initialState: {
          grid: true,
          snap: false,
          osnap: true,
          ortho: true,
          sheet: this.sheetVisible,
        },
        onChange: (st) => this.handleStatusBarStateChange(st),
        onZoomReset: () => this.graph.zoomTo(1),
      });
    } catch (e) {
      console.warn("Status bar init warning:", e);
    }

    try {
      this.boxSelection = new CadBoxSelection(container, this.graph);
    } catch (e) {
      console.warn("Box selection init warning:", e);
    }

    try {
      this.layersPanel = new CadLayersPanel(container, this.graph, this.sidecar, {
        onSheetToggle: (visible) => this.toggleSheetFrame(visible),
      });
    } catch (e) {
      console.warn("Layers panel init warning:", e);
    }

    // 3. Initialize Reverse Semantic Editor & Palette
    if (options.getSource && options.applySource) {
      this.semanticEditor = new SemanticEditor({
        getSource: options.getSource,
        applySource: options.applySource,
        showNotice: options.showNotice,
      });
      this.semanticEditor.attachGraph(this.graph);
    }

    try {
      this.palette = new SysMLPalette(container, this.graph, {
        onInsert: (event: InsertElementEvent) => {
          this.semanticEditor?.handleInsertElement(event.kind, event.name, event.targetParentId);
        },
      });
    } catch (e) {
      console.warn("Palette init warning:", e);
    }

    // 4. Initialize CAD Command Bar
    try {
      this.commandBar = new CadCommandBar(container, {
        zoomFit: () => this.zoomFit(),
        toggleOrtho: () => this.toggleOrtho(),
        toggleGrid: () => this.toggleGrid(),
        toggleSnap: () => this.toggleSnap(),
        toggleOsnap: () => this.toggleOsnap(),
        toggleSheet: () => this.toggleSheet(),
        alignSelected: (type) => this.alignSelected(type),
        resetLayout: () => this.resetLayout(),
        switchView: (v) => this.switchView(v),
        setTheme: (t) => this.setTheme(t),
        exportFormat: (fmt) => this.triggerExport(fmt),
        showNotice: (msg) => this.showNoticeCallback?.(msg),
      });
    } catch (e) {
      console.warn("Command bar init warning:", e);
    }

    this.applyThemeStyles();
    this.bindEvents();
  }

  private handleStatusBarStateChange(state: StatusBarState): void {
    // GRID
    if (state.grid) {
      this.graph.showGrid();
    } else {
      this.graph.hideGrid();
    }

    // SNAP (10px grid snap)
    this.graph.setGridSize(state.snap ? 10 : 1);

    // OSNAP (Snapline guide)
    if (state.osnap) {
      this.snaplinePlugin?.enable();
    } else {
      this.snaplinePlugin?.disable();
    }

    // ORTHO (F8 lock)
    this.orthoEnabled = state.ortho;
    for (const edge of this.graph.getEdges()) {
      edge.setRouter(
        this.orthoEnabled
          ? { name: "manhattan", args: { padding: 12, step: 10 } }
          : { name: "normal" },
      );
    }

    // SHEET
    this.toggleSheetFrame(state.sheet);
  }

  public toggleSheetFrame(visible?: boolean): void {
    this.sheetVisible = visible !== undefined ? visible : !this.sheetVisible;
    this.renderOrUpdateIsoFrame();
  }

  private bindEvents(): void {
    // Save manual node movement to LayoutSidecar scoped by viewType
    this.graph.on("node:moved", ({ node }) => {
      const pos = node.getPosition();
      const size = node.getSize();
      this.sidecar.set(
        node.id,
        {
          x: pos.x,
          y: pos.y,
          width: size.width,
          height: size.height,
          userMoved: true,
        },
        this.currentViewIR?.viewType,
      );
    });

    this.graph.on("node:resized", ({ node }) => {
      const pos = node.getPosition();
      const size = node.getSize();
      this.sidecar.set(
        node.id,
        {
          x: pos.x,
          y: pos.y,
          width: size.width,
          height: size.height,
          userMoved: true,
        },
        this.currentViewIR?.viewType,
      );
    });

    // Node click to toggle compartment fold or highlight source location in CodeMirror
    this.graph.on("node:click", ({ node, e }) => {
      const target = e.target as SVGElement;
      const isFoldBtn =
        target?.getAttribute?.("data-selector") === "foldBtn" ||
        target?.textContent === "▾" ||
        target?.textContent === "▸";

      if (isFoldBtn) {
        const data = node.getData() as
          | { viewNode?: SysMLViewNode; sourceLocation?: SourceLocation }
          | undefined;
        if (data?.viewNode && data.viewNode.compartments?.length > 0) {
          data.viewNode.collapsed = !data.viewNode.collapsed;
          const newAttrs = buildNodeAttrs(data.viewNode, this.currentThemeStyles);
          node.setAttrs(newAttrs as any);

          const curSize = node.getSize();
          if (data.viewNode.collapsed) {
            node.prop("expandedHeight", curSize.height);
            node.setSize(curSize.width, 44);
          } else {
            const expH = Number(node.prop("expandedHeight")) || 120;
            node.setSize(curSize.width, expH);
          }

          const updatedPos = node.getPosition();
          const updatedSize = node.getSize();
          this.sidecar.set(
            node.id,
            {
              x: updatedPos.x,
              y: updatedPos.y,
              width: updatedSize.width,
              height: updatedSize.height,
              userMoved: true,
            },
            this.currentViewIR?.viewType,
          );
          return;
        }
      }

      const data = node.getData() as { sourceLocation?: SourceLocation } | undefined;
      if (data && data.sourceLocation && this.onSelect) {
        this.onSelect(data.sourceLocation);
      }
    });

    // Realtime cursor world coordinate tracking (clientToLocal accepts clientX, clientY directly)
    this.onPointerMoveHandler = (e: PointerEvent) => {
      const localPos = this.graph.clientToLocal(e.clientX, e.clientY);
      this.statusBar?.setCoordinates(localPos.x, localPos.y);
    };
    this.container.addEventListener("pointermove", this.onPointerMoveHandler);

    this.graph.on("scale", ({ sx }) => {
      this.statusBar?.setZoom(sx);
      this.rulers?.draw();
    });

    this.graph.on("translate", () => {
      this.rulers?.draw();
    });

    // Keyboard shortcuts handler:
    // - Space: Pan toggle
    // - Ctrl+Z: Undo
    // - Ctrl+Y / Ctrl+Shift+Z: Redo
    // - Delete / Backspace: Safe delete
    // - F8: Ortho toggle
    this.onKeyDownHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

      if (e.code === "Space" && !this.spaceDown && !isInput) {
        this.spaceDown = true;
        this.graph.enablePanning();
      } else if (!isInput && (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (this.historyPlugin?.canUndo()) {
          this.historyPlugin.undo();
        }
      } else if (
        !isInput &&
        (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") ||
          ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
        e.preventDefault();
        if (this.historyPlugin?.canRedo()) {
          this.historyPlugin.redo();
        }
      } else if (!isInput && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        this.semanticEditor?.handleDeleteSelected();
      } else if (e.key === "F8") {
        e.preventDefault();
        this.statusBar?.toggleMode("ortho");
      }
    };

    this.onKeyUpHandler = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        this.spaceDown = false;
        this.graph.disablePanning();
      }
    };

    window.addEventListener("keydown", this.onKeyDownHandler);
    window.addEventListener("keyup", this.onKeyUpHandler);
  }

  public setScope(sessionKey: string): void {
    this.sidecar.setScope(sessionKey);
  }

  public setTheme(themeId: CanvasThemeId): void {
    this.themeId = themeId;
    this.currentThemeStyles = resolveTheme(themeId);
    this.sheetVisible = this.currentThemeStyles.isIso;
    this.statusBar?.updateState({ sheet: this.sheetVisible });
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

    if (!this.sheetVisible || !this.currentViewIR) return;

    const frame = document.createElement("div");
    frame.className = "iso-sheet-frame";
    frame.style.position = "absolute";
    frame.style.inset = "6px";
    frame.style.border = "2px solid #000000";
    frame.style.pointerEvents = "none";
    frame.style.boxSizing = "border-box";
    frame.style.zIndex = "5";

    // Inner margin frame
    const inner = document.createElement("div");
    inner.style.position = "absolute";
    inner.style.inset = "18px";
    inner.style.border = "1px solid #000000";

    // Top & Bottom Zone Labels: 1 through 8
    const topZones = document.createElement("div");
    topZones.style.position = "absolute";
    topZones.style.top = "0";
    topZones.style.left = "18px";
    topZones.style.right = "18px";
    topZones.style.height = "18px";
    topZones.style.display = "flex";
    topZones.style.justifyContent = "space-around";
    topZones.style.alignItems = "center";
    topZones.style.fontSize = "9px";
    topZones.style.fontFamily = "ui-monospace, monospace";
    topZones.style.color = "#000000";

    const botZones = document.createElement("div");
    botZones.style.position = "absolute";
    botZones.style.bottom = "0";
    botZones.style.left = "18px";
    botZones.style.right = "298px"; // avoid overlapping title block
    botZones.style.height = "18px";
    botZones.style.display = "flex";
    botZones.style.justifyContent = "space-around";
    botZones.style.alignItems = "center";
    botZones.style.fontSize = "9px";
    botZones.style.fontFamily = "ui-monospace, monospace";
    botZones.style.color = "#000000";

    for (let i = 1; i <= 8; i++) {
      const sp1 = document.createElement("span");
      sp1.textContent = String(i);
      topZones.appendChild(sp1);

      const sp2 = document.createElement("span");
      sp2.textContent = String(i);
      botZones.appendChild(sp2);
    }
    frame.appendChild(topZones);
    frame.appendChild(botZones);

    // Left & Right Zone Labels: A through F
    const leftZones = document.createElement("div");
    leftZones.style.position = "absolute";
    leftZones.style.left = "0";
    leftZones.style.top = "18px";
    leftZones.style.bottom = "18px";
    leftZones.style.width = "18px";
    leftZones.style.display = "flex";
    leftZones.style.flexDirection = "column";
    leftZones.style.justifyContent = "space-around";
    leftZones.style.alignItems = "center";
    leftZones.style.fontSize = "9px";
    leftZones.style.fontFamily = "ui-monospace, monospace";
    leftZones.style.color = "#000000";

    const rightZones = document.createElement("div");
    rightZones.style.position = "absolute";
    rightZones.style.right = "0";
    rightZones.style.top = "18px";
    rightZones.style.bottom = "93px"; // avoid title block
    rightZones.style.width = "18px";
    rightZones.style.display = "flex";
    rightZones.style.flexDirection = "column";
    rightZones.style.justifyContent = "space-around";
    rightZones.style.alignItems = "center";
    rightZones.style.fontSize = "9px";
    rightZones.style.fontFamily = "ui-monospace, monospace";
    rightZones.style.color = "#000000";

    const zoneLetters = ["A", "B", "C", "D", "E", "F"];
    for (const letter of zoneLetters) {
      const spL = document.createElement("span");
      spL.textContent = letter;
      leftZones.appendChild(spL);

      const spR = document.createElement("span");
      spR.textContent = letter;
      rightZones.appendChild(spR);
    }
    frame.appendChild(leftZones);
    frame.appendChild(rightZones);

    // Safe DOM construction for Title Block (bottom-right)
    const titleBlock = document.createElement("div");
    titleBlock.style.position = "absolute";
    titleBlock.style.bottom = "0";
    titleBlock.style.right = "0";
    titleBlock.style.width = "280px";
    titleBlock.style.height = "75px";
    titleBlock.style.borderTop = "1px solid #000000";
    titleBlock.style.borderLeft = "1px solid #000000";
    titleBlock.style.backgroundColor = "rgba(255, 255, 255, 0.95)";
    titleBlock.style.padding = "6px 8px";
    titleBlock.style.fontSize = "10px";
    titleBlock.style.fontFamily = "ui-monospace, monospace";
    titleBlock.style.color = "#000000";
    titleBlock.style.display = "flex";
    titleBlock.style.flexDirection = "column";
    titleBlock.style.justifyContent = "space-between";

    const titleH = document.createElement("div");
    titleH.style.fontWeight = "bold";
    titleH.style.fontSize = "11px";
    titleH.textContent = `${this.currentViewIR.rootPackageName} · ${this.currentViewIR.viewType.toUpperCase()}`;
    titleBlock.appendChild(titleH);

    const row1 = document.createElement("div");
    row1.style.display = "flex";
    row1.style.justifyContent = "space-between";
    const s1 = document.createElement("span");
    s1.textContent = `NODES: ${this.currentViewIR.summary.displayedNodes}`;
    const s2 = document.createElement("span");
    s2.textContent = `EDGES: ${this.currentViewIR.summary.displayedEdges}`;
    row1.append(s1, s2);
    titleBlock.appendChild(row1);

    const row2 = document.createElement("div");
    row2.style.display = "flex";
    row2.style.justifyContent = "space-between";
    const s3 = document.createElement("span");
    const shaShort = this.currentViewIR.sourceSha256.slice(0, 10);
    s3.textContent = `SHA: ${shaShort}…`;
    const s4 = document.createElement("span");
    const dateStr = new Date().toISOString().slice(0, 10);
    s4.textContent = dateStr;
    row2.append(s3, s4);
    titleBlock.appendChild(row2);

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

    this.layersPanel?.setViewType(viewIR.viewType);
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
      // If user previously moved this node, honor manual position from LayoutSidecar scoped by viewType!
      const sidecarPos = this.sidecar.get(node.id, viewIR.viewType);
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

      const cell = this.graph.addNode({
        id: node.id,
        shape: SYSML_NODE_NAME,
        x: finalX,
        y: finalY,
        width: finalWidth,
        height: finalHeight,
        attrs: attrs as any,
        ports: {
          items: portItems,
        },
        data: {
          viewNode: node,
          layer: node.layer,
          sourceLocation: node.sourceLocation,
        },
      });

      nodeCells.set(node.id, cell);

      if (!sidecarPos) {
        this.sidecar.set(
          node.id,
          {
            x: finalX,
            y: finalY,
            width: finalWidth,
            height: finalHeight,
            userMoved: false,
          },
          viewIR.viewType,
        );
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
        data: { edge, layer: edge.layer },
        source: edge.sourcePortId
          ? { cell: edge.sourceId, port: edge.sourcePortId }
          : { cell: edge.sourceId },
        target: edge.targetPortId
          ? { cell: edge.targetId, port: edge.targetPortId }
          : { cell: edge.targetId },
        router: this.orthoEnabled
          ? {
              name: "manhattan",
              args: { padding: 12, step: 10 },
            }
          : {
              name: "normal",
            },
        connector: {
          name: "jumpover",
          args: { type: "arc", size: 6 },
        },
        tools: [
          { name: "vertices" },
          { name: "segments" },
        ],
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
    this.rulers?.draw();
  }

  private buildEdgeAttrs(edge: SysMLViewEdge, theme: ThemeStyles): Record<string, any> {
    const isControlFlow = edge.kind === "transition";
    const isRequirement = edge.kind === "satisfy" || edge.kind === "verify";

    const strokeColor = isRequirement
      ? theme.edge.satisfyStroke
      : isControlFlow
        ? theme.edge.transitionStroke
        : theme.edge.connectionStroke;

    const strokeDash = isControlFlow ? "4 4" : isRequirement ? "6 3" : undefined;

    return {
      line: {
        stroke: strokeColor,
        strokeWidth: 1.5,
        strokeDasharray: strokeDash,
        targetMarker: {
          name: "classic",
          size: 7,
          fill: strokeColor,
          stroke: strokeColor,
        },
      },
    };
  }

  private refreshNodeAndEdgeStyles(): void {
    const theme = this.currentThemeStyles;
    if (!this.currentViewIR) return;

    for (const node of this.currentViewIR.nodes) {
      const cell = this.graph.getCellById(node.id);
      if (cell && cell.isNode()) {
        const attrs = buildNodeAttrs(node, theme);
        cell.setAttrs(attrs as any);

        // Synchronize port styles
        for (const port of node.ports || []) {
          cell.portProp(port.id, "attrs/stub/stroke", theme.port.stroke);
          cell.portProp(port.id, "attrs/pin/fill", theme.port.fill);
          cell.portProp(port.id, "attrs/pin/stroke", theme.port.stroke);
          cell.portProp(port.id, "attrs/text/fill", theme.port.textColor);
        }
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

  // --- Milestone R3: Exporters & Importers Integration ---

  public getCurrentPositions(): Map<string, { x: number; y: number; width: number; height: number }> {
    const map = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const node of this.graph.getNodes()) {
      const pos = node.getPosition();
      const size = node.getSize();
      map.set(node.id, { x: pos.x, y: pos.y, width: size.width, height: size.height });
    }
    return map;
  }

  public exportDxf(options?: DxfExportOptions): string {
    if (!this.currentViewIR) throw new Error("尚未生成或加载任何架构视图");
    const edgeVertices = new Map<string, { x: number; y: number }[]>();
    for (const edge of this.graph.getEdges()) {
      const vertices = edge.getVertices() || [];
      if (vertices.length > 0) {
        edgeVertices.set(edge.id, vertices);
      }
    }
    return DxfExporter.export(this.currentViewIR, {
      includeFrame: options?.includeFrame ?? this.sheetVisible,
      scale: options?.scale,
      nodePositions: this.getCurrentPositions(),
      edgeVertices,
    });
  }

  public exportDrawio(): string {
    if (!this.currentViewIR) throw new Error("尚未生成或加载任何架构视图");
    const src = this.getSourceCallback?.() || "";
    return DrawioExporter.export(this.currentViewIR, {
      sysmlSource: src,
      nodePositions: this.getCurrentPositions(),
    });
  }

  public exportWorkbenchJson(): string {
    if (!this.currentViewIR) throw new Error("尚未生成或加载任何架构视图");
    const src = this.getSourceCallback?.() || "";
    return JsonExporter.exportProject(this.currentViewIR, src, {
      activeTheme: this.themeId,
      sidecarPositions: this.sidecar.toRecord(),
    });
  }

  public exportSvg(options?: { includeFrame?: boolean }): string {
    if (!this.currentViewIR) throw new Error("尚未生成或加载任何架构视图");
    const svgEl = this.graph.container.querySelector("svg");
    if (!svgEl) throw new Error("未找到画布对应的 SVG 矢量渲染图元");
    const src = this.getSourceCallback?.() || "";
    return SvgExporter.export(svgEl, this.currentViewIR, {
      includeFrame: options?.includeFrame ?? this.sheetVisible,
      sysmlSource: src,
      theme: this.themeId,
      sidecarPositions: this.sidecar.toRecord(),
      nodePositions: this.getCurrentPositions(),
    });
  }

  public async exportPngBlob(
    scale: 1 | 2 | 4 = 2,
    bg: "white" | "transparent" | "blueprint" = "blueprint",
  ): Promise<Blob> {
    const svgStr = this.exportSvg();
    const widthMatch = svgStr.match(/width="([^"]+)"/);
    const heightMatch = svgStr.match(/height="([^"]+)"/);
    const w = widthMatch ? parseFloat(widthMatch[1]) : 1000;
    const h = heightMatch ? parseFloat(heightMatch[1]) : 700;
    return ImageExporter.exportPngBlob(svgStr, w, h, { scale, background: bg });
  }

  public async handleImportFile(file: File): Promise<ImportResult> {
    const result = await CanvasImporter.importFile(file);
    if (result.kind === "sysml") {
      this.applySourceCallback?.(result.source, true);
      this.showNoticeCallback?.(`已导入 SysML 源码文件: ${file.name}`);
    } else if (result.kind === "workbench") {
      this.sidecar.restoreRecord(result.project.sidecarPositions || {});
      if (result.project.activeTheme) {
        this.setTheme(result.project.activeTheme as CanvasThemeId);
      }
      this.applySourceCallback?.(result.project.sysmlSource, true);
      this.showNoticeCallback?.(`已成功恢复工作台工程包: ${file.name}`);
    } else if (result.kind === "drawio") {
      if (result.result.hasMetadata) {
        const targetViewType = (result.result.viewType as ViewType) || this.currentViewIR?.viewType || "general";
        for (const [id, pos] of result.result.updatedPositions.entries()) {
          this.sidecar.set(
            id,
            { x: pos.x, y: pos.y, width: pos.width || 180, height: pos.height || 60, userMoved: true },
            targetViewType,
          );
        }
        this.applySourceCallback?.(result.result.sysmlSource, true);
        this.showNoticeCallback?.(`已载入 Draw.io 框图并同步位置坐标: ${file.name}`);
      } else {
        this.applySourceCallback?.(result.result.sysmlSource, true);
        this.showNoticeCallback?.(`已从手绘 Draw.io 图解逆向生成 SysML 初始骨架代码: ${file.name}`);
      }
    } else if (result.kind === "unknown") {
      this.showNoticeCallback?.(result.error);
    }
    return result;
  }

  // --- CAD Command Bar Action Delegators ---

  public toggleOrtho(): boolean {
    this.statusBar?.toggleMode("ortho");
    return this.orthoEnabled;
  }

  public toggleGrid(): boolean {
    this.statusBar?.toggleMode("grid");
    return this.statusBar ? this.statusBar.getState().grid : true;
  }

  public toggleSnap(): boolean {
    this.statusBar?.toggleMode("snap");
    return this.statusBar ? this.statusBar.getState().snap : false;
  }

  public toggleOsnap(): boolean {
    this.statusBar?.toggleMode("osnap");
    return this.statusBar ? this.statusBar.getState().osnap : true;
  }

  public toggleSheet(): boolean {
    this.statusBar?.toggleMode("sheet");
    return this.sheetVisible;
  }

  public alignSelected(type: "left" | "right" | "top" | "bottom" | "centerH" | "centerV"): boolean {
    if (!this.layersPanel) return false;
    const count = this.layersPanel.getSelectedNodes().length;
    if (count < 2) return false;
    this.layersPanel.alignSelected(type);
    return true;
  }

  public hasRenderedView(): boolean {
    return Boolean(this.currentViewIR && this.graph.getNodes().length > 0);
  }

  public async triggerExport(format: "dxf" | "drawio" | "png" | "svg" | "json"): Promise<void> {
    const downloadBlob = (blob: Blob, filename: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };

    if (format === "dxf") {
      const dxf = this.exportDxf();
      downloadBlob(new Blob([dxf], { type: "application/dxf" }), "diagram.dxf");
    } else if (format === "drawio") {
      const drawio = this.exportDrawio();
      downloadBlob(new Blob([drawio], { type: "application/vnd.jgraph.mxfile" }), "diagram.drawio");
    } else if (format === "json") {
      const json = this.exportWorkbenchJson();
      downloadBlob(new Blob([json], { type: "application/json" }), "project.sysmlwb.json");
    } else if (format === "svg") {
      const svg = this.exportSvg();
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "diagram.svg");
    } else if (format === "png") {
      const blob = await this.exportPngBlob(2);
      downloadBlob(blob, "diagram-2x.png");
    }
  }

  public destroy(): void {
    window.removeEventListener("keydown", this.onKeyDownHandler);
    window.removeEventListener("keyup", this.onKeyUpHandler);
    this.container.removeEventListener("pointermove", this.onPointerMoveHandler);

    this.commandBar?.dispose();
    this.rulers?.dispose();
    this.statusBar?.dispose();
    this.boxSelection?.dispose();
    this.layersPanel?.dispose();
    this.palette?.dispose();
    this.semanticEditor?.dispose();
    this.snaplinePlugin?.dispose();
    this.historyPlugin?.dispose();
    this.miniMapPlugin?.dispose();
    this.selectionPlugin?.dispose();
    this.transformPlugin?.dispose();

    if (this.sheetFrameEl) this.sheetFrameEl.remove();
    this.graph.dispose();
  }
}
