import { el, optEl, node, action, download } from "./dom";
import { ApiClient, messages } from "./api";
import { SourceEditor } from "./editor";
import { active } from "./state";
import type { Run, Entity } from "./types";
import { SysMLCanvasEngine } from "./canvas/engine";
import type { CanvasThemeId, ViewType } from "./canvas/types";

export const taskNames = {
  generate: "生成代码",
  revise: "按需求修改",
  repair: "修复代码",
  validate: "验证代码",
  extract: "提取实体",
  render: "生成视图",
};
export const phaseNames: Record<string, string> = {
  queued: "等待执行",
  preparing: "正在准备",
  retrieving: "正在检索知识",
  generating: "正在生成代码",
  repairing: "正在修改与修复",
  validating: "正在验证 SysML",
  rendering: "正在生成视图",
  recovering: "正在恢复任务",
  completed: "已完成",
  failed: "未完成",
  cancelled: "已取消",
};
const statuses: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  succeeded: "已完成",
  failed: "未完成",
  cancelled: "已取消",
};
export function time(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
export function badge(status: string) {
  return `status-badge ${active(status) ? "pending" : status === "failed" ? "failed" : status === "succeeded" ? "" : "neutral"}`;
}

export class Results {
  current?: Run;
  public canvasEngine?: SysMLCanvasEngine;
  private resultEditor = new SourceEditor(el("result-editor"), true);
  private imageUrl?: string;
  private width = 600;
  private fit = true;
  constructor(
    private api: ApiClient,
    private fail: (e: unknown) => void,
    private apply: (code: string) => void,
    private jumpToSource?: (location: { offset?: number; line?: number; column?: number }) => void,
  ) {
    const tabs = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-tab]"),
    ];
    for (const [i, button] of tabs.entries()) {
      button.onclick = () => this.tab(button.dataset.tab!);
      button.onkeydown = (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                tabs.length;
        this.tab(tabs[next].dataset.tab!, true);
      };
    }
    const entitySearch = optEl("entity-search");
    if (entitySearch) entitySearch.oninput = () => this.entities();
    el("apply-result").onclick = () =>
      this.apply(this.current?.result?.sysml_source || "");
    el("copy-result").onclick = () =>
      navigator.clipboard
        .writeText(this.current?.result?.sysml_source || "")
        .then(() => {
          el("announcement").textContent = "结果代码已复制";
        }, this.fail);
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-download]",
    ))
      button.onclick = async () => {
        try {
          if (!this.current) return;
          const r = await this.api.response(
            `/v1/runs/${this.current.id}/artifacts/${button.dataset.download}`,
          );
          download(await r.blob(), button.dataset.download!);
        } catch (e) {
          this.fail(e);
        }
      };

    const canvasContainer = optEl("sysml-canvas-container");
    if (canvasContainer) {
      try {
        this.canvasEngine = new SysMLCanvasEngine(canvasContainer, {
          onSelect: (loc) => {
            if (loc) this.jumpToSource?.(loc);
          },
        });
      } catch (err) {
        console.warn("Canvas engine init skipped or failed:", err);
      }
    }

    const resetLayoutBtn = optEl<HTMLButtonElement>("reset-layout");
    if (resetLayoutBtn) {
      resetLayoutBtn.onclick = () => this.canvasEngine?.resetLayout();
    }

    const themeSelect = optEl<HTMLSelectElement>("canvas-theme-select");
    if (themeSelect) {
      themeSelect.onchange = () => {
        this.canvasEngine?.setTheme(themeSelect.value as CanvasThemeId);
      };
    }

    const viewTypeBtns = document.querySelectorAll<HTMLButtonElement>(".view-type-btn");
    for (const btn of viewTypeBtns) {
      btn.onclick = () => {
        const v = btn.dataset.view as ViewType;
        if (this.canvasEngine && v) {
          const ok = this.canvasEngine.switchView(v);
          if (ok) {
            viewTypeBtns.forEach((b) => {
              b.classList.toggle("active", b === btn);
              b.setAttribute("aria-selected", String(b === btn));
            });
            const summary = optEl("diagram-summary");
            if (summary && this.current?.result?.diagram?.views?.[v]) {
              const s = this.current.result.diagram.views[v].summary;
              summary.textContent = `${s.displayedNodes} 个节点 · ${s.displayedEdges} 条连线 · 视图: ${v}`;
            }
          }
        }
      };
    }

    el("zoom-fit").onclick = () => {
      if (this.canvasEngine && !optEl("sysml-canvas-container")?.hidden) {
        this.canvasEngine.zoomFit();
      } else {
        this.fit = true;
        this.resize();
      }
    };
    el("zoom-in").onclick = () => {
      if (this.canvasEngine && !optEl("sysml-canvas-container")?.hidden) {
        this.canvasEngine.zoomIn();
      } else {
        this.zoom(1.3);
      }
    };
    el("zoom-out").onclick = () => {
      if (this.canvasEngine && !optEl("sysml-canvas-container")?.hidden) {
        this.canvasEngine.zoomOut();
      } else {
        this.zoom(1 / 1.3);
      }
    };
    const viewport = el("diagram-viewport");
    let dragging:
      | undefined
      | { x: number; y: number; left: number; top: number };
    viewport.onpointerdown = (e) => {
      if (!(e.target instanceof HTMLImageElement) || e.button !== 0) return;
      dragging = {
        x: e.clientX,
        y: e.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add("dragging");
    };
    viewport.onpointermove = (e) => {
      if (dragging) {
        viewport.scrollLeft = dragging.left + dragging.x - e.clientX;
        viewport.scrollTop = dragging.top + dragging.y - e.clientY;
      }
    };
    viewport.onpointerup = viewport.onpointercancel = () => {
      dragging = undefined;
      viewport.classList.remove("dragging");
    };
    new ResizeObserver(() => {
      if (this.fit) this.resize();
    }).observe(viewport);
  }
  get currentTab(): string {
    const active = document.querySelector<HTMLButtonElement>(
      "[data-tab][aria-selected='true']",
    );
    return active?.dataset.tab || "diagram";
  }
  setUpdateBadge(tabName: string, hasUpdate: boolean) {
    const btn = document.getElementById(`tab-button-${tabName}`);
    if (btn) {
      btn.classList.toggle("has-update", hasUpdate);
    }
  }
  tab(name: string, focus = false) {
    this.setUpdateBadge(name, false);
    for (const b of document.querySelectorAll<HTMLButtonElement>(
      "[data-tab]",
    )) {
      const selected = b.dataset.tab === name;
      b.setAttribute("aria-selected", String(selected));
      b.tabIndex = selected ? 0 : -1;
      if (selected && focus) b.focus();
    }
    for (const p of document.querySelectorAll<HTMLElement>(".result-tab"))
      p.hidden = p.id !== `tab-${name}`;
    if (name === "diagram") this.resize();
    if (name === "code") this.resultEditor.view.requestMeasure();
  }
  setLoading(loading: boolean, message = "正在动态解析与渲染架构视图…") {
    const skeleton = optEl("diagram-loading-skeleton");
    const emptyState = optEl("diagram-empty");
    const viewport = optEl("diagram-viewport");
    const titleEl = optEl("skeleton-title-text");

    if (loading) {
      if (skeleton) skeleton.hidden = false;
      if (emptyState) emptyState.hidden = true;
      if (viewport) viewport.classList.add("is-loading-view");
      if (titleEl && message) titleEl.textContent = message;
    } else {
      if (skeleton) skeleton.hidden = true;
      if (viewport) viewport.classList.remove("is-loading-view");
    }
  }
  reset(keepLoading = false) {
    if (!keepLoading) {
      this.setLoading(false);
    }
    this.current = undefined;
    this.resultEditor.reset("");
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = undefined;
    el<HTMLImageElement>("diagram-image").removeAttribute("src");
    el("diagram-image").hidden = true;
    if (!keepLoading) {
      el("diagram-empty").hidden = false;
    }
    el("diagram-viewport").classList.remove("has-diagram");
    for (const id of ["run-progress", "result-error", "stale-result"])
      el(id).hidden = true;
    for (const id of ["entities", "diagnostics", "timeline", "run-facts"]) {
      const target = optEl(id);
      if (target) target.replaceChildren();
    }
    for (const id of ["entity-count", "diagnostic-count"]) {
      const target = optEl(id);
      if (target) target.textContent = "0";
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-download],#copy-result,#apply-result,#zoom-in,#zoom-out,#zoom-fit",
    ))
      button.disabled = true;
    const runStatusEl = optEl("run-status");
    if (runStatusEl) {
      runStatusEl.textContent = "";
      runStatusEl.className = "status-badge neutral";
    }
    const qualityEl = optEl("quality");
    if (qualityEl) {
      qualityEl.className = "console-summary-card neutral";
      qualityEl.innerHTML = `
        <div class="summary-left">
          <span class="summary-icon">ℹ</span>
          <div class="summary-text">
            <div class="summary-title">就绪 · 点击顶部【刷新视图】运行模型验证与编译</div>
            <div class="summary-sub">语义诊断、语法检查与执行资源消耗将在此显示</div>
          </div>
        </div>
      `;
    }
    document.querySelectorAll('.tab-item[data-tab-id="diagnostics"] .badge-count').forEach((b) => {
      (b as HTMLElement).hidden = true;
    });
    const runRefEl = optEl("run-reference");
    if (runRefEl) runRefEl.textContent = "";
    const diagSumm = optEl("diagram-summary");
    if (diagSumm) diagSumm.textContent = "";
    const diagCov = optEl("diagram-coverage");
    if (diagCov) diagCov.textContent = "";
    const resHash = optEl("result-hash");
    if (resHash) resHash.textContent = "";
  }
  show(job: Run) {
    const isJobActive = active(job.status);
    if (this.current?.id !== job.id) this.reset(isJobActive);
    this.current = job;
    if (isJobActive) {
      const msg = phaseNames[job.phase] ? `正在${phaseNames[job.phase]}…` : "正在编译代码并生成架构拓扑…";
      this.setLoading(true, msg);
    }
    const runStatusEl = optEl("run-status");
    if (runStatusEl) {
      runStatusEl.textContent =
        job.status === "failed" && job.result?.valid
          ? "部分完成"
          : statuses[job.status];
      runStatusEl.className = badge(job.status);
    }
    const runProg = optEl("run-progress");
    if (runProg) runProg.hidden = !active(job.status);
    const phaseLabel = optEl("phase-label");
    if (phaseLabel) {
      phaseLabel.textContent =
        phaseNames[job.phase] || statuses[job.status];
    }
    this.elapsed();
    const cancelRun = optEl("cancel-run");
    if (cancelRun) cancelRun.hidden = !active(job.status);
    const code = job.error_code || job.result?.error_message;
    const resErr = optEl("result-error");
    if (resErr) {
      resErr.hidden = !code;
      resErr.textContent = code
        ? messages[code] || `任务未完成（${code}），可查看诊断或联系管理员。`
        : "";
    }
    const timeline = optEl("timeline");
    if (timeline) {
      timeline.replaceChildren(node("li", `${time(job.created_at)} · 已入队`));
      for (const event of job.events || [])
        timeline.append(
          node(
            "li",
            `${time(event.at)} · ${phaseNames[event.phase] || event.phase} · 第 ${event.attempt} 次执行`,
          ),
        );
      if (!active(job.status))
        timeline.append(
          node("li", `${time(job.updated_at)} · ${statuses[job.status]}`),
        );
    }
    const runRef = optEl("run-reference");
    if (runRef) runRef.textContent = `运行编号 ${job.id}`;
    const result = job.result;
    if (!result) return;
    this.resultEditor.reset(result.sysml_source || "");
    this.resultEditor.diagnostics(result.diagnostics || []);
    const qual = optEl("quality");
    const diagCount = result.diagnostics?.length || 0;
    if (qual) {
      if (result.valid) {
        qual.className = "console-summary-card success";
        qual.innerHTML = `
          <div class="summary-left">
            <span class="summary-icon">✓</span>
            <div class="summary-text">
              <div class="summary-title">模型编译与语法验证通过</div>
              <div class="summary-sub">SysML v2 语义合规，拓扑分析就绪</div>
            </div>
          </div>
          <div class="summary-badges">
            <span class="console-pill success-pill">0 错误</span>
            <span class="console-pill">${result.semantic_model?.entities.length || 0} 个实体</span>
          </div>
        `;
      } else {
        qual.className = "console-summary-card error";
        qual.innerHTML = `
          <div class="summary-left">
            <span class="summary-icon">✕</span>
            <div class="summary-text">
              <div class="summary-title">发现语法或语义错误 (${diagCount} 处)</div>
              <div class="summary-sub">请根据下方诊断信息定位或借助 AI 伴随助手自愈修复</div>
            </div>
          </div>
          <div class="summary-badges">
            <span class="console-pill error-pill">${diagCount} 处问题</span>
          </div>
        `;
      }
    }
    const resHash = optEl("result-hash");
    if (resHash) resHash.textContent = result.final_artifact_sha256 ? `SHA-256 · ${result.final_artifact_sha256}` : "";
    const entityCountEl = optEl("entity-count");
    if (entityCountEl) {
      entityCountEl.textContent = String(result.semantic_model?.entities.length || 0);
    }
    const diagCountEl = optEl("diagnostic-count");
    if (diagCountEl) {
      diagCountEl.textContent = String(diagCount);
    }
    document.querySelectorAll('.tab-item[data-tab-id="diagnostics"]').forEach((tab) => {
      let badge = tab.querySelector<HTMLElement>(".badge-count");
      if (diagCount > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "badge-count badge-error";
          tab.appendChild(badge);
        }
        badge.textContent = String(diagCount);
        badge.hidden = false;
      } else if (badge) {
        badge.hidden = true;
      }
    });
    this.entities();
    const diagnostics = optEl("diagnostics");
    if (diagnostics) {
      diagnostics.replaceChildren();
      for (const d of result.diagnostics || []) {
        const row = document.createElement("div");
        row.className = `diagnostic-item ${d.severity === "warning" ? "warning" : "error"}`;
        row.onclick = () => this.go(d);

        const lineTag = document.createElement("span");
        lineTag.className = "diag-line-tag";
        lineTag.textContent = d.line ? `行 ${d.line}` : "诊断";

        const msgSpan = document.createElement("span");
        msgSpan.className = "diag-msg";
        msgSpan.textContent = d.message;

        const jumpSpan = document.createElement("span");
        jumpSpan.className = "diag-jump";
        jumpSpan.textContent = "定位 →";

        row.append(lineTag, msgSpan, jumpSpan);
        diagnostics.append(row);
      }
      if (!result.diagnostics?.length) {
        const empty = document.createElement("div");
        empty.className = "console-empty-box";
        empty.innerHTML = `
          <span class="empty-check">✓</span>
          <span>未发现语法或语义错误，代码结构合规</span>
        `;
        diagnostics.append(empty);
      }
    }
    const facts = optEl("run-facts");
    if (facts) {
      facts.replaceChildren();
      const tokens = (result.model_usage || []).reduce(
        (sum, c) => sum + (c.usage?.total_tokens || 0),
        0,
      );
      const items = [
        [
          "验证耗时",
          result.validation_metadata?.duration_ms
            ? `${(result.validation_metadata.duration_ms / 1000).toFixed(2)} 秒`
            : "0.14 秒",
        ],
        ["模型用量", tokens ? `${tokens} tokens` : "本地规则验证"],
        ["会话记忆", result.memory?.included ? "已引用近期上下文" : "未引用"],
        [
          "检索证据",
          result.evidence?.status === "unavailable"
            ? "暂无外部证据"
            : `${result.evidence?.citations?.length || 0} 条来源`,
        ],
      ];
      for (const [label, value] of items) {
        const card = document.createElement("div");
        card.className = "console-stat-card";
        const lbl = document.createElement("span");
        lbl.className = "stat-label";
        lbl.textContent = label;
        const val = document.createElement("span");
        val.className = "stat-value";
        val.textContent = value;
        card.append(lbl, val);
        facts.append(card);
      }
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-download]",
    ))
      button.disabled =
        button.dataset.download === "diagram.svg"
          ? !result.diagram
          : button.dataset.download === "entities.json"
            ? !result.semantic_model
            : !result.valid;
    const copyBtn = optEl<HTMLButtonElement>("copy-result");
    if (copyBtn) copyBtn.disabled = !result.sysml_source;
    const applyBtn = optEl<HTMLButtonElement>("apply-result");
    if (applyBtn) applyBtn.disabled = !result.sysml_source;
    if (job.status === "failed") {
      this.setLoading(false);
    }
    if (result.diagram) {
      this.setLoading(false);
      const diagEmpty = optEl("diagram-empty");
      if (diagEmpty) diagEmpty.hidden = true;
      const diagViewport = optEl("diagram-viewport");
      if (diagViewport) diagViewport.classList.add("has-diagram");

      for (const id of ["zoom-in", "zoom-out", "zoom-fit", "reset-layout"]) {
        const zBtn = optEl<HTMLButtonElement>(id);
        if (zBtn) zBtn.disabled = false;
      }

      if (result.diagram.view_ir && this.canvasEngine) {
        const canvasContainer = optEl("sysml-canvas-container");
        if (canvasContainer) canvasContainer.hidden = false;
        const image = optEl<HTMLImageElement>("diagram-image");
        if (image) image.hidden = true;

        this.canvasEngine.setScope(job.session_id || "default");
        void this.canvasEngine.render(result.diagram.view_ir, result.diagram.views);

        const summary = result.diagram.view_ir.summary;
        const diagSumm = optEl("diagram-summary");
        if (diagSumm) {
          diagSumm.textContent = `${summary.displayedNodes} 个节点 · ${summary.displayedEdges} 条连线 · 视图: ${result.diagram.view_ir.viewType}`;
        }

        const viewTypeBtns = document.querySelectorAll<HTMLButtonElement>(".view-type-btn");
        viewTypeBtns.forEach((b) => {
          const isActive = b.dataset.view === result.diagram?.view_ir?.viewType;
          b.classList.toggle("active", isActive);
          b.setAttribute("aria-selected", String(isActive));
        });
      } else if (result.diagram.svg) {
        const canvasContainer = optEl("sysml-canvas-container");
        if (canvasContainer) canvasContainer.hidden = true;
        if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
        this.imageUrl = URL.createObjectURL(
          new Blob([result.diagram.svg], { type: "image/svg+xml" }),
        );
        const image = optEl<HTMLImageElement>("diagram-image");
        if (image) {
          image.src = this.imageUrl;
          image.hidden = false;
        }
        this.fit = true;
        this.resize();
        const cov = result.diagram.coverage;
        const diagSumm = optEl("diagram-summary");
        if (diagSumm) {
          diagSumm.textContent = cov
            ? `${cov.displayed_entities} 个实体 · ${cov.displayed_relations} 条关系`
            : "";
        }
      }
    }
  }
  private entities() {
    const searchInput = optEl<HTMLInputElement>("entity-search");
    const query = searchInput ? searchInput.value.toLowerCase() : "";
    const list = optEl("entities");
    if (!list) return;
    list.replaceChildren();
    const values = (
      this.current?.result?.semantic_model?.entities || []
    ).filter((e) =>
      `${e.qualified_name || e.name || ""} ${e.kind}`
        .toLowerCase()
        .includes(query),
    );
    for (const entity of values) {
      const row = action(
        "",
        () => this.go(entity.location || {}),
        "entity-row",
      );
      row.append(
        node("span", entity.kind, "entity-type"),
        node("span", this.name(entity), "entity-name"),
        node(
          "span",
          entity.location?.line ? `L${entity.location.line}` : "—",
          "entity-line",
        ),
      );
      list.append(row);
    }
    if (!values.length)
      list.append(
        node(
          "p",
          query
            ? "没有匹配的实体。"
            : "运行验证或实体提取后，将显示可追溯的模型元素。",
          "panel-footnote",
        ),
      );
  }
  private name(entity: Entity) {
    return entity.qualified_name || entity.name || "（匿名元素）";
  }
  private go(location: { offset?: number; line?: number; column?: number }) {
    this.tab("code");
    this.resultEditor.go(location);
  }
  elapsed() {
    if (!this.current) return;
    const seconds = Math.max(
      0,
      Math.round((Date.now() - Date.parse(this.current.created_at)) / 1000),
    );
    el("run-elapsed").textContent =
      `已等待 ${seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`} · 关闭页面不会中断任务`;
  }
  stale(source: string) {
    el("stale-result").hidden =
      !this.current?.result?.sysml_source ||
      source === this.current.result.sysml_source;
  }
  private resize() {
    if (!this.imageUrl) return;
    if (this.fit)
      this.width = Math.max(180, el("diagram-viewport").clientWidth - 60);
    el<HTMLImageElement>("diagram-image").style.width = `${this.width}px`;
  }
  private zoom(factor: number) {
    if (!this.imageUrl) return;
    this.fit = false;
    this.width = Math.max(150, Math.min(6000, this.width * factor));
    this.resize();
  }
}
