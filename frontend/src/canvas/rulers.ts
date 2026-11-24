import type { Graph } from "@antv/x6/es";

export class CanvasRulers {
  private container: HTMLElement;
  private graph: Graph;
  private rulerHCanvas: HTMLCanvasElement;
  private rulerVCanvas: HTMLCanvasElement;
  private cursorIndicatorH: HTMLDivElement;
  private cursorIndicatorV: HTMLDivElement;
  private disposed = false;

  constructor(container: HTMLElement, graph: Graph) {
    this.container = container;
    this.graph = graph;

    // Corner unit badge
    const corner = document.createElement("div");
    corner.className = "cad-ruler-corner";
    corner.style.position = "absolute";
    corner.style.top = "0";
    corner.style.left = "0";
    corner.style.width = "20px";
    corner.style.height = "20px";
    corner.style.backgroundColor = "var(--bg-card-header, #161f2e)";
    corner.style.borderRight = "1px solid var(--border-subtle, #273549)";
    corner.style.borderBottom = "1px solid var(--border-subtle, #273549)";
    corner.style.fontSize = "9px";
    corner.style.color = "var(--text-secondary, #94a3b8)";
    corner.style.display = "flex";
    corner.style.alignItems = "center";
    corner.style.justifyContent = "center";
    corner.style.zIndex = "12";
    corner.textContent = "px";
    container.appendChild(corner);

    // Top horizontal ruler
    this.rulerHCanvas = document.createElement("canvas");
    this.rulerHCanvas.className = "cad-ruler-h";
    this.rulerHCanvas.style.position = "absolute";
    this.rulerHCanvas.style.top = "0";
    this.rulerHCanvas.style.left = "20px";
    this.rulerHCanvas.style.right = "0";
    this.rulerHCanvas.style.height = "20px";
    this.rulerHCanvas.style.zIndex = "11";
    this.rulerHCanvas.style.pointerEvents = "none";
    container.appendChild(this.rulerHCanvas);

    // Left vertical ruler
    this.rulerVCanvas = document.createElement("canvas");
    this.rulerVCanvas.className = "cad-ruler-v";
    this.rulerVCanvas.style.position = "absolute";
    this.rulerVCanvas.style.top = "20px";
    this.rulerVCanvas.style.left = "0";
    this.rulerVCanvas.style.bottom = "0";
    this.rulerVCanvas.style.width = "20px";
    this.rulerVCanvas.style.zIndex = "11";
    this.rulerVCanvas.style.pointerEvents = "none";
    container.appendChild(this.rulerVCanvas);

    // Cursor tracking lines
    this.cursorIndicatorH = document.createElement("div");
    this.cursorIndicatorH.style.position = "absolute";
    this.cursorIndicatorH.style.top = "0";
    this.cursorIndicatorH.style.height = "20px";
    this.cursorIndicatorH.style.width = "1px";
    this.cursorIndicatorH.style.backgroundColor = "#ef4444";
    this.cursorIndicatorH.style.zIndex = "12";
    this.cursorIndicatorH.style.display = "none";
    this.cursorIndicatorH.style.pointerEvents = "none";
    container.appendChild(this.cursorIndicatorH);

    this.cursorIndicatorV = document.createElement("div");
    this.cursorIndicatorV.style.position = "absolute";
    this.cursorIndicatorV.style.left = "0";
    this.cursorIndicatorV.style.width = "20px";
    this.cursorIndicatorV.style.height = "1px";
    this.cursorIndicatorV.style.backgroundColor = "#ef4444";
    this.cursorIndicatorV.style.zIndex = "12";
    this.cursorIndicatorV.style.display = "none";
    this.cursorIndicatorV.style.pointerEvents = "none";
    container.appendChild(this.cursorIndicatorV);

    // Hook graph events
    this.graph.on("scale", () => this.draw());
    this.graph.on("translate", () => this.draw());
    this.graph.on("resize", () => this.resizeAndDraw());

    // Cursor tracking
    container.addEventListener("pointermove", (e) => {
      if (this.disposed) return;
      const rect = container.getBoundingClientRect();
      const clientX = e.clientX - rect.left;
      const clientY = e.clientY - rect.top;

      if (clientX >= 20 && clientY >= 20) {
        this.cursorIndicatorH.style.display = "block";
        this.cursorIndicatorH.style.left = `${clientX}px`;
        this.cursorIndicatorV.style.display = "block";
        this.cursorIndicatorV.style.top = `${clientY}px`;
      } else {
        this.cursorIndicatorH.style.display = "none";
        this.cursorIndicatorV.style.display = "none";
      }
    });

    container.addEventListener("pointerleave", () => {
      this.cursorIndicatorH.style.display = "none";
      this.cursorIndicatorV.style.display = "none";
    });

    this.resizeAndDraw();
  }

  public resizeAndDraw(): void {
    if (this.disposed) return;
    const width = Math.max(10, this.container.clientWidth - 20);
    const height = Math.max(10, this.container.clientHeight - 20);

    const dpr = window.devicePixelRatio || 1;
    this.rulerHCanvas.width = width * dpr;
    this.rulerHCanvas.height = 20 * dpr;
    this.rulerVCanvas.width = 20 * dpr;
    this.rulerVCanvas.height = height * dpr;

    this.draw();
  }

  public draw(): void {
    if (this.disposed) return;
    const dpr = window.devicePixelRatio || 1;
    const ctxH = this.rulerHCanvas.getContext("2d");
    const ctxV = this.rulerVCanvas.getContext("2d");
    if (!ctxH || !ctxV) return;

    const width = this.rulerHCanvas.width / dpr;
    const height = this.rulerVCanvas.height / dpr;

    ctxH.save();
    ctxH.scale(dpr, dpr);
    ctxV.save();
    ctxV.scale(dpr, dpr);

    // Clear
    ctxH.fillStyle = "rgba(18, 25, 38, 0.95)";
    ctxH.fillRect(0, 0, width, 20);
    ctxV.fillStyle = "rgba(18, 25, 38, 0.95)";
    ctxV.fillRect(0, 0, 20, height);

    ctxH.strokeStyle = "#273549";
    ctxH.lineWidth = 1;
    ctxH.beginPath();
    ctxH.moveTo(0, 19.5);
    ctxH.lineTo(width, 19.5);
    ctxH.stroke();

    ctxV.strokeStyle = "#273549";
    ctxV.lineWidth = 1;
    ctxV.beginPath();
    ctxV.moveTo(19.5, 0);
    ctxV.lineTo(19.5, height);
    ctxV.stroke();

    // Zoom & pan parameters
    const zoom = this.graph.zoom();
    const translation = this.graph.translate();
    const tx = translation.tx;
    const ty = translation.ty;

    // Adaptive step based on zoom
    let step = 100;
    if (zoom > 2) step = 20;
    else if (zoom > 1.2) step = 50;
    else if (zoom < 0.4) step = 500;
    else if (zoom < 0.7) step = 200;

    const stepPx = step * zoom;

    // Horizontal Ticks
    const startWorldX = Math.floor((-tx) / step) * step;
    ctxH.font = "9px ui-monospace, monospace";
    ctxH.fillStyle = "#94a3b8";
    ctxH.strokeStyle = "#475569";

    for (let wx = startWorldX; ; wx += step) {
      const sx = wx * zoom + tx;
      if (sx > width) break;
      if (sx < 0) continue;

      ctxH.beginPath();
      ctxH.moveTo(sx + 0.5, 12);
      ctxH.lineTo(sx + 0.5, 20);
      ctxH.stroke();

      ctxH.fillText(String(wx), sx + 3, 10);

      // Minor ticks
      const subStepPx = stepPx / 5;
      for (let j = 1; j < 5; j++) {
        const msx = sx + j * subStepPx;
        if (msx >= 0 && msx <= width) {
          ctxH.beginPath();
          ctxH.moveTo(msx + 0.5, 16);
          ctxH.lineTo(msx + 0.5, 20);
          ctxH.stroke();
        }
      }
    }

    // Vertical Ticks
    const startWorldY = Math.floor((-ty) / step) * step;
    ctxV.font = "9px ui-monospace, monospace";
    ctxV.fillStyle = "#94a3b8";
    ctxV.strokeStyle = "#475569";

    for (let wy = startWorldY; ; wy += step) {
      const sy = wy * zoom + ty;
      if (sy > height) break;
      if (sy < 0) continue;

      ctxV.beginPath();
      ctxV.moveTo(12, sy + 0.5);
      ctxV.lineTo(20, sy + 0.5);
      ctxV.stroke();

      // Draw rotated label
      ctxV.save();
      ctxV.translate(10, sy + 3);
      ctxV.rotate(-Math.PI / 2);
      ctxV.fillText(String(wy), 0, 0);
      ctxV.restore();

      // Minor ticks
      const subStepPx = stepPx / 5;
      for (let j = 1; j < 5; j++) {
        const msy = sy + j * subStepPx;
        if (msy >= 0 && msy <= height) {
          ctxV.beginPath();
          ctxV.moveTo(16, msy + 0.5);
          ctxV.lineTo(20, msy + 0.5);
          ctxV.stroke();
        }
      }
    }

    ctxH.restore();
    ctxV.restore();
  }

  public dispose(): void {
    this.destroy();
  }

  public destroy(): void {
    this.disposed = true;
    this.rulerHCanvas.remove();
    this.rulerVCanvas.remove();
    this.cursorIndicatorH.remove();
    this.cursorIndicatorV.remove();
  }
}
