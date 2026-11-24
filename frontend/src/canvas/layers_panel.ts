import type { Graph, Cell, Node } from "@antv/x6/es";
import type { LayerId, SysMLViewNode } from "./types";
import type { LayoutSidecar } from "./sidecar";

export interface LayerDef {
  id: LayerId;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
}

export class CadLayersPanel {
  private container: HTMLElement;
  private graph: Graph;
  private sidecar: LayoutSidecar;
  private panelEl: HTMLDivElement;
  private isCollapsed = false;
  private selectedNode: Node | null = null;
  private currentViewType?: string;
  private onSheetToggle?: (visible: boolean) => void;

  private layers: LayerDef[] = [
    { id: "L0_Frame", name: "L0 图纸图框", color: "#64748b", visible: true, locked: false },
    { id: "L1_Definitions", name: "L1 定义元素", color: "#3b82f6", visible: true, locked: false },
    { id: "L2_Structure", name: "L2 结构部件", color: "#10b981", visible: true, locked: false },
    { id: "L3_Behavior", name: "L3 状态行为", color: "#f59e0b", visible: true, locked: false },
    { id: "L4_Connections", name: "L4 连线网络", color: "#8b5cf6", visible: true, locked: false },
    { id: "L5_Requirements", name: "L5 需求约束", color: "#ec4899", visible: true, locked: false },
  ];

  // Inspector DOM references
  private inspectorCard!: HTMLDivElement;
  private elemNameEl!: HTMLSpanElement;
  private elemKindEl!: HTMLSpanElement;
  private inputX!: HTMLInputElement;
  private inputY!: HTMLInputElement;
  private inputW!: HTMLInputElement;
  private inputH!: HTMLInputElement;
  private noSelectionHint!: HTMLDivElement;

  constructor(
    container: HTMLElement,
    graph: Graph,
    sidecar: LayoutSidecar,
    options: { onSheetToggle?: (visible: boolean) => void } = {},
  ) {
    this.container = container;
    this.graph = graph;
    this.sidecar = sidecar;
    this.onSheetToggle = options.onSheetToggle;

    this.panelEl = document.createElement("div");
    this.panelEl.className = "cad-layers-panel";
    this.panelEl.style.position = "absolute";
    this.panelEl.style.top = "24px";
    this.panelEl.style.right = "8px";
    this.panelEl.style.width = "240px";
    this.panelEl.style.maxHeight = "calc(100% - 60px)";
    this.panelEl.style.backgroundColor = "var(--bg-card, #131b26)";
    this.panelEl.style.border = "1px solid var(--border-subtle, #273549)";
    this.panelEl.style.borderRadius = "6px";
    this.panelEl.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.4)";
    this.panelEl.style.zIndex = "16";
    this.panelEl.style.display = "flex";
    this.panelEl.style.flexDirection = "column";
    this.panelEl.style.overflow = "hidden";
    this.panelEl.style.fontSize = "12px";
    this.panelEl.style.transition = "transform 0.2s ease, width 0.2s ease";

    container.appendChild(this.panelEl);

    this.render();
    this.bindGraphEvents();
  }

  public setViewType(viewType?: string): void {
    this.currentViewType = viewType;
  }

  public toggleCollapse(collapse?: boolean): void {
    this.isCollapsed = collapse !== undefined ? collapse : !this.isCollapsed;
    if (this.isCollapsed) {
      this.panelEl.classList.add("collapsed");
      this.panelEl.style.width = "32px";
      this.panelEl.style.overflow = "hidden";
    } else {
      this.panelEl.classList.remove("collapsed");
      this.panelEl.style.width = "240px";
      this.panelEl.style.overflow = "visible";
    }
  }

  private render(): void {
    this.panelEl.replaceChildren();

    // Header
    const header = document.createElement("div");
    header.className = "cad-panel-header";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.padding = "7px 10px";
    header.style.backgroundColor = "var(--bg-card-header, #192332)";
    header.style.borderBottom = "1px solid var(--border-subtle, #273549)";
    header.style.userSelect = "none";

    const titleWrap = document.createElement("div");
    titleWrap.style.display = "flex";
    titleWrap.style.alignItems = "center";
    titleWrap.style.gap = "6px";

    const icon = document.createElement("span");
    icon.textContent = "≡";
    icon.style.fontWeight = "bold";
    icon.style.color = "var(--accent-blue, #38bdf8)";

    const title = document.createElement("span");
    title.textContent = "CAD 图层与数值属性";
    title.style.fontWeight = "600";
    title.style.color = "var(--text-primary, #f1f5f9)";

    titleWrap.append(icon, title);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "cad-panel-toggle-btn";
    toggleBtn.textContent = this.isCollapsed ? "◀" : "▶";
    toggleBtn.style.background = "none";
    toggleBtn.style.border = "none";
    toggleBtn.style.cursor = "pointer";
    toggleBtn.style.color = "var(--text-secondary, #94a3b8)";
    toggleBtn.style.padding = "0 4px";
    toggleBtn.onclick = () => {
      this.toggleCollapse();
      toggleBtn.textContent = this.isCollapsed ? "◀" : "▶";
    };

    header.append(titleWrap, toggleBtn);
    this.panelEl.appendChild(header);

    // Scrollable body
    const body = document.createElement("div");
    body.className = "cad-panel-body";
    body.style.overflowY = "auto";
    body.style.padding = "8px 10px";
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "10px";

    // Section 1: Layers
    const layersSection = document.createElement("div");
    layersSection.className = "cad-layers-section";

    const layersTitle = document.createElement("div");
    layersTitle.textContent = "语义图层 (L0~L5)";
    layersTitle.style.fontSize = "11px";
    layersTitle.style.fontWeight = "600";
    layersTitle.style.color = "var(--text-secondary, #94a3b8)";
    layersTitle.style.marginBottom = "6px";
    layersSection.appendChild(layersTitle);

    const layerList = document.createElement("div");
    layerList.style.display = "flex";
    layerList.style.flexDirection = "column";
    layerList.style.gap = "4px";

    for (const layer of this.layers) {
      const row = document.createElement("div");
      row.className = "cad-layer-row";
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.padding = "3px 6px";
      row.style.borderRadius = "4px";
      row.style.backgroundColor = "var(--bg-card-hover, rgba(255,255,255,0.03))";

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "6px";

      const dot = document.createElement("span");
      dot.style.width = "8px";
      dot.style.height = "8px";
      dot.style.borderRadius = "50%";
      dot.style.backgroundColor = layer.color;

      const name = document.createElement("span");
      name.textContent = layer.name;
      name.style.fontSize = "11px";
      name.style.color = layer.visible ? "var(--text-primary, #f1f5f9)" : "var(--text-muted, #64748b)";

      left.append(dot, name);

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "4px";

      // Eye visibility button
      const eyeBtn = document.createElement("button");
      eyeBtn.className = `cad-layer-btn ${layer.visible ? "active" : ""}`;
      eyeBtn.textContent = layer.visible ? "👁" : "🕶";
      eyeBtn.title = layer.visible ? "隐藏此图层" : "显示此图层";
      eyeBtn.style.background = "none";
      eyeBtn.style.border = "none";
      eyeBtn.style.cursor = "pointer";
      eyeBtn.style.fontSize = "12px";
      eyeBtn.style.opacity = layer.visible ? "1" : "0.5";
      eyeBtn.onclick = () => {
        layer.visible = !layer.visible;
        eyeBtn.textContent = layer.visible ? "👁" : "🕶";
        eyeBtn.style.opacity = layer.visible ? "1" : "0.5";
        name.style.color = layer.visible ? "var(--text-primary, #f1f5f9)" : "var(--text-muted, #64748b)";
        this.applyLayerVisibility(layer);
      };

      // Lock button
      const lockBtn = document.createElement("button");
      lockBtn.className = `cad-layer-btn ${layer.locked ? "locked" : ""}`;
      lockBtn.textContent = layer.locked ? "🔒" : "🔓";
      lockBtn.title = layer.locked ? "解除锁定" : "锁定此图层防误触";
      lockBtn.style.background = "none";
      lockBtn.style.border = "none";
      lockBtn.style.cursor = "pointer";
      lockBtn.style.fontSize = "12px";
      lockBtn.style.opacity = layer.locked ? "1" : "0.5";
      lockBtn.onclick = () => {
        layer.locked = !layer.locked;
        lockBtn.textContent = layer.locked ? "🔒" : "🔓";
        lockBtn.style.opacity = layer.locked ? "1" : "0.5";
        this.applyLayerLock(layer);
      };

      actions.append(eyeBtn, lockBtn);
      row.append(left, actions);
      layerList.appendChild(row);
    }
    layersSection.appendChild(layerList);
    body.appendChild(layersSection);

    // Section 2: Coordinate & Size Inspector
    const inspectorSection = document.createElement("div");
    inspectorSection.className = "cad-inspector-section";
    inspectorSection.style.borderTop = "1px solid var(--border-subtle, #273549)";
    inspectorSection.style.paddingTop = "8px";

    const inspectorTitle = document.createElement("div");
    inspectorTitle.textContent = "精准数值定位 (X, Y, W, H)";
    inspectorTitle.style.fontSize = "11px";
    inspectorTitle.style.fontWeight = "600";
    inspectorTitle.style.color = "var(--text-secondary, #94a3b8)";
    inspectorTitle.style.marginBottom = "6px";
    inspectorSection.appendChild(inspectorTitle);

    this.noSelectionHint = document.createElement("div");
    this.noSelectionHint.textContent = "未选中图元。点击画布图元可直接修改坐标";
    this.noSelectionHint.style.fontSize = "11px";
    this.noSelectionHint.style.color = "var(--text-muted, #64748b)";
    this.noSelectionHint.style.fontStyle = "italic";
    this.noSelectionHint.style.padding = "6px 0";
    inspectorSection.appendChild(this.noSelectionHint);

    this.inspectorCard = document.createElement("div");
    this.inspectorCard.className = "cad-inspector-card";
    this.inspectorCard.style.display = "none";
    this.inspectorCard.style.flexDirection = "column";
    this.inspectorCard.style.gap = "6px";

    const elemHeader = document.createElement("div");
    elemHeader.style.display = "flex";
    elemHeader.style.justifyContent = "space-between";
    elemHeader.style.alignItems = "center";

    this.elemNameEl = document.createElement("span");
    this.elemNameEl.style.fontWeight = "600";
    this.elemNameEl.style.color = "var(--accent-blue, #38bdf8)";
    this.elemNameEl.style.overflow = "hidden";
    this.elemNameEl.style.textOverflow = "ellipsis";
    this.elemNameEl.style.whiteSpace = "nowrap";
    this.elemNameEl.style.maxWidth = "140px";

    this.elemKindEl = document.createElement("span");
    this.elemKindEl.style.fontSize = "10px";
    this.elemKindEl.style.padding = "1px 5px";
    this.elemKindEl.style.borderRadius = "3px";
    this.elemKindEl.style.backgroundColor = "rgba(56, 189, 248, 0.15)";
    this.elemKindEl.style.color = "#38bdf8";

    elemHeader.append(this.elemNameEl, this.elemKindEl);
    this.inspectorCard.appendChild(elemHeader);

    // Inputs 2x2 grid
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "1fr 1fr";
    grid.style.gap = "6px";

    const createField = (label: string, onCommit: (val: number) => void) => {
      const field = document.createElement("div");
      field.style.display = "flex";
      field.style.alignItems = "center";
      field.style.gap = "4px";

      const lbl = document.createElement("span");
      lbl.textContent = label;
      lbl.style.fontSize = "10px";
      lbl.style.fontWeight = "600";
      lbl.style.color = "var(--text-secondary, #94a3b8)";
      lbl.style.width = "14px";

      const inp = document.createElement("input");
      inp.type = "number";
      inp.step = "1";
      inp.style.width = "100%";
      inp.style.boxSizing = "border-box";
      inp.style.padding = "3px 5px";
      inp.style.backgroundColor = "var(--bg-editor, #0d131f)";
      inp.style.border = "1px solid var(--border-subtle, #273549)";
      inp.style.borderRadius = "3px";
      inp.style.color = "var(--text-primary, #f1f5f9)";
      inp.style.fontSize = "11px";
      inp.style.fontFamily = "ui-monospace, monospace";

      inp.onchange = () => {
        const val = parseFloat(inp.value);
        if (!isNaN(val)) onCommit(val);
      };

      field.append(lbl, inp);
      return { field, inp };
    };

    const fx = createField("X:", (val) => this.updateSelectedNodePos(val, undefined));
    this.inputX = fx.inp;
    const fy = createField("Y:", (val) => this.updateSelectedNodePos(undefined, val));
    this.inputY = fy.inp;
    const fw = createField("W:", (val) => this.updateSelectedNodeSize(val, undefined));
    this.inputW = fw.inp;
    const fh = createField("H:", (val) => this.updateSelectedNodeSize(undefined, val));
    this.inputH = fh.inp;

    grid.append(fx.field, fy.field, fw.field, fh.field);
    this.inspectorCard.appendChild(grid);
    inspectorSection.appendChild(this.inspectorCard);
    body.appendChild(inspectorSection);

    // Section 3: Alignment & Distribution Tools
    const alignSection = document.createElement("div");
    alignSection.className = "cad-align-section";
    alignSection.style.borderTop = "1px solid var(--border-subtle, #273549)";
    alignSection.style.paddingTop = "8px";

    const alignTitle = document.createElement("div");
    alignTitle.textContent = "对齐与等距分布";
    alignTitle.style.fontSize = "11px";
    alignTitle.style.fontWeight = "600";
    alignTitle.style.color = "var(--text-secondary, #94a3b8)";
    alignTitle.style.marginBottom = "6px";
    alignSection.appendChild(alignTitle);

    const toolsRow1 = document.createElement("div");
    toolsRow1.style.display = "flex";
    toolsRow1.style.gap = "4px";

    const toolsRow2 = document.createElement("div");
    toolsRow2.style.display = "flex";
    toolsRow2.style.gap = "4px";
    toolsRow2.style.marginTop = "4px";

    const createToolBtn = (text: string, title: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.title = title;
      b.style.flex = "1";
      b.style.padding = "3px 2px";
      b.style.fontSize = "10px";
      b.style.backgroundColor = "var(--bg-card-header, #192332)";
      b.style.border = "1px solid var(--border-subtle, #273549)";
      b.style.borderRadius = "3px";
      b.style.color = "var(--text-primary, #f1f5f9)";
      b.style.cursor = "pointer";
      b.onclick = onClick;
      return b;
    };

    toolsRow1.append(
      createToolBtn("⇤ 左", "左对齐选中图元", () => this.alignSelected("left")),
      createToolBtn("⇥ 右", "右对齐选中图元", () => this.alignSelected("right")),
      createToolBtn("⤒ 顶", "顶对齐选中图元", () => this.alignSelected("top")),
      createToolBtn("⤓ 底", "底对齐选中图元", () => this.alignSelected("bottom")),
    );

    toolsRow2.append(
      createToolBtn("⫿ 居中", "水平居中对齐", () => this.alignSelected("centerH")),
      createToolBtn("⩚ 垂直", "垂直居中对齐", () => this.alignSelected("centerV")),
      createToolBtn("⋯ 间距X", "水平均匀分布", () => this.distributeSelected("horizontal")),
      createToolBtn("⋮ 间距Y", "垂直均匀分布", () => this.distributeSelected("vertical")),
    );

    alignSection.append(toolsRow1, toolsRow2);
    body.appendChild(alignSection);

    this.panelEl.appendChild(body);
  }

  private bindGraphEvents(): void {
    // When cell selected
    this.graph.on("cell:selected", ({ cell }) => {
      if (cell.isNode()) {
        this.selectNode(cell as Node);
      }
    });

    this.graph.on("node:click", ({ node }) => {
      this.selectNode(node);
    });

    this.graph.on("blank:click", () => {
      this.clearSelection();
    });

    this.graph.on("node:moved", ({ node }) => {
      if (this.selectedNode?.id === node.id) {
        this.updateInspectorValues(node);
      }
    });

    this.graph.on("node:resized", ({ node }) => {
      if (this.selectedNode?.id === node.id) {
        this.updateInspectorValues(node);
      }
    });
  }

  public selectNode(node: Node): void {
    this.selectedNode = node;
    this.noSelectionHint.style.display = "none";
    this.inspectorCard.style.display = "flex";

    const data = node.getData() as { viewNode?: SysMLViewNode } | undefined;
    const vn = data?.viewNode;
    this.elemNameEl.textContent = vn?.name || node.id;
    this.elemNameEl.title = vn?.qualifiedName || node.id;
    this.elemKindEl.textContent = vn?.kind || "node";

    this.updateInspectorValues(node);
  }

  public clearSelection(): void {
    this.selectedNode = null;
    this.noSelectionHint.style.display = "block";
    this.inspectorCard.style.display = "none";
  }

  private updateInspectorValues(node: Node): void {
    const pos = node.getPosition();
    const size = node.getSize();
    this.inputX.value = String(Math.round(pos.x));
    this.inputY.value = String(Math.round(pos.y));
    this.inputW.value = String(Math.round(size.width));
    this.inputH.value = String(Math.round(size.height));
  }

  private updateSelectedNodePos(x?: number, y?: number): void {
    if (!this.selectedNode) return;
    const curPos = this.selectedNode.getPosition();
    const newX = x !== undefined ? x : curPos.x;
    const newY = y !== undefined ? y : curPos.y;
    this.selectedNode.setPosition(newX, newY);

    const size = this.selectedNode.getSize();
    this.sidecar.set(
      this.selectedNode.id,
      { x: newX, y: newY, width: size.width, height: size.height, userMoved: true },
      this.currentViewType,
    );
  }

  private updateSelectedNodeSize(w?: number, h?: number): void {
    if (!this.selectedNode) return;
    const curSize = this.selectedNode.getSize();
    const newW = w !== undefined ? Math.max(20, w) : curSize.width;
    const newH = h !== undefined ? Math.max(20, h) : curSize.height;
    this.selectedNode.setSize(newW, newH);

    const pos = this.selectedNode.getPosition();
    this.sidecar.set(
      this.selectedNode.id,
      { x: pos.x, y: pos.y, width: newW, height: newH, userMoved: true },
      this.currentViewType,
    );
  }

  private applyLayerVisibility(layer: LayerDef): void {
    if (layer.id === "L0_Frame") {
      this.onSheetToggle?.(layer.visible);
      return;
    }

    const cells = this.graph.getCells();
    for (const cell of cells) {
      const data = cell.getData() as { viewNode?: SysMLViewNode; layer?: string } | undefined;
      const cellLayer = data?.layer || data?.viewNode?.layer;
      if (cellLayer === layer.id) {
        cell.setVisible(layer.visible);
      }
    }
  }

  private applyLayerLock(layer: LayerDef): void {
    const nodes = this.graph.getNodes();
    for (const node of nodes) {
      const data = node.getData() as { viewNode?: SysMLViewNode; layer?: string } | undefined;
      const cellLayer = data?.layer || data?.viewNode?.layer;
      if (cellLayer === layer.id) {
        node.prop("interacting/nodeMovable", !layer.locked);
      }
    }
  }

  public getSelectedNodes(): Node[] {
    const selected = this.graph.getSelectedCells().filter((c): c is Node => c.isNode());
    if (selected.length === 0 && this.selectedNode) {
      return [this.selectedNode];
    }
    return selected;
  }

  public alignSelected(type: "left" | "right" | "top" | "bottom" | "centerH" | "centerV"): void {
    const nodes = this.getSelectedNodes();
    if (nodes.length < 2) return;

    const bboxes = nodes.map((n) => ({
      node: n,
      pos: n.getPosition(),
      size: n.getSize(),
    }));

    if (type === "left") {
      const minX = Math.min(...bboxes.map((b) => b.pos.x));
      for (const b of bboxes) {
        b.node.setPosition(minX, b.pos.y);
        this.saveNodePos(b.node);
      }
    } else if (type === "right") {
      const maxR = Math.max(...bboxes.map((b) => b.pos.x + b.size.width));
      for (const b of bboxes) {
        b.node.setPosition(maxR - b.size.width, b.pos.y);
        this.saveNodePos(b.node);
      }
    } else if (type === "top") {
      const minY = Math.min(...bboxes.map((b) => b.pos.y));
      for (const b of bboxes) {
        b.node.setPosition(b.pos.x, minY);
        this.saveNodePos(b.node);
      }
    } else if (type === "bottom") {
      const maxB = Math.max(...bboxes.map((b) => b.pos.y + b.size.height));
      for (const b of bboxes) {
        b.node.setPosition(b.pos.x, maxB - b.size.height);
        this.saveNodePos(b.node);
      }
    } else if (type === "centerH") {
      const avgCenterX =
        bboxes.reduce((sum, b) => sum + (b.pos.x + b.size.width / 2), 0) / bboxes.length;
      for (const b of bboxes) {
        b.node.setPosition(avgCenterX - b.size.width / 2, b.pos.y);
        this.saveNodePos(b.node);
      }
    } else if (type === "centerV") {
      const avgCenterY =
        bboxes.reduce((sum, b) => sum + (b.pos.y + b.size.height / 2), 0) / bboxes.length;
      for (const b of bboxes) {
        b.node.setPosition(b.pos.x, avgCenterY - b.size.height / 2);
        this.saveNodePos(b.node);
      }
    }

    if (this.selectedNode) {
      this.updateInspectorValues(this.selectedNode);
    }
  }

  public distributeSelected(direction: "horizontal" | "vertical"): void {
    const nodes = this.getSelectedNodes();
    if (nodes.length < 3) return;

    if (direction === "horizontal") {
      const sorted = [...nodes].sort((a, b) => a.getPosition().x - b.getPosition().x);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan =
        last.getPosition().x +
        last.getSize().width -
        first.getPosition().x;
      const totalWidth = sorted.reduce((sum, n) => sum + n.getSize().width, 0);
      const gap = Math.max(10, (totalSpan - totalWidth) / (sorted.length - 1));

      let curX = first.getPosition().x;
      for (const n of sorted) {
        n.setPosition(curX, n.getPosition().y);
        this.saveNodePos(n);
        curX += n.getSize().width + gap;
      }
    } else {
      const sorted = [...nodes].sort((a, b) => a.getPosition().y - b.getPosition().y);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalSpan =
        last.getPosition().y +
        last.getSize().height -
        first.getPosition().y;
      const totalHeight = sorted.reduce((sum, n) => sum + n.getSize().height, 0);
      const gap = Math.max(10, (totalSpan - totalHeight) / (sorted.length - 1));

      let curY = first.getPosition().y;
      for (const n of sorted) {
        n.setPosition(n.getPosition().x, curY);
        this.saveNodePos(n);
        curY += n.getSize().height + gap;
      }
    }

    if (this.selectedNode) {
      this.updateInspectorValues(this.selectedNode);
    }
  }

  private saveNodePos(node: Node): void {
    const pos = node.getPosition();
    const size = node.getSize();
    this.sidecar.set(
      node.id,
      { x: pos.x, y: pos.y, width: size.width, height: size.height, userMoved: true },
      this.currentViewType,
    );
  }

  public dispose(): void {
    this.panelEl.remove();
  }
}
