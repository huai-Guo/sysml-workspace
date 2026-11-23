export type GroupMode = "combined" | "split";
export type ActiveTab = "editor" | "view" | "diagnostics";

export class LayoutManager {
  private groupMode: GroupMode = "combined";
  private activeTab: ActiveTab = "editor";
  private ratioMainX = 62; // percentage for left main area vs copilot
  private ratioEditorY = 50; // percentage for editor height in split mode
  private mainOnLeft = true; // left/right position swap
  private sidebarOpen = true;
  private maximized: "main" | "editor" | "view" | "copilot" | null = null;

  private workbenchEl!: HTMLElement;
  private mainEl!: HTMLElement;
  private editorEl!: HTMLElement;
  private viewEl!: HTMLElement;
  private copilotEl!: HTMLElement;
  private splitterMainCopilot!: HTMLElement;
  private splitterEditorView!: HTMLElement;

  private navToggleBtn!: HTMLButtonElement | null;
  private navModeText!: HTMLElement | null;
  private navModeIcon!: HTMLElement | null;

  private maxEditorBtn!: HTMLButtonElement | null;
  private maxViewBtn!: HTMLButtonElement | null;
  private maxCopilotBtn!: HTMLButtonElement | null;

  init() {
    this.workbenchEl = document.getElementById("workbench") as HTMLElement;
    this.mainEl = document.getElementById("workbench-main") as HTMLElement;
    this.editorEl = document.getElementById("editor-region") as HTMLElement;
    this.viewEl = document.getElementById("view-region") as HTMLElement;
    this.copilotEl = document.getElementById("copilot-region") as HTMLElement;

    this.splitterMainCopilot = document.getElementById("splitter-main-copilot") as HTMLElement;
    this.splitterEditorView = document.getElementById("splitter-editor-view") as HTMLElement;

    this.navToggleBtn = document.getElementById("btn-toggle-workbench-mode") as HTMLButtonElement | null;
    this.navModeText = document.getElementById("nav-mode-text") as HTMLElement | null;
    this.navModeIcon = document.getElementById("nav-mode-icon") as HTMLElement | null;

    this.maxEditorBtn = document.getElementById("btn-maximize-editor") as HTMLButtonElement | null;
    this.maxViewBtn = document.getElementById("btn-maximize-view") as HTMLButtonElement | null;
    this.maxCopilotBtn = document.getElementById("btn-maximize-copilot") as HTMLButtonElement | null;

    // Load saved preferences
    const savedGroup = localStorage.getItem("sysml_group_mode") as GroupMode | null;
    if (savedGroup === "combined" || savedGroup === "split") {
      this.groupMode = savedGroup;
    }

    const savedActiveTab = localStorage.getItem("sysml_active_tab") as ActiveTab | null;
    if (savedActiveTab === "editor" || savedActiveTab === "view" || savedActiveTab === "diagnostics") {
      this.activeTab = savedActiveTab;
    }

    const savedRatioX = localStorage.getItem("sysml_split_main_x");
    if (savedRatioX) {
      const num = parseFloat(savedRatioX);
      if (!isNaN(num) && num >= 25 && num <= 85) this.ratioMainX = num;
    }

    const savedRatioY = localStorage.getItem("sysml_split_editor_y");
    if (savedRatioY) {
      const num = parseFloat(savedRatioY);
      if (!isNaN(num) && num >= 15 && num <= 85) this.ratioEditorY = num;
    }

    const savedOrder = localStorage.getItem("sysml_main_on_left");
    if (savedOrder !== null) {
      this.mainOnLeft = savedOrder === "true";
    }

    const savedSidebar = localStorage.getItem("sysml_sidebar_open");
    if (savedSidebar !== null) {
      this.sidebarOpen = savedSidebar === "true";
    }

    this.apply();
    this.bindEvents();
    this.bindDragAndDrop();
  }

  setGroupMode(mode: GroupMode) {
    this.groupMode = mode;
    localStorage.setItem("sysml_group_mode", mode);
    this.apply();
  }

  toggleGroupMode() {
    this.setGroupMode(this.groupMode === "combined" ? "split" : "combined");
  }

  setActiveTab(tab: ActiveTab) {
    this.activeTab = tab;
    localStorage.setItem("sysml_active_tab", tab);
    this.apply();
  }

  apply() {
    if (!this.workbenchEl || !this.mainEl) return;

    this.mainEl.setAttribute("data-group-mode", this.groupMode);

    // Apply left/right column order
    if (this.mainOnLeft) {
      this.mainEl.style.order = "1";
      if (this.splitterMainCopilot) this.splitterMainCopilot.style.order = "2";
      if (this.copilotEl) this.copilotEl.style.order = "3";
    } else {
      if (this.copilotEl) this.copilotEl.style.order = "1";
      if (this.splitterMainCopilot) this.splitterMainCopilot.style.order = "2";
      this.mainEl.style.order = "3";
    }

    // Nav button state
    if (this.navModeText) {
      this.navModeText.textContent = this.groupMode === "combined" ? "组合标签页" : "上下拆分分栏";
    }
    if (this.navModeIcon) {
      this.navModeIcon.textContent = this.groupMode === "combined" ? "◫" : "⊟";
    }

    // Toggle button text in pane headers
    document.querySelectorAll(".btn-toggle-combine").forEach((btn) => {
      const icon = btn.querySelector(".combine-icon");
      const text = btn.querySelector(".combine-text");
      if (this.groupMode === "combined") {
        if (icon) icon.textContent = "⊟";
        if (text) text.textContent = "拆分视图";
        btn.setAttribute("title", "拆分为代码与视图独立上下分栏");
      } else {
        if (icon) icon.textContent = "◫";
        if (text) text.textContent = "组合标签页";
        btn.setAttribute("title", "将代码与视图组合为单个标签页窗口 (LeetCode 风格)");
      }
    });

    // Maximized logic
    this.workbenchEl.classList.toggle("maximized-editor", this.maximized === "editor");
    this.workbenchEl.classList.toggle("maximized-view", this.maximized === "view");
    this.workbenchEl.classList.toggle("maximized-copilot", this.maximized === "copilot");
    this.workbenchEl.classList.toggle("maximized-main", this.maximized === "main");

    if (this.maximized) {
      if (this.maximized === "copilot") {
        this.mainEl.style.display = "none";
        if (this.splitterMainCopilot) this.splitterMainCopilot.style.display = "none";
        this.copilotEl.style.display = "flex";
        this.copilotEl.style.flex = "1 1 100%";
      } else {
        this.copilotEl.style.display = "none";
        if (this.splitterMainCopilot) this.splitterMainCopilot.style.display = "none";
        this.mainEl.style.display = "flex";
        this.mainEl.style.flex = "1 1 100%";

        if (this.maximized === "editor") {
          this.editorEl.style.display = "flex";
          this.editorEl.style.flex = "1 1 100%";
          this.viewEl.style.display = "none";
          if (this.splitterEditorView) this.splitterEditorView.style.display = "none";
        } else if (this.maximized === "view") {
          this.viewEl.style.display = "flex";
          this.viewEl.style.flex = "1 1 100%";
          this.editorEl.style.display = "none";
          if (this.splitterEditorView) this.splitterEditorView.style.display = "none";
        }
      }
    } else {
      // Normal non-maximized mode
      this.mainEl.style.display = "flex";
      this.copilotEl.style.display = "flex";
      if (this.splitterMainCopilot) this.splitterMainCopilot.style.display = "flex";

      this.mainEl.style.flex = `0 0 ${this.ratioMainX}%`;
      this.copilotEl.style.flex = "1 1 0";

      if (this.groupMode === "combined") {
        // Combined mode: single window hosting tabs
        if (this.splitterEditorView) this.splitterEditorView.style.display = "none";

        if (this.activeTab === "editor") {
          this.editorEl.style.display = "flex";
          this.editorEl.style.flex = "1 1 100%";
          this.viewEl.style.display = "none";
        } else {
          // 'view' or 'diagnostics'
          this.viewEl.style.display = "flex";
          this.viewEl.style.flex = "1 1 100%";
          this.editorEl.style.display = "none";

          // Select tab inside view
          const tabDiagBtn = document.getElementById("tab-button-diagnostics");
          const tabViewBtn = document.getElementById("tab-button-diagram");
          if (this.activeTab === "diagnostics") {
            tabDiagBtn?.click();
          } else {
            tabViewBtn?.click();
          }
        }
      } else {
        // Split mode: editor top, view bottom
        this.editorEl.style.display = "flex";
        this.viewEl.style.display = "flex";
        if (this.splitterEditorView) this.splitterEditorView.style.display = "flex";

        this.editorEl.style.flex = `0 0 ${this.ratioEditorY}%`;
        this.viewEl.style.flex = "1 1 0";
      }
    }

    // Update active state on horizontal tabs
    this.updateTabStyles();

    // Sidebar state
    const shell = document.getElementById("workspace");
    if (shell) {
      shell.classList.toggle("sidebar-collapsed", !this.sidebarOpen);
    }

    // Update maximize buttons icon
    if (this.maxEditorBtn) this.maxEditorBtn.innerHTML = this.maximized === "editor" ? "🗗" : "⤢";
    if (this.maxViewBtn) this.maxViewBtn.innerHTML = this.maximized === "view" ? "🗗" : "⤢";
    if (this.maxCopilotBtn) this.maxCopilotBtn.innerHTML = this.maximized === "copilot" ? "🗗" : "⤢";

    window.dispatchEvent(new Event("resize"));
  }

  private updateTabStyles() {
    // Top-left combined tabs in editor header
    const tabEditor = document.getElementById("tab-combo-editor");
    const tabView = document.getElementById("tab-combo-view");
    const tabDiag = document.getElementById("tab-combo-diag");

    // Top-left combined tabs in view header
    const tabEditorV = document.getElementById("tab-combo-editor-v");
    const tabViewV = document.getElementById("tab-button-diagram");
    const tabDiagV = document.getElementById("tab-button-diagnostics");

    if (this.groupMode === "combined") {
      tabEditor?.classList.toggle("active", this.activeTab === "editor");
      tabView?.classList.toggle("active", this.activeTab === "view");
      tabDiag?.classList.toggle("active", this.activeTab === "diagnostics");

      tabEditorV?.classList.toggle("active", this.activeTab === "editor");
      tabViewV?.classList.toggle("active", this.activeTab === "view");
      tabDiagV?.classList.toggle("active", this.activeTab === "diagnostics");

      // Show the combined-only tabs in both headers
      document.querySelectorAll(".combined-tab-item").forEach((el) => {
        (el as HTMLElement).style.display = "";
      });
    } else {
      // Split mode: hide extra combined-only tabs
      document.querySelectorAll(".combined-tab-item").forEach((el) => {
        (el as HTMLElement).style.display = "none";
      });
      tabEditor?.classList.add("active");
    }
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    localStorage.setItem("sysml_sidebar_open", String(this.sidebarOpen));
    this.apply();
  }

  toggleMaximize(target: "main" | "editor" | "view" | "copilot") {
    if (this.maximized === target) {
      this.maximized = null;
    } else {
      this.maximized = target;
    }
    this.apply();
  }

  swapColumns() {
    this.mainOnLeft = !this.mainOnLeft;
    localStorage.setItem("sysml_main_on_left", String(this.mainOnLeft));
    this.apply();
  }

  resetLayout() {
    this.groupMode = "combined";
    this.activeTab = "editor";
    this.ratioMainX = 62;
    this.ratioEditorY = 50;
    this.mainOnLeft = true;
    this.maximized = null;
    this.sidebarOpen = true;

    localStorage.setItem("sysml_group_mode", "combined");
    localStorage.setItem("sysml_active_tab", "editor");
    localStorage.setItem("sysml_split_main_x", "62");
    localStorage.setItem("sysml_split_editor_y", "50");
    localStorage.setItem("sysml_main_on_left", "true");
    localStorage.setItem("sysml_sidebar_open", "true");

    this.apply();
  }

  focusEditor() {
    if (this.maximized && this.maximized !== "editor") {
      this.maximized = null;
    }
    this.setActiveTab("editor");
    const ed = document.getElementById("source-editor");
    ed?.scrollIntoView({ behavior: "smooth" });
  }

  focusView() {
    if (this.maximized && this.maximized !== "view") {
      this.maximized = null;
    }
    this.setActiveTab("view");
    const view = document.getElementById("view-region");
    view?.scrollIntoView({ behavior: "smooth" });
  }

  private bindEvents() {
    // Mode toggle in top nav
    if (this.navToggleBtn) {
      this.navToggleBtn.onclick = () => this.toggleGroupMode();
    }

    // Mode toggle buttons in pane headers
    document.querySelectorAll(".btn-toggle-combine").forEach((btn) => {
      (btn as HTMLElement).onclick = (e) => {
        e.stopPropagation();
        this.toggleGroupMode();
      };
    });

    // Reset layout
    const resetBtn = document.getElementById("btn-layout-reset");
    if (resetBtn) {
      resetBtn.onclick = () => this.resetLayout();
    }

    // Sidebar toggles
    document.querySelectorAll(".btn-toggle-sidebar").forEach((btn) => {
      (btn as HTMLElement).onclick = () => this.toggleSidebar();
    });

    // Horizontal top-left tab buttons
    const tabButtons = [
      { id: "tab-combo-editor", tab: "editor" as ActiveTab },
      { id: "tab-combo-editor-v", tab: "editor" as ActiveTab },
      { id: "tab-combo-view", tab: "view" as ActiveTab },
      { id: "tab-combo-diag", tab: "diagnostics" as ActiveTab },
    ];

    tabButtons.forEach(({ id, tab }) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.onclick = (e) => {
          e.stopPropagation();
          this.setActiveTab(tab);
        };
      }
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

    // Swap buttons
    document.querySelectorAll(".btn-swap-panel").forEach((btn) => {
      (btn as HTMLElement).onclick = (e) => {
        e.stopPropagation();
        this.swapColumns();
      };
    });

    // Vertical Splitter: Main Area vs Copilot (resizes ratioMainX)
    if (this.splitterMainCopilot) {
      let draggingMain = false;

      this.splitterMainCopilot.addEventListener("mousedown", (e) => {
        if (this.maximized) return;
        e.preventDefault();
        draggingMain = true;
        this.splitterMainCopilot.classList.add("dragging");
        document.body.classList.add("is-resizing");
        document.body.style.cursor = "col-resize";
      });

      window.addEventListener("mousemove", (e) => {
        if (!draggingMain || !this.workbenchEl) return;
        const rect = this.workbenchEl.getBoundingClientRect();
        const offset = this.mainOnLeft ? e.clientX - rect.left : rect.right - e.clientX;
        let pct = (offset / rect.width) * 100;
        pct = Math.max(25, Math.min(85, pct));
        this.ratioMainX = pct;
        if (this.mainEl) this.mainEl.style.flex = `0 0 ${pct}%`;
      });

      window.addEventListener("mouseup", () => {
        if (draggingMain) {
          draggingMain = false;
          this.splitterMainCopilot.classList.remove("dragging");
          document.body.classList.remove("is-resizing");
          document.body.style.cursor = "";
          localStorage.setItem("sysml_split_main_x", String(Math.round(this.ratioMainX)));
          window.dispatchEvent(new Event("resize"));
        }
      });

      this.splitterMainCopilot.addEventListener("dblclick", () => {
        this.ratioMainX = 62;
        localStorage.setItem("sysml_split_main_x", "62");
        this.apply();
      });
    }

    // Horizontal Splitter: Editor vs View in split mode (resizes ratioEditorY)
    if (this.splitterEditorView) {
      let draggingEditor = false;

      this.splitterEditorView.addEventListener("mousedown", (e) => {
        if (this.maximized || this.groupMode === "combined") return;
        e.preventDefault();
        draggingEditor = true;
        this.splitterEditorView.classList.add("dragging");
        document.body.classList.add("is-resizing");
        document.body.style.cursor = "row-resize";
      });

      window.addEventListener("mousemove", (e) => {
        if (!draggingEditor || !this.mainEl) return;
        const rect = this.mainEl.getBoundingClientRect();
        const offset = e.clientY - rect.top;
        let pct = (offset / rect.height) * 100;
        pct = Math.max(15, Math.min(85, pct));
        this.ratioEditorY = pct;
        if (this.editorEl) this.editorEl.style.flex = `0 0 ${pct}%`;
      });

      window.addEventListener("mouseup", () => {
        if (draggingEditor) {
          draggingEditor = false;
          this.splitterEditorView.classList.remove("dragging");
          document.body.classList.remove("is-resizing");
          document.body.style.cursor = "";
          localStorage.setItem("sysml_split_editor_y", String(Math.round(this.ratioEditorY)));
          window.dispatchEvent(new Event("resize"));
        }
      });

      this.splitterEditorView.addEventListener("dblclick", () => {
        this.ratioEditorY = 50;
        localStorage.setItem("sysml_split_editor_y", "50");
        this.apply();
      });
    }
  }

  private bindDragAndDrop() {
    // Draggable headings for swapping Left Main and Right Copilot
    const regions: HTMLElement[] = [this.mainEl, this.copilotEl].filter(Boolean);

    regions.forEach((region) => {
      const heading = region.querySelector(".pane-heading") as HTMLElement;
      if (!heading) return;

      heading.setAttribute("draggable", "true");
      heading.classList.add("draggable-pane-heading");

      heading.addEventListener("dragstart", (e) => {
        const target = e.target as HTMLElement;
        if (target.closest("button, input, select, textarea, a, .result-tabs, .horizontal-tabs")) {
          if (!target.closest(".pane-drag-handle")) {
            e.preventDefault();
            return;
          }
        }
        e.dataTransfer?.setData("text/plain", region.id);
        region.classList.add("is-dragging");
        this.workbenchEl.classList.add("has-drag-active");
      });

      heading.addEventListener("dragend", () => {
        region.classList.remove("is-dragging");
        this.workbenchEl.classList.remove("has-drag-active");
        regions.forEach((r) => r.classList.remove("drop-target"));
      });

      region.addEventListener("dragover", (e) => {
        e.preventDefault();
        region.classList.add("drop-target");
      });

      region.addEventListener("dragleave", (e) => {
        const rect = region.getBoundingClientRect();
        if (
          e.clientX <= rect.left ||
          e.clientX >= rect.right ||
          e.clientY <= rect.top ||
          e.clientY >= rect.bottom
        ) {
          region.classList.remove("drop-target");
        }
      });

      region.addEventListener("drop", (e) => {
        e.preventDefault();
        region.classList.remove("drop-target");
        this.swapColumns();
        this.workbenchEl.classList.remove("has-drag-active");
      });
    });
  }
}
