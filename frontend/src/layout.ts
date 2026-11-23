export type SplitDirection = "row" | "column";

export class LayoutManager {
  private direction: SplitDirection = "row";
  private ratio = 52; // percentage for editor pane
  private sidebarOpen = true;
  private maximized: "editor" | "result" | null = null;

  private workbenchEl!: HTMLElement;
  private editorPane!: HTMLElement;
  private resultPane!: HTMLElement;
  private resizerEl!: HTMLElement;
  private sidebarEl!: HTMLElement;
  private splitBtn!: HTMLButtonElement;
  private maxEditorBtn!: HTMLButtonElement;
  private maxResultBtn!: HTMLButtonElement;

  init() {
    this.workbenchEl = document.querySelector(".workbench") as HTMLElement;
    this.editorPane = document.querySelector(".editor-pane") as HTMLElement;
    this.resultPane = document.querySelector(".result-pane") as HTMLElement;
    this.resizerEl = document.getElementById("pane-resizer") as HTMLElement;
    this.sidebarEl = document.getElementById("sidebar") as HTMLElement;

    this.splitBtn = document.getElementById("btn-layout-split") as HTMLButtonElement;
    this.maxEditorBtn = document.getElementById("btn-maximize-editor") as HTMLButtonElement;
    this.maxResultBtn = document.getElementById("btn-maximize-result") as HTMLButtonElement;

    // Load saved preferences
    const savedDir = localStorage.getItem("sysml_layout_dir") as SplitDirection | null;
    if (savedDir === "row" || savedDir === "column") {
      this.direction = savedDir;
    }
    const savedRatio = localStorage.getItem("sysml_layout_ratio");
    if (savedRatio) {
      const num = parseFloat(savedRatio);
      if (!isNaN(num) && num >= 15 && num <= 85) {
        this.ratio = num;
      }
    }
    const savedSidebar = localStorage.getItem("sysml_sidebar_open");
    if (savedSidebar !== null) {
      this.sidebarOpen = savedSidebar === "true";
    }

    this.apply();
    this.bindEvents();
  }

  private apply() {
    if (!this.workbenchEl) return;

    // Apply direction
    this.workbenchEl.classList.toggle("layout-row", this.direction === "row");
    this.workbenchEl.classList.toggle("layout-column", this.direction === "column");

    // Apply maximized state
    this.workbenchEl.classList.toggle("maximized-editor", this.maximized === "editor");
    this.workbenchEl.classList.toggle("maximized-result", this.maximized === "result");

    if (this.maximized) {
      this.editorPane.style.flex = "";
      this.resultPane.style.flex = "";
    } else {
      if (this.direction === "row") {
        this.editorPane.style.flex = `0 0 ${this.ratio}%`;
        this.editorPane.style.height = "";
        this.resultPane.style.flex = "1 1 0";
      } else {
        this.editorPane.style.flex = `0 0 ${this.ratio}%`;
        this.editorPane.style.width = "";
        this.resultPane.style.flex = "1 1 0";
      }
    }

    // Apply sidebar state
    const shell = document.getElementById("workspace");
    if (shell) {
      shell.classList.toggle("sidebar-collapsed", !this.sidebarOpen);
    }

    // Update button labels
    if (this.splitBtn) {
      this.splitBtn.innerHTML = this.direction === "row" 
        ? `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm6 1H2v8h6V4zm1 8h5V4H9v8z"/></svg> 左右分栏` 
        : `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2 3h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm0 1v3h12V4H2zm12 5H2v3h12V9z"/></svg> 上下分栏`;
      this.splitBtn.title = this.direction === "row" ? "切换为上下分栏布局" : "切换为左右分栏布局";
    }

    if (this.maxEditorBtn) {
      this.maxEditorBtn.innerHTML = this.maximized === "editor" ? "🗗" : "⤢";
      this.maxEditorBtn.title = this.maximized === "editor" ? "还原窗格" : "最大化编辑区";
    }

    if (this.maxResultBtn) {
      this.maxResultBtn.innerHTML = this.maximized === "result" ? "🗗" : "⤢";
      this.maxResultBtn.title = this.maximized === "result" ? "还原窗格" : "最大化右侧区";
    }

    // Notify window resize so diagram / CodeMirror measure properly
    window.dispatchEvent(new Event("resize"));
  }

  toggleDirection() {
    this.direction = this.direction === "row" ? "column" : "row";
    localStorage.setItem("sysml_layout_dir", this.direction);
    this.maximized = null;
    this.apply();
  }

  resetLayout() {
    this.ratio = 52;
    this.direction = "row";
    this.maximized = null;
    this.sidebarOpen = true;
    localStorage.setItem("sysml_layout_ratio", "52");
    localStorage.setItem("sysml_layout_dir", "row");
    localStorage.setItem("sysml_sidebar_open", "true");
    this.apply();
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    localStorage.setItem("sysml_sidebar_open", String(this.sidebarOpen));
    this.apply();
  }

  toggleMaximize(target: "editor" | "result") {
    if (this.maximized === target) {
      this.maximized = null;
    } else {
      this.maximized = target;
    }
    this.apply();
  }

  private bindEvents() {
    // Split toggle button
    if (this.splitBtn) {
      this.splitBtn.onclick = () => this.toggleDirection();
    }

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
    if (this.maxResultBtn) {
      this.maxResultBtn.onclick = () => this.toggleMaximize("result");
    }

    // Resizer dragging
    if (!this.resizerEl) return;

    let dragging = false;

    this.resizerEl.addEventListener("mousedown", (e) => {
      if (this.maximized) return;
      e.preventDefault();
      dragging = true;
      this.resizerEl.classList.add("dragging");
      document.body.classList.add("is-resizing");
      document.body.style.cursor = this.direction === "row" ? "col-resize" : "row-resize";
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const rect = this.workbenchEl.getBoundingClientRect();
      if (this.direction === "row") {
        const offset = e.clientX - rect.left;
        const total = rect.width;
        let pct = (offset / total) * 100;
        pct = Math.max(18, Math.min(82, pct));
        this.ratio = pct;
        this.editorPane.style.flex = `0 0 ${pct}%`;
      } else {
        const offset = e.clientY - rect.top;
        const total = rect.height;
        let pct = (offset / total) * 100;
        pct = Math.max(18, Math.min(82, pct));
        this.ratio = pct;
        this.editorPane.style.flex = `0 0 ${pct}%`;
      }
    });

    window.addEventListener("mouseup", () => {
      if (dragging) {
        dragging = false;
        this.resizerEl.classList.remove("dragging");
        document.body.classList.remove("is-resizing");
        document.body.style.cursor = "";
        localStorage.setItem("sysml_layout_ratio", String(Math.round(this.ratio)));
        window.dispatchEvent(new Event("resize"));
      }
    });

    // Double click resizer to reset ratio
    this.resizerEl.addEventListener("dblclick", () => {
      this.ratio = 52;
      localStorage.setItem("sysml_layout_ratio", "52");
      this.apply();
    });
  }
}
