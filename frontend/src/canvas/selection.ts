import type { Graph, Cell, Node } from "@antv/x6/es";

export class CadBoxSelection {
  private container: HTMLElement;
  private graph: Graph;
  private boxEl: HTMLDivElement;
  private startClientX = 0;
  private startClientY = 0;
  private isSelecting = false;
  private disposed = false;
  private spacePressed = false;

  private onMouseDownHandler!: (e: MouseEvent) => void;
  private onMouseMoveHandler!: (e: MouseEvent) => void;
  private onMouseUpHandler!: (e: MouseEvent) => void;
  private onKeyDownHandler!: (e: KeyboardEvent) => void;
  private onKeyUpHandler!: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement, graph: Graph) {
    this.container = container;
    this.graph = graph;

    this.boxEl = document.createElement("div");
    this.boxEl.className = "cad-selection-box";
    this.boxEl.style.position = "absolute";
    this.boxEl.style.display = "none";
    this.boxEl.style.pointerEvents = "none";
    this.boxEl.style.zIndex = "20";
    this.boxEl.style.boxSizing = "border-box";
    container.appendChild(this.boxEl);

    this.bindEvents();
  }

  private bindEvents(): void {
    this.onKeyDownHandler = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        this.spacePressed = true;
      }
    };
    this.onKeyUpHandler = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        this.spacePressed = false;
      }
    };
    window.addEventListener("keydown", this.onKeyDownHandler);
    window.addEventListener("keyup", this.onKeyUpHandler);

    this.onMouseDownHandler = (e: MouseEvent) => {
      // Suppress box selection when Space is held for panning, or not primary left button
      if (e.button !== 0 || this.spacePressed) return;
      // Do not trigger if clicking on node, port, or UI widget
      const target = e.target as HTMLElement;
      if (
        target.closest(".x6-node") ||
        target.closest(".x6-port") ||
        target.closest(".x6-edge") ||
        target.closest(".x6-widget-transform") ||
        target.closest(".x6-widget-selection") ||
        target.closest(".cad-status-bar") ||
        target.closest(".cad-ruler-corner") ||
        target.closest(".cad-properties-panel") ||
        target.closest(".sysml-palette")
      ) {
        return;
      }

      const rect = this.container.getBoundingClientRect();
      this.startClientX = e.clientX - rect.left;
      this.startClientY = e.clientY - rect.top;
      this.isSelecting = true;

      this.boxEl.style.left = `${this.startClientX}px`;
      this.boxEl.style.top = `${this.startClientY}px`;
      this.boxEl.style.width = "0px";
      this.boxEl.style.height = "0px";
      this.boxEl.style.display = "block";
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!this.isSelecting || this.disposed) return;
      const rect = this.container.getBoundingClientRect();
      const currentClientX = e.clientX - rect.left;
      const currentClientY = e.clientY - rect.top;

      const minX = Math.min(this.startClientX, currentClientX);
      const minY = Math.min(this.startClientY, currentClientY);
      const width = Math.abs(currentClientX - this.startClientX);
      const height = Math.abs(currentClientY - this.startClientY);

      this.boxEl.style.left = `${minX}px`;
      this.boxEl.style.top = `${minY}px`;
      this.boxEl.style.width = `${width}px`;
      this.boxEl.style.height = `${height}px`;

      // AutoCAD distinguishing rule:
      // Dragging Left-to-Right: Solid Blue Window Selection
      // Dragging Right-to-Left: Dashed Green Crossing Selection
      const isWindowSelection = currentClientX >= this.startClientX;
      if (isWindowSelection) {
        this.boxEl.style.border = "1.5px solid #3b82f6";
        this.boxEl.style.backgroundColor = "rgba(59, 130, 246, 0.16)";
      } else {
        this.boxEl.style.border = "1.5px dashed #22c55e";
        this.boxEl.style.backgroundColor = "rgba(34, 197, 94, 0.16)";
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!this.isSelecting || this.disposed) return;
      this.isSelecting = false;
      this.boxEl.style.display = "none";

      const rect = this.container.getBoundingClientRect();
      const endClientX = e.clientX - rect.left;
      const endClientY = e.clientY - rect.top;

      const minClientX = Math.min(this.startClientX, endClientX);
      const minClientY = Math.min(this.startClientY, endClientY);
      const width = Math.abs(endClientX - this.startClientX);
      const height = Math.abs(endClientY - this.startClientY);

      // Ignore trivial clicks (< 5px)
      if (width < 5 && height < 5) {
        return;
      }

      const isWindowSelection = endClientX >= this.startClientX;

      // Convert selection screen coordinates to graph world coordinates
      const startWorld = this.graph.clientToLocal(
        minClientX + rect.left,
        minClientY + rect.top,
      );
      const endWorld = this.graph.clientToLocal(
        minClientX + width + rect.left,
        minClientY + height + rect.top,
      );

      const selMinX = Math.min(startWorld.x, endWorld.x);
      const selMaxX = Math.max(startWorld.x, endWorld.x);
      const selMinY = Math.min(startWorld.y, endWorld.y);
      const selMaxY = Math.max(startWorld.y, endWorld.y);

      // Find matching nodes
      const allNodes = this.graph.getNodes();
      const matchedNodes: Node[] = [];

      for (const node of allNodes) {
        if (!node.isVisible()) continue;
        const pos = node.getPosition();
        const size = node.getSize();
        const nodeMinX = pos.x;
        const nodeMaxX = pos.x + size.width;
        const nodeMinY = pos.y;
        const nodeMaxY = pos.y + size.height;

        if (isWindowSelection) {
          // Window selection: fully enclosed
          const fullyEnclosed =
            nodeMinX >= selMinX &&
            nodeMaxX <= selMaxX &&
            nodeMinY >= selMinY &&
            nodeMaxY <= selMaxY;
          if (fullyEnclosed) {
            matchedNodes.push(node);
          }
        } else {
          // Crossing selection: intersects or touches
          const intersects = !(
            nodeMaxX < selMinX ||
            nodeMinX > selMaxX ||
            nodeMaxY < selMinY ||
            nodeMinY > selMaxY
          );
          if (intersects) {
            matchedNodes.push(node);
          }
        }
      }

      // Apply selection to graph
      this.graph.cleanSelection();
      if (matchedNodes.length > 0) {
        this.graph.select(matchedNodes);
      }
    };

    this.container.addEventListener("mousedown", this.onMouseDownHandler);
    this.onMouseMoveHandler = handleMouseMove;
    this.onMouseUpHandler = handleMouseUp;
    window.addEventListener("mousemove", this.onMouseMoveHandler);
    window.addEventListener("mouseup", this.onMouseUpHandler);
  }

  public dispose(): void {
    this.destroy();
  }

  public destroy(): void {
    this.disposed = true;
    this.container.removeEventListener("mousedown", this.onMouseDownHandler);
    window.removeEventListener("mousemove", this.onMouseMoveHandler);
    window.removeEventListener("mouseup", this.onMouseUpHandler);
    window.removeEventListener("keydown", this.onKeyDownHandler);
    window.removeEventListener("keyup", this.onKeyUpHandler);
    this.boxEl.remove();
  }
}
