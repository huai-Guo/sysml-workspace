import type { NodeLayoutPosition } from "./types";

export class LayoutSidecar {
  private key: string;
  private memoryCache: Map<string, NodeLayoutPosition> = new Map();

  constructor(sessionKey: string = "default") {
    this.key = `sysml_wb_sidecar_${sessionKey}`;
    this.loadFromStorage();
  }

  public setScope(sessionKey: string): void {
    this.key = `sysml_wb_sidecar_${sessionKey}`;
    this.memoryCache.clear();
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const [id, pos] of Object.entries(parsed)) {
          this.memoryCache.set(id, pos as NodeLayoutPosition);
        }
      }
    } catch {
      // Ignore parse/storage issues
    }
  }

  public saveToStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const obj: Record<string, NodeLayoutPosition> = {};
      for (const [id, pos] of this.memoryCache.entries()) {
        obj[id] = pos;
      }
      localStorage.setItem(this.key, JSON.stringify(obj));
    } catch {
      // Ignore quota/storage issues
    }
  }

  public get(id: string, viewType?: string): NodeLayoutPosition | undefined {
    const key = viewType ? `${viewType}::${id}` : id;
    return this.memoryCache.get(key) || this.memoryCache.get(id);
  }

  public set(id: string, pos: NodeLayoutPosition, viewType?: string): void {
    const key = viewType ? `${viewType}::${id}` : id;
    this.memoryCache.set(key, { ...pos, userMoved: true });
    this.saveToStorage();
  }

  public has(id: string, viewType?: string): boolean {
    const key = viewType ? `${viewType}::${id}` : id;
    return this.memoryCache.has(key) || this.memoryCache.has(id);
  }

  public getAll(): Map<string, NodeLayoutPosition> {
    return new Map(this.memoryCache);
  }

  public clear(): void {
    this.memoryCache.clear();
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.removeItem(this.key);
      } catch {
        // Ignore
      }
    }
  }
}
