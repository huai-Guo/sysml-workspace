export type PanelKey = "editor" | "view" | "copilot";

export class LayoutManager {
  private slots: PanelKey[] = ["editor", "view", "copilot"];
  private ratioMainX = 62; // percentage for left main area
  private ratioLeftY = 50; // percentage for slot 1 height within left main area
  private sidebarOpen = true;
  private maximized: PanelKey | null = null;

  private workbenchEl!: HTMLElement;
  private mainColEl!: HTMLElement;
  private slotEls: HTMLElement[] = [];
  private panels: Record<PanelKey, HTMLElement> = {} as any;
  private splitterMainX!: HTMLElement;
  private splitterLeftY!: HTMLElement;

  private maxEditorBtn!: HTMLButtonElement | null;
  private maxViewBtn!: HTMLButtonElement | null;
  private maxCopilotBtn!: HTMLButtonElement | null;

  init() {
    this.workbenchEl = document.querySelector(".workbench") as HTMLElement;
    this.mainColEl = document.getElementById("workbench-main") as HTMLElement;

    this.slotEls = [
      document.getElementById("slot-1") as HTMLElement,
      document.getElementById("slot-2") as HTMLElement,
      document.getElementById("slot-3") as HTMLElement,
    ];

    this.panels = {
      editor: document.getElementById("editor-region") as HTMLElement,
      view: document.getElementById("view-region") as HTMLElement,
      copilot: document.getElementById("copilot-region") as HTMLElement,
    };

    this.splitterMainX = document.getElementById("splitter-main-copilot") as HTMLElement;
    this.splitterLeftY = document.getElementById("splitter-editor-view") as HTMLElement;

    this.maxEditorBtn = document.getElementById("btn-maximize-editor") as HTMLButtonElement | null;
    this.maxViewBtn = document.getElementById("btn-maximize-view") as HTMLButtonElement | null;
    this.maxCopilotBtn = document.getElementById("btn-maximize-copilot") as HTMLButtonElement | null;

    // Load saved preferences
    const savedSlots = localStorage.getItem("sysml_panel_slots");
    if (savedSlots) {
      try {
        const parsed = JSON.parse(savedSlots);
        if (Array.isArray(parsed) && parsed.length === 3 && ["editor", "view", "copilot"].every((k) => parsed.includes(k))) {
          this.slots = parsed as PanelKey[];
        }
      } catch {
        // ignore
      }
    }

    const savedRatioX = localStorage.getItem("sysml_split_main_x");
    if (savedRatioX) {
      const num = parseFloat(savedRatioX);
      if (!isNaN(num) && num >= 25 && num <= 85) this.ratioMainX = num;
    }
    const savedRatioY = localStorage.getItem("sysml_split_main_y");
    if (savedRatioY) {
      const num = parseFloat(savedRatioY);
      if (!isNaN(num) && num >= 15 && num <= 85) this.ratioLeftY = num;
    }
    const savedSidebar = localStorage.getItem("sysml_sidebar_open");
    if (savedSidebar !== null) {
      this.sidebarOpen = savedSidebar === "true";
    }

    this.mountSlots();
    this.apply();
    this.bindEvents();
    this.bindDragAndDrop();
  }

  mountSlots() {
    this.slots.forEach((key, index) => {
      const slotEl = this.slotEls[index];
      const panelEl = this.panels[key];
      if (slotEl && panelEl && panelEl.parentElement !== slotEl) {
        slotEl.appendChild(panelEl);
      }
    });
  }

  swapPanels(keyA: PanelKey, keyB: PanelKey) {
    if (keyA === keyB) return;
    const idxA = this.slots.indexOf(keyA);
    const idxB = this.slots.indexOf(keyB);
    if (idxA === -1 || idxB === -1) return;

    this.slots[idxA] = keyB;
    this.slots[idxB] = keyA;

    this.mountSlots();
    localStorage.setItem("sysml_panel_slots", JSON.stringify(this.slots));
    this.apply();
    window.dispatchEvent(new Event("resize"));
  }

  apply() {
    if (!this.workbenchEl) return;

    // Apply maximized state classes
    this.workbenchEl.classList.toggle("maximized-editor", this.maximized === "editor");
    this.workbenchEl.classList.toggle("maximized-view", this.maximized === "view");
    this.workbenchEl.classList.toggle("maximized-copilot", this.maximized === "copilot");

    if (this.maximized) {
      const maxKey = this.maximized;
      const maxSlotIdx = this.slots.indexOf(maxKey);

      this.slotEls.forEach((slot, idx) => {
        if (!slot) return;
        if (idx === maxSlotIdx) {
          slot.style.display = "flex";
          slot.style.flex = "1 1 100%";
        } else {
          slot.style.display = "none";
        }
      });

      if (maxSlotIdx === 2) {
        // Slot 3 (right side) maximized
        if (this.mainColEl) this.mainColEl.style.display = "none";
        if (this.splitterMainX) this.splitterMainX.style.display = "none";
      } else {
        // Slot 1 or 2 (left side) maximized
        if (this.mainColEl) {
          this.mainColEl.style.display = "flex";
          this.mainColEl.style.flex = "1 1 100%";
        }
        if (this.splitterMainX) this.splitterMainX.style.display = "none";
        if (this.splitterLeftY) this.splitterLeftY.style.display = "none";
      }
    } else {
      // Normal split state
      if (this.mainColEl) {
        this.mainColEl.style.display = "flex";
        this.mainColEl.style.flex = `0 0 ${this.ratioMainX}%`;
      }
      if (this.splitterMainX) this.splitterMainX.style.display = "";
      if (this.splitterLeftY) this.splitterLeftY.style.display = "";

      if (this.slotEls[0]) {
        this.slotEls[0].style.display = "flex";
        this.slotEls[0].style.flex = `0 0 ${this.ratioLeftY}%`;
      }
      if (this.slotEls[1]) {
        this.slotEls[1].style.display = "flex";
        this.slotEls[1].style.flex = `1 1 0`;
      }
      if (this.slotEls[2]) {
        this.slotEls[2].style.display = "flex";
        this.slotEls[2].style.flex = `1 1 0`;
      }
    }

    // Apply sidebar state
    const shell = document.getElementById("workspace");
    if (shell) {
      shell.classList.toggle("sidebar-collapsed", !this.sidebarOpen);
    }

    // Update maximize buttons icon & title
    if (this.maxEditorBtn) {
      this.maxEditorBtn.innerHTML = this.maximized === "editor" ? "🗗" : "⤢";
      this.maxEditorBtn.title = this.maximized === "editor" ? "还原窗格" : "最大化此板块";
    }
    if (this.maxViewBtn) {
      this.maxViewBtn.innerHTML = this.maximized === "view" ? "🗗" : "⤢";
      this.maxViewBtn.title = this.maximized === "view" ? "还原窗格" : "最大化此板块";
    }
    if (this.maxCopilotBtn) {
      this.maxCopilotBtn.innerHTML = this.maximized === "copilot" ? "🗗" : "⤢";
      this.maxCopilotBtn.title = this.maximized === "copilot" ? "还原窗格" : "最大化此板块";
    }

    window.dispatchEvent(new Event("resize"));
  }

  resetLayout() {
    this.slots = ["editor", "view", "copilot"];
    this.ratioMainX = 62;
    this.ratioLeftY = 50;
    this.maximized = null;
    this.sidebarOpen = true;
    localStorage.setItem("sysml_panel_slots", JSON.stringify(this.slots));
    localStorage.setItem("sysml_split_main_x", "62");
    localStorage.setItem("sysml_split_main_y", "50");
    localStorage.setItem("sysml_sidebar_open", "true");
    this.mountSlots();
    this.apply();
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    localStorage.setItem("sysml_sidebar_open", String(this.sidebarOpen));
    this.apply();
  }

  toggleMaximize(target: PanelKey) {
    if (this.maximized === target) {
      this.maximized = null;
    } else {
      this.maximized = target;
    }
    this.apply();
  }

  focusEditor() {
    if (this.maximized && this.maximized !== "editor") {
      this.maximized = null;
      this.apply();
    }
    const ed = document.getElementById("source-editor");
    ed?.scrollIntoView({ behavior: "smooth" });
  }

  focusView() {
    if (this.maximized && this.maximized !== "view") {
      this.maximized = null;
      this.apply();
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
    if (this.maxEditorBtn) {
      this.maxEditorBtn.onclick = () => this.toggleMaximize("editor");
    }
    if (this.maxViewBtn) {
      this.maxViewBtn.onclick = () => this.toggleMaximize("view");
    }
    if (this.maxCopilotBtn) {
      this.maxCopilotBtn.onclick = () => this.toggleMaximize("copilot");
    }

    // Vertical Splitter: Main (left) vs Right Slot (drag left-right)
    if (this.splitterMainX) {
      let draggingX = false;

      this.splitterMainX.addEventListener("mousedown", (e) => {
        if (this.maximized) return;
        e.preventDefault();
        draggingX = true;
        this.splitterMainX.classList.add("dragging");
        document.body.classList.add("is-resizing");
        document.body.style.cursor = "col-resize";
      });

      window.addEventListener("mousemove", (e) => {
        if (!draggingX) return;
        const rect = this.workbenchEl.getBoundingClientRect();
        const offset = e.clientX - rect.left;
        const total = rect.width;
        let pct = (offset / total) * 100;
        pct = Math.max(25, Math.min(80, pct));
        this.ratioMainX = pct;
        if (this.mainColEl) this.mainColEl.style.flex = `0 0 ${pct}%`;
      });

      window.addEventListener("mouseup", () => {
        if (draggingX) {
          draggingX = false;
          this.splitterMainX.classList.remove("dragging");
          document.body.classList.remove("is-resizing");
          document.body.style.cursor = "";
          localStorage.setItem("sysml_split_main_x", String(Math.round(this.ratioMainX)));
          window.dispatchEvent(new Event("resize"));
        }
      });

      this.splitterMainX.addEventListener("dblclick", () => {
        this.ratioMainX = 62;
        localStorage.setItem("sysml_split_main_x", "62");
        this.apply();
      });
    }

    // Horizontal Splitter: Slot 1 vs Slot 2 (drag up-down)
    if (this.splitterLeftY) {
      let draggingY = false;

      this.splitterLeftY.addEventListener("mousedown", (e) => {
        if (this.maximized) return;
        e.preventDefault();
        draggingY = true;
        this.splitterLeftY.classList.add("dragging");
        document.body.classList.add("is-resizing");
        document.body.style.cursor = "row-resize";
      });

      window.addEventListener("mousemove", (e) => {
        if (!draggingY || !this.mainColEl) return;
        const rect = this.mainColEl.getBoundingClientRect();
        const offset = e.clientY - rect.top;
        const total = rect.height;
        let pct = (offset / total) * 100;
        pct = Math.max(15, Math.min(85, pct));
        this.ratioLeftY = pct;
        if (this.slotEls[0]) this.slotEls[0].style.flex = `0 0 ${pct}%`;
      });

      window.addEventListener("mouseup", () => {
        if (draggingY) {
          draggingY = false;
          this.splitterLeftY.classList.remove("dragging");
          document.body.classList.remove("is-resizing");
          document.body.style.cursor = "";
          localStorage.setItem("sysml_split_main_y", String(Math.round(this.ratioLeftY)));
          window.dispatchEvent(new Event("resize"));
        }
      });

      this.splitterLeftY.addEventListener("dblclick", () => {
        this.ratioLeftY = 50;
        localStorage.setItem("sysml_split_main_y", "50");
        this.apply();
      });
    }
  }

  private bindDragAndDrop() {
    let draggedKey: PanelKey | null = null;

    const panelKeys: PanelKey[] = ["editor", "view", "copilot"];

    panelKeys.forEach((key) => {
      const panel = this.panels[key];
      if (!panel) return;

      const header = panel.querySelector(".pane-heading") as HTMLElement;
      if (!header) return;

      // Make header draggable
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
        draggedKey = key;
        if (e.dataTransfer) {
          e.dataTransfer.setData("text/plain", key);
          e.dataTransfer.effectAllowed = "move";
        }
        panel.classList.add("is-dragging");
        this.workbenchEl.classList.add("has-drag-active");
      });

      header.addEventListener("dragend", () => {
        draggedKey = null;
        panel.classList.remove("is-dragging");
        this.workbenchEl.classList.remove("has-drag-active");
        panelKeys.forEach((k) => this.panels[k]?.classList.remove("drop-target"));
      });

      // Panel acts as drop target
      panel.addEventListener("dragover", (e) => {
        if (!draggedKey || draggedKey === key) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        panel.classList.add("drop-target");
      });

      panel.addEventListener("dragenter", (e) => {
        if (!draggedKey || draggedKey === key) return;
        e.preventDefault();
        panel.classList.add("drop-target");
      });

      panel.addEventListener("dragleave", (e) => {
        // Only remove if leaving the panel boundary
        const rect = panel.getBoundingClientRect();
        if (
          e.clientX <= rect.left ||
          e.clientX >= rect.right ||
          e.clientY <= rect.top ||
          e.clientY >= rect.bottom
        ) {
          panel.classList.remove("drop-target");
        }
      });

      panel.addEventListener("drop", (e) => {
        e.preventDefault();
        panelKeys.forEach((k) => this.panels[k]?.classList.remove("drop-target"));
        const sourceKey = (e.dataTransfer?.getData("text/plain") as PanelKey) || draggedKey;
        if (sourceKey && sourceKey !== key) {
          this.swapPanels(sourceKey, key);
        }
        draggedKey = null;
        this.workbenchEl.classList.remove("has-drag-active");
      });
    });

    // Also bind swap buttons if present
    document.querySelectorAll<HTMLButtonElement>(".btn-swap-panel").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const fromKey = btn.dataset.panel as PanelKey;
        // Cycle swap with next slot
        const curIdx = this.slots.indexOf(fromKey);
        const nextIdx = (curIdx + 1) % this.slots.length;
        const targetKey = this.slots[nextIdx];
        this.swapPanels(fromKey, targetKey);
      };
    });
  }
}
