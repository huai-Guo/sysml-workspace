import type { Graph } from "@antv/x6/es";
import type { SysMLViewNode } from "./types";

export interface PaletteItem {
  kind: string;
  label: string;
  badge: string;
  category: "structure" | "behavior" | "requirement";
  defaultPrefix: string;
  description: string;
}

export interface InsertElementEvent {
  kind: string;
  name: string;
  targetParentId?: string;
  position?: { x: number; y: number };
}

export class SysMLPalette {
  private container: HTMLElement;
  private graph: Graph;
  private popoverEl: HTMLElement;
  private isVisible = false;
  private onInsert?: (event: InsertElementEvent) => void;
  private getDefaultParentId?: () => string | undefined;
  private itemCounters: Record<string, number> = {};
  private outsideClickListener: (e: MouseEvent) => void;

  private items: PaletteItem[] = [
    {
      kind: "package",
      label: "包 (Package)",
      badge: "pkg",
      category: "structure",
      defaultPrefix: "SubPkg",
      description: "新增命名空间包容器",
    },
    {
      kind: "part_def",
      label: "部件定义 (Part Def)",
      badge: "def",
      category: "structure",
      defaultPrefix: "ModuleDef",
      description: "新增可复用部件类型定义",
    },
    {
      kind: "part",
      label: "部件实例 (Part)",
      badge: "part",
      category: "structure",
      defaultPrefix: "unit",
      description: "在系统或当前选中容器内新增部件",
    },
    {
      kind: "port_def",
      label: "端口定义 (Port Def)",
      badge: "pdef",
      category: "structure",
      defaultPrefix: "SignalIfc",
      description: "新增接口端口类型定义",
    },
    {
      kind: "port",
      label: "边界端口 (Port)",
      badge: "port",
      category: "structure",
      defaultPrefix: "ioPort",
      description: "在选中定义或部件上新增边界端口",
    },
    {
      kind: "state",
      label: "状态 (State)",
      badge: "state",
      category: "behavior",
      defaultPrefix: "Mode",
      description: "新增状态机行为节点",
    },
    {
      kind: "action",
      label: "动作 (Action)",
      badge: "act",
      category: "behavior",
      defaultPrefix: "ProcessStep",
      description: "新增执行动作步骤",
    },
    {
      kind: "requirement",
      label: "需求规格 (Requirement)",
      badge: "req",
      category: "requirement",
      defaultPrefix: "ReqSpec",
      description: "新增带文档说明的系统需求",
    },
  ];

  constructor(
    container: HTMLElement,
    graph: Graph,
    options: {
      onInsert?: (event: InsertElementEvent) => void;
      getDefaultParentId?: () => string | undefined;
    } = {},
  ) {
    this.container = container;
    this.graph = graph;
    this.onInsert = options.onInsert;
    this.getDefaultParentId = options.getDefaultParentId;

    const existing = document.getElementById("palette-menu-popover");
    if (existing) {
      this.popoverEl = existing;
    } else {
      this.popoverEl = document.createElement("div");
      this.popoverEl.id = "palette-menu-popover";
      this.popoverEl.className = "canvas-palette-popover";
      this.popoverEl.hidden = true;
      container.appendChild(this.popoverEl);
    }

    this.outsideClickListener = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const toggleBtn = document.getElementById("toggle-palette-btn");
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
    this.setupCanvasDrop();
  }

  public toggle(show?: boolean): void {
    this.isVisible = show !== undefined ? show : !this.isVisible;
    this.popoverEl.hidden = !this.isVisible;
    if (this.isVisible) {
      // Close sibling popovers so menus never overlap
      const layersPop = document.getElementById("layers-menu-popover");
      const exportPop = document.getElementById("export-menu-popover");
      if (layersPop) layersPop.hidden = true;
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

  private generateUniqueName(prefix: string, existingSource: string = ""): string {
    for (let i = 1; i < 999; i++) {
      this.itemCounters[prefix] = Math.max(this.itemCounters[prefix] || 0, i);
      const candidate = `${prefix}_${this.itemCounters[prefix]}`;
      if (!existingSource || !new RegExp(`\\b${candidate}\\b`).test(existingSource)) {
        return candidate;
      }
      this.itemCounters[prefix]++;
    }
    return `${prefix}_${Date.now() % 1000}`;
  }

  private resolveActiveParentId(): string | undefined {
    const selected = this.graph.getSelectedCells().filter((c) => c.isNode());
    if (selected.length === 1) {
      const vn = (selected[0].getData() as { viewNode?: SysMLViewNode } | undefined)?.viewNode;
      if (vn && ["package", "definition", "usage", "state"].includes(vn.shapeCategory)) {
        return vn.name;
      }
    }
    return this.getDefaultParentId?.();
  }

  private render(): void {
    this.popoverEl.replaceChildren();

    const header = document.createElement("div");
    header.className = "popover-header";

    const title = document.createElement("span");
    title.className = "popover-title";
    title.textContent = "点击或拖拽新建图元";

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

    const categories: { key: PaletteItem["category"]; label: string }[] = [
      { key: "structure", label: "结构与接口" },
      { key: "behavior", label: "状态与行为" },
      { key: "requirement", label: "需求规格" },
    ];

    for (const cat of categories) {
      const catItems = this.items.filter((it) => it.category === cat.key);
      if (catItems.length === 0) continue;

      const catSection = document.createElement("div");
      catSection.className = "palette-cat-section";

      const catTitle = document.createElement("div");
      catTitle.className = "palette-cat-title";
      catTitle.textContent = cat.label;
      catSection.appendChild(catTitle);

      const itemsGrid = document.createElement("div");
      itemsGrid.className = "palette-items-grid";

      for (const item of catItems) {
        const itemBtn = document.createElement("button");
        itemBtn.type = "button";
        itemBtn.className = "palette-item-card";
        itemBtn.draggable = true;
        itemBtn.title = item.description;

        const badge = document.createElement("span");
        badge.className = "palette-item-badge";
        badge.textContent = item.badge;

        const lbl = document.createElement("span");
        lbl.className = "palette-item-label";
        lbl.textContent = item.label;

        itemBtn.append(badge, lbl);

        itemBtn.onclick = (e) => {
          e.stopPropagation();
          const name = this.generateUniqueName(item.defaultPrefix);
          const targetParentId =
            item.kind === "package" || item.kind === "part_def" || item.kind === "port_def"
              ? undefined
              : this.resolveActiveParentId();
          this.hide();
          this.onInsert?.({
            kind: item.kind,
            name,
            targetParentId,
          });
        };

        itemBtn.ondragstart = (e) => {
          e.dataTransfer?.setData(
            "application/sysml-item",
            JSON.stringify({ kind: item.kind, defaultPrefix: item.defaultPrefix }),
          );
        };

        itemsGrid.appendChild(itemBtn);
      }

      catSection.appendChild(itemsGrid);
      body.appendChild(catSection);
    }

    this.popoverEl.appendChild(body);
  }

  private setupCanvasDrop(): void {
    const mount = this.container.querySelector<HTMLElement>(".x6-graph-mount") || this.container;
    mount.addEventListener("dragover", (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("application/sysml-item")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    });

    mount.addEventListener("drop", (e) => {
      const raw = e.dataTransfer?.getData("application/sysml-item");
      if (!raw) return;
      e.preventDefault();

      try {
        const parsed = JSON.parse(raw);
        const name = this.generateUniqueName(parsed.defaultPrefix || "Item");
        const localPos = this.graph.clientToLocal(e.clientX, e.clientY);

        const nodes = this.graph.getNodes();
        const targetNode = nodes.find((n) => {
          if (!n.isVisible()) return false;
          const pos = n.getPosition();
          const size = n.getSize();
          return (
            localPos.x >= pos.x &&
            localPos.x <= pos.x + size.width &&
            localPos.y >= pos.y &&
            localPos.y <= pos.y + size.height
          );
        });
        const vn = (targetNode?.getData() as { viewNode?: SysMLViewNode } | undefined)?.viewNode;
        const targetParentId = vn?.name;

        this.hide();
        this.onInsert?.({
          kind: parsed.kind,
          name,
          targetParentId,
          position: localPos,
        });
      } catch (err) {
        console.warn("Palette drop parse error:", err);
      }
    });
  }

  public dispose(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener("click", this.outsideClickListener);
    }
    this.popoverEl.remove();
  }
}
