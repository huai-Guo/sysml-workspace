import type { Graph, Node } from "@antv/x6/es";
import type { LayerId } from "./types";
import type { LayoutSidecar } from "./sidecar";

export interface DisplayPreferences {
  showCompartments: boolean;
  showPortTypes: boolean;
  showDefinitions: boolean;
  orthoRouting: boolean;
}

export interface CadLayersPanelCallbacks {
  onDisplayChange?: (prefs: DisplayPreferences) => void;
}

export class CadLayersPanel {
  private container: HTMLElement;
  private graph: Graph;
  private sidecar: LayoutSidecar;
  private popoverEl: HTMLElement;
  private isVisible = false;
  private currentViewType?: string;
  private outsideClickListener: (e: MouseEvent) => void;
  private onDisplayChange?: (prefs: DisplayPreferences) => void;

  public prefs: DisplayPreferences = {
    showCompartments: true,
    showPortTypes: false,
    showDefinitions: true,
    orthoRouting: true,
  };

  constructor(
    container: HTMLElement,
    graph: Graph,
    sidecar: LayoutSidecar,
    options: CadLayersPanelCallbacks = {},
  ) {
    this.container = container;
    this.graph = graph;
    this.sidecar = sidecar;
    this.onDisplayChange = options.onDisplayChange;

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
    if (this.isVisible) {
      const palettePop = document.getElementById("palette-menu-popover");
      const exportPop = document.getElementById("export-menu-popover");
      if (palettePop) palettePop.hidden = true;
      if (exportPop) exportPop.hidden = true;
    }
  }

  public toggleCollapse(collapse?: boolean): void {
    this.toggle(collapse !== undefined ? !collapse : undefined);
  }

  public show(): void {
    this.toggle(true);
  }

  public hide(): void {
    this.toggle(false);
  }

  private render(): void {
    this.popoverEl.replaceChildren();

    const header = document.createElement("div");
    header.className = "popover-header";

    const title = document.createElement("span");
    title.className = "popover-title";
    title.textContent = "视图显示选项";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "popover-close-btn";
    closeBtn.textContent = "×";
    closeBtn.title = "关闭";
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      this.hide();
    };

    header.append(title, closeBtn);
    this.popoverEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "popover-body";

    const optionsList: {
      key: keyof DisplayPreferences;
      label: string;
      desc: string;
    }[] = [
      {
        key: "showCompartments",
        label: "显示内部隔间",
        desc: "展示属性、端口与状态行为分栏",
      },
      {
        key: "showPortTypes",
        label: "显示端口类型",
        desc: "常驻标注端口接口类型 (: PortType)",
      },
      {
        key: "showDefinitions",
        label: "显示定义目录卡",
        desc: "在结构视图中展示 part def / port def",
      },
      {
        key: "orthoRouting",
        label: "正交折线连线",
        desc: "启用水平/垂直曼哈顿直角布线",
      },
    ];

    const listEl = document.createElement("div");
    listEl.className = "display-options-list";

    for (const opt of optionsList) {
      const row = document.createElement("label");
      row.className = "display-option-row";

      const textWrap = document.createElement("div");
      textWrap.className = "display-option-text";

      const lbl = document.createElement("span");
      lbl.className = "display-option-label";
      lbl.textContent = opt.label;

      const sub = document.createElement("small");
      sub.className = "display-option-desc";
      sub.textContent = opt.desc;

      textWrap.append(lbl, sub);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "display-option-check";
      checkbox.checked = this.prefs[opt.key];
      checkbox.onchange = () => {
        this.prefs[opt.key] = checkbox.checked;
        this.applyPreferences();
        this.onDisplayChange?.(this.prefs);
      };

      row.append(textWrap, checkbox);
      listEl.appendChild(row);
    }

    body.appendChild(listEl);
    this.popoverEl.appendChild(body);
  }

  public applyPreferences(): void {
    for (const cell of this.graph.getCells()) {
      const cellLayer = (cell.getData() as { layer?: LayerId })?.layer;
      if (cellLayer === "L1_Definitions" && cell.isNode()) {
        if (this.prefs.showDefinitions || this.currentViewType !== "general") {
          cell.show();
        } else {
          cell.hide();
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
      for (const b of bboxes) b.node.position(minX, b.bbox.y);
    } else if (type === "right") {
      const maxR = Math.max(...bboxes.map((b) => b.bbox.x + b.bbox.width));
      for (const b of bboxes) b.node.position(maxR - b.bbox.width, b.bbox.y);
    } else if (type === "top") {
      const minY = Math.min(...bboxes.map((b) => b.bbox.y));
      for (const b of bboxes) b.node.position(b.bbox.x, minY);
    } else if (type === "bottom") {
      const maxB = Math.max(...bboxes.map((b) => b.bbox.y + b.bbox.height));
      for (const b of bboxes) b.node.position(b.bbox.x, maxB - b.bbox.height);
    } else if (type === "centerH") {
      const minX = Math.min(...bboxes.map((b) => b.bbox.x));
      const maxR = Math.max(...bboxes.map((b) => b.bbox.x + b.bbox.width));
      const midX = (minX + maxR) / 2;
      for (const b of bboxes) b.node.position(midX - b.bbox.width / 2, b.bbox.y);
    } else if (type === "centerV") {
      const minY = Math.min(...bboxes.map((b) => b.bbox.y));
      const maxB = Math.max(...bboxes.map((b) => b.bbox.y + b.bbox.height));
      const midY = (minY + maxB) / 2;
      for (const b of bboxes) b.node.position(b.bbox.x, midY - b.bbox.height / 2);
    }
  }

  public distributeSelected(direction: "horizontal" | "vertical"): void {
    const selected = this.graph.getSelectedCells().filter((c): c is Node => c.isNode());
    if (selected.length < 3) return;

    if (direction === "horizontal") {
      selected.sort((a, b) => a.getPosition().x - b.getPosition().x);
      const first = selected[0].getPosition().x;
      const last = selected[selected.length - 1].getPosition().x;
      const step = (last - first) / (selected.length - 1);
      for (let i = 1; i < selected.length - 1; i++) {
        selected[i].position(first + i * step, selected[i].getPosition().y);
      }
    } else {
      selected.sort((a, b) => a.getPosition().y - b.getPosition().y);
      const first = selected[0].getPosition().y;
      const last = selected[selected.length - 1].getPosition().y;
      const step = (last - first) / (selected.length - 1);
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
