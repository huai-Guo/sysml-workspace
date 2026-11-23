export type LayoutMode = "merge-right" | "merge-left" | "merge-top" | "merge-bottom" | "grid-4";
export type SlotKey = "tl" | "bl" | "tr" | "br";
export type PanelKey = "editor" | "view" | "copilot" | "diagnostics";

export class LayoutManager {
  private mode: LayoutMode = "merge-right";
  private slots: Record<SlotKey, PanelKey> = {
    tl: "editor",
    bl: "view",
    tr: "copilot",
    br: "diagnostics",
  };
  private ratioColX = 60; // Left column width in % (boundary between Left and Right)
  private ratioRowY = 50; // Top row height in % (boundary between Top and Bottom)
  private sidebarOpen = true;
  private maximizedSlot: SlotKey | null = null;

  private workbenchEl!: HTMLElement;
  private slotEls: Record<SlotKey, HTMLElement> = {} as any;
  private panels: Record<PanelKey, HTMLElement> = {} as any;
  private splitterColX!: HTMLElement;
  private splitterRowY!: HTMLElement;

  private layoutMenuBtn!: HTMLButtonElement | null;
  private layoutMenuDropdown!: HTMLElement | null;
  private layoutLabelEl!: HTMLElement | null;
  private layoutIconEl!: HTMLElement | null;

  init() {
    this.workbenchEl = document.getElementById("workbench") as HTMLElement;
    if (!this.workbenchEl) {
      this.workbenchEl = document.querySelector(".workbench") as HTMLElement;
    }

    this.slotEls = {
      tl: document.getElementById("slot-tl") as HTMLElement,
      bl: document.getElementById("slot-bl") as HTMLElement,
      tr: document.getElementById("slot-tr") as HTMLElement,
      br: document.getElementById("slot-br") as HTMLElement,
    };

    this.panels = {
      editor: document.getElementById("editor-region") as HTMLElement,
      view: document.getElementById("view-region") as HTMLElement,
      copilot: document.getElementById("copilot-region") as HTMLElement,
      diagnostics: document.getElementById("diagnostics-region") as HTMLElement,
    };

    this.splitterColX = document.getElementById("splitter-col-x") as HTMLElement;
    this.splitterRowY = document.getElementById("splitter-row-y") as HTMLElement;

    this.layoutMenuBtn = document.getElementById("btn-layout-menu") as HTMLButtonElement | null;
    this.layoutMenuDropdown = document.getElementById("layout-menu") as HTMLElement | null;
    this.layoutLabelEl = document.getElementById("layout-label") as HTMLElement | null;
    this.layoutIconEl = document.getElementById("layout-icon") as HTMLElement | null;

    // Load saved preferences
    const savedMode = localStorage.getItem("sysml_layout_mode") as LayoutMode | null;
    if (savedMode && ["merge-right", "merge-left", "merge-top", "merge-bottom", "grid-4"].includes(savedMode)) {
      this.mode = savedMode;
    }

    const savedSlots = localStorage.getItem("sysml_slot_panels");
    if (savedSlots) {
      try {
        const parsed = JSON.parse(savedSlots);
        if (parsed && typeof parsed === "object") {
          const validKeys: SlotKey[] = ["tl", "bl", "tr", "br"];
          const validPanels: PanelKey[] = ["editor", "view", "copilot", "diagnostics"];
          if (validKeys.every((k) => validPanels.includes(parsed[k]))) {
            this.slots = parsed;
          }
        }
      } catch {
        // ignore
      }
    }

    const savedColX = localStorage.getItem("sysml_split_col_x");
    if (savedColX) {
      const num = parseFloat(savedColX);
      if (!isNaN(num) && num >= 20 && num <= 80) this.ratioColX = num;
    }
    const savedRowY = localStorage.getItem("sysml_split_row_y");
    if (savedRowY) {
      const num = parseFloat(savedRowY);
      if (!isNaN(num) && num >= 15 && num <= 85) this.ratioRowY = num;
    }
    const savedSidebar = localStorage.getItem("sysml_sidebar_open");
    if (savedSidebar !== null) {
      this.sidebarOpen = savedSidebar === "true";
    }

    this.applyMode();
    this.mountPanels();
    this.applyRatios();
    this.bindEvents();
    this.bindDragAndDrop();
    this.bindLayoutMenu();
  }

  getActiveSlots(): SlotKey[] {
    switch (this.mode) {
      case "merge-right":
        return ["tl", "bl", "tr"];
      case "merge-left":
        return ["tl", "tr", "br"];
      case "merge-bottom":
        return ["tl", "tr", "bl"];
      case "merge-top":
        return ["tl", "bl", "br"];
      case "grid-4":
      default:
        return ["tl", "bl", "tr", "br"];
    }
  }

  isSlotActive(slotKey: SlotKey): boolean {
    return this.getActiveSlots().includes(slotKey);
  }

  getSlotOfPanel(panelKey: PanelKey): SlotKey | null {
    for (const [s, p] of Object.entries(this.slots) as [SlotKey, PanelKey][]) {
      if (p === panelKey) return s;
    }
    return null;
  }

  setMode(newMode: LayoutMode) {
    this.mode = newMode;
    this.maximizedSlot = null;
    localStorage.setItem("sysml_layout_mode", newMode);
    this.applyMode();

    // Ensure core panels ('editor', 'view', 'copilot') are placed in active slots
    const activeSlots = this.getActiveSlots();
    const corePanels: PanelKey[] = ["editor", "view", "copilot"];
    const missingCores = corePanels.filter((p) => {
      const slot = this.getSlotOfPanel(p);
      return !slot || !activeSlots.includes(slot);
    });

    for (const core of missingCores) {
      // Find an active slot holding a non-core panel or another panel
      const targetSlot = activeSlots.find((s) => !corePanels.includes(this.slots[s])) || activeSlots[0];
      if (targetSlot) {
        const curSlot = this.getSlotOfPanel(core);
        if (curSlot) {
          const replaced = this.slots[targetSlot];
          this.slots[targetSlot] = core;
          this.slots[curSlot] = replaced;
        }
      }
    }

    this.mountPanels();
    this.applyRatios();
    window.dispatchEvent(new Event("resize"));
  }

  private applyMode() {
    if (!this.workbenchEl) return;
    this.workbenchEl.setAttribute("data-layout", this.mode);

    // Update layout menu button
    const modeMeta: Record<LayoutMode, { icon: string; label: string }> = {
      "merge-right": { icon: "◨", label: "右列合并" },
      "merge-left": { icon: "◧", label: "左列合并" },
      "merge-bottom": { icon: "⬓", label: "底行合并" },
      "merge-top": { icon: "⬒", label: "顶行合并" },
      "grid-4": { icon: "⊞", label: "四宫格" },
    };

    const meta = modeMeta[this.mode] || modeMeta["merge-right"];
    if (this.layoutIconEl) this.layoutIconEl.textContent = meta.icon;
    if (this.layoutLabelEl) this.layoutLabelEl.textContent = meta.label;

    // Update active state in dropdown
    document.querySelectorAll(".layout-option").forEach((opt) => {
      const optMode = (opt as HTMLElement).dataset.mode;
      opt.classList.toggle("active", optMode === this.mode);
    });
  }

  mountPanels() {
    const slotKeys: SlotKey[] = ["tl", "bl", "tr", "br"];
    slotKeys.forEach((slotKey) => {
      const panelKey = this.slots[slotKey];
      const slotEl = this.slotEls[slotKey];
      const panelEl = this.panels[panelKey];
      if (slotEl && panelEl && panelEl.parentElement !== slotEl) {
        slotEl.appendChild(panelEl);
      }
    });

    localStorage.setItem("sysml_slot_panels", JSON.stringify(this.slots));
  }

  swapSlots(slotA: SlotKey, slotB: SlotKey) {
    if (slotA === slotB) return;
    const temp = this.slots[slotA];
    this.slots[slotA] = this.slots[slotB];
    this.slots[slotB] = temp;

    this.mountPanels();
    window.dispatchEvent(new Event("resize"));
  }

  swapPanels(panelA: PanelKey, panelB: PanelKey) {
    const slotA = this.getSlotOfPanel(panelA);
    const slotB = this.getSlotOfPanel(panelB);
    if (slotA && slotB) {
      this.swapSlots(slotA, slotB);
    }
  }

  toggleSlotMerge(slotKey: SlotKey) {
    if (this.mode === "grid-4") {
      // In 4-quadrant grid, merge depending on which slot was clicked
      if (slotKey === "tr" || slotKey === "br") {
        this.setMode("merge-right");
      } else if (slotKey === "tl" || slotKey === "bl") {
        this.setMode("merge-left");
      }
    } else {
      // If already in a merged mode, split back into 4-quadrant grid!
      this.setMode("grid-4");
    }
  }

  private applyRatios() {
    if (!this.workbenchEl) return;
    this.workbenchEl.style.setProperty("--col-width-left", `${this.ratioColX}%`);
    this.workbenchEl.style.setProperty("--row-height-top", `${this.ratioRowY}%`);

    // Sidebar state
    const shell = document.getElementById("workspace");
    if (shell) {
      shell.classList.toggle("sidebar-collapsed", !this.sidebarOpen);
    }

    // Maximized classes
    this.workbenchEl.classList.toggle("maximized", this.maximizedSlot !== null);
    (["tl", "bl", "tr", "br"] as SlotKey[]).forEach((s) => {
      this.workbenchEl.classList.toggle(`maximized-${s}`, this.maximizedSlot === s);
    });

    // Update maximize buttons
    const maxButtons: Record<PanelKey, string> = {
      editor: "btn-maximize-editor",
      view: "btn-maximize-view",
      copilot: "btn-maximize-copilot",
      diagnostics: "btn-maximize-diagnostics",
    };

    (Object.keys(maxButtons) as PanelKey[]).forEach((pKey) => {
      const btn = document.getElementById(maxButtons[pKey]) as HTMLButtonElement | null;
      if (btn) {
        const slot = this.getSlotOfPanel(pKey);
        const isMax = slot && this.maximizedSlot === slot;
        btn.innerHTML = isMax ? "🗗" : "⤢";
        btn.title = isMax ? "还原窗格" : "最大化此板块";
      }
    });

    window.dispatchEvent(new Event("resize"));
  }

  resetLayout() {
    this.mode = "merge-right";
    this.ratioColX = 60;
    this.ratioRowY = 50;
    this.slots = {
      tl: "editor",
      bl: "view",
      tr: "copilot",
      br: "diagnostics",
    };
    this.maximizedSlot = null;
    this.sidebarOpen = true;

    localStorage.setItem("sysml_layout_mode", this.mode);
    localStorage.setItem("sysml_slot_panels", JSON.stringify(this.slots));
    localStorage.setItem("sysml_split_col_x", "60");
    localStorage.setItem("sysml_split_row_y", "50");
    localStorage.setItem("sysml_sidebar_open", "true");

    this.applyMode();
    this.mountPanels();
    this.applyRatios();
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    localStorage.setItem("sysml_sidebar_open", String(this.sidebarOpen));
    this.applyRatios();
  }

  toggleMaximize(targetPanel: PanelKey) {
    const slot = this.getSlotOfPanel(targetPanel);
    if (!slot) return;
    if (this.maximizedSlot === slot) {
      this.maximizedSlot = null;
    } else {
      this.maximizedSlot = slot;
    }
    this.applyRatios();
  }

  focusEditor() {
    if (this.maximizedSlot) {
      this.maximizedSlot = null;
      this.applyRatios();
    }
    const edSlot = this.getSlotOfPanel("editor");
    if (edSlot && !this.isSlotActive(edSlot)) {
      this.setMode("grid-4");
    }
    const ed = document.getElementById("source-editor");
    ed?.scrollIntoView({ behavior: "smooth" });
  }

  focusView() {
    if (this.maximizedSlot) {
      this.maximizedSlot = null;
      this.applyRatios();
    }
    const viewSlot = this.getSlotOfPanel("view");
    if (viewSlot && !this.isSlotActive(viewSlot)) {
      this.setMode("grid-4");
    }
    const view = document.getElementById("view-region");
    view?.scrollIntoView({ behavior: "smooth" });
  }

  private bindEvents() {
    // Reset layout button
    const resetBtn = document.getElementById("btn-layout-reset");
    if (resetBtn) {
      resetBtn.onclick = () => this.resetLayout();
    }

    // Sidebar toggle buttons
    const sidebarToggles = document.querySelectorAll(".btn-toggle-sidebar");
    sidebarToggles.forEach((btn) => {
      (btn as HTMLElement).onclick = () => this.toggleSidebar();
    });

    // Maximize buttons
    const maxButtons: Record<PanelKey, string> = {
      editor: "btn-maximize-editor",
      view: "btn-maximize-view",
      copilot: "btn-maximize-copilot",
      diagnostics: "btn-maximize-diagnostics",
    };

    (Object.keys(maxButtons) as PanelKey[]).forEach((pKey) => {
      const btn = document.getElementById(maxButtons[pKey]) as HTMLButtonElement | null;
      if (btn) {
        btn.onclick = () => this.toggleMaximize(pKey);
      }
    });

    // Slot merge/split buttons on panel headers
    document.querySelectorAll<HTMLButtonElement>(".btn-slot-merge").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const panelEl = btn.closest<HTMLElement>("[data-panel], .editor-pane, .view-pane, .copilot-pane, .diagnostics-pane");
        if (!panelEl) return;
        const panelKey = this.getPanelKeyFromElement(panelEl);
        if (panelKey) {
          const slotKey = this.getSlotOfPanel(panelKey);
          if (slotKey) this.toggleSlotMerge(slotKey);
        }
      };
    });

    // Swap buttons
    document.querySelectorAll<HTMLButtonElement>(".btn-swap-panel").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const fromPanel = (btn.dataset.panel as PanelKey) || this.getPanelKeyFromElement(btn.closest(".editor-pane, .view-pane, .copilot-pane, .diagnostics-pane") as HTMLElement);
        if (!fromPanel) return;
        const curSlot = this.getSlotOfPanel(fromPanel);
        if (!curSlot) return;

        const activeSlots = this.getActiveSlots();
        const curIdx = activeSlots.indexOf(curSlot);
        const nextIdx = (curIdx + 1) % activeSlots.length;
        const targetSlot = activeSlots[nextIdx];
        this.swapSlots(curSlot, targetSlot);
      };
    });

    // Boundary Splitters Resizing
    this.bindSplitters();
  }

  private getPanelKeyFromElement(el: HTMLElement | null): PanelKey | null {
    if (!el) return null;
    if (el.id === "editor-region" || el.classList.contains("editor-pane")) return "editor";
    if (el.id === "view-region" || el.classList.contains("view-pane")) return "view";
    if (el.id === "copilot-region" || el.classList.contains("copilot-pane")) return "copilot";
    if (el.id === "diagnostics-region" || el.classList.contains("diagnostics-pane")) return "diagnostics";
    return (el.dataset.panel as PanelKey) || null;
  }

  private bindSplitters() {
    // 1. Vertical Splitter for Column boundary (Left vs Right)
    if (this.splitterColX) {
      let draggingCol = false;

      this.splitterColX.addEventListener("mousedown", (e) => {
        if (this.maximizedSlot) return;
        e.preventDefault();
        draggingCol = true;
        this.splitterColX.classList.add("dragging");
        document.body.classList.add("is-resizing");
        document.body.style.cursor = "col-resize";
      });

      window.addEventListener("mousemove", (e) => {
        if (!draggingCol || !this.workbenchEl) return;
        const rect = this.workbenchEl.getBoundingClientRect();
        const offset = e.clientX - rect.left;
        let pct = (offset / rect.width) * 100;
        pct = Math.max(20, Math.min(80, pct));
        this.ratioColX = pct;
        this.workbenchEl.style.setProperty("--col-width-left", `${pct}%`);
      });

      window.addEventListener("mouseup", () => {
        if (draggingCol) {
          draggingCol = false;
          this.splitterColX.classList.remove("dragging");
          document.body.classList.remove("is-resizing");
          document.body.style.cursor = "";
          localStorage.setItem("sysml_split_col_x", String(Math.round(this.ratioColX)));
          window.dispatchEvent(new Event("resize"));
        }
      });

      this.splitterColX.addEventListener("dblclick", () => {
        this.ratioColX = 60;
        localStorage.setItem("sysml_split_col_x", "60");
        this.applyRatios();
      });
    }

    // 2. Horizontal Splitter for Row boundary (Top vs Bottom)
    if (this.splitterRowY) {
      let draggingRow = false;

      this.splitterRowY.addEventListener("mousedown", (e) => {
        if (this.maximizedSlot) return;
        e.preventDefault();
        draggingRow = true;
        this.splitterRowY.classList.add("dragging");
        document.body.classList.add("is-resizing");
        document.body.style.cursor = "row-resize";
      });

      window.addEventListener("mousemove", (e) => {
        if (!draggingRow || !this.workbenchEl) return;
        const rect = this.workbenchEl.getBoundingClientRect();
        const offset = e.clientY - rect.top;
        let pct = (offset / rect.height) * 100;
        pct = Math.max(15, Math.min(85, pct));
        this.ratioRowY = pct;
        this.workbenchEl.style.setProperty("--row-height-top", `${pct}%`);
      });

      window.addEventListener("mouseup", () => {
        if (draggingRow) {
          draggingRow = false;
          this.splitterRowY.classList.remove("dragging");
          document.body.classList.remove("is-resizing");
          document.body.style.cursor = "";
          localStorage.setItem("sysml_split_row_y", String(Math.round(this.ratioRowY)));
          window.dispatchEvent(new Event("resize"));
        }
      });

      this.splitterRowY.addEventListener("dblclick", () => {
        this.ratioRowY = 50;
        localStorage.setItem("sysml_split_row_y", "50");
        this.applyRatios();
      });
    }
  }

  private bindLayoutMenu() {
    if (!this.layoutMenuBtn || !this.layoutMenuDropdown) return;

    this.layoutMenuBtn.onclick = (e) => {
      e.stopPropagation();
      const isHidden = this.layoutMenuDropdown!.hidden;
      this.layoutMenuDropdown!.hidden = !isHidden;
    };

    document.addEventListener("click", (e) => {
      if (
        this.layoutMenuDropdown &&
        !this.layoutMenuDropdown.hidden &&
        !this.layoutMenuDropdown.contains(e.target as Node) &&
        e.target !== this.layoutMenuBtn
      ) {
        this.layoutMenuDropdown.hidden = true;
      }
    });

    document.querySelectorAll<HTMLButtonElement>(".layout-option").forEach((btn) => {
      btn.onclick = () => {
        const mode = btn.dataset.mode as LayoutMode;
        if (mode) {
          this.setMode(mode);
          if (this.layoutMenuDropdown) this.layoutMenuDropdown.hidden = true;
        }
      };
    });
  }

  private bindDragAndDrop() {
    let draggedPanel: PanelKey | null = null;
    const panelKeys: PanelKey[] = ["editor", "view", "copilot", "diagnostics"];

    panelKeys.forEach((key) => {
      const panel = this.panels[key];
      if (!panel) return;

      const header = panel.querySelector(".pane-heading") as HTMLElement;
      if (!header) return;

      header.setAttribute("draggable", "true");
      header.classList.add("draggable-pane-heading");

      header.addEventListener("dragstart", (e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button, input, select, textarea, a, .result-tabs, .file-tab")) {
          if (!target.closest(".pane-drag-handle")) {
            e.preventDefault();
            return;
          }
        }

        draggedPanel = key;
        if (e.dataTransfer) {
          e.dataTransfer.setData("text/plain", key);
          e.dataTransfer.effectAllowed = "move";
        }
        panel.classList.add("is-dragging");
        this.workbenchEl.classList.add("has-drag-active");
      });

      header.addEventListener("dragend", () => {
        draggedPanel = null;
        panel.classList.remove("is-dragging");
        this.workbenchEl.classList.remove("has-drag-active");
        document.querySelectorAll(".workbench-slot").forEach((s) => s.classList.remove("drop-target"));
      });
    });

    // Slots act as drop targets
    const slotKeys: SlotKey[] = ["tl", "bl", "tr", "br"];
    slotKeys.forEach((slotKey) => {
      const slotEl = this.slotEls[slotKey];
      if (!slotEl) return;

      slotEl.addEventListener("dragover", (e) => {
        if (!draggedPanel) return;
        const curSlot = this.getSlotOfPanel(draggedPanel);
        if (curSlot === slotKey) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        slotEl.classList.add("drop-target");
      });

      slotEl.addEventListener("dragenter", (e) => {
        if (!draggedPanel) return;
        const curSlot = this.getSlotOfPanel(draggedPanel);
        if (curSlot === slotKey) return;
        e.preventDefault();
        slotEl.classList.add("drop-target");
      });

      slotEl.addEventListener("dragleave", (e) => {
        const rect = slotEl.getBoundingClientRect();
        if (
          e.clientX <= rect.left ||
          e.clientX >= rect.right ||
          e.clientY <= rect.top ||
          e.clientY >= rect.bottom
        ) {
          slotEl.classList.remove("drop-target");
        }
      });

      slotEl.addEventListener("drop", (e) => {
        e.preventDefault();
        slotEl.classList.remove("drop-target");
        document.querySelectorAll(".workbench-slot").forEach((s) => s.classList.remove("drop-target"));

        const sourcePanel = (e.dataTransfer?.getData("text/plain") as PanelKey) || draggedPanel;
        if (sourcePanel) {
          const fromSlot = this.getSlotOfPanel(sourcePanel);
          if (fromSlot && fromSlot !== slotKey) {
            this.swapSlots(fromSlot, slotKey);
          }
        }
        draggedPanel = null;
        this.workbenchEl.classList.remove("has-drag-active");
      });
    });
  }
}
