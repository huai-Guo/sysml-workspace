export type TabId = "editor" | "view" | "diagnostics" | "copilot";
export type PaneId = "editor-region" | "view-region" | "copilot-region";

export interface TabDef {
  id: TabId;
  label: string;
  iconHtml: string;
  tooltip: string;
  subTag?: string;
  badgeId?: string;
}

export interface PaneState {
  tabs: TabId[];
  activeTab: TabId;
}

export interface DockState {
  panes: Record<PaneId, PaneState>;
  ratioMainX: number; // percentage width for left column vs copilot
  ratioLeftY: number; // percentage height for top pane vs bottom in left column
  maximized: PaneId | null;
}

export const TAB_DEFS: Record<TabId, TabDef> = {
  editor: {
    id: "editor",
    label: "model.sysml",
    iconHtml: `<span class="file-icon">S</span>`,
    subTag: "SysML v2",
    tooltip: "SysML v2 源代码编辑 (拖拽至其他窗口即可合并标签页)",
  },
  view: {
    id: "view",
    label: "架构视图",
    iconHtml: `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M1 2h6v5H1zm8 0h6v3H9zm0 5h6v7H9zM1 9h6v5H1z"/></svg>`,
    tooltip: "SysML 语义架构与拓扑图 (拖拽至其他窗口即可合并标签页)",
  },
  diagnostics: {
    id: "diagnostics",
    label: "语法检查与大纲",
    iconHtml: `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M10.97 4.97a.235.235 0 0 0-.02.022L7.477 9.417 5.384 7.323a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-1.071-1.05z"/></svg>`,
    badgeId: "diagnostic-count",
    tooltip: "查看 SysML v2 语法语义诊断错误与模型元素结构大纲",
  },
  copilot: {
    id: "copilot",
    label: "AI 助手",
    iconHtml: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 1a2 2 0 0 1 2 2v1h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm-3 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm6 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>`,
    subTag: "glm-5.3",
    tooltip: "SysML 智能伴随建模助手 (拖拽至其他窗口即可合并标签页)",
  },
};

const DEFAULT_STATE: DockState = {
  panes: {
    "editor-region": {
      tabs: ["editor", "view", "diagnostics"],
      activeTab: "editor",
    },
    "view-region": {
      tabs: [],
      activeTab: "view",
    },
    "copilot-region": {
      tabs: ["copilot"],
      activeTab: "copilot",
    },
  },
  ratioMainX: 62,
  ratioLeftY: 50,
  maximized: null,
};

type DropTarget =
  | { type: "merge"; targetPaneId: PaneId; insertIndex: number }
  | { type: "split-bottom" }
  | { type: "split-right" }
  | null;

export class LayoutManager {
  private state: DockState = JSON.parse(JSON.stringify(DEFAULT_STATE));
  private sidebarOpen = true;

  // Drag state
  private draggingTab: TabId | null = null;
  private sourcePaneId: PaneId | null = null;
  private currentDropTarget: DropTarget = null;

  // DOM elements
  private workbenchEl!: HTMLElement;
  private mainColumnEl!: HTMLElement;
  private editorPaneEl!: HTMLElement;
  private viewPaneEl!: HTMLElement;
  private copilotPaneEl!: HTMLElement;
  private splitterMainCopilot!: HTMLElement;
  private splitterEditorView!: HTMLElement;
  private dropOverlayBottom!: HTMLElement | null;
  private dropOverlayRight!: HTMLElement | null;

  init() {
    this.workbenchEl = document.getElementById("workbench") as HTMLElement;
    this.mainColumnEl = document.getElementById("workbench-main") as HTMLElement;
    this.editorPaneEl = document.getElementById("editor-region") as HTMLElement;
    this.viewPaneEl = document.getElementById("view-region") as HTMLElement;
    this.copilotPaneEl = document.getElementById("copilot-region") as HTMLElement;

    this.splitterMainCopilot = document.getElementById("splitter-main-copilot") as HTMLElement;
    this.splitterEditorView = document.getElementById("splitter-editor-view") as HTMLElement;
    this.dropOverlayBottom = document.getElementById("drop-overlay-bottom");
    this.dropOverlayRight = document.getElementById("workbench-drop-right");

    this.loadState();
    this.bindWindowControls();
    this.bindSplitters();
    this.bindProximityDragDrop();
    this.apply();
  }

  private loadState() {
    try {
      const saved = localStorage.getItem("sysml_dock_state_v2");
      if (saved) {
        const parsed = JSON.parse(saved) as DockState;
        if (parsed.panes && parsed.panes["editor-region"] && parsed.panes["copilot-region"]) {
          this.state = parsed;
        }
      }
    } catch {
      this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    }

    const savedSidebar = localStorage.getItem("sysml_sidebar_open");
    if (savedSidebar !== null) {
      this.sidebarOpen = savedSidebar === "true";
    }
  }

  private saveState() {
    try {
      localStorage.setItem("sysml_dock_state_v2", JSON.stringify(this.state));
    } catch {
      // ignore
    }
  }

  resetLayout() {
    this.state = JSON.parse(JSON.stringify(DEFAULT_STATE));
    this.saveState();
    this.apply();
  }

  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
    localStorage.setItem("sysml_sidebar_open", String(this.sidebarOpen));
    const shell = document.getElementById("workspace");
    if (shell) {
      shell.classList.toggle("sidebar-collapsed", !this.sidebarOpen);
    }
  }

  toggleMaximize(target: PaneId) {
    if (this.state.maximized === target) {
      this.state.maximized = null;
    } else {
      this.state.maximized = target;
    }
    this.saveState();
    this.apply();
  }

  focusEditor() {
    if (this.state.maximized && this.state.maximized !== "editor-region") {
      this.state.maximized = null;
    }
    this.activateTab("editor");
    const ed = document.getElementById("source-editor");
    ed?.scrollIntoView({ behavior: "smooth" });
  }

  focusView() {
    if (this.state.maximized && this.state.maximized !== "view-region" && this.state.maximized !== "editor-region") {
      this.state.maximized = null;
    }
    this.activateTab("view");
    window.dispatchEvent(new Event("resize"));
  }

  private activateTab(tabId: TabId) {
    // Find which pane currently contains this tab
    for (const [paneId, pane] of Object.entries(this.state.panes) as [PaneId, PaneState][]) {
      if (pane.tabs.includes(tabId)) {
        pane.activeTab = tabId;
        this.saveState();
        this.apply();
        return;
      }
    }
    // If not found in any pane, insert into editor-region
    this.state.panes["editor-region"].tabs.push(tabId);
    this.state.panes["editor-region"].activeTab = tabId;
    this.saveState();
    this.apply();
  }

  private getContentElement(tabId: TabId): HTMLElement | null {
    switch (tabId) {
      case "editor":
        return document.getElementById("panel-content-editor");
      case "view":
        return document.getElementById("panel-content-view");
      case "diagnostics":
        return document.getElementById("panel-content-diagnostics");
      case "copilot":
        return document.getElementById("panel-content-copilot");
    }
  }

  apply() {
    if (!this.workbenchEl) return;

    const shell = document.getElementById("workspace");
    if (shell) {
      shell.classList.toggle("sidebar-collapsed", !this.sidebarOpen);
    }

    const panes = this.state.panes;
    const hasLeftTop = panes["editor-region"].tabs.length > 0;
    const hasLeftBottom = panes["view-region"].tabs.length > 0;
    const hasRight = panes["copilot-region"].tabs.length > 0;
    const hasLeftColumn = hasLeftTop || hasLeftBottom;

    // Maximized logic
    if (this.state.maximized) {
      const maxId = this.state.maximized;
      [this.editorPaneEl, this.viewPaneEl, this.copilotPaneEl].forEach((p) => {
        if (!p) return;
        if (p.id === maxId) {
          p.hidden = false;
          p.removeAttribute("hidden");
          p.style.display = "flex";
          p.style.flex = "1 1 100%";
        } else {
          p.hidden = true;
          p.style.display = "none";
        }
      });
      if (this.splitterMainCopilot) {
        this.splitterMainCopilot.hidden = true;
        this.splitterMainCopilot.style.display = "none";
      }
      if (this.splitterEditorView) {
        this.splitterEditorView.hidden = true;
        this.splitterEditorView.style.display = "none";
      }
      if (this.mainColumnEl) {
        if (maxId === "copilot-region") {
          this.mainColumnEl.hidden = true;
          this.mainColumnEl.style.display = "none";
        } else {
          this.mainColumnEl.hidden = false;
          this.mainColumnEl.removeAttribute("hidden");
          this.mainColumnEl.style.display = "flex";
          this.mainColumnEl.style.flex = "1 1 100%";
        }
      }
    } else {
      // Normal Mode
      // 1. Left vs Right Column layout
      if (hasLeftColumn && hasRight) {
        this.mainColumnEl.hidden = false;
        this.mainColumnEl.removeAttribute("hidden");
        this.mainColumnEl.style.display = "flex";
        this.mainColumnEl.style.flex = `0 0 ${this.state.ratioMainX}%`;

        this.copilotPaneEl.hidden = false;
        this.copilotPaneEl.removeAttribute("hidden");
        this.copilotPaneEl.style.display = "flex";
        this.copilotPaneEl.style.flex = "1 1 0";

        if (this.splitterMainCopilot) {
          this.splitterMainCopilot.hidden = false;
          this.splitterMainCopilot.removeAttribute("hidden");
          this.splitterMainCopilot.style.display = "flex";
        }
      } else if (hasLeftColumn && !hasRight) {
        this.mainColumnEl.hidden = false;
        this.mainColumnEl.removeAttribute("hidden");
        this.mainColumnEl.style.display = "flex";
        this.mainColumnEl.style.flex = "1 1 100%";

        this.copilotPaneEl.hidden = true;
        this.copilotPaneEl.style.display = "none";

        if (this.splitterMainCopilot) {
          this.splitterMainCopilot.hidden = true;
          this.splitterMainCopilot.style.display = "none";
        }
      } else if (!hasLeftColumn && hasRight) {
        this.mainColumnEl.hidden = true;
        this.mainColumnEl.style.display = "none";

        this.copilotPaneEl.hidden = false;
        this.copilotPaneEl.removeAttribute("hidden");
        this.copilotPaneEl.style.display = "flex";
        this.copilotPaneEl.style.flex = "1 1 100%";

        if (this.splitterMainCopilot) {
          this.splitterMainCopilot.hidden = true;
          this.splitterMainCopilot.style.display = "none";
        }
      }

      // 2. Left Column: Top vs Bottom Pane layout
      if (hasLeftTop && hasLeftBottom) {
        this.editorPaneEl.hidden = false;
        this.editorPaneEl.removeAttribute("hidden");
        this.editorPaneEl.style.display = "flex";
        this.editorPaneEl.style.flex = `0 0 ${this.state.ratioLeftY || 50}%`;

        this.viewPaneEl.hidden = false;
        this.viewPaneEl.removeAttribute("hidden");
        this.viewPaneEl.style.display = "flex";
        this.viewPaneEl.style.flex = "1 1 0";

        if (this.splitterEditorView) {
          this.splitterEditorView.hidden = false;
          this.splitterEditorView.removeAttribute("hidden");
          this.splitterEditorView.style.display = "flex";
        }
      } else if (hasLeftTop && !hasLeftBottom) {
        this.editorPaneEl.hidden = false;
        this.editorPaneEl.removeAttribute("hidden");
        this.editorPaneEl.style.display = "flex";
        this.editorPaneEl.style.flex = "1 1 100%";

        this.viewPaneEl.hidden = true;
        this.viewPaneEl.style.display = "none";

        if (this.splitterEditorView) {
          this.splitterEditorView.hidden = true;
          this.splitterEditorView.style.display = "none";
        }
      } else if (!hasLeftTop && hasLeftBottom) {
        this.editorPaneEl.hidden = true;
        this.editorPaneEl.style.display = "none";

        this.viewPaneEl.hidden = false;
        this.viewPaneEl.removeAttribute("hidden");
        this.viewPaneEl.style.display = "flex";
        this.viewPaneEl.style.flex = "1 1 100%";

        if (this.splitterEditorView) {
          this.splitterEditorView.hidden = true;
          this.splitterEditorView.style.display = "none";
        }
      }
    }

    // Render tab bars and mount active content for each pane
    (Object.entries(panes) as [PaneId, PaneState][]).forEach(([paneId, pane]) => {
      this.renderTabBar(paneId, pane);
      this.mountPaneContent(paneId, pane);
    });

    // Update maximize button icons
    const maxEditor = document.getElementById("btn-maximize-editor");
    const maxView = document.getElementById("btn-maximize-view");
    const maxCopilot = document.getElementById("btn-maximize-copilot");
    if (maxEditor) maxEditor.textContent = this.state.maximized === "editor-region" ? "🗗" : "⤢";
    if (maxView) maxView.textContent = this.state.maximized === "view-region" ? "🗗" : "⤢";
    if (maxCopilot) maxCopilot.textContent = this.state.maximized === "copilot-region" ? "🗗" : "⤢";

    window.dispatchEvent(new Event("resize"));
  }

  private renderTabBar(paneId: PaneId, pane: PaneState) {
    const tabbar = document.getElementById(`tabbar-${paneId}`);
    if (!tabbar) return;

    tabbar.replaceChildren();

    pane.tabs.forEach((tabId) => {
      const def = TAB_DEFS[tabId];
      if (!def) return;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `tab-item ${pane.activeTab === tabId ? "active" : ""}`;
      btn.setAttribute("draggable", "true");
      btn.setAttribute("data-tab-id", tabId);
      btn.setAttribute("data-pane-id", paneId);
      btn.setAttribute("title", def.tooltip);

      let inner = `${def.iconHtml}<span>${def.label}</span>`;
      if (def.subTag) {
        inner += `<span class="copilot-model-tag">${def.subTag}</span>`;
      }
      if (def.badgeId) {
        const count = parseInt(document.getElementById(def.badgeId)?.textContent || "0", 10);
        if (count > 0) {
          inner += `<span class="badge-count badge-error">${count}</span>`;
        }
      }
      btn.innerHTML = inner;

      // Click to switch active tab
      btn.onclick = (e) => {
        e.stopPropagation();
        pane.activeTab = tabId;
        this.saveState();
        this.apply();
      };

      // HTML5 Drag Start
      btn.ondragstart = (e) => {
        this.draggingTab = tabId;
        this.sourcePaneId = paneId;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", tabId);
        }
        btn.classList.add("is-dragging");
        document.body.classList.add("is-tab-dragging");
      };

      // HTML5 Drag End
      btn.ondragend = () => {
        btn.classList.remove("is-dragging");
        this.cleanupDragVisuals();
      };

      tabbar.appendChild(btn);
    });
  }

  private mountPaneContent(paneId: PaneId, pane: PaneState) {
    if (pane.tabs.length === 0) return; // Crucial: empty pane does not mount or claim content!

    const paneEl = document.getElementById(paneId);
    if (!paneEl) return;
    const bodyEl = paneEl.querySelector(".pane-body") as HTMLElement;
    if (!bodyEl) return;

    if (!pane.tabs.includes(pane.activeTab)) {
      pane.activeTab = pane.tabs[0];
    }

    // Attach active content to this pane's body
    const activeContent = this.getContentElement(pane.activeTab);
    if (activeContent) {
      if (activeContent.parentElement !== bodyEl) {
        bodyEl.appendChild(activeContent);
      }
      activeContent.classList.add("is-active");
      activeContent.hidden = false;
      activeContent.style.display = "flex";
    }

    // Hide inactive contents currently sitting inside this pane's body
    bodyEl.querySelectorAll<HTMLElement>(".panel-content").forEach((c) => {
      if (c !== activeContent) {
        c.classList.remove("is-active");
        c.hidden = true;
        c.style.display = "none";
      }
    });
  }

  private cleanupDragVisuals() {
    this.draggingTab = null;
    this.sourcePaneId = null;
    this.currentDropTarget = null;
    document.body.classList.remove("is-tab-dragging");

    document.querySelectorAll(".dock-tabbar").forEach((t) => {
      t.classList.remove("proximity-drop-target");
      t.querySelectorAll(".ghost-tab-indicator").forEach((g) => g.remove());
    });
    this.dropOverlayBottom?.classList.remove("active");
    this.dropOverlayRight?.classList.remove("active");
  }

  private bindProximityDragDrop() {
    // Workbench-level dragover for proximity tracking
    window.addEventListener("dragover", (e) => {
      if (!this.draggingTab || !this.sourcePaneId) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "move";
      }

      const clientX = e.clientX;
      const clientY = e.clientY;

      let foundTarget: DropTarget = null;

      // 1. Proximity check on visible tabbars (< 60px distance from tabbar)
      const tabbarIds: PaneId[] = ["editor-region", "view-region", "copilot-region"];
      for (const pid of tabbarIds) {
        const tabbar = document.getElementById(`tabbar-${pid}`);
        if (!tabbar || tabbar.offsetParent === null) continue;

        const rect = tabbar.getBoundingClientRect();
        // Check proximity: within horizontal bounds + vertical buffer of 60px
        const isNearVertical = clientY >= rect.top - 20 && clientY <= rect.bottom + 50;
        const isNearHorizontal = clientX >= rect.left - 20 && clientX <= rect.right + 40;

        if (isNearVertical && isNearHorizontal) {
          // Calculate insertion index
          const items = Array.from(tabbar.querySelectorAll(".tab-item:not(.is-dragging)"));
          let insertIndex = items.length;
          for (let i = 0; i < items.length; i++) {
            const itemRect = items[i].getBoundingClientRect();
            if (clientX < itemRect.left + itemRect.width / 2) {
              insertIndex = i;
              break;
            }
          }
          foundTarget = { type: "merge", targetPaneId: pid, insertIndex };
          break;
        }
      }

      // 2. Proximity check on bottom split zone (lower 45% of editor-region when view-region is collapsed)
      if (!foundTarget && this.state.panes["view-region"].tabs.length === 0) {
        const editorPane = this.editorPaneEl;
        if (editorPane && editorPane.offsetParent !== null) {
          const rect = editorPane.getBoundingClientRect();
          const inHorizontal = clientX >= rect.left && clientX <= rect.right;
          const inLowerHalf = clientY >= rect.top + rect.height * 0.5 && clientY <= rect.bottom;
          if (inHorizontal && inLowerHalf) {
            foundTarget = { type: "split-bottom" };
          }
        }
      }

      // 3. Proximity check on right split zone (right 25% of workbench if copilot is collapsed)
      if (!foundTarget && this.state.panes["copilot-region"].tabs.length === 0) {
        if (this.workbenchEl) {
          const rect = this.workbenchEl.getBoundingClientRect();
          const inRightSide = clientX >= rect.right - 220 && clientX <= rect.right;
          const inVertical = clientY >= rect.top && clientY <= rect.bottom;
          if (inRightSide && inVertical) {
            foundTarget = { type: "split-right" };
          }
        }
      }

      // 4. Proximity fallback: over open view-region pane body
      if (!foundTarget && this.state.panes["view-region"].tabs.length > 0) {
        const viewPane = this.viewPaneEl;
        if (viewPane && viewPane.offsetParent !== null) {
          const rect = viewPane.getBoundingClientRect();
          if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
            foundTarget = { type: "merge", targetPaneId: "view-region", insertIndex: this.state.panes["view-region"].tabs.length };
          }
        }
      }

      this.currentDropTarget = foundTarget;
      this.updateDropIndicators(foundTarget);
    });

    // Window-level drop
    window.addEventListener("drop", (e) => {
      if (!this.draggingTab || !this.sourcePaneId) return;
      e.preventDefault();
      e.stopPropagation();

      const tabToMove = this.draggingTab;
      const fromPane = this.sourcePaneId;
      const target = this.currentDropTarget;

      this.cleanupDragVisuals();

      if (!target) return;

      if (target.type === "merge") {
        this.executeMerge(tabToMove, fromPane, target.targetPaneId, target.insertIndex);
      } else if (target.type === "split-bottom") {
        this.executeSplitBottom(tabToMove, fromPane);
      } else if (target.type === "split-right") {
        this.executeSplitRight(tabToMove, fromPane);
      }
    });
  }

  private updateDropIndicators(target: DropTarget) {
    // Tabbar indicators
    const tabbarIds: PaneId[] = ["editor-region", "view-region", "copilot-region"];
    tabbarIds.forEach((pid) => {
      const tabbar = document.getElementById(`tabbar-${pid}`);
      if (!tabbar) return;
      if (target && target.type === "merge" && target.targetPaneId === pid) {
        tabbar.classList.add("proximity-drop-target");
        let ghost = tabbar.querySelector(".ghost-tab-indicator");
        if (!ghost) {
          ghost = document.createElement("div");
          ghost.className = "ghost-tab-indicator";
          ghost.textContent = `+ ${TAB_DEFS[this.draggingTab!]?.label || "合并标签页"}`;
          tabbar.appendChild(ghost);
        }
      } else {
        tabbar.classList.remove("proximity-drop-target");
        tabbar.querySelectorAll(".ghost-tab-indicator").forEach((g) => g.remove());
      }
    });

    // Split bottom overlay
    if (this.dropOverlayBottom) {
      this.dropOverlayBottom.classList.toggle("active", target !== null && target.type === "split-bottom");
    }

    // Split right overlay
    if (this.dropOverlayRight) {
      this.dropOverlayRight.classList.toggle("active", target !== null && target.type === "split-right");
    }
  }

  private executeMerge(tabId: TabId, fromPane: PaneId, toPane: PaneId, insertIndex: number) {
    if (fromPane === toPane) {
      // Reorder within the same pane
      const list = this.state.panes[fromPane].tabs;
      const oldIdx = list.indexOf(tabId);
      if (oldIdx !== -1) {
        list.splice(oldIdx, 1);
        list.splice(Math.min(insertIndex, list.length), 0, tabId);
      }
    } else {
      // Move from fromPane to toPane
      const srcTabs = this.state.panes[fromPane].tabs;
      const idx = srcTabs.indexOf(tabId);
      if (idx !== -1) {
        srcTabs.splice(idx, 1);
        if (this.state.panes[fromPane].activeTab === tabId) {
          this.state.panes[fromPane].activeTab = srcTabs[0] || ("editor" as TabId);
        }
      }

      const destTabs = this.state.panes[toPane].tabs;
      destTabs.splice(Math.min(insertIndex, destTabs.length), 0, tabId);
      this.state.panes[toPane].activeTab = tabId;
    }

    this.saveState();
    this.apply();
  }

  private executeSplitBottom(tabId: TabId, fromPane: PaneId) {
    // Remove from source pane
    const srcTabs = this.state.panes[fromPane].tabs;
    const idx = srcTabs.indexOf(tabId);
    if (idx !== -1) {
      srcTabs.splice(idx, 1);
      if (this.state.panes[fromPane].activeTab === tabId) {
        this.state.panes[fromPane].activeTab = srcTabs[0] || ("editor" as TabId);
      }
    }

    // Place into view-region
    this.state.panes["view-region"].tabs.push(tabId);
    this.state.panes["view-region"].activeTab = tabId;
    this.state.ratioLeftY = 50;

    this.saveState();
    this.apply();
  }

  private executeSplitRight(tabId: TabId, fromPane: PaneId) {
    // Remove from source pane
    const srcTabs = this.state.panes[fromPane].tabs;
    const idx = srcTabs.indexOf(tabId);
    if (idx !== -1) {
      srcTabs.splice(idx, 1);
      if (this.state.panes[fromPane].activeTab === tabId) {
        this.state.panes[fromPane].activeTab = srcTabs[0] || ("editor" as TabId);
      }
    }

    // Place into copilot-region
    this.state.panes["copilot-region"].tabs.push(tabId);
    this.state.panes["copilot-region"].activeTab = tabId;

    this.saveState();
    this.apply();
  }

  private bindWindowControls() {
    // Reset layout button in header
    const resetBtn = document.getElementById("btn-layout-reset");
    if (resetBtn) {
      resetBtn.onclick = () => this.resetLayout();
    }

    // One-click Code + View split comparison button
    const splitCompareBtn = document.getElementById("btn-split-side-by-side");
    if (splitCompareBtn) {
      splitCompareBtn.onclick = () => {
        if (this.state.panes["view-region"].tabs.includes("view")) {
          this.resetLayout();
        } else {
          this.executeSplitBottom("view", "editor-region");
          this.state.panes["editor-region"].activeTab = "editor";
          this.saveState();
          this.apply();
        }
      };
    }

    // Sidebar toggle
    document.querySelectorAll(".btn-toggle-sidebar").forEach((btn) => {
      (btn as HTMLElement).onclick = () => this.toggleSidebar();
    });

    // Maximize buttons
    const maxEditor = document.getElementById("btn-maximize-editor");
    if (maxEditor) maxEditor.onclick = () => this.toggleMaximize("editor-region");

    const maxView = document.getElementById("btn-maximize-view");
    if (maxView) maxView.onclick = () => this.toggleMaximize("view-region");

    const maxCopilot = document.getElementById("btn-maximize-copilot");
    if (maxCopilot) maxCopilot.onclick = () => this.toggleMaximize("copilot-region");
  }

  private bindSplitters() {
    // Vertical Splitter: Left column vs Right Copilot
    if (this.splitterMainCopilot) {
      let dragging = false;

      this.splitterMainCopilot.addEventListener("mousedown", (e) => {
        if (this.state.maximized) return;
        e.preventDefault();
        dragging = true;
        this.splitterMainCopilot.classList.add("dragging");
        document.body.classList.add("is-resizing");
        document.body.style.cursor = "col-resize";
      });

      window.addEventListener("mousemove", (e) => {
        if (!dragging || !this.workbenchEl) return;
        const rect = this.workbenchEl.getBoundingClientRect();
        const offset = e.clientX - rect.left;
        let pct = (offset / rect.width) * 100;
        pct = Math.max(25, Math.min(85, pct));
        this.state.ratioMainX = pct;
        if (this.mainColumnEl) this.mainColumnEl.style.flex = `0 0 ${pct}%`;
      });

      window.addEventListener("mouseup", () => {
        if (dragging) {
          dragging = false;
          this.splitterMainCopilot.classList.remove("dragging");
          document.body.classList.remove("is-resizing");
          document.body.style.cursor = "";
          this.saveState();
          window.dispatchEvent(new Event("resize"));
        }
      });

      this.splitterMainCopilot.addEventListener("dblclick", () => {
        this.state.ratioMainX = 62;
        this.saveState();
        this.apply();
      });
    }

    // Horizontal Splitter: Left top vs Left bottom
    if (this.splitterEditorView) {
      let dragging = false;

      this.splitterEditorView.addEventListener("mousedown", (e) => {
        if (this.state.maximized) return;
        e.preventDefault();
        dragging = true;
        this.splitterEditorView.classList.add("dragging");
        document.body.classList.add("is-resizing");
        document.body.style.cursor = "row-resize";
      });

      window.addEventListener("mousemove", (e) => {
        if (!dragging || !this.mainColumnEl) return;
        const rect = this.mainColumnEl.getBoundingClientRect();
        const offset = e.clientY - rect.top;
        let pct = (offset / rect.height) * 100;
        pct = Math.max(15, Math.min(85, pct));
        this.state.ratioLeftY = pct;
        if (this.editorPaneEl) this.editorPaneEl.style.flex = `0 0 ${pct}%`;
      });

      window.addEventListener("mouseup", () => {
        if (dragging) {
          dragging = false;
          this.splitterEditorView.classList.remove("dragging");
          document.body.classList.remove("is-resizing");
          document.body.style.cursor = "";
          this.saveState();
          window.dispatchEvent(new Event("resize"));
        }
      });

      this.splitterEditorView.addEventListener("dblclick", () => {
        this.state.ratioLeftY = 50;
        this.saveState();
        this.apply();
      });
    }
  }
}
