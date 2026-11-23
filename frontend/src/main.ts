import "./workbench.css";
import { LayoutManager } from "./layout";
import { ApiClient, ApiError, messages } from "./api";
import {
  DraftBuffer,
  SubmissionLatch,
  VersionGate,
  active,
  pollingDelay,
} from "./state";
import { SourceEditor } from "./editor";
import { Results, taskNames, badge, time } from "./results";
import { el, node, action, dialog, download } from "./dom";
import type {
  Identity,
  Session,
  SessionSummary,
  WorkspaceValue,
  Draft,
  Run,
  Page,
  Capabilities,
  Knowledge,
  Task,
} from "./types";

const api = new ApiClient(),
  authGate = new VersionGate(),
  selection = new VersionGate(),
  runGate = new VersionGate(),
  submission = new SubmissionLatch();
const historyGate = new VersionGate();
const polling = new Set<number>();
let identity: Identity | undefined,
  sessionId: string | undefined,
  buffer: DraftBuffer<WorkspaceValue> | undefined,
  sessions: SessionSummary[] = [];
let capabilities: Capabilities | undefined,
  historyRows: Run[] = [],
  historyCursor: string | null | undefined;
let submitting = false,
  switching = false,
  creating = false,
  saveError = false,
  saveTimer: ReturnType<typeof setTimeout> | undefined,
  pollTimer: ReturnType<typeof setTimeout> | undefined;
let selectedRun: string | undefined,
  pollFailures = 0;
const sourceEditor = new SourceEditor(
  el("source-editor"),
  false,
  (source) => {
    if (buffer) {
      edit({ ...buffer.value.draft, sysml_source: source });
    }
  },
  () => void submitRun(),
  () => void save().catch(fail),
);
const results = new Results(api, fail, (source) => void applySource(source));
const example = `package Electrical {
    port def Power;

    part def System {
        part battery {
            port output: Power;
        }
        part motor {
            port input: Power;
        }
        connection energy
            connect battery.output to motor.input;
    }
}
`;

function notice(text = "") {
  el("notice-text").textContent = text;
  el("notice").hidden = !text;
  if (text) el("announcement").textContent = text;
}
function fail(error: unknown) {
  const message =
    error instanceof ApiError
      ? `${error.message}${error.requestId ? ` 请求编号：${error.requestId}` : ""}`
      : error instanceof Error && error.message === "draft_conflict"
        ? messages.draft_conflict
        : "连接或操作未能完成。你的输入仍保留在当前页面，请重试。";
  if (error instanceof ApiError && error.status === 401) {
    authGate.next();
    runGate.next();
    clearTimeout(pollTimer);
    el("login").hidden = false;
    el("workspace").hidden = true;
    el("login-error").textContent = message;
    el("rescue-draft").hidden = !buffer?.dirty;
    for (const modal of document.querySelectorAll<HTMLDialogElement>(
      "dialog[open]",
    ))
      modal.close();
    return;
  }
  notice(message);
}
function updateSave() {
  const dirty = !!buffer?.dirty;
  el("save-state").textContent = buffer?.conflict
    ? "保存冲突"
    : saveError
      ? "保存失败"
      : buffer?.saving
        ? "正在保存…"
        : dirty
          ? "尚未保存"
          : "已保存";
  el("save-state").classList.toggle("unsaved", dirty || saveError);
  el("draft-indicator").hidden = !dirty;
  el("conflict").hidden = !buffer?.conflict;
  results.stale(sourceEditor.value);
  const lineCount = sourceEditor.value.split("\n").length;
  el("source-count").textContent = `${lineCount} 行 · UTF-8`;
  const fileMeta = document.getElementById("sidebar-file-meta");
  if (fileMeta) {
    fileMeta.textContent = `${lineCount} 行 · UTF-8`;
  }
  el("memory-label").textContent = buffer?.value.memory_enabled
    ? "会话记忆已开启"
    : "会话记忆已关闭";
}
function updateControls() {
  const task = el<HTMLSelectElement>("task").value as Task;
  const needsModel = ["generate", "revise", "repair"].includes(task);
  const available = capabilities?.capabilities.includes(task);
  el("prompt-area").hidden = !needsModel;
  el("render-option").hidden = task === "render";
  el("prompt-label").textContent =
    task === "generate"
      ? "工程需求"
      : task === "revise"
        ? "需要怎样修改模型？"
        : "修复要求（可选）";
  el("capability-note").textContent = !capabilities
    ? "正在检查服务"
    : !capabilities.workers
      ? "执行服务暂不可用"
      : needsModel && !available
        ? "模型 API 尚未配置"
        : task === "render" && !available
          ? "结构图服务暂不可用"
          : "";
  const button = el<HTMLButtonElement>("submit");
  el<HTMLButtonElement>("logout").disabled = submitting || switching || creating;
  button.textContent = submitting ? "正在提交…" : taskNames[task];
  button.disabled = submitting || switching || !sessionId || !available;
  el<HTMLButtonElement>("new-session").disabled =
    creating || switching || submitting;
  el<HTMLButtonElement>("model-settings").disabled = switching || !sessionId;
  el<HTMLButtonElement>("rename-session").disabled = switching || !sessionId;
  el<HTMLButtonElement>("save-draft").disabled = switching || !buffer;
}
function edit(draft: Draft) {
  if (!buffer) return;
  buffer.set({ ...buffer.value, draft });
  saveError = false;
  updateSave();
  updateControls();
  sourceEditor.diagnostics(
    sourceEditor.value === results.current?.result?.sysml_source
      ? results.current.result.diagnostics || []
      : [],
  );
  clearTimeout(saveTimer);
  if (!buffer.conflict)
    saveTimer = setTimeout(() => void save().catch(fail), 800);
}
async function save() {
  clearTimeout(saveTimer);
  const current = buffer,
    id = sessionId,
    epoch = authGate.current;
  if (!current || !id) return;
  const saving = current.flush(async (value, revision) => {
    const answer = await api.json<Session>(`/v1/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...value, revision }),
    });
    return answer;
  });
  updateSave();
  try {
    await saving;
    if (authGate.accepts(epoch) && buffer === current) {
      saveError = false;
      const summary = sessions.find((s) => s.id === id);
      if (summary) summary.title = current.value.title;
      renderSessions();
    }
  } catch (error) {
    if (buffer === current) saveError = true;
    throw error;
  } finally {
    if (buffer === current) updateSave();
  }
}
function install(session: Session) {
  sessionId = session.id;
  buffer = new DraftBuffer(
    {
      title: session.title,
      memory_enabled: session.memory_enabled,
      draft: session.draft,
    },
    session.revision,
  );
  saveError = false;
  sourceEditor.reset(session.draft.sysml_source);
  el<HTMLTextAreaElement>("prompt").value = session.draft.request;
  el<HTMLSelectElement>("task").value = session.draft.task;
  el<HTMLInputElement>("render").checked = session.draft.render;
  el("rename-session").textContent = session.title;
  updateSave();
  updateControls();
  renderSessions();
  void loadCopilotChat(session.id);
}
function renderSessions() {
  const filter = el<HTMLInputElement>("session-search").value.toLowerCase();
  el("session-count").textContent = String(sessions.length);
  const list = el("sessions");
  list.replaceChildren();
  for (const session of sessions.filter((s) =>
    s.title.toLowerCase().includes(filter),
  )) {
    const isCurrent = session.id === sessionId;
    const button = node(
      "div",
      "",
      `session-thread ${isCurrent ? "active" : ""}`,
    );
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.title = `${session.title} (双击重命名)`;
    button.setAttribute("aria-current", isCurrent ? "page" : "false");

    const iconSpan = node("span", "💬", "thread-icon");
    const infoDiv = node("div", "", "thread-info");
    const labelSpan = node("strong", session.title, "thread-title");
    const metaSpan = node(
      "small",
      isCurrent ? "当前活动会话" : "建模会话",
      "thread-meta",
    );
    infoDiv.append(labelSpan, metaSpan);
    button.append(iconSpan, infoDiv);

    const startInlineRename = () => {
      const input = document.createElement("input");
      input.className = "session-rename-input";
      input.value = session.title;
      infoDiv.replaceWith(input);
      input.focus();
      input.select();
      let committed = false;
      const commit = async () => {
        if (committed) return;
        committed = true;
        const newTitle = input.value.trim() || session.title;
        if (newTitle !== session.title) {
          try {
            if (session.id === sessionId && buffer) {
              buffer.set({ ...buffer.value, title: newTitle });
              el("rename-session").textContent = newTitle;
              await save();
            } else {
              await api.json(`/v1/sessions/${session.id}`, {
                method: "PATCH",
                body: JSON.stringify({ title: newTitle }),
              });
              session.title = newTitle;
            }
          } catch (err) {
            fail(err);
          }
        }
        renderSessions();
      };
      input.onblur = () => void commit();
      input.onkeydown = (ke) => {
        if (ke.key === "Enter") {
          ke.preventDefault();
          void commit();
        } else if (ke.key === "Escape") {
          ke.preventDefault();
          committed = true;
          renderSessions();
        }
      };
    };

    let clickTimer: ReturnType<typeof setTimeout> | undefined;

    button.onclick = (e) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = undefined;
        return;
      }
      clickTimer = setTimeout(() => {
        clickTimer = undefined;
        void selectSession(session.id).catch(fail);
      }, 250);
    };

    button.ondblclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = undefined;
      }
      startInlineRename();
    };

    list.append(button);
  }
  if (!list.childElementCount)
    list.append(
      node(
        "p",
        filter ? "没有匹配的会话" : "还没有会话，点击上方新建工程会话。",
        "session-empty",
      ),
    );
}
async function loadSessions() {
  const epoch = authGate.current;
  const answer = await api.json<Page<SessionSummary>>("/v1/sessions");
  if (authGate.accepts(epoch)) {
    sessions = answer.items;
    renderSessions();
  }
  return answer.items;
}
function updateUrl() {
  if (!sessionId) {
    history.replaceState(null, "", location.pathname);
    return;
  }
  const params = new URLSearchParams({ model: sessionId });
  if (selectedRun) params.set("run", selectedRun);
  history.replaceState(null, "", `#${params}`);
}
async function selectSession(id: string, skipSave = false) {
  if (switching || submitting) return;
  switching = true;
  updateControls();
  try {
    if (!skipSave) await save();
    const epoch = authGate.current,
      ticket = selection.next();
    runGate.next();
    clearTimeout(pollTimer);
    const session = await api.json<Session>(`/v1/sessions/${id}`);
    if (!authGate.accepts(epoch) || !selection.accepts(ticket)) return;
    results.reset();
    selectedRun = undefined;
    submission.accepted();
    install(session);
    el("sidebar").classList.remove("open");
    el("toggle-sidebar").setAttribute("aria-expanded", "false");
    const requestedRun = new URLSearchParams(location.hash.slice(1)).get("run");
    updateUrl();
    await loadHistory();
    if (!selection.accepts(ticket)) return;
    const run =
      historyRows.find((r) => r.id === requestedRun) || historyRows[0];
    if (run) await viewRun(run.id);
    else results.tab("diagram");
  } finally {
    switching = false;
    updateControls();
  }
}
async function createSession(value?: WorkspaceValue) {
  if (creating || switching || submitting) return;
  creating = true;
  updateControls();
  try {
    if (!value) await save();
    const session = await api.json<Session>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({
        title: value?.title || "未命名模型",
        memory_enabled: value?.memory_enabled ?? true,
      }),
    });
    if (value) {
      const saved = await api.json<Session>(`/v1/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...value, revision: session.revision }),
      });
      session.draft = saved.draft;
      session.revision = saved.revision;
    } else if (!capabilities?.capabilities.includes("generate")) {
      session.draft.task = "render";
      await api.json(`/v1/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          draft: session.draft,
          revision: session.revision,
        }),
      });
    }
    await loadSessions();
    await selectSession(session.id, true);
    notice();
  } finally {
    creating = false;
    updateControls();
  }
}
async function applySource(source: string, skipConfirm = false) {
  if (!buffer) return;
  if (!skipConfirm && sourceEditor.value && sourceEditor.value !== source) {
    const choice = await dialog(
      "将结果用于继续编辑？",
      "当前草稿将替换为这份代码。运行记录保持不变，编辑器中可撤销这次替换。",
      [
        { label: "取消", value: "cancel" },
        { label: "继续编辑", value: "apply" },
      ],
    );
    if (choice.value !== "apply") return;
  }
  sourceEditor.value = source;
  el<HTMLSelectElement>("task").value = "render";
  edit({ ...buffer.value.draft, task: "render", sysml_source: source });
  await save().catch(fail);
  sourceEditor.view.focus();
}
async function useExample() {
  if (!sessionId) await createSession();
  if (buffer) {
    await applySource(example);
    if (buffer.value.title === "未命名模型") {
      buffer.set({ ...buffer.value, title: "电力系统" });
      el("rename-session").textContent = "电力系统";
      await save();
    }
  }
}

async function refreshCapabilities() {
  if (!identity || !el("login").hidden) return;
  const epoch = authGate.current;
  try {
    const value = await api.json<Capabilities>("/v1/capabilities");
    if (!authGate.accepts(epoch)) return;
    capabilities = value;
    const good = value.workers > 0;
    el("connection-label").textContent = good
      ? "服务已连接"
      : "等待执行服务恢复";
    el("connection-dot").className = `status-dot ${good ? "good" : "warn"}`;
    const degraded =
      !value.capabilities.includes("render") ||
      !value.capabilities.includes("rag");
    el("service-summary").textContent = good
      ? degraded
        ? "部分服务不可用"
        : "服务运行正常"
      : "执行服务不可用";
    el("service-dot").className =
      `status-dot ${good && !degraded ? "good" : "warn"}`;
    const rows = el("capabilities");
    rows.replaceChildren();
    for (const [name, label] of [
      ["validate", "语言验证 / 实体提取"],
      ["render", "结构图"],
      ["rag", "知识检索"],
      ["generate", "付费模型"],
    ]) {
      const row = node("div", "", "capability-row");
      row.append(
        node("span", label),
        node(
          "span",
          value.capabilities.includes(name)
            ? name === "generate"
              ? "已配置"
              : "可用"
            : name === "generate"
              ? "未配置或无 worker"
              : "不可用",
          `status-badge ${value.capabilities.includes(name) ? "" : "neutral"}`,
        ),
      );
      rows.append(row);
    }
    updateControls();
  } catch (error) {
    if (!authGate.accepts(epoch)) return;
    capabilities = undefined;
    el("connection-label").textContent = "连接中断，正在重连";
    el("connection-dot").className = "status-dot bad";
    el("service-summary").textContent = "服务连接中断";
    el("service-dot").className = "status-dot bad";
    updateControls();
    if (error instanceof ApiError && error.status === 401) fail(error);
  }
}

async function loadHistory(more = false) {
  const id = sessionId,
    ticket = selection.current;
  if (!id) return;
  const request = historyGate.next();
  const cursor = more ? historyCursor : null;
  if (more && !cursor) return;
  const page = await api.json<Page<Run>>(
    `/v1/sessions/${id}/runs${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  if (!selection.accepts(ticket) || !historyGate.accepts(request) || id !== sessionId) return;
  historyRows = more ? [...new Map([...historyRows, ...page.items].map(row => [row.id, row])).values()] : page.items;
  historyCursor = page.next_cursor;
  renderHistory();
}
function renderHistory() {
  const list = el("history");
  list.replaceChildren();
  for (const run of historyRows) {
    const button = action(
      "",
      () => void viewRun(run.id).catch(fail),
      `history-card ${selectedRun === run.id ? "active" : ""}`,
    );
    const top = node("div", "", "history-top");
    top.append(
      node("span", taskNames[run.task] || "模型运行"),
      node(
        "span",
        run.status === "succeeded"
          ? "已完成"
          : run.status === "failed"
            ? "未完成"
            : run.status === "cancelled"
              ? "已取消"
              : run.status === "queued"
                ? "排队中"
                : "运行中",
        badge(run.status),
      ),
    );
    button.append(
      top,
      node(
        "p",
        `${time(run.created_at)}${run.request_preview ? " · " + run.request_preview : ""}`,
      ),
    );
    list.append(button);
  }
  if (!historyRows.length)
    list.append(
      node(
        "p",
        "还没有运行记录。保存草稿后，选择操作并运行。",
        "panel-footnote",
      ),
    );
  el("more-history").hidden = !historyCursor;
}
async function viewRun(id: string) {
  selectedRun = id;
  const ticket = runGate.next();
  pollFailures = 0;
  clearTimeout(pollTimer);
  results.reset();
  updateUrl();
  renderHistory();
  await poll(ticket);
}
async function poll(ticket = runGate.current) {
  if (polling.has(ticket) || !runGate.accepts(ticket)) return;
  clearTimeout(pollTimer);
  const id = selectedRun,
    model = sessionId;
  if (!id) return;
  polling.add(ticket);
  try {
    let run = await api.json<Run>(`/v1/runs/${id}/status`);
    if (!runGate.accepts(ticket) || sessionId !== model) return;
    if (!active(run.status)) {
      run = await api.json<Run>(`/v1/runs/${id}`);
      if (!runGate.accepts(ticket) || sessionId !== model) return;
    }
    pollFailures = 0;
    results.show(run);
    results.stale(sourceEditor.value);
    el("retry-poll").hidden = true;
    if (active(run.status)) {
      pollTimer = setTimeout(
        () => void poll(ticket),
        pollingDelay(0, document.hidden),
      );
    } else {
      sourceEditor.diagnostics(
        sourceEditor.value === run.result?.sysml_source
          ? run.result.diagnostics || []
          : [],
      );
      await loadHistory();
      if (!runGate.accepts(ticket)) return;
      if (run.status === "failed") {
        if (["generate", "revise", "repair"].includes(run.task)) {
          notifyCopilotRunFailed(run);
        } else {
          results.tab("diagnostics");
        }
      } else if (["generate", "revise", "repair"].includes(run.task)) {
        notifyCopilotRunComplete(run);
        if (run.result?.diagram) {
          results.setUpdateBadge("diagram", true);
        }
      } else if (run.task === "render" || run.result?.diagram) {
        results.tab("diagram");
      } else if (run.task === "extract") {
        results.tab("entities");
      }
      el("announcement").textContent =
        `${taskNames[run.task]}${run.status === "succeeded" ? "已完成" : "已结束"}`;
    }
  } catch (error) {
    if (!runGate.accepts(ticket) || model !== sessionId) return;
    pollFailures++;
    el("retry-poll").hidden = false;
    el("phase-label").textContent = "连接中断 · 任务仍在服务端运行";
    if (
      !(error instanceof ApiError) ||
      error.status === 429 ||
      error.status >= 500
    )
      pollTimer = setTimeout(
        () => void poll(ticket),
        Math.max(
          pollingDelay(pollFailures, document.hidden),
          error instanceof ApiError ? error.retryAfter * 1000 : 0,
        ),
      );
    else fail(error);
  } finally {
    polling.delete(ticket);
  }
}

function notifyCopilotRunComplete(run: Run) {
  const chat = el("copilot-chat");
  if (!chat) return;

  const pending = chat.querySelector(".copilot-msg.pending");
  if (pending) pending.remove();

  const msg = node("div", "", "copilot-msg assistant");
  const avatar = node("div", "🤖", "msg-avatar");
  const body = node("div", "", "msg-body");

  const header = node("div", "", "copilot-card-header");
  header.append(
    node("strong", `✨ 建模任务【${taskNames[run.task] || run.task}】已完成`),
  );
  body.append(header);

  body.append(
    node(
      "p",
      "模型代码已由 glm-5.3 生成并完成语义解析。你可以直接采纳到左侧编辑器，或在右侧查看对应的结构图。",
    ),
  );

  if (run.result?.diagnostics?.length) {
    body.append(
      node(
        "p",
        `⚠️ 伴随诊断提示：${run.result.diagnostics.length} 项（已在左侧行号及诊断面板标出）。`,
        "copilot-diag-note",
      ),
    );
  }

  if (run.result?.sysml_source) {
    const code = run.result.sysml_source;
    body.append(node("pre", code, "copilot-code-preview"));

    const actions = node("div", "", "copilot-code-actions");

    const applyBtn = action(
      "✨ 采纳到编辑器",
      () => {
        void applySource(code, true);
        notice("已将最新代码同步至编辑器！");
      },
      "btn-action-apply",
    );

    const viewBtn = action(
      "📐 查看对应结构图",
      () => {
        results.tab("diagram");
        results.setUpdateBadge("diagram", false);
      },
      "btn-action-view",
    );

    const copyBtn = action(
      "📋 复制代码",
      () => {
        navigator.clipboard.writeText(code).then(() => {
          notice("代码已复制到剪贴板");
        });
      },
      "btn-action-copy",
    );

    actions.append(applyBtn, viewBtn, copyBtn);
    body.append(actions);

    if (!sourceEditor.value.trim()) {
      void applySource(code, true);
    }
  }

  msg.append(avatar, body);
  chat.append(msg);
  chat.scrollTop = chat.scrollHeight;
}

function notifyCopilotRunFailed(run: Run) {
  const chat = el("copilot-chat");
  if (!chat) return;

  const pending = chat.querySelector(".copilot-msg.pending");
  if (pending) pending.remove();

  const msg = node("div", "", "copilot-msg assistant error");
  const avatar = node("div", "🤖", "msg-avatar");
  const body = node("div", "", "msg-body");

  body.append(
    node(
      "p",
      `❌ 任务【${taskNames[run.task] || run.task}】执行未完全成功：${run.error || "请检查模型连接与输入需求。"}`,
    ),
  );

  msg.append(avatar, body);
  chat.append(msg);
  chat.scrollTop = chat.scrollHeight;
}

async function submitRun(overrideTask?: Task, overrideRequest?: string) {
  if (submitting || switching || !buffer || !sessionId) return;
  const task = overrideTask || buffer.value.draft.task;
  const req = overrideRequest !== undefined ? overrideRequest : buffer.value.draft.request;
  if (!capabilities?.capabilities.includes(task)) {
    notice(messages.model_not_configured);
    return;
  }
  // Capture exactly what the user chose to run; autosave may finish after more edits.
  const draft = structuredClone(buffer.value.draft);
  draft.task = task;
  draft.request = req;
  const model = sessionId;
  const epoch = authGate.current;
  if (["generate", "revise"].includes(task) && !draft.request.trim()) {
    notice("请先描述你的工程需求或修改要求。");
    if (!overrideTask) el("prompt").focus();
    return;
  }
  if (task !== "generate" && !draft.sysml_source.trim()) {
    notice("请先编辑或导入 SysML 代码，也可以打开示例模型。");
    sourceEditor.view.focus();
    return;
  }
  submitting = true;
  updateControls();
  try {
    await save();
    if (!authGate.accepts(epoch) || sessionId !== model) return;
    const payload = {
      session_id: model,
      ...draft,
      sysml_source: task === "generate" ? "" : draft.sysml_source,
      request: ["generate", "revise", "repair"].includes(task)
        ? draft.request
        : "",
      render: task === "render" || draft.render,
    };
    const attempt = submission.forBody(JSON.stringify(payload));
    const job = await api.json<Run>("/v1/runs", {
      method: "POST",
      body: attempt.body,
      headers: { "Idempotency-Key": attempt.key },
    });
    if (!authGate.accepts(epoch)) return;
    submission.accepted();
    notice();
    if (["generate", "revise", "repair"].includes(task)) {
      results.tab("copilot");
    } else if (overrideTask === "render" || task === "render") {
      results.tab("diagram");
    } else if (task === "extract") {
      results.tab("entities");
    } else {
      results.tab("diagnostics");
    }
    await viewRun(job.id);
  } catch (error) {
    fail(error);
  } finally {
    submitting = false;
    updateControls();
  }
}

function clearPrivateForms() {
  el<HTMLFormElement>("knowledge-form").reset();
  for (const id of ["session-search", "entity-search", "modal-input", "file-input"])
    el<HTMLInputElement>(id).value = "";
  for (const id of ["documents", "modal-title", "modal-description", "modal-actions", "knowledge-error"])
    el(id).replaceChildren();
  documentAttempt = undefined;
  notice();
}

async function enter(me: Identity) {
  const old = identity;
  identity = me;
  authGate.next();
  selection.next();
  runGate.next();
  api.csrf = me.csrf_token;
  clearTimeout(pollTimer);
  clearTimeout(saveTimer);
  const restored =
    old?.tenant_id === me.tenant_id &&
    old?.user_id === me.user_id &&
    buffer?.dirty
      ? { id: sessionId, value: buffer.value, revision: buffer.revision }
      : undefined;
  sourceEditor.reset("");
  buffer = undefined;
  sessionId = undefined;
  selectedRun = undefined;
  results.reset();
  clearPrivateForms();
  sessions = [];
  historyRows = [];
  historyCursor = undefined;
  el("sessions").replaceChildren();
  el("history").replaceChildren();
  submission.accepted();
  el("workspace").hidden = false;
  el("login").hidden = true;
  el("identity").textContent = me.user_id;
  el("tenant-name").textContent = me.tenant_id;
  el("avatar").textContent = me.user_id.slice(0, 1).toUpperCase();
  el("login-error").textContent = "";
  await refreshCapabilities();
  const rows = await loadSessions();
  const wanted = new URLSearchParams(location.hash.slice(1)).get("model");
  const id = rows.find((s) => s.id === restored?.id)?.id || rows.find((s) => s.id === wanted)?.id || rows[0]?.id;
  if (id) await selectSession(id, true);
  else await createSession();
  if (restored && restored.id === sessionId) {
    // Retain the previous revision so another tab's update produces a visible conflict.
    const current = await api.json<Session>(`/v1/sessions/${sessionId}`);
    buffer = new DraftBuffer(
      {
        title: current.title,
        memory_enabled: current.memory_enabled,
        draft: current.draft,
      },
      restored.revision,
    );
    buffer.set(restored.value);
    sourceEditor.reset(restored.value.draft.sysml_source);
    el<HTMLTextAreaElement>("prompt").value = restored.value.draft.request;
    el<HTMLSelectElement>("task").value = restored.value.draft.task;
    el<HTMLInputElement>("render").checked = restored.value.draft.render;
    el("rename-session").textContent = restored.value.title;
    updateSave();
    updateControls();
    await save().catch(fail);
  }
}

el<HTMLFormElement>("login-form").onsubmit = async (event) => {
  event.preventDefault();
  const token = el<HTMLInputElement>("token");
  el<HTMLButtonElement>("connect").disabled = true;
  try {
    const me = await api.json<Identity>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ access_token: token.value.trim() }),
    });
    token.value = "";
    await enter(me);
  } catch (error) {
    if (el("login").hidden) { fail(error); return; }
    el("login-error").textContent =
      error instanceof ApiError
        ? error.message
        : "无法连接到服务，请稍后重试。";
  } finally {
    el<HTMLButtonElement>("connect").disabled = false;
  }
};
el("logout").onclick = async () => {
  try {
    await save();
    await api.json("/v1/auth/logout", { method: "POST" });
    authGate.next();
    selection.next();
    runGate.next();
    clearTimeout(pollTimer);
    clearTimeout(saveTimer);
    identity = undefined;
    api.csrf = "";
    buffer = undefined;
    sessionId = undefined;
    sourceEditor.reset("");
    el<HTMLTextAreaElement>("prompt").value = "";
    results.reset();
    sessions = [];
    historyRows = [];
    el("sessions").replaceChildren();
    el("history").replaceChildren();
    el("documents").replaceChildren();
    clearPrivateForms();
    el("workspace").hidden = true;
    el("login").hidden = false;
    el("rescue-draft").hidden = true;
    history.replaceState(null, "", location.pathname);
    el("token").focus();
  } catch (error) {
    fail(error);
  }
};
el("new-session").onclick = () => void createSession().catch(fail);
el("session-search").oninput = renderSessions;
el("save-draft").onclick = () => void save().catch(fail);
el("submit").onclick = () => void submitRun();
el("dismiss-notice").onclick = () => notice();
el("rename-session").onclick = async () => {
  if (!buffer) return;
  const choice = await dialog(
    "重命名模型",
    "为模型选择一个容易识别的名称。",
    [
      { label: "取消", value: "cancel" },
      { label: "保存名称", value: "save" },
    ],
    buffer.value.title,
  );
  if (choice.value === "save" && choice.text) {
    buffer.set({ ...buffer.value, title: choice.text });
    el("rename-session").textContent = choice.text;
    updateSave();
    await save().catch(fail);
  }
};
el("model-settings").onclick = async () => {
  if (!buffer) return;
  const choice = await dialog(
    "模型设置",
    "记忆只引用此模型的近期成功运行；关闭记忆不会删除历史记录。",
    [
      { label: "关闭", value: "cancel" },
      {
        label: buffer.value.memory_enabled ? "关闭会话记忆" : "开启会话记忆",
        value: "memory",
      },
      { label: "删除模型", value: "delete", danger: true },
    ],
  );
  if (choice.value === "memory") {
    buffer.set({
      ...buffer.value,
      memory_enabled: !buffer.value.memory_enabled,
    });
    await save().catch(fail);
  }
  if (choice.value === "delete") {
    const confirmed = await dialog(
      "删除这个模型？",
      "此模型的草稿、运行记录和产物将被删除，正在执行的任务也会取消。",
      [
        { label: "保留模型", value: "cancel" },
        { label: "删除模型", value: "delete", danger: true },
      ],
    );
    if (confirmed.value === "delete") {
      try {
        await api.json(`/v1/sessions/${sessionId}`, { method: "DELETE" });
        clearTimeout(saveTimer);
        buffer = undefined;
        sessionId = undefined;
        runGate.next();
        clearTimeout(pollTimer);
        results.reset();
        await loadSessions();
        if (sessions.length) await selectSession(sessions[0].id, true);
        else await createSession();
      } catch (e) {
        fail(e);
      }
    }
  }
};
el("task").onchange = () => {
  if (buffer)
    edit({
      ...buffer.value.draft,
      task: el<HTMLSelectElement>("task").value as Task,
    });
};
el("prompt").oninput = () => {
  if (buffer)
    edit({
      ...buffer.value.draft,
      request: el<HTMLTextAreaElement>("prompt").value,
    });
};
el("render").onchange = () => {
  if (buffer)
    edit({
      ...buffer.value.draft,
      render: el<HTMLInputElement>("render").checked,
    });
};
el("load-example").onclick = el("empty-example").onclick = () =>
  void useExample().catch(fail);
el("download-draft").onclick = el("rescue-draft").onclick = () =>
  download(
    new Blob([sourceEditor.value], { type: "text/plain;charset=utf-8" }),
    "draft.sysml",
  );
el("import-source").onclick = () => el<HTMLInputElement>("file-input").click();
el("file-input").onchange = async () => {
  const input = el<HTMLInputElement>("file-input");
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 128 * 1024) {
      notice("文件超过 128 KiB，请缩小后再导入。");
      return;
    }
    await applySource(await file.text());
  } catch (error) {
    fail(error);
  } finally {
    input.value = "";
  }
};
el("cancel-run").onclick = async () => {
  if (!selectedRun) return;
  const id = selectedRun,
    ticket = runGate.current;
  el<HTMLButtonElement>("cancel-run").disabled = true;
  try {
    await api.json(`/v1/runs/${id}/cancel`, { method: "POST" });
    if (runGate.accepts(ticket)) await poll(ticket);
  } catch (error) {
    fail(error);
  } finally {
    el<HTMLButtonElement>("cancel-run").disabled = false;
  }
};
el("retry-poll").onclick = () => void poll();
el("refresh-history").onclick = () => void loadHistory().catch(fail);
el("more-history").onclick = async () => {
  const button = el<HTMLButtonElement>("more-history");
  button.disabled = true;
  try {
    await loadHistory(true);
  } catch (e) {
    fail(e);
  } finally {
    button.disabled = false;
  }
};
el("load-server").onclick = async () => {
  const choice = await dialog(
    "载入服务器上的草稿？",
    "当前页面尚未保存的修改会被替换。也可以取消后选择“另存为新模型”。",
    [
      { label: "取消", value: "cancel" },
      { label: "载入服务器版本", value: "load" },
    ],
  );
  if (choice.value === "load" && sessionId)
    await selectSession(sessionId, true).catch(fail);
};
el("fork-draft").onclick = () => {
  if (buffer)
    void createSession({
      ...structuredClone(buffer.value),
      title: buffer.value.title + " · 副本",
    }).catch(fail);
};
el("toggle-sidebar").onclick = () => {
  const opened = el("sidebar").classList.toggle("open");
  el("toggle-sidebar").setAttribute("aria-expanded", String(opened));
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    el("sidebar").classList.remove("open");
    el("toggle-sidebar").setAttribute("aria-expanded", "false");
  }
});

async function loadDocuments() {
  const epoch = authGate.current;
  const page = await api.json<Page<Knowledge>>("/v1/knowledge");
  if (!authGate.accepts(epoch)) return;
  const list = el("documents");
  list.replaceChildren();
  for (const doc of page.items) {
    const row = node("div", "", "document-row");
    row.append(
      node("span", doc.title),
      action(
        "删除",
        async () => {
          const answer = await dialog(
            "删除这份资料？",
            "后续模型请求将不再检索此资料。历史运行中的来源记录仍然保留。",
            [
              { label: "取消", value: "cancel" },
              { label: "删除资料", value: "delete", danger: true },
            ],
          );
          if (answer.value === "delete")
            try {
              await api.json(`/v1/knowledge/${encodeURIComponent(doc.id)}`, {
                method: "DELETE",
              });
              await loadDocuments();
            } catch (e) {
              fail(e);
            }
        },
        "button ghost compact",
      ),
    );
    list.append(row);
  }
  if (!page.items.length)
    list.append(
      node("p", "还没有资料。可以添加团队规范、约束或术语说明。", "fineprint"),
    );
}
el("open-knowledge").onclick = async () => {
  el<HTMLDialogElement>("knowledge-modal").showModal();
  el("knowledge-error").textContent = "";
  try {
    await loadDocuments();
  } catch (e) {
    el("knowledge-error").textContent =
      e instanceof ApiError ? e.message : "知识服务暂时无法连接。";
  }
};
el("close-knowledge").onclick = () =>
  el<HTMLDialogElement>("knowledge-modal").close();
let documentAttempt: { id: string; body: string } | undefined;
el<HTMLFormElement>("knowledge-form").onsubmit = async (event) => {
  event.preventDefault();
  const body = JSON.stringify({
    title: el<HTMLInputElement>("document-title").value,
    content: el<HTMLTextAreaElement>("document-content").value,
  });
  if (
    new TextEncoder().encode(el<HTMLTextAreaElement>("document-content").value)
      .length > 32768
  ) {
    el("knowledge-error").textContent = "资料超过 32 KiB。";
    return;
  }
  if (documentAttempt?.body !== body)
    documentAttempt = { id: crypto.randomUUID(), body };
  el<HTMLButtonElement>("save-document").disabled = true;
  try {
    await api.json(`/v1/knowledge/${documentAttempt.id}`, {
      method: "PUT",
      body,
    });
    documentAttempt = undefined;
    el<HTMLFormElement>("knowledge-form").reset();
    await loadDocuments();
    el("knowledge-error").textContent = "";
  } catch (e) {
    el("knowledge-error").textContent =
      e instanceof ApiError ? e.message : "保存失败，请重试。";
  } finally {
    el<HTMLButtonElement>("save-document").disabled = false;
  }
};
el("open-status").onclick = () => {
  el<HTMLDialogElement>("status-modal").showModal();
  void refreshCapabilities();
};
el("close-status").onclick = () =>
  el<HTMLDialogElement>("status-modal").close();
el("format-code").onclick = () => {
  sourceEditor.format();
};
el("render-run").onclick = () => {
  void submitRun("render");
};
el("btn-quick-render").onclick = () => {
  void submitRun("render");
};
const editTitleBtn = document.getElementById("btn-edit-title");
if (editTitleBtn) {
  editTitleBtn.onclick = () => el("rename-session").click();
}
const layoutManager = new LayoutManager();

function appendCopilotMsg(role: "user" | "assistant", content: string) {
  const chat = el("copilot-chat");
  if (!chat) return null;
  const msg = node("div", "", `copilot-msg ${role}`);
  const avatar = node("div", role === "user" ? "👤" : "🤖", "msg-avatar");
  const body = node("div", "", "msg-body");
  const p = node("p", content);
  body.append(p);
  msg.append(avatar, body);
  chat.append(msg);
  chat.scrollTop = chat.scrollHeight;
  return msg;
}

function appendCopilotPending(text: string) {
  const chat = el("copilot-chat");
  if (!chat) return;
  const msg = node("div", "", "copilot-msg assistant pending");
  const avatar = node("div", "🤖", "msg-avatar");
  const body = node("div", "", "msg-body");
  const p = node("p", text);
  body.append(p);
  msg.append(avatar, body);
  chat.append(msg);
  chat.scrollTop = chat.scrollHeight;
}

function appendCopilotWelcome() {
  const chat = el("copilot-chat");
  if (!chat) return;
  chat.replaceChildren();
  const msg = node("div", "", "copilot-msg assistant");
  const avatar = node("div", "🤖", "msg-avatar");
  const body = node("div", "", "msg-body");
  const p1 = node("p", "你好！我是 SysML AI 伴随建模助手 (glm-5.3)。");
  const p2 = node(
    "p",
    "你可以直接向我描述你希望构建的系统结构、对当前模型进行增量扩充，或让我自愈修复代码中的语法报错。",
  );
  body.append(p1, p2);
  msg.append(avatar, body);
  chat.append(msg);
}

async function loadCopilotChat(sessId: string) {
  const chat = el("copilot-chat");
  if (!chat) return;
  chat.replaceChildren();

  try {
    const page = await api.json<Page<Run>>(
      `/v1/sessions/${sessId}/runs?limit=30`,
    );
    const modelRuns = page.items
      .filter(
        (r) =>
          ["generate", "revise", "repair"].includes(r.task) && r.request,
      )
      .reverse();

    if (modelRuns.length > 0) {
      for (const r of modelRuns) {
        if (r.request) {
          appendCopilotMsg("user", r.request);
        }
        if (r.status === "succeeded" && r.result?.sysml_source) {
          notifyCopilotRunComplete(r);
        } else if (r.status === "failed") {
          notifyCopilotRunFailed(r);
        }
      }
    } else {
      appendCopilotWelcome();
    }
  } catch {
    appendCopilotWelcome();
  }
}

function initCopilot() {
  const input = el<HTMLTextAreaElement>("copilot-input");
  const sendBtn = el<HTMLButtonElement>("copilot-send");

  async function handleSend(promptText: string) {
    const text = promptText.trim();
    if (!text || submitting || !sessionId) return;

    appendCopilotMsg("user", text);
    input.value = "";

    let task: Task = "revise";
    if (!sourceEditor.value.trim()) {
      task = "generate";
    } else if (
      text.includes("修复") ||
      text.includes("自愈") ||
      text.includes("报错")
    ) {
      task = "repair";
    }

    appendCopilotPending("正在思考并调用 glm-5.3 生成模型代码与结构...");

    try {
      if (buffer) {
        edit({
          ...buffer.value.draft,
          task,
          request: text,
          render: true,
        });
      }
      await submitRun(task, text);
    } catch (err) {
      const pending = el("copilot-chat")?.querySelector(
        ".copilot-msg.pending",
      );
      if (pending) {
        pending.querySelector(".msg-body")!.textContent =
          "执行遇到错误: " +
          (err instanceof Error ? err.message : String(err));
      }
    }
  }

  sendBtn.onclick = () => {
    void handleSend(input.value);
  };

  input.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend(input.value);
    }
  };

  for (const pill of document.querySelectorAll<HTMLButtonElement>(
    ".copilot-pill",
  )) {
    pill.onclick = () => {
      const p = pill.dataset.prompt;
      if (p) void handleSend(p);
    };
  }

  const activeFileItem = document.getElementById("active-file-item");
  if (activeFileItem) {
    activeFileItem.onclick = () => sourceEditor.view.focus();
  }
}

window.addEventListener("beforeunload", (event) => {
  if (buffer?.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
setInterval(() => void refreshCapabilities(), 15000);
setInterval(() => results.elapsed(), 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && identity) {
    void refreshCapabilities();
    if (results.current && active(results.current.status)) void poll();
  }
});
results.reset();
updateControls();
layoutManager.init();
initCopilot();
void api
  .json<Identity>("/v1/auth/session")
  .then(enter)
  .catch((error) => {
    if (!(error instanceof ApiError && error.status === 401))
      el("login-error").textContent =
        "无法恢复登录，请检查服务连接或重新登录。";
  });
