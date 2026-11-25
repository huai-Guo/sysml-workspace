import type { Graph, Cell, Node } from "@antv/x6/es";
import type { LayerId } from "./types";
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
  private popoverEl: HTMLElement;
  private isVisible = false;
  private currentViewType?: string;
  private outsideClickListener: (e: MouseEvent) => void;

  private layers: LayerDef[] = [
    { id: "L1_Definitions", name: "L1 定义元素", color: "#3b82f6", visible: true, locked: false },
    { id: "L2_Structure", name: "L2 结构部件", color: "#10b981", visible: true, locked: false },
    { id: "L3_Behavior", name: "L3 状态行为", color: "#f59e0b", visible: true, locked: false },
    { id: "L4_Connections", name: "L4 连线网络", color: "#8b5cf6", visible: true, locked: false },
    { id: "L5_Requirements", name: "L5 需求约束", color: "#ec4899", visible: true, locked: false },
  ];

  constructor(
    container: HTMLElement,
    graph: Graph,
    sidecar: LayoutSidecar,
    _options: { onSheetToggle?: (visible: boolean) => void } = {},
  ) {
    this.container = container;
    this.graph = graph;
    this.sidecar = sidecar;

    const existing = document.getElementById("layers-menu-popover");
    if (existing) {
      this.popoverEl = existing;
    } else {
      this.popoverEl = document.createElement("div");
      this.popoverEl.id = "layers-menu-popover";
      this.popoverEl.className = "canvas-layers-popover";
      this.popoverEl.hidden = true;
      container.appendChild(this.popoverEl);
    }

    this.outsideClickListener = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const toggleBtn = document.getElementById("toggle-layers-btn");
      if (
        this.isVisible &&
        target &&
        !this.popoverEl.contains(target) &&
        (!toggleBtn || !toggleBtn.contains(target))
      ) {
        this.hide();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("click", this.outsideClickListener);
    }

    this.render();
  }

  public setViewType(viewType?: string): void {
    this.currentViewType = viewType;
  }

  public toggle(show?: boolean): void {
    this.isVisible = show !== undefined ? show : !this.isVisible;
    this.popoverEl.hidden = !this.isVisible;
  }

  public toggleCollapse(collapse?: boolean): void {
    if (collapse !== undefined) {
      this.toggle(!collapse);
    } else {
      this.toggle();
    }
  }

  public show(): void {
    this.toggle(true);
  }

  public hide(): void {
    this.toggle(false);
  }

  private render(): void {
    this.popoverEl.replaceChildren();

    // Header
    const header = document.createElement("div");
    header.className = "popover-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "popover-title-wrap";

    const icon = document.createElement("span");
    icon.className = "popover-icon";
    icon.textContent = "≡";

    const title = document.createElement("span");
    title.className = "popover-title";
    title.textContent = "语义图层过滤与对齐";

    titleWrap.append(icon, title);

    const closeBtn = document.createElement("button");
    closeBtn.className = "popover-close-btn";
    closeBtn.textContent = "✕";
    closeBtn.title = "收起浮层";
    closeBtn.onclick = () => this.hide();

    header.append(titleWrap, closeBtn);
    this.popoverEl.appendChild(header);

    // Body
    const body = document.createElement("div");
    body.className = "popover-body";

    // Section 1: Layer Visibility & Lock
    const layersSection = document.createElement("div");
    layersSection.className = "layers-cat-section";

    const layersTitle = document.createElement("div");
    layersTitle.className = "layers-section-title";
    layersTitle.textContent = "语义元素显隐与锁定";
    layersSection.appendChild(layersTitle);

    const layerList = document.createElement("div");
    layerList.className = "layers-filter-list";

    for (const layer of this.layers) {
      const row = document.createElement("div");
      row.className = "layer-filter-row";

      const left = document.createElement("div");
      left.className = "layer-filter-left";

      const dot = document.createElement("span");
      dot.className = "layer-filter-dot";
      dot.setAttribute("data-layer-id", layer.id);

      const name = document.createElement("span");
      name.className = `layer-filter-name ${layer.visible ? "" : "muted"}`;
      name.textContent = layer.name;

      left.append(dot, name);

      const actions = document.createElement("div");
      actions.className = "layer-filter-actions";

      // Eye visibility button
      const eyeBtn = document.createElement("button");
      eyeBtn.className = `layer-btn-icon ${layer.visible ? "active" : ""}`;
      eyeBtn.textContent = layer.visible ? "👁" : "🕶";
      eyeBtn.title = layer.visible ? "隐藏此图层" : "显示此图层";
      eyeBtn.onclick = () => {
        layer.visible = !layer.visible;
        eyeBtn.textContent = layer.visible ? "👁" : "🕶";
        eyeBtn.classList.toggle("active", layer.visible);
        name.classList.toggle("muted", !layer.visible);
        this.applyLayerVisibility(layer);
      };

      // Lock button
      const lockBtn = document.createElement("button");
      lockBtn.className = `layer-btn-icon ${layer.locked ? "locked" : ""}`;
      lockBtn.textContent = layer.locked ? "🔒" : "🔓";
      lockBtn.title = layer.locked ? "解除锁定" : "锁定此图层防误触";
      lockBtn.onclick = () => {
        layer.locked = !layer.locked;
        lockBtn.textContent = layer.locked ? "🔒" : "🔓";
        lockBtn.classList.toggle("locked", layer.locked);
        this.applyLayerLock(layer);
      };

      actions.append(eyeBtn, lockBtn);
      row.append(left, actions);
      layerList.appendChild(row);
    }
    layersSection.appendChild(layerList);
    body.appendChild(layersSection);

    // Section 2: Alignment & Distribution Tools
    const alignSection = document.createElement("div");
    alignSection.className = "layers-align-section";

    const alignTitle = document.createElement("div");
    alignTitle.className = "layers-section-title";
    alignTitle.textContent = "多选图元对齐与分布";
    alignSection.appendChild(alignTitle);

    const toolsRow1 = document.createElement("div");
    toolsRow1.className = "align-tools-row";

    const toolsRow2 = document.createElement("div");
    toolsRow2.className = "align-tools-row";

    const createToolBtn = (text: string, titleText: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.className = "align-tool-btn";
      b.textContent = text;
      b.title = titleText;
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

    this.popoverEl.appendChild(body);
  }

  private applyLayerVisibility(layer: LayerDef): void {
    const cells = this.graph.getCells();
    for (const cell of cells) {
      const cellLayer = (cell.getData() as { layer?: LayerId })?.layer;
      if (cellLayer === layer.id) {
        if (layer.visible) {
          cell.show();
        } else {
          cell.hide();
        }
      }
    }
  }

  private applyLayerLock(layer: LayerDef): void {
    const cells = this.graph.getCells();
    for (const cell of cells) {
      const cellLayer = (cell.getData() as { layer?: LayerId })?.layer;
      if (cellLayer === layer.id) {
        if (cell.isNode()) {
          const n = cell as Node;
          n.prop("movable", !layer.locked);
          n.prop("resizable", !layer.locked);
        }
      }
    }
  }

  public alignSelected(type: "left" | "right" | "top" | "bottom" | "centerH" | "centerV"): void {
    const selected = this.graph.getSelectedCells().filter((c): c is Node => c.isNode());
    if (selected.length < 2) return;

    const bboxes = selected.map((n) => ({
      node: n,
      bbox: n.getBBox(),
    }));

    if (type === "left") {
      const minX = Math.min(...bboxes.map((b) => b.bbox.x));
      for (const b of bboxes) {
        b.node.position(minX, b.bbox.y);
      }
    } else if (type === "right") {
      const maxR = Math.max(...bboxes.map((b) => b.bbox.x + b.bbox.width));
      for (const b of bboxes) {
        b.node.position(maxR - b.bbox.width, b.bbox.y);
      }
    } else if (type === "top") {
      const minY = Math.min(...bboxes.map((b) => b.bbox.y));
      for (const b of bboxes) {
        b.node.position(b.bbox.x, minY);
      }
    } else if (type === "bottom") {
      const maxB = Math.max(...bboxes.map((b) => b.bbox.y + b.bbox.height));
      for (const b of bboxes) {
        b.node.position(b.bbox.x, maxB - b.bbox.height);
      }
    } else if (type === "centerH") {
      const minX = Math.min(...bboxes.map((b) => b.bbox.x));
      const maxR = Math.max(...bboxes.map((b) => b.bbox.x + b.bbox.width));
      const midX = (minX + maxR) / 2;
      for (const b of bboxes) {
        b.node.position(midX - b.bbox.width / 2, b.bbox.y);
      }
    } else if (type === "centerV") {
      const minY = Math.min(...bboxes.map((b) => b.bbox.y));
      const maxB = Math.max(...bboxes.map((b) => b.bbox.y + b.bbox.height));
      const midY = (minY + maxB) / 2;
      for (const b of bboxes) {
        b.node.position(b.bbox.x, midY - b.bbox.height / 2);
      }
    }
  }

  public distributeSelected(direction: "horizontal" | "vertical"): void {
    const selected = this.graph.getSelectedCells().filter((c): c is Node => c.isNode());
    if (selected.length < 3) return;

    if (direction === "horizontal") {
      selected.sort((a, b) => a.getPosition().x - b.getPosition().x);
      const first = selected[0].getPosition().x;
      const last = selected[selected.length - 1].getPosition().x;
      const totalWidth = selected.slice(0, -1).reduce((acc, n) => acc + n.getSize().width, 0);
      const span = last - first;
      const step = span / (selected.length - 1);
      for (let i = 1; i < selected.length - 1; i++) {
        selected[i].position(first + i * step, selected[i].getPosition().y);
      }
    } else {
      selected.sort((a, b) => a.getPosition().y - b.getPosition().y);
      const first = selected[0].getPosition().y;
      const last = selected[selected.length - 1].getPosition().y;
      const span = last - first;
      const step = span / (selected.length - 1);
      for (let i = 1; i < selected.length - 1; i++) {
        selected[i].position(selected[i].getPosition().x, first + i * step);
      }
    }
  }

  public dispose(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener("click", this.outsideClickListener);
    }
    this.popoverEl.remove();
  }
}
