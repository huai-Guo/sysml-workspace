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
  private paletteEl: HTMLDivElement;
  private isCollapsed = false;
  private onInsert?: (event: InsertElementEvent) => void;
  private itemCounters: Record<string, number> = {};

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

    this.paletteEl = document.createElement("div");
    this.paletteEl.className = "sysml-palette";
    this.paletteEl.style.position = "absolute";
    this.paletteEl.style.top = "24px";
    this.paletteEl.style.left = "24px";
    this.paletteEl.style.width = "180px";
    this.paletteEl.style.maxHeight = "calc(100% - 60px)";
    this.paletteEl.style.backgroundColor = "var(--bg-card, #131b26)";
    this.paletteEl.style.border = "1px solid var(--border-subtle, #273549)";
    this.paletteEl.style.borderRadius = "6px";
    this.paletteEl.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.4)";
    this.paletteEl.style.zIndex = "16";
    this.paletteEl.style.display = "flex";
    this.paletteEl.style.flexDirection = "column";
    this.paletteEl.style.overflow = "hidden";
    this.paletteEl.style.fontSize = "12px";
    this.paletteEl.style.transition = "transform 0.2s ease, width 0.2s ease";

    container.appendChild(this.paletteEl);

    this.render();
  }

  public toggleCollapse(collapse?: boolean): void {
    this.isCollapsed = collapse !== undefined ? collapse : !this.isCollapsed;
    if (this.isCollapsed) {
      this.paletteEl.classList.add("collapsed");
      this.paletteEl.style.width = "32px";
      this.paletteEl.style.overflow = "hidden";
    } else {
      this.paletteEl.classList.remove("collapsed");
      this.paletteEl.style.width = "180px";
      this.paletteEl.style.overflow = "visible";
    }
  }

  private generateUniqueName(prefix: string): string {
    this.itemCounters[prefix] = (this.itemCounters[prefix] || 0) + 1;
    return `${prefix}_${this.itemCounters[prefix]}`;
  }

  private render(): void {
    this.paletteEl.replaceChildren();

    // Header
    const header = document.createElement("div");
    header.className = "palette-header";
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
    icon.textContent = "❖";
    icon.style.fontWeight = "bold";
    icon.style.color = "var(--accent-emerald, #10b981)";

    const title = document.createElement("span");
    title.textContent = "SysML v2 元件库";
    title.style.fontWeight = "600";
    title.style.color = "var(--text-primary, #f1f5f9)";

    titleWrap.append(icon, title);

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "palette-toggle-btn";
    toggleBtn.textContent = this.isCollapsed ? "▶" : "◀";
    toggleBtn.style.background = "none";
    toggleBtn.style.border = "none";
    toggleBtn.style.cursor = "pointer";
    toggleBtn.style.color = "var(--text-secondary, #94a3b8)";
    toggleBtn.style.padding = "0 4px";
    toggleBtn.onclick = () => {
      this.toggleCollapse();
      toggleBtn.textContent = this.isCollapsed ? "▶" : "◀";
    };

    header.append(titleWrap, toggleBtn);
    this.paletteEl.appendChild(header);

    // Body
    const body = document.createElement("div");
    body.className = "palette-body";
    body.style.overflowY = "auto";
    body.style.padding = "8px 10px";
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "10px";

    const categories: { key: PaletteItem["category"]; label: string }[] = [
      { key: "structure", label: "结构图元" },
      { key: "behavior", label: "行为与状态" },
      { key: "requirement", label: "需求规格" },
    ];

    for (const cat of categories) {
      const catItems = this.items.filter((it) => it.category === cat.key);
      if (catItems.length === 0) continue;

      const catSection = document.createElement("div");

      const catTitle = document.createElement("div");
      catTitle.textContent = cat.label;
      catTitle.style.fontSize = "10px";
      catTitle.style.fontWeight = "600";
      catTitle.style.color = "var(--text-muted, #64748b)";
      catTitle.style.marginBottom = "4px";
      catSection.appendChild(catTitle);

      const itemsGrid = document.createElement("div");
      itemsGrid.style.display = "flex";
      itemsGrid.style.flexDirection = "column";
      itemsGrid.style.gap = "4px";

      for (const item of catItems) {
        const itemBtn = document.createElement("div");
        itemBtn.className = "palette-item-card";
        itemBtn.draggable = true;
        itemBtn.title = `${item.description} (单击插入或拖拽到画布)`;
        itemBtn.style.display = "flex";
        itemBtn.style.alignItems = "center";
        itemBtn.style.gap = "8px";
        itemBtn.style.padding = "5px 8px";
        itemBtn.style.borderRadius = "4px";
        itemBtn.style.backgroundColor = "var(--bg-card-hover, rgba(255,255,255,0.03))";
        itemBtn.style.border = "1px solid var(--border-subtle, #273549)";
        itemBtn.style.cursor = "grab";
        itemBtn.style.userSelect = "none";
        itemBtn.style.transition = "background-color 0.15s, border-color 0.15s";

        itemBtn.onmouseenter = () => {
          itemBtn.style.backgroundColor = "rgba(56, 189, 248, 0.1)";
          itemBtn.style.borderColor = "var(--accent-blue, #38bdf8)";
        };
        itemBtn.onmouseleave = () => {
          itemBtn.style.backgroundColor = "var(--bg-card-hover, rgba(255,255,255,0.03))";
          itemBtn.style.borderColor = "var(--border-subtle, #273549)";
        };

        const ico = document.createElement("span");
        ico.textContent = item.icon;
        ico.style.fontSize = "13px";

        const lbl = document.createElement("span");
        lbl.textContent = item.label;
        lbl.style.fontSize = "11px";
        lbl.style.fontWeight = "500";
        lbl.style.color = "var(--text-primary, #f1f5f9)";

        itemBtn.append(ico, lbl);

        // Click to insert at center of graph viewport
        itemBtn.onclick = () => {
          const name = this.generateUniqueName(item.defaultPrefix);
          const center = this.graph.getGraphArea().center;
          this.onInsert?.({
            kind: item.kind,
            name,
            position: { x: center.x, y: center.y },
          });
        };

        // HTML5 drag support
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

    this.paletteEl.appendChild(body);

    // Setup canvas drop target
    this.setupCanvasDrop();
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

        // Check if dropped onto a node container
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
    this.paletteEl.remove();
  }
}
