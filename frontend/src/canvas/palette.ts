import type { Graph } from "@antv/x6/es";

export interface PaletteItem {
  kind: string;
  label: string;
  icon: string;
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
  private itemCounters: Record<string, number> = {};
  private outsideClickListener: (e: MouseEvent) => void;

  private items: PaletteItem[] = [
    {
      kind: "package",
      label: "Package",
      icon: "📦",
      category: "structure",
      defaultPrefix: "Pkg",
      description: "SysML 顶层或子系统包命名空间",
    },
    {
      kind: "part_def",
      label: "Part Def",
      icon: "⛶",
      category: "structure",
      defaultPrefix: "ComponentDef",
      description: "可复用的部件定义 (Definition 直角框)",
    },
    {
      kind: "part",
      label: "Part",
      icon: "▢",
      category: "structure",
      defaultPrefix: "subsystem",
      description: "系统部件用法实例 (Usage 圆角框)",
    },
    {
      kind: "port",
      label: "Port",
      icon: "▣",
      category: "structure",
      defaultPrefix: "port_io",
      description: "边界交互管脚端口 (EPLAN 贴边管脚)",
    },
    {
      kind: "state",
      label: "State",
      icon: "◯",
      category: "behavior",
      defaultPrefix: "State_Active",
      description: "状态机行为状态 (State 视图圆角框)",
    },
    {
      kind: "action",
      label: "Action",
      icon: "▷",
      category: "behavior",
      defaultPrefix: "ExecuteStep",
      description: "行为动作/执行步骤",
    },
    {
      kind: "requirement",
      label: "Requirement",
      icon: "✦",
      category: "requirement",
      defaultPrefix: "Req_Safety",
      description: "系统需求规格约束 (Requirement 视图)",
    },
  ];

  constructor(
    container: HTMLElement,
    graph: Graph,
    options: { onInsert?: (event: InsertElementEvent) => void } = {},
  ) {
    this.container = container;
    this.graph = graph;
    this.onInsert = options.onInsert;

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

  private generateUniqueName(prefix: string): string {
    this.itemCounters[prefix] = (this.itemCounters[prefix] || 0) + 1;
    return `${prefix}_${this.itemCounters[prefix]}`;
  }

  private render(): void {
    this.popoverEl.replaceChildren();

    const header = document.createElement("div");
    header.className = "popover-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "popover-title-wrap";

    const icon = document.createElement("span");
    icon.className = "popover-icon";
    icon.textContent = "❖";

    const title = document.createElement("span");
    title.className = "popover-title";
    title.textContent = "新建 SysML 图元";

    titleWrap.append(icon, title);

    const closeBtn = document.createElement("button");
    closeBtn.className = "popover-close-btn";
    closeBtn.textContent = "✕";
    closeBtn.title = "收起浮层";
    closeBtn.onclick = () => this.hide();

    header.append(titleWrap, closeBtn);
    this.popoverEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "popover-body";

    const categories: { key: PaletteItem["category"]; label: string }[] = [
      { key: "structure", label: "结构图元" },
      { key: "behavior", label: "行为与状态" },
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
        const itemBtn = document.createElement("div");
        itemBtn.className = "palette-item-card";
        itemBtn.draggable = true;
        itemBtn.title = `${item.description} (单击插入或拖拽到画布)`;

        const ico = document.createElement("span");
        ico.className = "palette-item-icon";
        ico.textContent = item.icon;

        const lbl = document.createElement("span");
        lbl.className = "palette-item-label";
        lbl.textContent = item.label;

        itemBtn.append(ico, lbl);

        itemBtn.onclick = () => {
          const name = this.generateUniqueName(item.defaultPrefix);
          const center = this.graph.getGraphArea().center;
          this.onInsert?.({
            kind: item.kind,
            name,
            position: { x: center.x, y: center.y },
          });
          this.hide();
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
    mount.ondragover = (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };

    mount.ondrop = (e) => {
      e.preventDefault();
      const raw = e.dataTransfer?.getData("application/sysml-item");
      if (!raw) return;

      try {
        const parsed = JSON.parse(raw);
        const name = this.generateUniqueName(parsed.defaultPrefix || "Item");
        const rect = mount.getBoundingClientRect();
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;
        const localPos = this.graph.clientToLocal(clientX, clientY);

        const nodes = this.graph.getNodes();
        const targetNode = nodes.find((n) => {
          const pos = n.getPosition();
          const size = n.getSize();
          return (
            localPos.x >= pos.x &&
            localPos.x <= pos.x + size.width &&
            localPos.y >= pos.y &&
            localPos.y <= pos.y + size.height
          );
        });
        const targetParentId = targetNode ? targetNode.id : undefined;

        this.onInsert?.({
          kind: parsed.kind,
          name,
          targetParentId,
          position: localPos,
        });
      } catch (err) {
        console.warn("Palette drop parse error:", err);
      }
    };
  }

  public dispose(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener("click", this.outsideClickListener);
    }
    this.popoverEl.remove();
  }
}
