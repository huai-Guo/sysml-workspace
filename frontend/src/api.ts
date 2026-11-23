export const messages: Record<string, string> = {
  invalid_credentials: "登录已过期或访问令牌无效，请重新登录。",
  csrf_rejected: "登录状态需要刷新，请重新登录后继续。",
  origin_rejected: "当前访问地址与服务配置不一致，请联系管理员。",
  draft_conflict:
    "此模型已在另一页面更新。你的本地修改仍保留，请选择如何处理。",
  storage_unavailable:
    "存储服务暂时不可用。请稍后重试，你的输入仍保留在当前页面。",
  queue_full: "服务队列已满，请稍后重试。",
  pending_quota_exceeded: "你已有多个任务在排队或运行，请等待完成后再提交。",
  request_quota_exceeded: "已达到当前请求配额，请稍后重试。",
  session_quota_exceeded: "模型数量已达上限，请整理不再使用的模型。",
  model_not_configured:
    "模型 API 尚未配置。你仍可编辑、验证、提取实体和生成结构图。",
  knowledge_not_configured: "知识库尚未配置。",
  knowledge_unavailable: "知识服务暂时不可用，请稍后重试。",
  knowledge_quota_exceeded: "知识库容量已达上限，请整理已有资料。",
  invalid_request: "请检查输入内容和大小限制。",
  request_too_large: "内容超过大小限制，请缩小模型或资料后重试。",
  request_timeout: "请求传输超时，请重试。",
  paid_call_interrupted:
    "模型请求已发出，但执行进程中断，结果未能保存。系统没有自动重复收费调用；请核对供应商用量后再手动运行。",
  deadline_exceeded: "任务超过等待或执行时限，请缩小输入后重试。",
  run_timeout: "任务执行超时，请缩小模型或稍后重试。",
  worker_lost: "执行进程中断且已达到恢复次数，请稍后手动重试。",
  dependency_temporarily_unavailable:
    "依赖服务暂时不可用，系统正在等待恢复。请稍后运行。",
  execution_failed:
    "执行未能完成。请重试；若持续出现，请将运行编号提供给管理员。",
  model_error: "模型调用失败。请检查供应商配置、额度或服务状态后再运行。",
  invalid: "代码未通过语言验证。请查看下方诊断并定位修改。",
  repair_exhausted: "自动修复后仍有诊断，请检查代码或调整需求。",
  tool_error: "语言验证器未能完成检查，请稍后重试。",
  renderer_unavailable: "结构图暂时生成失败，已验证的代码和实体已保留。可将结果用于继续编辑，再单独生成结构图，无需重复调用模型。",
  timeout: "处理超时，请缩小输入后重试。",
  internal_error: "服务发生异常，请将请求编号提供给管理员。",
  session_not_found: "模型已被删除或当前账号无法访问。",
  run_not_found: "运行记录已不存在或当前账号无法访问。",
  artifact_not_ready: "此运行尚无可下载的有效产物。",
};
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public requestId = "",
    public retryAfter = 0,
  ) {
    super(messages[code] || `服务请求未完成（${status}）。`);
  }
}
export class ApiClient {
  csrf = "";
  constructor(private transport: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  async response(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    if (options.body) headers.set("Content-Type", "application/json");
    if (this.csrf) headers.set("X-CSRF-Token", this.csrf);
    const response = await this.transport(path, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal || AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new ApiError(
        body.error || "request_failed",
        response.status,
        response.headers.get("X-Request-ID") || "",
        Math.min(60, Number(response.headers.get("Retry-After")) || 0),
      );
    }
    return response;
  }
  async json<T>(path: string, options: RequestInit = {}): Promise<T> {
    const r = await this.response(path, options);
    return r.status === 204 ? (undefined as T) : r.json();
  }
}
