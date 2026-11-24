import type { CanvasThemeId, ViewType } from "./types";

export interface CadCommandContext {
  zoomFit: () => void;
  toggleOrtho: () => boolean;
  toggleGrid: () => boolean;
  toggleSnap: () => boolean;
  toggleOsnap: () => boolean;
  toggleSheet: () => boolean;
  alignSelected: (type: "left" | "right" | "top" | "bottom" | "centerH" | "centerV") => boolean;
  resetLayout: () => void;
  switchView: (view: ViewType) => boolean;
  setTheme: (theme: CanvasThemeId) => void;
  exportFormat: (format: "dxf" | "drawio" | "png" | "svg" | "json") => Promise<void> | void;
  showNotice?: (msg: string) => void;
}

export interface CadCommandDef {
  command: string;
  description: string;
  category: "VIEW" | "MODE" | "ALIGN" | "THEME" | "EXPORT";
  aliases?: string[];
  execute: (args: string[], ctx: CadCommandContext) => Promise<string> | string;
}

export const CAD_COMMANDS: CadCommandDef[] = [
  {
    command: "FIT",
    aliases: ["ZOOM FIT", "ZF"],
    category: "VIEW",
    description: "自适应画布居中缩放",
    execute: (_args, ctx) => {
      ctx.zoomFit();
      return "已自适应画布缩放";
    },
  },
  {
    command: "ORTHO",
    aliases: ["F8"],
    category: "MODE",
    description: "切换 F8 正交连线锁定",
    execute: (_args, ctx) => {
      const on = ctx.toggleOrtho();
      return `ORTHO 正交锁定: ${on ? "开启" : "关闭"}`;
    },
  },
  {
    command: "GRID",
    category: "MODE",
    description: "切换点阵网格背景显隐",
    execute: (_args, ctx) => {
      const on = ctx.toggleGrid();
      return `GRID 栅格网格: ${on ? "开启" : "关闭"}`;
    },
  },
  {
    command: "SNAP",
    category: "MODE",
    description: "切换 10px 栅格坐标吸附",
    execute: (_args, ctx) => {
      const on = ctx.toggleSnap();
      return `SNAP 栅格吸附: ${on ? "开启" : "关闭"}`;
    },
  },
  {
    command: "OSNAP",
    category: "MODE",
    description: "切换对象特征捕捉 (对齐参考线)",
    execute: (_args, ctx) => {
      const on = ctx.toggleOsnap();
      return `OSNAP 特征捕捉: ${on ? "开启" : "关闭"}`;
    },
  },
  {
    command: "SHEET",
    category: "MODE",
    description: "切换 ISO 标准工程图框与标题栏",
    execute: (_args, ctx) => {
      const on = ctx.toggleSheet();
      return `SHEET 工程图框: ${on ? "显示" : "隐藏"}`;
    },
  },
  {
    command: "ALIGN L",
    aliases: ["ALIGN LEFT", "AL"],
    category: "ALIGN",
    description: "左对齐选中图元",
    execute: (_args, ctx) => {
      const ok = ctx.alignSelected("left");
      return ok ? "已执行左对齐" : "对齐失败: 需至少选中 2 个图元";
    },
  },
  {
    command: "ALIGN R",
    aliases: ["ALIGN RIGHT", "AR"],
    category: "ALIGN",
    description: "右对齐选中图元",
    execute: (_args, ctx) => {
      const ok = ctx.alignSelected("right");
      return ok ? "已执行右对齐" : "对齐失败: 需至少选中 2 个图元";
    },
  },
  {
    command: "ALIGN T",
    aliases: ["ALIGN TOP", "AT"],
    category: "ALIGN",
    description: "顶对齐选中图元",
    execute: (_args, ctx) => {
      const ok = ctx.alignSelected("top");
      return ok ? "已执行顶对齐" : "对齐失败: 需至少选中 2 个图元";
    },
  },
  {
    command: "ALIGN B",
    aliases: ["ALIGN BOTTOM", "AB"],
    category: "ALIGN",
    description: "底对齐选中图元",
    execute: (_args, ctx) => {
      const ok = ctx.alignSelected("bottom");
      return ok ? "已执行底对齐" : "对齐失败: 需至少选中 2 个图元";
    },
  },
  {
    command: "ALIGN H",
    aliases: ["ALIGN HORIZONTAL", "ALIGN CENTERH"],
    category: "ALIGN",
    description: "水平中心居中对齐选中图元",
    execute: (_args, ctx) => {
      const ok = ctx.alignSelected("centerH");
      return ok ? "已执行水平居中对齐" : "对齐失败: 需至少选中 2 个图元";
    },
  },
  {
    command: "ALIGN V",
    aliases: ["ALIGN VERTICAL", "ALIGN CENTERV"],
    category: "ALIGN",
    description: "垂直中心居中对齐选中图元",
    execute: (_args, ctx) => {
      const ok = ctx.alignSelected("centerV");
      return ok ? "已执行垂直居中对齐" : "对齐失败: 需至少选中 2 个图元";
    },
  },
  {
    command: "LAYOUT",
    aliases: ["RESET", "RELOAD"],
    category: "VIEW",
    description: "重置手工拖拽布局并恢复自动排版",
    execute: (_args, ctx) => {
      ctx.resetLayout();
      return "已重置手工布局并恢复自动 ELK 排版";
    },
  },
  {
    command: "VIEW GENERAL",
    category: "VIEW",
    description: "切换至通用结构全貌视图",
    execute: (_args, ctx) => {
      const ok = ctx.switchView("general");
      return ok ? "已切换至 General 视图" : "视图不可用";
    },
  },
  {
    command: "VIEW IBD",
    aliases: ["VIEW INTERCONNECTION"],
    category: "VIEW",
    description: "切换至内部互联结构视图 (IBD)",
    execute: (_args, ctx) => {
      const ok = ctx.switchView("interconnection");
      return ok ? "已切换至 IBD 内部互联视图" : "当前模型无 IBD 视图";
    },
  },
  {
    command: "VIEW STATE",
    aliases: ["VIEW STM"],
    category: "VIEW",
    description: "切换至状态机与状态迁移视图",
    execute: (_args, ctx) => {
      const ok = ctx.switchView("state");
      return ok ? "已切换至状态转移视图" : "当前模型无状态机视图";
    },
  },
  {
    command: "VIEW REQ",
    aliases: ["VIEW REQUIREMENT"],
    category: "VIEW",
    description: "切换至需求追踪满足矩阵视图",
    execute: (_args, ctx) => {
      const ok = ctx.switchView("requirements");
      return ok ? "已切换至需求追踪视图" : "当前模型无需求矩阵视图";
    },
  },
  {
    command: "SKIN CAD",
    category: "THEME",
    description: "切换至 AutoCAD 暗黑电气工程皮肤",
    execute: (_args, ctx) => {
      ctx.setTheme("cad-blueprint");
      return "已切换至 CAD 暗黑工程皮肤";
    },
  },
  {
    command: "SKIN ISO",
    category: "THEME",
    description: "切换至 ISO 128 白纸蓝线工程图皮肤",
    execute: (_args, ctx) => {
      ctx.setTheme("iso-drafting");
      return "已切换至 ISO 128 白纸工程图皮肤";
    },
  },
  {
    command: "SKIN SYSON",
    category: "THEME",
    description: "切换至 Eclipse SysON 规范现代皮肤",
    execute: (_args, ctx) => {
      ctx.setTheme("syson-clean");
      return "已切换至 SysON 现代皮肤";
    },
  },
  {
    command: "EXPORT DXF",
    category: "EXPORT",
    description: "导出标准 AutoCAD 2000 (.dxf) 图纸",
    execute: async (_args, ctx) => {
      await ctx.exportFormat("dxf");
      return "已导出 AutoCAD 图纸 (.dxf)";
    },
  },
  {
    command: "EXPORT DRAWIO",
    aliases: ["EXPORT XML"],
    category: "EXPORT",
    description: "导出未压缩标准 Draw.io (.drawio) 框图",
    execute: async (_args, ctx) => {
      await ctx.exportFormat("drawio");
      return "已导出 Draw.io 框图 (.drawio)";
    },
  },
  {
    command: "EXPORT PNG",
    category: "EXPORT",
    description: "导出 2x 超采样高清架构图 (.png)",
    execute: async (_args, ctx) => {
      await ctx.exportFormat("png");
      return "已导出高清 PNG 位图";
    },
  },
  {
    command: "EXPORT SVG",
    category: "EXPORT",
    description: "导出内嵌工程元数据的独立矢量图 (.svg)",
    execute: async (_args, ctx) => {
      await ctx.exportFormat("svg");
      return "已导出独立矢量图 (.svg)";
    },
  },
  {
    command: "EXPORT JSON",
    aliases: ["EXPORT WORKBENCH"],
    category: "EXPORT",
    description: "导出全量工作台工程包 (.sysmlwb.json)",
    execute: async (_args, ctx) => {
      await ctx.exportFormat("json");
      return "已导出工作台工程包 (.sysmlwb.json)";
    },
  },
];

export class CadCommandParser {
  public static matchCommand(input: string): { def: CadCommandDef; args: string[] } | null {
    const raw = input.trim();
    if (!raw) return null;
    const upper = raw.toUpperCase();

    // 1. Direct command match
    for (const def of CAD_COMMANDS) {
      if (upper === def.command || def.aliases?.some((a) => a === upper)) {
        return { def, args: [] };
      }
    }

    // 2. Prefix with arguments (e.g. "VIEW IBD", "EXPORT DXF", "ALIGN L")
    for (const def of CAD_COMMANDS) {
      const parts = def.command.split(" ");
      if (parts.length > 1 && upper.startsWith(parts[0] + " ")) {
        const sub = upper.slice(parts[0].length).trim();
        if (sub === parts.slice(1).join(" ") || def.aliases?.some((a) => a === upper)) {
          return { def, args: [] };
        }
      }
    }

    // 3. Fallback matching start words
    for (const def of CAD_COMMANDS) {
      if (upper.startsWith(def.command + " ")) {
        const rest = raw.slice(def.command.length).trim();
        return { def, args: rest ? rest.split(/\s+/) : [] };
      }
    }

    return null;
  }

  public static suggest(query: string, limit = 8): CadCommandDef[] {
    const clean = query.trim().toUpperCase();
    if (!clean) return CAD_COMMANDS.slice(0, limit);

    return CAD_COMMANDS.filter((cmd) => {
      if (cmd.command.includes(clean)) return true;
      if (cmd.description.toUpperCase().includes(clean)) return true;
      if (cmd.aliases?.some((a) => a.includes(clean))) return true;
      return false;
    }).slice(0, limit);
  }
}

export class CadCommandBar {
  private container: HTMLElement;
  private ctx: CadCommandContext;
  private overlay: HTMLElement;
  private inputEl: HTMLInputElement;
  private suggestionsList: HTMLElement;
  private activeSuggestionIndex = 0;
  private visible = false;
  private currentSuggestions: CadCommandDef[] = [];
  private onKeyDownWindow: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement, ctx: CadCommandContext) {
    this.container = container;
    this.ctx = ctx;

    // Create floating UI overlay
    this.overlay = document.createElement("div");
    this.overlay.className = "cad-command-bar-overlay";
    this.overlay.style.position = "absolute";
    this.overlay.style.top = "16px";
    this.overlay.style.left = "50%";
    this.overlay.style.transform = "translateX(-50%)";
    this.overlay.style.width = "460px";
    this.overlay.style.backgroundColor = "var(--bg-card, #131b26)";
    this.overlay.style.border = "1px solid var(--accent, #38bdf8)";
    this.overlay.style.borderRadius = "6px";
    this.overlay.style.boxShadow = "0 12px 36px rgba(0, 0, 0, 0.65)";
    this.overlay.style.zIndex = "50";
    this.overlay.style.display = "none";
    this.overlay.style.flexDirection = "column";
    this.overlay.style.overflow = "hidden";
    this.overlay.style.fontFamily = "ui-monospace, Consolas, monospace";

    // Header bar with prompt and input
    const inputRow = document.createElement("div");
    inputRow.style.display = "flex";
    inputRow.style.alignItems = "center";
    inputRow.style.padding = "8px 12px";
    inputRow.style.borderBottom = "1px solid var(--border-subtle, #273549)";

    const promptLabel = document.createElement("span");
    promptLabel.style.color = "var(--accent, #38bdf8)";
    promptLabel.style.fontWeight = "bold";
    promptLabel.style.marginRight = "8px";
    promptLabel.style.fontSize = "12px";
    promptLabel.textContent = "COMMAND:";
    inputRow.appendChild(promptLabel);

    this.inputEl = document.createElement("input");
    this.inputEl.className = "cad-command-input";
    this.inputEl.type = "text";
    this.inputEl.placeholder = "输入 CAD 命令 (如 FIT, ALIGN L, VIEW IBD, EXPORT DXF)...";
    this.inputEl.style.flex = "1";
    this.inputEl.style.backgroundColor = "transparent";
    this.inputEl.style.border = "none";
    this.inputEl.style.outline = "none";
    this.inputEl.style.color = "var(--text-primary, #f1f5f9)";
    this.inputEl.style.fontSize = "12px";
    this.inputEl.style.fontFamily = "inherit";
    inputRow.appendChild(this.inputEl);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.title = "关闭 (Esc)";
    closeBtn.style.background = "transparent";
    closeBtn.style.border = "none";
    closeBtn.style.color = "var(--text-secondary, #94a3b8)";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.fontSize = "12px";
    closeBtn.style.marginLeft = "8px";
    closeBtn.onclick = () => this.hide();
    inputRow.appendChild(closeBtn);

    this.overlay.appendChild(inputRow);

    // Suggestions container
    this.suggestionsList = document.createElement("div");
    this.suggestionsList.className = "cad-command-suggestions";
    this.suggestionsList.style.maxHeight = "240px";
    this.suggestionsList.style.overflowY = "auto";
    this.overlay.appendChild(this.suggestionsList);

    this.container.appendChild(this.overlay);

    // Bind input and keyboard events
    this.inputEl.addEventListener("input", () => this.onInputChanged());
    this.inputEl.addEventListener("keydown", (e) => this.onInputKeyDown(e));

    // Global "/" shortcut to trigger Command Bar
    this.onKeyDownWindow = (e: KeyboardEvent) => {
      if (e.key === "/" && !this.visible) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable ||
            target.closest(".cm-content"))
        ) {
          return;
        }
        e.preventDefault();
        this.show();
      }
    };
    window.addEventListener("keydown", this.onKeyDownWindow);
  }

  public show(): void {
    this.visible = true;
    this.overlay.style.display = "flex";
    this.inputEl.value = "";
    this.activeSuggestionIndex = 0;
    this.updateSuggestions("");
    requestAnimationFrame(() => this.inputEl.focus());
  }

  public hide(): void {
    this.visible = false;
    this.overlay.style.display = "none";
  }

  public toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  public async executeCommand(commandStr: string): Promise<void> {
    const matched = CadCommandParser.matchCommand(commandStr);
    if (!matched) {
      this.ctx.showNotice?.(`未知 CAD 命令: "${commandStr}"。按 Tab 查看可用命令`);
      return;
    }

    try {
      const msg = await matched.def.execute(matched.args, this.ctx);
      this.ctx.showNotice?.(`[CAD] ${msg}`);
      this.hide();
    } catch (err: any) {
      this.ctx.showNotice?.(`[CAD 执行失败] ${err.message || String(err)}`);
    }
  }

  private onInputChanged(): void {
    this.activeSuggestionIndex = 0;
    this.updateSuggestions(this.inputEl.value);
  }

  private updateSuggestions(query: string): void {
    this.currentSuggestions = CadCommandParser.suggest(query);
    this.suggestionsList.replaceChildren();

    if (this.currentSuggestions.length === 0) {
      const empty = document.createElement("div");
      empty.style.padding = "8px 12px";
      empty.style.fontSize = "11px";
      empty.style.color = "var(--text-secondary, #94a3b8)";
      empty.textContent = "无匹配命令";
      this.suggestionsList.appendChild(empty);
      return;
    }

    this.currentSuggestions.forEach((def, index) => {
      const item = document.createElement("div");
      item.className = `cad-command-item ${index === this.activeSuggestionIndex ? "active" : ""}`;
      item.style.padding = "6px 12px";
      item.style.display = "flex";
      item.style.alignItems = "center";
      item.style.justifyContent = "space-between";
      item.style.cursor = "pointer";
      item.style.fontSize = "11px";
      item.style.backgroundColor =
        index === this.activeSuggestionIndex ? "rgba(56, 189, 248, 0.15)" : "transparent";

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "8px";

      const cmdText = document.createElement("strong");
      cmdText.style.color = "var(--accent, #38bdf8)";
      cmdText.textContent = def.command;
      left.appendChild(cmdText);

      const descText = document.createElement("span");
      descText.style.color = "var(--text-secondary, #94a3b8)";
      descText.textContent = def.description;
      left.appendChild(descText);

      const catBadge = document.createElement("span");
      catBadge.style.fontSize = "9px";
      catBadge.style.padding = "1px 4px";
      catBadge.style.borderRadius = "3px";
      catBadge.style.border = "1px solid var(--border-subtle, #273549)";
      catBadge.style.color = "var(--text-secondary, #94a3b8)";
      catBadge.textContent = def.category;

      item.append(left, catBadge);

      item.onclick = () => {
        this.inputEl.value = def.command;
        this.executeCommand(def.command);
      };

      this.suggestionsList.appendChild(item);
    });
  }

  private onInputKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      this.hide();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (this.currentSuggestions.length > 0) {
        this.activeSuggestionIndex = (this.activeSuggestionIndex + 1) % this.currentSuggestions.length;
        this.updateSuggestions(this.inputEl.value);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (this.currentSuggestions.length > 0) {
        this.activeSuggestionIndex =
          (this.activeSuggestionIndex - 1 + this.currentSuggestions.length) %
          this.currentSuggestions.length;
        this.updateSuggestions(this.inputEl.value);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const val = this.inputEl.value.trim();
      if (val) {
        this.executeCommand(val);
      } else if (this.currentSuggestions[this.activeSuggestionIndex]) {
        this.executeCommand(this.currentSuggestions[this.activeSuggestionIndex].command);
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (this.currentSuggestions[this.activeSuggestionIndex]) {
        this.inputEl.value = this.currentSuggestions[this.activeSuggestionIndex].command;
        this.onInputChanged();
      }
    }
  }

  public dispose(): void {
    window.removeEventListener("keydown", this.onKeyDownWindow);
    this.overlay.remove();
  }
}
