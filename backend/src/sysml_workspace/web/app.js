const form = document.querySelector('#composer');
const requestInput = document.querySelector('#request');
const sendButton = document.querySelector('#send');
const charCount = document.querySelector('#char-count');
const setupNotice = document.querySelector('#setup-notice');
const conversation = document.querySelector('#conversation');
const welcome = document.querySelector('#welcome');
const messages = document.querySelector('#messages');
const toast = document.querySelector('#toast');

const labels = {
  succeeded: '验证通过',
  repair_exhausted: '达到自动修复上限',
  invalid: '未通过验证',
  model_error: '模型调用失败',
  tool_error: '验证工具失败',
  timeout: '运行超时',
  cancelled: '已取消',
};

let readyToRun = false;
let busy = false;
let toastTimer;

function scrollToLatest() {
  requestAnimationFrame(() => {
    conversation.scrollTop = conversation.scrollHeight;
  });
}

function updateComposer() {
  requestInput.style.height = 'auto';
  requestInput.style.height = `${Math.min(requestInput.scrollHeight, 180)}px`;
  charCount.textContent = `${requestInput.value.length.toLocaleString()} / 20,000`;
  sendButton.disabled = busy || !readyToRun || !requestInput.value.trim();
}

function setBusy(value) {
  busy = value;
  requestInput.disabled = value;
  sendButton.setAttribute('aria-label', value ? '正在生成' : '发送需求');
  sendButton.innerHTML = value
    ? '<span class="send-spinner" aria-hidden="true"></span>'
    : '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V4M5.5 8.5 10 4l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  updateComposer();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1900);
}

function createAssistantMessage() {
  const row = document.createElement('article');
  row.className = 'message-row assistant';

  const avatar = document.createElement('span');
  avatar.className = 'assistant-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.innerHTML = '<svg viewBox="0 0 32 32" fill="none"><path d="m16 3 12 6.5v13L16 29 4 22.5v-13L16 3Z" stroke="currentColor" stroke-width="1.8"/><path d="m4.5 9.8 11.5 6.4 11.5-6.4M16 16.2v12" stroke="currentColor" stroke-width="1.8"/></svg>';

  const content = document.createElement('div');
  content.className = 'message-content';
  const name = document.createElement('div');
  name.className = 'assistant-label';
  name.textContent = 'SysML Agent';
  const activity = document.createElement('div');
  activity.className = 'typing-indicator';
  activity.innerHTML = '<i></i><i></i><i></i><span>正在生成，并等待 Pilot 验证…</span>';
  content.append(name, activity);
  row.append(avatar, content);
  messages.append(row);
  scrollToLatest();
  return { row, content };
}

function appendUserMessage(request) {
  welcome.hidden = true;
  const row = document.createElement('article');
  row.className = 'message-row user';
  const bubble = document.createElement('div');
  bubble.className = 'user-bubble';
  bubble.textContent = request;
  row.append(bubble);
  messages.append(row);
  scrollToLatest();
}

function renderDiagnostics(diagnostics) {
  const panel = document.createElement('section');
  panel.className = 'diagnostics';
  const heading = document.createElement('div');
  heading.className = 'diagnostics-heading';
  heading.textContent = `验证诊断 · ${diagnostics.length}`;
  panel.append(heading);

  for (const diagnostic of diagnostics) {
    const item = document.createElement('div');
    item.className = 'diagnostic-item';
    const dot = document.createElement('i');
    dot.className = 'diagnostic-dot';
    const detail = document.createElement('div');
    const message = document.createElement('div');
    message.textContent = diagnostic.message || '验证器返回一条诊断。';
    detail.append(message);
    const location = [
      diagnostic.line != null ? `L${diagnostic.line}` : null,
      diagnostic.column != null ? `C${diagnostic.column}` : null,
      diagnostic.code,
    ].filter(Boolean).join(' · ');
    if (location) {
      const meta = document.createElement('div');
      meta.className = 'diagnostic-meta';
      meta.textContent = `${diagnostic.severity || 'info'} · ${diagnostic.kind || 'diagnostic'} · ${location}`;
      detail.append(meta);
    }
    item.append(dot, detail);
    panel.append(item);
  }
  return panel;
}

function renderCandidates(candidates) {
  if (!candidates.length) return null;
  const details = document.createElement('details');
  details.className = 'candidate-details';
  const summary = document.createElement('summary');
  summary.textContent = `查看候选版本（${candidates.length}）`;
  const list = document.createElement('div');
  list.className = 'candidate-list';
  const origins = { generated: '首次生成', repair: '自动修复', input: '输入代码' };
  const states = { valid: '通过', invalid: '未通过', not_run: '未校验', tool_error: '工具错误', timeout: '超时' };

  for (const candidate of candidates) {
    const item = document.createElement('div');
    item.className = 'candidate-item';
    const title = document.createElement('span');
    title.textContent = `${origins[candidate.origin] || candidate.origin} · ${(candidate.source_sha256 || '').slice(0, 12)}`;
    const state = document.createElement('span');
    state.className = `candidate-state ${candidate.validation_status || ''}`;
    state.textContent = states[candidate.validation_status] || candidate.validation_status || '未知';
    item.append(title, state);
    list.append(item);
  }
  details.append(summary, list);
  return details;
}

function renderResult(target, result, transportError = null) {
  target.replaceChildren();
  const status = result.run_status || 'tool_error';
  const hasError = Boolean(transportError || result.error_message);
  const errorText = transportError || result.error_message;

  if (errorText) {
    const error = document.createElement('div');
    error.className = 'assistant-error';
    error.textContent = errorText;
    if (Array.isArray(result.missing) && result.missing.length) {
      error.textContent += `\n需要配置：${result.missing.join('；')}`;
    }
    target.append(error);
  } else {
    const intro = document.createElement('div');
    intro.className = 'assistant-copy';
    const paragraph = document.createElement('p');
    if (status === 'succeeded') {
      paragraph.textContent = '已生成 SysML，并通过 OMG Pilot 的语法与语义校验。';
    } else if (status === 'repair_exhausted') {
      paragraph.textContent = '生成和自动修复已结束，最终代码仍未通过验证。请查看诊断后调整需求再试。';
    } else if (status === 'invalid') {
      paragraph.textContent = '代码未通过验证，请参考下面的诊断信息。';
    } else {
      paragraph.textContent = `这次流程没有成功完成：${labels[status] || status}。`;
    }
    intro.append(paragraph);
    target.append(intro);
  }

  const source = result.sysml_source || '';
  if (source) {
    const card = document.createElement('section');
    card.className = 'code-card';
    const heading = document.createElement('div');
    heading.className = 'code-heading';
    const filename = document.createElement('span');
    filename.className = 'file-label';
    filename.innerHTML = '<i class="file-dot"></i> generated.sysml';
    const actions = document.createElement('div');
    actions.className = 'code-actions';

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'quiet-button';
    copy.textContent = '复制';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(source);
        showToast('SysML 代码已复制');
      } catch {
        showToast('复制失败，请手动选择代码');
      }
    });

    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'quiet-button';
    download.textContent = '下载';
    download.addEventListener('click', () => {
      const file = new Blob([source], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'generated.sysml';
      link.click();
      URL.revokeObjectURL(url);
    });

    actions.append(copy, download);
    heading.append(filename, actions);
    const pre = document.createElement('pre');
    pre.className = 'code-output';
    const code = document.createElement('code');
    code.textContent = source;
    pre.append(code);
    card.append(heading, pre);
    target.append(card);
  }

  const metadata = result.validation_metadata || {};
  const meta = document.createElement('div');
  meta.className = 'run-meta';
  const validation = document.createElement('span');
  validation.className = metadata.status === 'valid' ? 'ok' : '';
  validation.textContent = metadata.status === 'valid' ? '✓ Pilot 校验通过' : `校验：${metadata.status || '未运行'}`;
  const repair = document.createElement('span');
  repair.textContent = `自动修复 ${result.repair_count ?? 0} 轮`;
  const calls = document.createElement('span');
  calls.textContent = `模型调用 ${result.model_calls ?? 0} 次`;
  const validations = document.createElement('span');
  validations.textContent = `校验 ${result.validation_count ?? 0} 次`;
  meta.append(validation, repair, calls, validations);
  target.append(meta);

  const diagnostics = result.diagnostics || [];
  if (diagnostics.length) target.append(renderDiagnostics(diagnostics));
  const candidates = renderCandidates(result.candidate_history || []);
  if (candidates) target.append(candidates);

  const provenance = [
    metadata.validator_revision ? `Validator ${metadata.validator_revision}` : null,
    metadata.library_revision ? `Library ${metadata.library_revision}` : null,
    result.final_artifact_sha256 ? `SHA-256 ${result.final_artifact_sha256}` : null,
    metadata.duration_ms != null ? `校验耗时 ${Math.round(metadata.duration_ms)} ms` : null,
  ].filter(Boolean);
  if (provenance.length) {
    const footer = document.createElement('div');
    footer.className = 'provenance';
    footer.textContent = provenance.join('  ·  ');
    target.append(footer);
  }

}

async function submitRequest(request) {
  if (busy || !readyToRun || !request.trim()) return;
  const prompt = request.trim();
  requestInput.value = '';
  updateComposer();
  appendUserMessage(prompt);
  const assistant = createAssistantMessage();
  setBusy(true);

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: prompt }),
    });
    const result = await response.json();
    const transportError = response.ok ? null : (result.error || `请求失败（HTTP ${response.status}）。`);
    renderResult(assistant.content, result, transportError);
  } catch (error) {
    renderResult(assistant.content, { run_status: 'tool_error' }, `本地请求失败：${error.message}`);
  } finally {
    setBusy(false);
    scrollToLatest();
    requestInput.focus();
  }
}

async function loadReadiness() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const status = await response.json();
    const model = status.model || {};
    const validator = status.validator || {};
    const modelReady = model.configured === true;
    const validatorReady = validator.ready === true;
    readyToRun = modelReady && validatorReady;

    const modelChip = document.querySelector('#model-status');
    modelChip.className = `status-chip ${modelReady ? 'ready' : 'missing'}`;
    modelChip.querySelector('span').textContent = modelReady ? `模型 · ${model.provider}` : '模型待配置';
    modelChip.title = modelReady ? `模型已配置：${model.model}` : (model.missing || []).join('；');

    const validatorChip = document.querySelector('#validator-status');
    validatorChip.className = `status-chip ${validatorReady ? 'ready' : 'missing'}`;
    validatorChip.querySelector('span').textContent = validatorReady ? 'Pilot 已就绪' : 'Pilot 待安装';
    validatorChip.title = validatorReady ? 'SysML Pilot 0.62.0' : (validator.missing || []).join('、');

    const guidance = [];
    if (!modelReady) guidance.push(`模型配置：${(model.missing || []).join('；') || '尚未配置'}。`);
    if (!validatorReady) guidance.push(`验证器缺少：${(validator.missing || []).join('、')}。请运行 .\\tooling\\sysml-validator\\bootstrap.ps1。`);
    setupNotice.textContent = guidance.join('\n');
    setupNotice.hidden = guidance.length === 0;
  } catch {
    readyToRun = false;
    document.querySelector('#model-status').className = 'status-chip missing';
    document.querySelector('#model-status').querySelector('span').textContent = '本地服务不可用';
    document.querySelector('#validator-status').className = 'status-chip missing';
    document.querySelector('#validator-status').querySelector('span').textContent = '请重启测试页';
    setupNotice.textContent = '无法读取本地运行状态。请确认启动了 SysML Agent 本地测试服务。';
    setupNotice.hidden = false;
  }
  updateComposer();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitRequest(requestInput.value);
});

requestInput.addEventListener('input', updateComposer);
requestInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll('.suggestion').forEach((button) => {
  button.addEventListener('click', () => {
    requestInput.value = button.textContent.trim();
    updateComposer();
    requestInput.focus();
  });
});

loadReadiness();
