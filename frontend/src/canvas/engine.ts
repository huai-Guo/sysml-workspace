import { Graph, Node, Edge } from "@antv/x6/es";
import { Snapline, History, Selection, Transform } from "@antv/x6/es/plugin";
import type {
  SysMLViewIR,
  SysMLViewNode,
  SysMLViewEdge,
  CanvasThemeId,
  ViewType,
  SourceLocation,
  NodeLayoutPosition,
} from "./types";
import { resolveTheme, type ThemeStyles } from "./themes";
import { LayoutSidecar } from "./sidecar";
import { runElkLayout } from "./elk_layout";
import {
  registerSysMLShapes,
  SYSML_NODE_NAME,
  buildNodeAttrs,
  buildPortItems,
  formatSysMLPortLabel,
} from "./shapes";
import { CadBoxSelection } from "./selection";
import { CadLayersPanel } from "./layers_panel";
import { SysMLPalette, type InsertElementEvent } from "./palette";
import { SemanticEditor } from "./semantic_editor";
import { DrawioExporter, JsonExporter, SvgExporter, ImageExporter } from "./exporters";
import { CanvasImporter, type ImportResult } from "./importers";

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
  private onKeyDownHandler!: (e: KeyboardEvent) => void;
  private onKeyUpHandler!: (e: KeyboardEvent) => void;
  private spaceDown = false;
  private orthoEnabled = true;

  private getSourceCallback?: () => string;
  private applySourceCallback?: (newSource: string, skipConfirm?: boolean) => void;
  private showNoticeCallback?: (message: string) => void;

  // Controls & Plugins
  public boxSelection?: CadBoxSelection;
  public layersPanel?: CadLayersPanel;
  public palette?: SysMLPalette;
  public semanticEditor?: SemanticEditor;
  public snaplinePlugin?: Snapline;
  public historyPlugin?: History;
  public selectionPlugin?: Selection;
  public transformPlugin?: Transform;

  // R5 UI Components & State
  private zoomCapsuleEl?: HTMLElement;
  private breadcrumbsEl?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private rafLODId: number | null = null;
  public currentScale = 1.0;
  public currentLODTier: "macro" | "meso" | "micro" = "meso";
  public collapsedNodes: Set<string> = new Set();
  private preCollapseSizes = new Map<string, { width: number; height: number }>();
  private collapsedEdgeEndpoints = new Map<
    string,
    {
      collapsedParentId: string;
      originalSource: ReturnType<Edge["getSource"]>;
      originalTarget: ReturnType<Edge["getTarget"]>;
    }
  >();
  public drillPath: string[] = []; // Subsystem drill-down hierarchy
  private renderToken = 0;
  private pendingRender?: { viewIR: SysMLViewIR; allViews?: Record<string, SysMLViewIR> };

  constructor(container: HTMLElement, options: CanvasEngineOptions = {}) {
    this.container = container;
    this.themeId = options.theme || "auto";
    this.currentThemeStyles = resolveTheme(this.themeId);
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
        eventTypes: ["leftMouseDown", "mouseWheelDown"],
      },
      mousewheel: {
        enabled: true,
        zoomAtMousePosition: true,
        minScale: 0.2,
        maxScale: 3.0,
      },
      grid: {
        visible: true,
        type: "dot",
        args: {
          color: this.currentThemeStyles.gridColor,
          thickness: 1,
        },
      },
      connecting: {
        snap: { radius: 18 },
        allowBlank: false,
        allowLoop: false,
        highlight: true,
        connector: {
          name: "jumpover",
          args: { type: "arc", size: 6 },
        },
        router: {
          name: "manhattan",
          args: { padding: 12, step: 10 },
        },
        createEdge: () => {
          return this.graph.createEdge({
            shape: "edge",
            router: { name: "manhattan", args: { padding: 12, step: 10 } },
            connector: { name: "jumpover", args: { type: "arc", size: 6 } },
            attrs: {
              line: {
                stroke: this.currentThemeStyles.edge.connectionStroke,
                strokeWidth: 1.5,
                targetMarker: {
                  name: "classic",
                  size: 7,
                  fill: this.currentThemeStyles.edge.connectionStroke,
                  stroke: this.currentThemeStyles.edge.connectionStroke,
                },
              },
            },
          });
        },
      },
    });

    // Guard against non-finite transform coordinate calculations during tab switching
    const guardGraphViewMatrix = (g: any) => {
      const v = g?.view;
      if (v && typeof v.setMatrix === "function") {
        const origSetMatrix = v.setMatrix.bind(v);
        v.setMatrix = (m: any) => {
          if (m) {
            const keys = ["a", "b", "c", "d", "e", "f"];
            for (let i = 0; i < keys.length; i++) {
              const val = m[keys[i]];
              if (val !== undefined && !Number.isFinite(val)) {
                return;
              }
            }
          }
          return origSetMatrix(m);
        };
      }
      const tf = g?.transform;
      if (tf?.translate) {
        const origTranslate = tf.translate.bind(tf);
        tf.translate = (x: number, y: number) => {
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          return origTranslate(x, y);
        };
      }
      if (tf?.scale) {
        const origScale = tf.scale.bind(tf);
        tf.scale = (sx: number, sy: number, ox?: number, oy?: number) => {
          if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
          return origScale(sx, sy, ox, oy);
        };
      }
    };

    guardGraphViewMatrix(this.graph);

    // 1. Initialize X6 Plugins
    try {
      this.snaplinePlugin = new Snapline({ enabled: true });
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
        multiple: false,
        rubberband: false,
        showNodeSelectionBox: false,
      });
      this.graph.use(this.selectionPlugin);
    } catch (e) {
      console.warn("Selection plugin init warning:", e);
    }

    // 2. Initialize Display Preferences Popover (no CAD rubberband hijacking left-drag!)
    try {
      this.layersPanel = new CadLayersPanel(container, this.graph, this.sidecar, {
        onDisplayChange: (prefs) => {
          this.orthoEnabled = prefs.orthoRouting;
          this.refreshNodeAndEdgeStyles();
          this.applyLOD(this.currentScale);
          for (const edge of this.graph.getEdges()) {
            edge.setRouter(
              this.orthoEnabled
                ? { name: "manhattan", args: { padding: 22, step: 10 } }
                : { name: "normal" },
            );
          }
        },
      });
    } catch (e) {
      console.warn("Layers panel init warning:", e);
    }

    // 3. Initialize Reverse Semantic Editor & Palette (with 0ms Optimistic Canvas Updates)
    if (options.getSource && options.applySource) {
      this.semanticEditor = new SemanticEditor({
        getSource: options.getSource,
        applySource: options.applySource,
        showNotice: options.showNotice,
        isExpandedCompound: (nodeId: string) => this.isCompoundNode(nodeId),
        onOptimisticInsert: (req, position) => this.applyOptimisticInsert(req, position),
        onOptimisticRename: (nodeId, oldName, newName) =>
          this.applyOptimisticRename(nodeId, oldName, newName),
        onOptimisticDelete: (cellIds) => this.applyOptimisticDelete(cellIds),
      });
      this.semanticEditor.attachGraph(this.graph);
    }

    try {
      this.palette = new SysMLPalette(container, this.graph, {
        getSource: options.getSource,
        getDefaultParentId: () => {
          if (this.drillPath.length > 0) {
            const focused = this.drillPath[this.drillPath.length - 1];
            const found = this.currentViewIR?.nodes.find((n) => n.id === focused);
            return found?.qualifiedName || found?.name;
          }
          const primaryContainer = this.currentViewIR?.nodes.find(
            (n) => n.shapeCategory === "usage" && this.isCompoundNode(n.id),
          );
          return primaryContainer?.qualifiedName || primaryContainer?.name || this.currentViewIR?.rootPackageName;
        },
        onInsert: (event: InsertElementEvent) => {
          this.semanticEditor?.handleInsertElement(
            {
              kind: event.kind,
              name: event.name,
              parentQualifiedName: event.targetParentId,
              typeName: event.typeName,
              direction: event.direction,
              conjugated: event.conjugated,
            },
            undefined,
            undefined,
            event.position,
          );
        },
      });
    } catch (e) {
      console.warn("Palette init warning:", e);
    }

    // 4. Render R5 UI Components
    this.renderZoomCapsule();
    this.renderBreadcrumbs();
    this.setupResizeObserver();

    this.applyThemeStyles();
    this.bindEvents();
  }

  private renderZoomCapsule(): void {
    this.zoomCapsuleEl?.remove();
    const cap = document.createElement("div");
    cap.className = "canvas-zoom-capsule";

    const btnOut = document.createElement("button");
    btnOut.className = "zoom-cap-btn";
    btnOut.textContent = "−";
    btnOut.title = "缩小视图";
    btnOut.onclick = (e) => {
      e.stopPropagation();
      this.zoomOut();
    };

    const txt = document.createElement("span");
    txt.className = "zoom-cap-text";
    txt.textContent = `${Math.round(this.currentScale * 100)}%`;
    txt.title = "点击恢复 100% 原始比例";
    txt.onclick = (e) => {
      e.stopPropagation();
      this.zoomReset();
    };

    const btnIn = document.createElement("button");
    btnIn.className = "zoom-cap-btn";
    btnIn.textContent = "＋";
    btnIn.title = "放大视图";
    btnIn.onclick = (e) => {
      e.stopPropagation();
      this.zoomIn();
    };

    const btnFit = document.createElement("button");
    btnFit.className = "zoom-cap-btn fit";
    btnFit.textContent = "适应窗口";
    btnFit.title = "缩放以完整适应视口";
    btnFit.onclick = (e) => {
      e.stopPropagation();
      this.zoomFit();
    };

    cap.append(btnOut, txt, btnIn, btnFit);
    this.container.appendChild(cap);
    this.zoomCapsuleEl = cap;
  }

  private renderBreadcrumbs(): void {
    this.breadcrumbsEl?.remove();
    this.breadcrumbsEl = undefined;

    // Only show top-left navigation bar when drilled inside a subsystem container
    if (this.drillPath.length === 0) {
      return;
    }

    const breadcrumbs = document.createElement("div");
    breadcrumbs.className = "canvas-breadcrumbs";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "crumb-back-btn";
    backBtn.textContent = "← 返回上级";
    backBtn.onclick = (e) => {
      e.stopPropagation();
      this.drillUp();
    };
    breadcrumbs.appendChild(backBtn);

    const rootCrumb = document.createElement("span");
    rootCrumb.className = "crumb-item";
    rootCrumb.textContent = "全部";
    rootCrumb.onclick = () => {
      this.drillPath = [];
      this.renderBreadcrumbs();
      this.applyDrillFilter();
      this.zoomFit();
    };
    breadcrumbs.appendChild(rootCrumb);

    for (let i = 0; i < this.drillPath.length; i++) {
      const sep = document.createElement("span");
      sep.className = "crumb-separator";
      sep.textContent = "/";
      breadcrumbs.appendChild(sep);

      const targetId = this.drillPath[i];
      const targetNode = this.currentViewIR?.nodes.find((n) => n.id === targetId);
      const label = targetNode ? targetNode.name : targetId;

      const crumb = document.createElement("span");
      const isLast = i === this.drillPath.length - 1;
      crumb.className = `crumb-item ${isLast ? "active" : ""}`;
      crumb.textContent = label;
      crumb.onclick = () => {
        if (!isLast) {
          this.drillPath = this.drillPath.slice(0, i + 1);
          this.renderBreadcrumbs();
          this.applyDrillFilter();
          this.zoomFit();
        }
      };
      breadcrumbs.appendChild(crumb);
    }

    this.container.appendChild(breadcrumbs);
    this.breadcrumbsEl = breadcrumbs;
  }

  private setupResizeObserver(): void {
    let resizeTimer: any;
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver((entries) => {
        clearTimeout(resizeTimer);
        const entry = entries[0];
        if (entry && (entry.contentRect.width < 50 || entry.contentRect.height < 50)) {
          return;
        }
        if (this.container.clientWidth < 50 || this.container.clientHeight < 50) {
          return;
        }
        // If a diagram render was queued while this tab was hidden (0x0), execute it immediately now!
        if (this.pendingRender) {
          const queued = this.pendingRender;
          this.pendingRender = undefined;
          this.graph.resize(this.container.clientWidth, this.container.clientHeight);
          void this.render(queued.viewIR, queued.allViews);
          return;
        }
        resizeTimer = setTimeout(() => {
          if (
            this.container.clientWidth >= 50 &&
            this.container.clientHeight >= 50 &&
            this.currentViewIR &&
            this.hasRenderedView()
          ) {
            this.graph.resize(this.container.clientWidth, this.container.clientHeight);
            this.zoomFit();
          }
        }, 120);
      });
      this.resizeObserver.observe(this.container);
    }
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
      this.handleChildNodeMovedOrResized(node, true);
    });

    this.graph.on("node:moving", ({ node }) => {
      this.handleChildNodeMovedOrResized(node, false);
    });

    this.graph.on("node:resizing", ({ node }) => {
      this.handleChildNodeMovedOrResized(node, false);
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
      this.handleChildNodeMovedOrResized(node, true);
    });

    // Node click handlers: collapseBtn or clean selection + source location highlight
    this.graph.on("node:click", ({ node, e }) => {
      const target = e.target as SVGElement;
      const selector =
        target?.getAttribute?.("selector") || target?.getAttribute?.("data-selector");
      const text = target?.textContent?.trim();

      if (selector === "collapseBtn" || text === "[-]" || text === "[+]") {
        e.stopPropagation();
        this.toggleNodeCollapse(node.id);
        return;
      }

      const data = node.getData() as { sourceLocation?: SourceLocation } | undefined;
      if (data && data.sourceLocation && this.onSelect) {
        this.onSelect(data.sourceLocation);
      }
    });

    // Clean subtle border emphasis on selected node, cleared on blank click
    this.graph.on("node:selected", ({ node }) => {
      node.attr("body/strokeWidth", 2.6);
    });
    this.graph.on("node:unselected", ({ node }) => {
      node.attr("body/strokeWidth", this.currentThemeStyles.node.strokeWidth);
    });
    this.graph.on("blank:click", () => {
      this.graph.cleanSelection();
    });

    // Double-click on any compound container cleanly enters (drills down into) that subsystem
    this.graph.on("node:dblclick", ({ node, e }) => {
      if (this.isCompoundNode(node.id)) {
        e.stopPropagation();
        if (this.collapsedNodes.has(node.id)) {
          this.toggleNodeCollapse(node.id);
        }
        this.drillDown(node.id);
      }
    });

    // Right-click on any node opens the hierarchical composer anchored directly to that parent node
    this.graph.on("node:contextmenu", ({ node, e }) => {
      e.preventDefault();
      e.stopPropagation();
      const vn = (node.getData() as { viewNode?: SysMLViewNode } | undefined)?.viewNode;
      if (vn && this.palette) {
        this.graph.cleanSelection();
        this.graph.select(node);
        this.palette.openForParent(vn.qualifiedName || vn.name);
      }
    });

    // 3-Tier Semantic Zoom LOD throttled via requestAnimationFrame
    this.graph.on("scale", ({ sx }) => {
      this.currentScale = sx;
      if (this.zoomCapsuleEl) {
        const txt = this.zoomCapsuleEl.querySelector(".zoom-cap-text");
        if (txt) txt.textContent = `${Math.round(sx * 100)}%`;
      }
      this.handleScaleEvent(sx);
    });

    this.onKeyDownHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";

      if (!isInput && e.key === "Escape" && this.drillPath.length > 0) {
        e.preventDefault();
        this.drillUp();
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
      }
    };

    this.onKeyUpHandler = () => {};

    window.addEventListener("keydown", this.onKeyDownHandler);
    window.addEventListener("keyup", this.onKeyUpHandler);
  }

  // --- R5.2 真·大图套小图 (Auto-Fit Bounds, Collapse & Drill-Down) ---

  private handleChildNodeMovedOrResized(childCell: Node, persistUserMoved = false): void {
    const data = childCell.getData() as { viewNode?: SysMLViewNode } | undefined;
    const parentId = data?.viewNode?.parentId;
    if (!parentId) return;

    this.updateParentBounds(parentId, persistUserMoved);
  }

  public updateParentBounds(parentId: string, persistUserMoved = false): void {
    const parentCell = this.graph.getCellById(parentId) as Node;
    if (!parentCell || !parentCell.isNode()) return;

    // Collect all direct children of this parent
    const children = this.graph.getNodes().filter((n) => {
      const d = n.getData() as { viewNode?: SysMLViewNode } | undefined;
      return d?.viewNode?.parentId === parentId && n.isVisible();
    });

    if (children.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let hasWestPorts = false;
    let hasEastPorts = false;

    for (const child of children) {
      const pos = child.getPosition();
      const size = child.getSize();
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);

      const cNode = (child.getData() as { viewNode?: SysMLViewNode } | undefined)?.viewNode;
      for (const p of cNode?.ports || []) {
        if ((p.sideHint || "W") === "W") hasWestPorts = true;
        if (p.sideHint === "E") hasEastPorts = true;
      }
    }

    const parentPos = parentCell.getPosition();
    const parentSize = parentCell.getSize();

    const pViewNode = (parentCell.getData() as { viewNode?: SysMLViewNode } | undefined)?.viewNode;
    let totalLines = 0;
    if (pViewNode?.compartments && pViewNode.compartments.length > 0) {
      pViewNode.compartments.forEach((comp, idx) => {
        if (idx > 0) totalLines += 1;
        totalLines += 1 + comp.items.length;
      });
    }
    const compHeight = totalLines > 0 ? totalLines * 17 + 14 : 0;
    const topPadding = Math.max(58, 44 + compHeight + (totalLines > 0 ? 18 : 14));
    const padLeft = hasWestPorts ? 84 : 40;
    const padRight = hasEastPorts ? 84 : 40;
    const padBottom = 32;

    const desiredX = minX - padLeft;
    const desiredY = minY - topPadding;
    const newW = Math.max(300, maxX + padRight - desiredX);
    const newH = Math.max(120, maxY + padBottom - desiredY);

    if (desiredX !== parentPos.x || desiredY !== parentPos.y) {
      parentCell.setPosition(desiredX, desiredY, { deep: false });
    }
    if (newW !== parentSize.width || newH !== parentSize.height) {
      parentCell.setSize(newW, newH);
      if (pViewNode) {
        const refreshed = buildNodeAttrs(pViewNode, this.currentThemeStyles, {
          depth: this.calculateNodeDepth(pViewNode),
          isCompound: true,
          isCollapsed: this.collapsedNodes.has(parentId),
          lodTier: this.currentLODTier,
          scale: this.currentScale,
          nodeWidth: newW,
        });
        parentCell.attr("compartmentDividers/d", (refreshed.compartmentDividers as any)?.d || "");
      }
    }

    if (persistUserMoved) {
      this.sidecar.set(
        parentId,
        {
          x: desiredX,
          y: desiredY,
          width: newW,
          height: newH,
          userMoved: true,
        },
        this.currentViewIR?.viewType,
      );
    }

    const grandParentId = pViewNode?.parentId;
    if (grandParentId) {
      this.updateParentBounds(grandParentId, persistUserMoved);
    }
  }

  public toggleNodeCollapse(nodeId: string): void {
    const parentCell = this.graph.getCellById(nodeId) as Node;
    if (!parentCell || !parentCell.isNode()) return;

    const descendantIds = this.getDescendantNodeIds(nodeId);
    const descendantSet = new Set(descendantIds);
    const isNowCollapsed = !this.collapsedNodes.has(nodeId);

    if (isNowCollapsed) {
      this.collapsedNodes.add(nodeId);
      this.preCollapseSizes.set(nodeId, parentCell.getSize());

      // Shrink container to compact card
      parentCell.setSize(Math.min(parentCell.getSize().width, 220), 44);
      parentCell.attr("collapseBtn/text", "[+]");

      // Hide all descendant nodes
      for (const dId of descendantIds) {
        const dCell = this.graph.getCellById(dId);
        if (dCell) dCell.hide();
      }

      // Synchronously handle edges:
      // - Both endpoints inside descendantIds: hide
      // - One inside and one outside: record original endpoints and reroute to parentCell
      for (const edge of this.graph.getEdges()) {
        const srcId = edge.getSourceCellId();
        const tgtId = edge.getTargetCellId();
        const isSrcInside = descendantSet.has(srcId);
        const isTgtInside = descendantSet.has(tgtId);

        if (isSrcInside && isTgtInside) {
          edge.hide();
        } else if (isSrcInside || isTgtInside) {
          this.collapsedEdgeEndpoints.set(edge.id, {
            collapsedParentId: nodeId,
            originalSource: { ...edge.getSource() },
            originalTarget: { ...edge.getTarget() },
          });
          if (isSrcInside) {
            edge.setSource({ cell: parentCell.id });
          }
          if (isTgtInside) {
            edge.setTarget({ cell: parentCell.id });
          }
          edge.show();
        }
      }
    } else {
      this.collapsedNodes.delete(nodeId);
      const prev = this.preCollapseSizes.get(nodeId);
      if (prev) {
        parentCell.setSize(prev.width, prev.height);
      }
      parentCell.attr("collapseBtn/text", "[-]");

      // Show all descendant nodes
      for (const dId of descendantIds) {
        const dCell = this.graph.getCellById(dId);
        if (dCell) dCell.show();
      }

      // Restore edges:
      // If edge was rerouted by this collapsed parent, restore original source and target
      for (const edge of this.graph.getEdges()) {
        const recorded = this.collapsedEdgeEndpoints.get(edge.id);
        if (recorded && recorded.collapsedParentId === nodeId) {
          edge.setSource(recorded.originalSource);
          edge.setTarget(recorded.originalTarget);
          edge.show();
          this.collapsedEdgeEndpoints.delete(edge.id);
        } else {
          const srcId = edge.getSourceCellId();
          const tgtId = edge.getTargetCellId();
          if (descendantSet.has(srcId) && descendantSet.has(tgtId)) {
            edge.show();
          }
        }
      }

      this.updateParentBounds(nodeId);
    }
  }

  public drillDown(nodeId: string): void {
    if (!this.drillPath.includes(nodeId)) {
      this.drillPath.push(nodeId);
    }
    this.renderBreadcrumbs();
    this.applyDrillFilter();
    this.zoomFit();
  }

  public drillUp(): void {
    if (this.drillPath.length > 0) {
      this.drillPath.pop();
      this.renderBreadcrumbs();
      this.applyDrillFilter();
      this.zoomFit();
    }
  }

  private applyDrillFilter(): void {
    if (this.drillPath.length === 0) {
      // Show all nodes
      for (const cell of this.graph.getCells()) {
        cell.show();
      }
      return;
    }

    const currentFocusId = this.drillPath[this.drillPath.length - 1];
    const visibleIds = new Set<string>([currentFocusId, ...this.getDescendantNodeIds(currentFocusId)]);

    for (const node of this.graph.getNodes()) {
      if (visibleIds.has(node.id)) {
        node.show();
      } else {
        node.hide();
      }
    }

    for (const edge of this.graph.getEdges()) {
      const src = edge.getSourceCellId();
      const tgt = edge.getTargetCellId();
      if (visibleIds.has(src) && visibleIds.has(tgt)) {
        edge.show();
      } else {
        edge.hide();
      }
    }
  }

  private getDescendantNodeIds(parentId: string): string[] {
    const result: string[] = [];
    const queue = [parentId];
    const nodes = this.currentViewIR?.nodes || [];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const children = nodes.filter((n) => n.parentId === curr);
      for (const child of children) {
        result.push(child.id);
        queue.push(child.id);
      }
    }

    return result;
  }

  private isCompoundNode(nodeId: string): boolean {
    return (this.currentViewIR?.nodes || []).some((n) => n.parentId === nodeId);
  }

  private calculateNodeDepth(node: SysMLViewNode): number {
    let depth = 0;
    let curr = node.parentId;
    const map = new Map<string, SysMLViewNode>();
    for (const n of this.currentViewIR?.nodes || []) {
      map.set(n.id, n);
    }
    while (curr && map.has(curr)) {
      depth++;
      curr = map.get(curr)!.parentId;
    }
    return depth;
  }

  // --- R5.3 多比例尺语义缩放适配 (3-Tier Semantic Zoom LOD) ---

  private handleScaleEvent(scale: number): void {
    if (this.rafLODId !== null) return;
    this.rafLODId = requestAnimationFrame(() => {
      this.rafLODId = null;
      this.applyLOD(scale);
    });
  }

  public applyLOD(scale: number): void {
    let tier: "macro" | "meso" | "micro" = "meso";
    if (scale < 0.55) {
      tier = "macro";
    } else if (scale > 1.25) {
      tier = "micro";
    }

    this.currentLODTier = tier;
    const theme = this.currentThemeStyles;

    for (const node of this.graph.getNodes()) {
      const data = node.getData() as { viewNode?: SysMLViewNode } | undefined;
      const vn = data?.viewNode;
      if (!vn) continue;

      const isCompound = this.isCompoundNode(vn.id);
      const isCollapsed = this.collapsedNodes.has(vn.id);

      const size = node.getSize();
      const prefs = this.layersPanel?.prefs;
      const refreshedAttrs = buildNodeAttrs(vn, theme, {
        depth: this.calculateNodeDepth(vn),
        isCompound,
        isCollapsed,
        lodTier: tier,
        scale,
        nodeWidth: size.width,
        forceHideCompartments: prefs ? !prefs.showCompartments : false,
      });
      node.setAttrs(refreshedAttrs as any);

      // Port labels & internal directional glyphs
      const labelTier =
        tier !== "macro" && prefs?.showPortTypes ? "micro" : tier;
      for (const port of vn.ports || []) {
        const portLabel = formatSysMLPortLabel(port, labelTier);
        node.portProp(port.id, "attrs/dirGlyph/display", tier === "macro" ? "none" : "block");
        if (tier === "macro" || !portLabel) {
          node.portProp(port.id, "attrs/text/display", "none");
        } else {
          node.portProp(port.id, "attrs/text/display", "block");
          node.portProp(port.id, "attrs/text/text", portLabel);
        }
      }
    }

    // Grid compensation
    if (tier === "macro") {
      this.graph.drawGrid({
        type: "mesh",
        args: { color: theme.gridColor, thickness: 0.5 },
      });
    } else {
      this.graph.drawGrid({
        type: "dot",
        args: { color: theme.gridColor, thickness: 1 },
      });
    }
  }

  // --- Theme & View Lifecycle ---

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
    const resolvedThemeId =
      this.themeId === "auto"
        ? theme.name.includes("Blueprint")
          ? "cad-blueprint"
          : "syson-clean"
        : this.themeId;
    this.container.setAttribute("data-canvas-theme", resolvedThemeId);
    this.container.style.backgroundColor = theme.canvasBg;
    const mount = this.container.querySelector<HTMLElement>(".x6-graph-mount");
    if (mount) {
      mount.style.backgroundColor = theme.canvasBg;
    }

    if (theme.gridColor && theme.gridColor !== "transparent") {
      this.graph.showGrid();
      this.graph.drawGrid({
        type: "dot",
        args: { color: theme.gridColor, thickness: 1 },
      });
    } else {
      this.graph.hideGrid();
    }
  }

  public getCurrentViewType(): ViewType | undefined {
    return this.currentViewIR?.viewType;
  }

  public async render(
    viewIR: SysMLViewIR,
    allViews?: Record<string, SysMLViewIR>,
    options: { preserveViewport?: boolean; preserveDrillPath?: boolean } = {},
  ): Promise<void> {
    const token = ++this.renderToken;
    if (allViews) {
      this.allViews = allViews;
    }

    // Preserve active view tab (e.g. interconnection / state / requirements) during silent background sync
    let targetViewIR = viewIR;
    if (options.preserveViewport && this.currentViewIR && allViews?.[this.currentViewIR.viewType]) {
      targetViewIR = allViews[this.currentViewIR.viewType];
    }
    this.currentViewIR = targetViewIR;

    this.layersPanel?.setViewType(targetViewIR.viewType);
    if (!options.preserveDrillPath) {
      this.drillPath = [];
    } else {
      const validIds = new Set(targetViewIR.nodes.map((n) => n.id));
      this.drillPath = this.drillPath.filter((id) => validIds.has(id));
    }
    this.collapsedEdgeEndpoints.clear();
    this.renderBreadcrumbs();

    // Guard first-render when the View tab is hidden (0x0 container): queue until visible!
    if (this.container.clientWidth < 50 || this.container.clientHeight < 50) {
      this.pendingRender = { viewIR: targetViewIR, allViews };
      return;
    }
    this.pendingRender = undefined;
    this.graph.resize(this.container.clientWidth, this.container.clientHeight);

    const savedZoom = options.preserveViewport ? this.graph.zoom() : undefined;
    const savedTranslate = options.preserveViewport ? this.graph.translate() : undefined;

    // 1. Run ELK layout
    const elkResult = await runElkLayout(targetViewIR);

    if (token !== this.renderToken) {
      return;
    }

    if (this.container.clientWidth >= 50 && this.container.clientHeight >= 50) {
      this.graph.resize(this.container.clientWidth, this.container.clientHeight);
    }

    this.graph.clearCells();
    const stageG = this.container.querySelector(".x6-graph-svg-stage");
    if (stageG) {
      const zombieCells = stageG.querySelectorAll(".x6-cell");
      zombieCells.forEach((z) => z.remove());
    }

    const theme = this.currentThemeStyles;
    const nodeCells = new Map<string, Node>();
    const nodeDataMap = new Map<string, SysMLViewNode>();

    // 2. Instantiate and add nodes with depth and hierarchy awareness
    const parentDeltaMap = new Map<string, { dx: number; dy: number }>();
    const orderedNodes = [...targetViewIR.nodes].sort(
      (a, b) => this.calculateNodeDepth(a) - this.calculateNodeDepth(b),
    );
    for (const node of orderedNodes) {
      nodeDataMap.set(node.id, node);

      const sidecarPos = this.sidecar.get(node.id, targetViewIR.viewType);
      const elkPos = elkResult.positions.get(node.id) || {
        x: 60,
        y: 60,
        width: 180,
        height: 60,
      };

      const inheritedDelta =
        node.parentId && parentDeltaMap.has(node.parentId)
          ? parentDeltaMap.get(node.parentId)!
          : { dx: 0, dy: 0 };

      const finalX = sidecarPos?.userMoved ? sidecarPos.x : elkPos.x + inheritedDelta.dx;
      const finalY = sidecarPos?.userMoved ? sidecarPos.y : elkPos.y + inheritedDelta.dy;
      parentDeltaMap.set(node.id, { dx: finalX - elkPos.x, dy: finalY - elkPos.y });

      const finalWidth =
        sidecarPos?.userMoved && sidecarPos.width
          ? Math.max(sidecarPos.width, elkPos.width)
          : elkPos.width;
      const finalHeight =
        sidecarPos?.userMoved && sidecarPos.height
          ? Math.max(sidecarPos.height, elkPos.height)
          : elkPos.height;

      const depth = this.calculateNodeDepth(node);
      const isCompound = this.isCompoundNode(node.id);
      const isCollapsed = this.collapsedNodes.has(node.id);

      const prefs = this.layersPanel?.prefs;
      const attrs = buildNodeAttrs(node, theme, {
        depth,
        isCompound,
        isCollapsed,
        lodTier: this.currentLODTier,
        scale: this.currentScale,
        nodeWidth: finalWidth,
        forceHideCompartments: prefs ? !prefs.showCompartments : false,
      });
      const portItems = buildPortItems(node, theme, {
        lodTier: this.currentLODTier,
        scale: this.currentScale,
        forceShowPortTypes: prefs?.showPortTypes ?? false,
      });

      const cell = this.graph.addNode({
        id: node.id,
        shape: SYSML_NODE_NAME,
        x: finalX,
        y: finalY,
        width: finalWidth,
        height: finalHeight,
        zIndex: 1 + depth * 2,
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
          targetViewIR.viewType,
        );
      }
    }

    // 3. Establish container parent-child nesting in X6
    for (const node of orderedNodes) {
      if (node.parentId && nodeCells.has(node.parentId)) {
        const parentCell = nodeCells.get(node.parentId)!;
        const childCell = nodeCells.get(node.id)!;
        parentCell.addChild(childCell);
      }
    }

    // Auto-fit parent bounds bottom-up (deepest containers first) so nested children are ALWAYS enclosed
    const compoundNodesBottomUp = orderedNodes
      .filter((n) => this.isCompoundNode(n.id))
      .reverse();
    for (const node of compoundNodesBottomUp) {
      this.updateParentBounds(node.id, false);
    }

    const sideToDir = (
      side?: "N" | "S" | "E" | "W",
    ): ("top" | "bottom" | "left" | "right")[] | undefined => {
      if (side === "W") return ["left"];
      if (side === "E") return ["right"];
      if (side === "N") return ["top"];
      if (side === "S") return ["bottom"];
      return undefined;
    };

    // 4. Instantiate and add edges with port-direction-aware SysON orthogonal routing
    for (const edge of targetViewIR.edges || []) {
      if (!nodeCells.has(edge.sourceId) || !nodeCells.has(edge.targetId)) {
        continue;
      }

      const srcNode = nodeDataMap.get(edge.sourceId);
      const tgtNode = nodeDataMap.get(edge.targetId);
      const srcPort = edge.sourcePortId
        ? srcNode?.ports.find((p) => p.id === edge.sourcePortId)
        : undefined;
      const tgtPort = edge.targetPortId
        ? tgtNode?.ports.find((p) => p.id === edge.targetPortId)
        : undefined;

      const startDirs = srcPort
        ? sideToDir(srcPort.sideHint)
        : edge.kind === "specialization"
          ? (["top", "left", "right"] as const)
          : undefined;
      const endDirs = tgtPort
        ? sideToDir(tgtPort.sideHint)
        : edge.kind === "specialization"
          ? (["bottom", "left", "right"] as const)
          : undefined;

      const edgeAttrs = this.buildEdgeAttrs(edge, theme);

      this.graph.addEdge({
        id: edge.id,
        zIndex: 20,
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
              args: {
                padding: 22,
                step: 10,
                ...(startDirs ? { startDirections: [...startDirs] } : {}),
                ...(endDirs ? { endDirections: [...endDirs] } : {}),
              },
            }
          : {
              name: "normal",
            },
        connector: {
          name: "jumpover",
          args: { type: "arc", size: 5, radius: 4 },
        },
        attrs: edgeAttrs,
        labels: edge.label
          ? [
              {
                position: {
                  distance: 0.5,
                  offset: 12,
                },
                attrs: {
                  text: {
                    text: edge.label,
                    fill: theme.edge.textColor,
                    fontSize: 10.5,
                    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
                  },
                  rect: {
                    fill: theme.canvasBg,
                    stroke: theme.node.dividerColor,
                    strokeWidth: 0.75,
                    rx: 3,
                    ry: 3,
                  },
                },
              },
            ]
          : [],
      });
    }

    if (this.drillPath.length > 0) {
      this.applyDrillFilter();
    }
    this.layersPanel?.applyPreferences();

    // 5. Restore camera smoothly on background sync, or fit view on initial/explicit render
    if (
      options.preserveViewport &&
      savedZoom !== undefined &&
      savedTranslate !== undefined &&
      Number.isFinite(savedZoom)
    ) {
      this.graph.zoomTo(savedZoom);
      this.graph.translate(savedTranslate.tx, savedTranslate.ty);
    } else {
      this.zoomFit();
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => {
          if (token === this.renderToken) {
            this.zoomFit();
          }
        });
      }
    }
  }

  // --- 0ms Optimistic Canvas Mutations (Zero Reload Freeze) ---

  private findCanvasNodeByRef(ref?: string): SysMLViewNode | undefined {
    if (!ref || ref === "__root__" || !this.currentViewIR) return undefined;
    return (
      this.currentViewIR.nodes.find((n) => n.qualifiedName === ref || n.id === ref) ||
      this.currentViewIR.nodes.find((n) => n.name === ref) ||
      (ref.includes("::")
        ? this.currentViewIR.nodes.find((n) => n.name === ref.split("::").pop())
        : undefined)
    );
  }

  private updateToolbarNodeSummary(): void {
    if (!this.currentViewIR) return;
    const summaryEl = document.getElementById("diagram-summary");
    if (summaryEl) {
      summaryEl.textContent = `${this.currentViewIR.nodes.length} 节点 · ${this.currentViewIR.edges.length} 连线`;
    }
  }

  public applyOptimisticInsert(
    req: {
      kind: string;
      name: string;
      parentQualifiedName?: string;
      typeName?: string;
      direction?: "in" | "out" | "inout" | "";
      conjugated?: boolean;
    },
    dropPosition?: { x: number; y: number },
  ): void {
    if (!this.currentViewIR) return;
    const kind = req.kind.toLowerCase();
    const parentNode = this.findCanvasNodeByRef(req.parentQualifiedName);
    const parentCell = parentNode ? (this.graph.getCellById(parentNode.id) as Node) : undefined;
    const prefs = this.layersPanel?.prefs;

    // 1. Port attached to an existing Part / Part Def / Port Def
    if (kind === "port" && parentNode && parentCell) {
      const effectiveDir: "in" | "out" | "inout" | null = req.direction
        ? (req.direction as "in" | "out" | "inout")
        : null;
      const sideHint: "W" | "E" =
        effectiveDir === "out" || (!effectiveDir && req.conjugated === false && parentNode.ports.length % 2 === 1)
          ? "E"
          : "W";

      if (parentNode.shapeCategory === "definition" && this.currentViewIR.viewType === "general") {
        let portComp = parentNode.compartments.find((c) => c.id === "ports");
        if (!portComp) {
          portComp = { id: "ports", title: "ports", items: [] };
          parentNode.compartments.push(portComp);
        }
        const dirText = effectiveDir ? `${effectiveDir} ` : "";
        const typeText = req.typeName ? ` : ${req.conjugated ? "~" : ""}${req.typeName}` : "";
        portComp.items.push({
          id: `${parentNode.id}::${req.name}`,
          text: `${dirText}${req.name}${typeText}`,
        });
      } else {
        parentNode.ports.push({
          id: `${parentNode.id}::${req.name}`,
          name: req.name,
          typeName: req.typeName,
          direction: effectiveDir,
          conjugated: Boolean(req.conjugated),
          sideHint,
        });
        const portItems = buildPortItems(parentNode, this.currentThemeStyles, {
          lodTier: this.currentLODTier,
          scale: this.currentScale,
          forceShowPortTypes: prefs?.showPortTypes ?? false,
        });
        parentCell.removePorts();
        parentCell.addPorts(portItems as any);
      }

      const curSize = parentCell.getSize();
      const newH = Math.max(curSize.height, 58 + Math.max(parentNode.ports.length * 24, 24));
      parentCell.setSize(curSize.width, newH);
      const attrs = buildNodeAttrs(parentNode, this.currentThemeStyles, {
        depth: this.calculateNodeDepth(parentNode),
        isCompound: this.isCompoundNode(parentNode.id),
        isCollapsed: this.collapsedNodes.has(parentNode.id),
        lodTier: this.currentLODTier,
        scale: this.currentScale,
        nodeWidth: curSize.width,
        forceHideCompartments: prefs ? !prefs.showCompartments : false,
      });
      parentCell.setAttrs(attrs as any);
      if (parentNode.parentId) {
        this.updateParentBounds(parentNode.parentId, false);
      }
      return;
    }

    // 2. Attribute or directed Item added into parent node's compartment
    if ((kind === "attribute" || kind === "item") && parentNode && parentCell) {
      const compId = kind === "attribute" ? "attributes" : "ports";
      let comp = parentNode.compartments.find((c) => c.id === compId);
      if (!comp) {
        comp = { id: compId, title: compId, items: [] };
        parentNode.compartments.push(comp);
      }
      const dirPrefix = req.direction ? `${req.direction} ` : "";
      const typeSuffix = req.typeName ? ` : ${req.typeName}` : "";
      comp.items.push({
        id: `${parentNode.id}::${req.name}`,
        text: `${dirPrefix}${req.name}${typeSuffix}`,
      });
      const curSize = parentCell.getSize();
      const newH = curSize.height + 20;
      parentCell.setSize(curSize.width, newH);
      const attrs = buildNodeAttrs(parentNode, this.currentThemeStyles, {
        depth: this.calculateNodeDepth(parentNode),
        isCompound: this.isCompoundNode(parentNode.id),
        isCollapsed: this.collapsedNodes.has(parentNode.id),
        lodTier: this.currentLODTier,
        scale: this.currentScale,
        nodeWidth: curSize.width,
        forceHideCompartments: prefs ? !prefs.showCompartments : false,
      });
      parentCell.setAttrs(attrs as any);
      if (parentNode.parentId) {
        this.updateParentBounds(parentNode.parentId, false);
      }
      return;
    }

    // 3. Structural / Behavioral / Requirement Node insertion (including nested child inside parent!)
    const shapeCategoryMap: Record<string, SysMLViewNode["shapeCategory"]> = {
      package: "package",
      part_def: "definition",
      port_def: "definition",
      item_def: "definition",
      part: "usage",
      state: "state",
      action: "action",
      requirement: "requirement",
    };
    const stereotypeMap: Record<string, string> = {
      package: "«package»",
      part_def: "«part def»",
      port_def: "«port def»",
      item_def: "«item def»",
      part: "«part»",
      state: "«state»",
      action: "«action»",
      requirement: "«requirement»",
    };
    const layerMap: Record<string, SysMLViewNode["layer"]> = {
      package: "L2_Structure",
      part_def: "L1_Definitions",
      port_def: "L1_Definitions",
      item_def: "L1_Definitions",
      part: "L2_Structure",
      state: "L3_Behavior",
      action: "L3_Behavior",
      requirement: "L5_Requirements",
    };

    const basePrefix =
      req.parentQualifiedName && req.parentQualifiedName !== "__root__"
        ? req.parentQualifiedName
        : this.currentViewIR.rootPackageName;
    const qualifiedName = basePrefix ? `${basePrefix}::${req.name}` : req.name;

    // Inherit boundary ports optimistically if typed by an existing Part Def in General/Interconnection view!
    const inheritedPorts: SysMLViewNode["ports"] = [];
    if (kind === "part" && req.typeName && this.allViews?.general) {
      const defNode = this.allViews.general.nodes.find(
        (n) => n.shapeCategory === "definition" && n.name === req.typeName,
      );
      const portComp = defNode?.compartments.find((c) => c.id === "ports");
      if (portComp) {
        portComp.items.forEach((item, idx) => {
          const m = /^(?:(in|out|inout)\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*(~?)([A-Za-z_][A-Za-z0-9_]*))?/.exec(
            item.text.trim(),
          );
          if (m) {
            const dir = (m[1] as "in" | "out" | "inout" | undefined) || null;
            const pName = m[2];
            const conj = m[3] === "~";
            const pType = m[4];
            inheritedPorts.push({
              id: `${qualifiedName}::${pName}`,
              name: pName,
              typeName: pType,
              direction: dir,
              conjugated: conj,
              sideHint: dir === "out" || (!dir && idx % 2 === 1) ? "E" : "W",
            });
          }
        });
      }
    }

    const newNode: SysMLViewNode = {
      id: qualifiedName,
      semanticId: qualifiedName,
      qualifiedName,
      name: req.name,
      kind,
      shapeCategory: shapeCategoryMap[kind] || "usage",
      stereotype: stereotypeMap[kind] || `«${kind}»`,
      typeLabel: req.typeName || undefined,
      parentId: parentNode ? parentNode.id : null,
      layer: layerMap[kind] || "L2_Structure",
      compartments:
        kind === "requirement"
          ? [{ id: "doc", title: "doc", items: [{ id: `${qualifiedName}::doc`, text: `${req.name} 需求规格说明` }] }]
          : [],
      ports: inheritedPorts,
    };

    this.currentViewIR.nodes.push(newNode);
    this.currentViewIR.summary.displayedNodes = this.currentViewIR.nodes.length;

    const nodeW = 200;
    const nodeH = Math.max(64, 52 + inheritedPorts.length * 22 + (kind === "requirement" ? 36 : 0));
    let x = dropPosition?.x ?? 80;
    let y = dropPosition?.y ?? 80;

    if (!dropPosition) {
      if (parentNode && parentCell) {
        const pPos = parentCell.getPosition();
        const siblings = this.graph.getNodes().filter((n) => {
          const vn = (n.getData() as { viewNode?: SysMLViewNode } | undefined)?.viewNode;
          return vn?.parentId === parentNode.id;
        });
        if (siblings.length === 0) {
          x = pPos.x + 54;
          y = pPos.y + 68;
        } else {
          let maxBottom = pPos.y + 68;
          let firstX = pPos.x + 54;
          siblings.forEach((sib, idx) => {
            const sp = sib.getPosition();
            const ss = sib.getSize();
            if (idx === 0) firstX = sp.x;
            maxBottom = Math.max(maxBottom, sp.y + ss.height + 28);
          });
          x = firstX;
          y = maxBottom;
        }
      } else {
        const topNodes = this.graph.getNodes().filter((n) => {
          const vn = (n.getData() as { viewNode?: SysMLViewNode } | undefined)?.viewNode;
          return !vn?.parentId && (kind.endsWith("def") ? vn?.shapeCategory === "definition" : vn?.shapeCategory !== "definition");
        });
        if (topNodes.length > 0) {
          let maxRight = 60;
          let baseY = kind.endsWith("def") ? 48 : 240;
          topNodes.forEach((tn, idx) => {
            const tp = tn.getPosition();
            const ts = tn.getSize();
            if (idx === 0) baseY = tp.y;
            maxRight = Math.max(maxRight, tp.x + ts.width + 44);
          });
          x = maxRight;
          y = baseY;
        }
      }
    }

    const depth = this.calculateNodeDepth(newNode);
    const attrs = buildNodeAttrs(newNode, this.currentThemeStyles, {
      depth,
      isCompound: false,
      isCollapsed: false,
      lodTier: this.currentLODTier,
      scale: this.currentScale,
      nodeWidth: nodeW,
      forceHideCompartments: prefs ? !prefs.showCompartments : false,
    });
    const portItems = buildPortItems(newNode, this.currentThemeStyles, {
      lodTier: this.currentLODTier,
      scale: this.currentScale,
      forceShowPortTypes: prefs?.showPortTypes ?? false,
    });

    const newCell = this.graph.addNode({
      id: newNode.id,
      shape: SYSML_NODE_NAME,
      x,
      y,
      width: nodeW,
      height: nodeH,
      zIndex: 1 + depth * 2,
      attrs: attrs as any,
      ports: { items: portItems },
      data: {
        viewNode: newNode,
        layer: newNode.layer,
      },
    });

    if (parentNode && parentCell) {
      if (this.collapsedNodes.has(parentNode.id)) {
        this.toggleNodeCollapse(parentNode.id);
      }
      parentCell.addChild(newCell);
      const pAttrs = buildNodeAttrs(parentNode, this.currentThemeStyles, {
        depth: this.calculateNodeDepth(parentNode),
        isCompound: true,
        isCollapsed: false,
        lodTier: this.currentLODTier,
        scale: this.currentScale,
        nodeWidth: parentCell.getSize().width,
        forceHideCompartments: prefs ? !prefs.showCompartments : false,
      });
      parentCell.setAttrs(pAttrs as any);
      this.updateParentBounds(parentNode.id, false);
    }

    this.graph.cleanSelection();
    this.graph.select(newCell);
    this.updateToolbarNodeSummary();
  }

  public applyOptimisticRename(nodeId: string, _oldName: string, newName: string): void {
    const cell = this.graph.getCellById(nodeId) as Node;
    if (!cell || !cell.isNode()) return;
    const data = cell.getData() as { viewNode?: SysMLViewNode } | undefined;
    const vn = data?.viewNode;
    if (!vn) return;
    vn.name = newName;
    const parts = vn.qualifiedName.split("::");
    parts[parts.length - 1] = newName;
    vn.qualifiedName = parts.join("::");

    const attrs = buildNodeAttrs(vn, this.currentThemeStyles, {
      depth: this.calculateNodeDepth(vn),
      isCompound: this.isCompoundNode(vn.id),
      isCollapsed: this.collapsedNodes.has(vn.id),
      lodTier: this.currentLODTier,
      scale: this.currentScale,
      nodeWidth: cell.getSize().width,
      forceHideCompartments: this.layersPanel?.prefs ? !this.layersPanel.prefs.showCompartments : false,
    });
    cell.setAttrs(attrs as any);
  }

  public applyOptimisticDelete(cellIds: string[]): void {
    if (!this.currentViewIR) return;
    const toRemove = new Set<string>(cellIds);
    for (const id of cellIds) {
      for (const desc of this.getDescendantNodeIds(id)) {
        toRemove.add(desc);
      }
    }

    const affectedParents = new Set<string>();
    for (const n of this.currentViewIR.nodes) {
      if (toRemove.has(n.id) && n.parentId && !toRemove.has(n.parentId)) {
        affectedParents.add(n.parentId);
      }
    }

    for (const id of toRemove) {
      const cell = this.graph.getCellById(id);
      if (cell) cell.remove();
    }

    this.currentViewIR.nodes = this.currentViewIR.nodes.filter((n) => !toRemove.has(n.id));
    this.currentViewIR.edges = this.currentViewIR.edges.filter(
      (e) => !toRemove.has(e.id) && !toRemove.has(e.sourceId) && !toRemove.has(e.targetId),
    );
    this.currentViewIR.summary.displayedNodes = this.currentViewIR.nodes.length;
    this.currentViewIR.summary.displayedEdges = this.currentViewIR.edges.length;

    for (const pid of affectedParents) {
      this.updateParentBounds(pid, false);
    }
    this.updateToolbarNodeSummary();
  }

  private buildEdgeAttrs(edge: SysMLViewEdge, theme: ThemeStyles): Record<string, any> {
    if (edge.kind === "specialization") {
      const strokeColor = theme.edge.specializationStroke;
      return {
        line: {
          stroke: strokeColor,
          strokeWidth: 1.5,
          targetMarker: {
            name: "block",
            width: 10,
            height: 8,
            fill: theme.canvasBg,
            stroke: strokeColor,
            strokeWidth: 1.5,
          },
        },
      };
    }

    if (edge.kind === "composition") {
      const strokeColor = theme.edge.specializationStroke;
      return {
        line: {
          stroke: strokeColor,
          strokeWidth: 1.5,
          sourceMarker: {
            name: "diamond",
            width: 11,
            height: 7,
            fill: strokeColor,
            stroke: strokeColor,
          },
          targetMarker: null,
        },
      };
    }

    if (edge.kind === "satisfy" || edge.kind === "verify" || edge.kind === "dependency") {
      const strokeColor =
        edge.kind === "dependency" ? theme.edge.specializationStroke : theme.edge.satisfyStroke;
      return {
        line: {
          stroke: strokeColor,
          strokeWidth: 1.5,
          strokeDasharray: "6 4",
          targetMarker: {
            name: "async",
            size: 8,
            fill: "none",
            stroke: strokeColor,
            strokeWidth: 1.5,
          },
        },
      };
    }

    if (edge.kind === "transition") {
      const strokeColor = theme.edge.transitionStroke;
      return {
        line: {
          stroke: strokeColor,
          strokeWidth: 1.5,
          targetMarker: {
            name: "classic",
            size: 7,
            fill: strokeColor,
            stroke: strokeColor,
          },
        },
      };
    }

    if (edge.kind === "flow") {
      const strokeColor = theme.edge.flowStroke;
      return {
        line: {
          stroke: strokeColor,
          strokeWidth: 1.75,
          targetMarker: {
            name: "block",
            width: 8,
            height: 6,
            fill: strokeColor,
            stroke: strokeColor,
          },
        },
      };
    }

    // SysML v2 structural `connection` (`connect a to b`): clean symmetric binding line without colliding arrowheads
    return {
      line: {
        stroke: theme.edge.connectionStroke,
        strokeWidth: 1.6,
        targetMarker: null,
      },
    };
  }

  private refreshNodeAndEdgeStyles(): void {
    const theme = this.currentThemeStyles;
    if (!this.currentViewIR) return;

    for (const node of this.currentViewIR.nodes) {
      const cell = this.graph.getCellById(node.id);
      if (cell && cell.isNode()) {
        const depth = this.calculateNodeDepth(node);
        const isCompound = this.isCompoundNode(node.id);
        const isCollapsed = this.collapsedNodes.has(node.id);
        const size = cell.getSize();
        const prefs = this.layersPanel?.prefs;
        const attrs = buildNodeAttrs(node, theme, {
          depth,
          isCompound,
          isCollapsed,
          lodTier: this.currentLODTier,
          scale: this.currentScale,
          nodeWidth: size.width,
          forceHideCompartments: prefs ? !prefs.showCompartments : false,
        });
        cell.setAttrs(attrs as any);

        for (const port of node.ports || []) {
          const pinFill = port.conjugated ? theme.port.fill : theme.node.fill;
          const glyphFill = port.conjugated ? "#ffffff" : theme.port.stroke;
          cell.portProp(port.id, "attrs/pin/fill", pinFill);
          cell.portProp(port.id, "attrs/pin/stroke", theme.port.stroke);
          cell.portProp(port.id, "attrs/dirGlyph/fill", glyphFill);
          cell.portProp(port.id, "attrs/text/fill", theme.port.textColor);
          cell.portProp(port.id, "attrs/text/stroke", theme.canvasBg);
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
    if (this.container.clientWidth < 50 || this.container.clientHeight < 50) return;
    this.graph.zoom(0.2);
  }

  public zoomOut(): void {
    if (this.container.clientWidth < 50 || this.container.clientHeight < 50) return;
    this.graph.zoom(-0.2);
  }

  public zoomReset(): void {
    if (this.container.clientWidth < 50 || this.container.clientHeight < 50) return;
    this.graph.zoomTo(1.0);
  }

  public zoomFit(): void {
    if (this.container.clientWidth < 50 || this.container.clientHeight < 50) return;
    try {
      this.graph.zoomToFit({ padding: 36, maxScale: 1.5 });
    } catch (e) {
      console.warn("zoomFit warning:", e);
    }
  }

  public resetLayout(): void {
    this.sidecar.clear();
    if (this.currentViewIR) {
      this.render(this.currentViewIR, this.allViews);
    }
  }

  public getCurrentPositions(): Map<string, { x: number; y: number; width: number; height: number }> {
    const map = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const node of this.graph.getNodes()) {
      const pos = node.getPosition();
      const size = node.getSize();
      map.set(node.id, { x: pos.x, y: pos.y, width: size.width, height: size.height });
    }
    return map;
  }

  // --- Exporters & Importers Integration ---

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

  public exportSvg(): string {
    if (!this.currentViewIR) throw new Error("尚未生成或加载任何架构视图");
    const svgEl = this.graph.container.querySelector("svg");
    if (!svgEl) throw new Error("未找到画布对应的 SVG 矢量渲染图元");
    const src = this.getSourceCallback?.() || "";
    return SvgExporter.export(svgEl, this.currentViewIR, {
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

  public alignSelected(type: "left" | "right" | "top" | "bottom" | "centerH" | "centerV"): boolean {
    if (!this.layersPanel) return false;
    this.layersPanel.alignSelected(type);
    return true;
  }

  public hasRenderedView(): boolean {
    return Boolean(this.currentViewIR && (this.graph.getNodes().length > 0 || this.pendingRender));
  }

  public destroy(): void {
    window.removeEventListener("keydown", this.onKeyDownHandler);
    window.removeEventListener("keyup", this.onKeyUpHandler);

    this.resizeObserver?.disconnect();
    this.zoomCapsuleEl?.remove();
    this.breadcrumbsEl?.remove();

    this.boxSelection?.dispose();
    this.layersPanel?.dispose();
    this.palette?.dispose();
    this.semanticEditor?.dispose();
    this.snaplinePlugin?.dispose();
    this.historyPlugin?.dispose();
    this.selectionPlugin?.dispose();
    this.transformPlugin?.dispose();

    this.graph.dispose();
  }
}
