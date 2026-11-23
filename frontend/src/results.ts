import { el, node, action, download } from "./dom";
import { ApiClient, messages } from "./api";
import { SourceEditor } from "./editor";
import { active } from "./state";
import type { Run, Entity } from "./types";

export const taskNames = {
  generate: "生成代码",
  revise: "按需求修改",
  repair: "修复代码",
  validate: "验证代码",
  extract: "提取实体",
  render: "生成结构图",
};
export const phaseNames: Record<string, string> = {
  queued: "等待执行",
  preparing: "正在准备",
  retrieving: "正在检索知识",
  generating: "正在生成代码",
  repairing: "正在修改与修复",
  validating: "正在验证 SysML",
  rendering: "正在生成结构图",
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
  private resultEditor = new SourceEditor(el("result-editor"), true);
  private imageUrl?: string;
  private width = 600;
  private fit = true;
  constructor(
    private api: ApiClient,
    private fail: (e: unknown) => void,
    private apply: (code: string) => void,
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
    el("entity-search").oninput = () => this.entities();
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
    el("zoom-fit").onclick = () => {
      this.fit = true;
      this.resize();
    };
    el("zoom-in").onclick = () => this.zoom(1.3);
    el("zoom-out").onclick = () => this.zoom(1 / 1.3);
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
  tab(name: string, focus = false) {
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
  reset() {
    this.current = undefined;
    this.resultEditor.reset("");
    if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
    this.imageUrl = undefined;
    el<HTMLImageElement>("diagram-image").removeAttribute("src");
    el("diagram-image").hidden = true;
    el("diagram-empty").hidden = false;
    el("diagram-viewport").classList.remove("has-diagram");
    for (const id of ["run-progress", "result-error", "stale-result"])
      el(id).hidden = true;
    for (const id of ["entities", "diagnostics", "timeline", "run-facts"])
      el(id).replaceChildren();
    for (const id of ["entity-count", "diagnostic-count"])
      el(id).textContent = "0";
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-download],#copy-result,#apply-result,#zoom-in,#zoom-out,#zoom-fit",
    ))
      button.disabled = true;
    el("run-status").textContent = "尚未运行";
    el("run-status").className = badge("idle");
    el("quality").textContent = "尚未运行模型验证。";
    el("quality").className = "quality";
    el("run-reference").textContent = "";
    el("diagram-summary").textContent = "语义结构概览";
    el("diagram-coverage").textContent =
      "仅显示已解析的语义结构；不是所有 SysML 图种。";
    el("result-hash").textContent = "运行后可追溯到源代码版本。";
  }
  show(job: Run) {
    if (this.current?.id !== job.id) this.reset();
    this.current = job;
    el("run-status").textContent =
      job.status === "failed" && job.result?.valid
        ? "部分完成"
        : statuses[job.status];
    el("run-status").className = badge(job.status);
    el("run-progress").hidden = !active(job.status);
    el("phase-label").textContent =
      phaseNames[job.phase] || statuses[job.status];
    this.elapsed();
    el("cancel-run").hidden = !active(job.status);
    const code = job.error_code || job.result?.error_message;
    el("result-error").hidden = !code;
    el("result-error").textContent = code
      ? messages[code] || `任务未完成（${code}），可查看诊断或联系管理员。`
      : "";
    const timeline = el("timeline");
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
    el("run-reference").textContent = `运行编号 ${job.id}`;
    const result = job.result;
    if (!result) return;
    this.resultEditor.reset(result.sysml_source || "");
    this.resultEditor.diagnostics(result.diagnostics || []);
    el("quality").textContent = result.valid
      ? "语言验证通过。工程意图的正确性仍需评审。"
      : "代码尚未通过验证，请检查诊断后再使用。";
    el("quality").className = `quality ${result.valid ? "" : "invalid"}`;
    el("result-hash").textContent = result.final_artifact_sha256
      ? `SHA-256 · ${result.final_artifact_sha256}`
      : "本次没有生成源代码产物。";
    el("entity-count").textContent = String(
      result.semantic_model?.entities.length || 0,
    );
    el("diagnostic-count").textContent = String(
      result.diagnostics?.length || 0,
    );
    this.entities();
    const diagnostics = el("diagnostics");
    diagnostics.replaceChildren();
    for (const d of result.diagnostics || []) {
      const row = action(
        "",
        () => this.go(d),
        `diagnostic ${d.severity === "warning" ? "warning" : ""}`,
      );
      row.append(
        node("small", d.line ? `第 ${d.line} 行` : "诊断"),
        node("span", d.message),
      );
      diagnostics.append(row);
    }
    if (!result.diagnostics?.length)
      diagnostics.append(
        node(
          "p",
          result.valid
            ? "没有语言诊断。"
            : "本次未返回语言诊断，请查看任务状态。",
          "panel-footnote",
        ),
      );
    const facts = el("run-facts");
    facts.replaceChildren();
    const tokens = (result.model_usage || []).reduce(
      (sum, c) => sum + (c.usage?.total_tokens || 0),
      0,
    );
    const items = [
      [
        "语言验证",
        result.validation_metadata?.duration_ms
          ? `${(result.validation_metadata.duration_ms / 1000).toFixed(2)} 秒`
          : "—",
      ],
      ["模型用量", tokens ? `${tokens} tokens` : "未报告 token 用量"],
      ["会话记忆", result.memory?.included ? "已引用近期上下文" : "未引用"],
      [
        "检索证据",
        result.evidence?.status === "unavailable"
          ? "暂不可用"
          : `${result.evidence?.citations?.length || 0} 条来源`,
      ],
    ];
    for (const [label, value] of items) {
      const card = node("div", "", "fact");
      card.append(node("small", label), node("span", value));
      facts.append(card);
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
    el<HTMLButtonElement>("copy-result").disabled = !result.sysml_source;
    el<HTMLButtonElement>("apply-result").disabled = !result.sysml_source;
    if (result.diagram?.svg) {
      if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
      this.imageUrl = URL.createObjectURL(
        new Blob([result.diagram.svg], { type: "image/svg+xml" }),
      );
      const image = el<HTMLImageElement>("diagram-image");
      image.src = this.imageUrl;
      image.hidden = false;
      el("diagram-empty").hidden = true;
      el("diagram-viewport").classList.add("has-diagram");
      this.fit = true;
      this.resize();
      for (const id of ["zoom-in", "zoom-out", "zoom-fit"])
        el<HTMLButtonElement>(id).disabled = false;
      const cov = result.diagram.coverage;
      el("diagram-summary").textContent = cov
        ? `${cov.displayed_entities} 个实体 · ${cov.displayed_relations} 条关系`
        : "语义结构概览";
      el("diagram-coverage").textContent = cov
        ? `未显示 ${cov.omitted_entities} 个匿名、外部或范围外元素。结构概览不代表所有 SysML 图种。`
        : "语义结构概览";
    }
  }
  private entities() {
    const query = el<HTMLInputElement>("entity-search").value.toLowerCase();
    const list = el("entities");
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
