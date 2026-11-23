export class LayoutManager {
  private ratioMainX = 62; // percentage for left main area (editor + view)
  private ratioLeftY = 50; // percentage for editor height within left main area
  private sidebarOpen = true;
  private maximized: "editor" | "view" | "copilot" | null = null;

  private workbenchEl!: HTMLElement;
  private mainColEl!: HTMLElement;
  private editorPane!: HTMLElement;
  private viewPane!: HTMLElement;
  private copilotPane!: HTMLElement;
  private splitterMainX!: HTMLElement;
  private splitterLeftY!: HTMLElement;
  private sidebarEl!: HTMLElement;

  private maxEditorBtn!: HTMLButtonElement | null;
  private maxViewBtn!: HTMLButtonElement | null;
  private maxCopilotBtn!: HTMLButtonElement | null;

  init() {
    this.workbenchEl = document.querySelector(".workbench") as HTMLElement;
    this.mainColEl = document.getElementById("workbench-main") as HTMLElement;
    this.editorPane = document.getElementById("editor-region") as HTMLElement;
    this.viewPane = document.getElementById("view-region") as HTMLElement;
    this.copilotPane = document.getElementById("copilot-region") as HTMLElement;
    this.splitterMainX = document.getElementById("splitter-main-copilot") as HTMLElement;
    this.splitterLeftY = document.getElementById("splitter-editor-view") as HTMLElement;
    this.sidebarEl = document.getElementById("sidebar") as HTMLElement;

    this.maxEditorBtn = document.getElementById("btn-maximize-editor") as HTMLButtonElement | null;
    this.maxViewBtn = document.getElementById("btn-maximize-view") as HTMLButtonElement | null;
    this.maxCopilotBtn = document.getElementById("btn-maximize-copilot") as HTMLButtonElement | null;

    // Load saved preferences
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

    this.apply();
    this.bindEvents();
  }

  apply() {
    if (!this.workbenchEl) return;

    // Apply maximized state classes
    this.workbenchEl.classList.toggle("maximized-editor", this.maximized === "editor");
    this.workbenchEl.classList.toggle("maximized-view", this.maximized === "view");
    this.workbenchEl.classList.toggle("maximized-copilot", this.maximized === "copilot");

    if (this.maximized === "copilot") {
      if (this.mainColEl) this.mainColEl.style.display = "none";
      if (this.copilotPane) {
        this.copilotPane.style.display = "flex";
        this.copilotPane.style.flex = "1 1 100%";
      }
      if (this.splitterMainX) this.splitterMainX.style.display = "none";
    } else if (this.maximized === "editor" || this.maximized === "view") {
      if (this.copilotPane) this.copilotPane.style.display = "none";
      if (this.splitterMainX) this.splitterMainX.style.display = "none";
      if (this.mainColEl) {
        this.mainColEl.style.display = "flex";
        this.mainColEl.style.flex = "1 1 100%";
      }
      if (this.maximized === "editor") {
        if (this.editorPane) {
          this.editorPane.style.display = "flex";
          this.editorPane.style.flex = "1 1 100%";
        }
        if (this.viewPane) this.viewPane.style.display = "none";
        if (this.splitterLeftY) this.splitterLeftY.style.display = "none";
      } else {
        if (this.editorPane) this.editorPane.style.display = "none";
        if (this.viewPane) {
          this.viewPane.style.display = "flex";
          this.viewPane.style.flex = "1 1 100%";
        }
        if (this.splitterLeftY) this.splitterLeftY.style.display = "none";
      }
    } else {
      // Normal split state
      if (this.mainColEl) {
        this.mainColEl.style.display = "flex";
        this.mainColEl.style.flex = `0 0 ${this.ratioMainX}%`;
      }
      if (this.copilotPane) {
        this.copilotPane.style.display = "flex";
        this.copilotPane.style.flex = `1 1 0`;
      }
      if (this.splitterMainX) this.splitterMainX.style.display = "";

      if (this.editorPane) {
        this.editorPane.style.display = "flex";
        this.editorPane.style.flex = `0 0 ${this.ratioLeftY}%`;
      }
      if (this.viewPane) {
        this.viewPane.style.display = "flex";
        this.viewPane.style.flex = "1 1 0";
      }
      if (this.splitterLeftY) this.splitterLeftY.style.display = "";
    }

    // Apply sidebar state
    const shell = document.getElementById("workspace");
    if (shell) {
      shell.classList.toggle("sidebar-collapsed", !this.sidebarOpen);
    }

    // Update maximize buttons icon & title
    if (this.maxEditorBtn) {
      this.maxEditorBtn.innerHTML = this.maximized === "editor" ? "🗗" : "⤢";
      this.maxEditorBtn.title = this.maximized === "editor" ? "还原窗格" : "最大化编辑器";
    }
    if (this.maxViewBtn) {
      this.maxViewBtn.innerHTML = this.maximized === "view" ? "🗗" : "⤢";
      this.maxViewBtn.title = this.maximized === "view" ? "还原窗格" : "最大化视图";
    }
    if (this.maxCopilotBtn) {
      this.maxCopilotBtn.innerHTML = this.maximized === "copilot" ? "🗗" : "⤢";
      this.maxCopilotBtn.title = this.maximized === "copilot" ? "还原窗格" : "最大化 AI 助手";
    }

    window.dispatchEvent(new Event("resize"));
  }

  resetLayout() {
    this.ratioMainX = 62;
    this.ratioLeftY = 50;
    this.maximized = null;
    this.sidebarOpen = true;
    localStorage.setItem("sysml_split_main_x", "62");
    localStorage.setItem("sysml_split_main_y", "50");
    localStorage.setItem("sysml_sidebar_open", "true");
    this.apply();
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    localStorage.setItem("sysml_sidebar_open", String(this.sidebarOpen));
    this.apply();
  }

  toggleMaximize(target: "editor" | "view" | "copilot") {
    if (this.maximized === target) {
      this.maximized = null;
    } else {
      this.maximized = target;
    }
    this.apply();
  }

  focusEditor() {
    if (this.maximized === "view" || this.maximized === "copilot") {
      this.maximized = null;
      this.apply();
    }
    const ed = document.getElementById("source-editor");
    ed?.scrollIntoView({ behavior: "smooth" });
  }

  focusView() {
    if (this.maximized === "editor" || this.maximized === "copilot") {
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

    // Vertical Splitter: Main (Code+View) vs Copilot (drag left-right)
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

    // Horizontal Splitter: Editor vs View (drag up-down)
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
        if (this.editorPane) this.editorPane.style.flex = `0 0 ${pct}%`;
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
}
