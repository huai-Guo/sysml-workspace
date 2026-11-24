export interface StatusBarState {
  grid: boolean;
  snap: boolean;
  osnap: boolean;
  ortho: boolean;
  sheet: boolean;
}

export class CadStatusBar {
  private element: HTMLElement;
  private coordEl: HTMLElement;
  private zoomEl: HTMLElement;
  private buttons: Map<keyof StatusBarState, HTMLButtonElement> = new Map();
  private state: StatusBarState = {
    grid: true,
    snap: false,
    osnap: true,
    ortho: true,
    sheet: false,
  };
  private onChange?: (state: StatusBarState) => void;

  constructor(
    parent: HTMLElement,
    options: {
      initialState?: Partial<StatusBarState>;
      onChange?: (state: StatusBarState) => void;
      onZoomReset?: () => void;
    } = {},
  ) {
    this.onChange = options.onChange;
    if (options.initialState) {
      this.state = { ...this.state, ...options.initialState };
    }

    const bar = document.createElement("div");
    bar.className = "cad-status-bar";
    bar.style.position = "absolute";
    bar.style.bottom = "0";
    bar.style.left = "0";
    bar.style.right = "0";
    bar.style.height = "26px";
    bar.style.backgroundColor = "var(--bg-card-header, #131b26)";
    bar.style.borderTop = "1px solid var(--border-subtle, #273549)";
    bar.style.display = "flex";
    bar.style.alignItems = "center";
    bar.style.justifyContent = "space-between";
    bar.style.padding = "0 10px";
    bar.style.fontSize = "11px";
    bar.style.color = "var(--text-secondary, #94a3b8)";
    bar.style.zIndex = "15";
    bar.style.userSelect = "none";

    // Left: Cursor coordinates and zoom ratio
    const leftGroup = document.createElement("div");
    leftGroup.style.display = "flex";
    leftGroup.style.alignItems = "center";
    leftGroup.style.gap = "14px";

    this.coordEl = document.createElement("span");
    this.coordEl.className = "cad-status-coords";
    this.coordEl.style.fontFamily = "ui-monospace, monospace";
    this.coordEl.textContent = "X: 0.0   Y: 0.0";
    leftGroup.appendChild(this.coordEl);

    this.zoomEl = document.createElement("button");
    this.zoomEl.className = "cad-status-zoom-btn";
    this.zoomEl.style.background = "transparent";
    this.zoomEl.style.border = "none";
    this.zoomEl.style.color = "var(--text-secondary, #94a3b8)";
    this.zoomEl.style.cursor = "pointer";
    this.zoomEl.style.fontFamily = "ui-monospace, monospace";
    this.zoomEl.title = "缩放比 (单击重置 1:1)";
    this.zoomEl.textContent = "100%";
    if (options.onZoomReset) {
      this.zoomEl.onclick = options.onZoomReset;
    }
    leftGroup.appendChild(this.zoomEl);
    bar.appendChild(leftGroup);

    // Right: CAD precision mode toggles
    const rightGroup = document.createElement("div");
    rightGroup.style.display = "flex";
    rightGroup.style.alignItems = "center";
    rightGroup.style.gap = "4px";

    const modes: { key: keyof StatusBarState; label: string; title: string }[] = [
      { key: "grid", label: "GRID", title: "栅格网格背景开关" },
      { key: "snap", label: "SNAP", title: "栅格坐标吸附 (10px Grid Snap)" },
      { key: "osnap", label: "OSNAP", title: "对象特征管脚/中心捕捉" },
      { key: "ortho", label: "ORTHO", title: "F8 正交布线锁定 (Orthogonal Wiring)" },
      { key: "sheet", label: "SHEET", title: "标准工程图纸图框开关" },
    ];

    for (const m of modes) {
      const btn = document.createElement("button");
      btn.className = `cad-mode-btn ${this.state[m.key] ? "active" : ""}`;
      btn.textContent = m.label;
      btn.title = m.title;
      btn.onclick = () => {
        this.state[m.key] = !this.state[m.key];
        btn.classList.toggle("active", this.state[m.key]);
        this.onChange?.(this.state);
      };
      this.buttons.set(m.key, btn);
      rightGroup.appendChild(btn);
    }

    bar.appendChild(rightGroup);
    parent.appendChild(bar);
    this.element = bar;
  }

  public updateCoords(worldX: number, worldY: number): void {
    this.coordEl.textContent = `X: ${worldX.toFixed(1)}   Y: ${worldY.toFixed(1)}`;
  }

  public updateZoom(scale: number): void {
    this.zoomEl.textContent = `${Math.round(scale * 100)}%`;
  }

  public getState(): StatusBarState {
    return { ...this.state };
  }

  public setState(partial: Partial<StatusBarState>): void {
    this.state = { ...this.state, ...partial };
    for (const [key, btn] of this.buttons.entries()) {
      btn.classList.toggle("active", Boolean(this.state[key]));
    }
  }

  public setCoordinates(worldX: number, worldY: number): void {
    this.updateCoords(worldX, worldY);
  }

  public setZoom(scale: number): void {
    this.updateZoom(scale);
  }

  public updateState(partial: Partial<StatusBarState>): void {
    this.setState(partial);
  }

  public toggleMode(key: keyof StatusBarState): void {
    this.state[key] = !this.state[key];
    const btn = this.buttons.get(key);
    if (btn) btn.classList.toggle("active", Boolean(this.state[key]));
    this.onChange?.(this.state);
  }

  public dispose(): void {
    this.destroy();
  }

  public destroy(): void {
    this.element.remove();
  }
}
