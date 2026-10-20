// 助手错误人话层：把 provider HTTP 错误、网络错误与本地业务错误归一为一句可操作说明。
// 原始错误保留为 detail，由界面折叠展示，排查时不丢信息。
const MAX_DETAIL = 2000;

/** 解析 provider 错误文本，兼容 `<status>: <body>` 与 `<provider> (<status>): <body>`。 */
export const parseAgentError = message => {
  const raw = String(message ?? '').trim();
  const direct = raw.match(/^(\d{3}):\s*([\s\S]*)$/);
  const prefixed = raw.match(/^[^():]+\((\d{3})\):\s*([\s\S]*)$/);
  const sdk = raw.match(/^(\d{3}) status code(?:\s*\(([^)]*)\))?/i);
  const match = direct || prefixed;
  const status = match ? Number(match[1]) : sdk ? Number(sdk[1]) : undefined;
  let body = match ? match[2].trim() : sdk ? String(sdk[2] || '').trim() : raw;
  let providerMessage = '';
  if (body.startsWith('{')) {
    try {
      const parsed = JSON.parse(body);
      const candidate = [parsed?.message, parsed?.detail, parsed?.error?.message, parsed?.error]
        .find(value => typeof value === 'string' && value.trim());
      providerMessage = candidate ? candidate.trim() : '';
      if (providerMessage) body = providerMessage;
    } catch { /* 非 JSON 错误体保留原文 */ }
  }
  return { status, body, providerMessage, raw };
};

// 文本规则优先于状态码，避免 400 被笼统归为“参数问题”而掩盖余额不足、内容审核等具体原因。
const TEXT_SUMMARIES = [
  [/insufficient balance|insufficient_quota|insufficient credits|余额不足|quota exceeded/i, '模型账户余额不足，请到服务商充值后重新发送。'],
  [/no api key|missing api key|api key not found|尚未配置.*key/i, '尚未配置可用的 API Key，请在「设置 → 创作助手」中连接模型服务。'],
  [/invalid api key|invalid_api_key|incorrect api key|unauthorized|authentication failed|无效的.*(?:key|密钥)/i, 'API Key 无效或已失效，请在「设置 → 创作助手」中更新连接。'],
  [/model.*(?:not found|does not exist|not exist)|model_not_found|unknown model/i, '模型不存在或已下线，请在设置中更换模型。'],
  [/rate limit|too many requests|rate_limit|请求过于频繁/i, '请求过于频繁或触发额度限制，请稍后再试。'],
  [/context length|context_length|maximum context|too many tokens|token limit|上下文长度|Token 模型预算/i, '输入超出模型上下文长度，请缩短内容或换用更大上下文的模型。'],
  [/content policy|content_filter|safety|moderation|内容安全/i, '服务端审核拦截了本次内容；可以调整表述后重试，原始错误见详情。'],
  [/fetch failed|econnrefused|econnreset|etimedout|enetunreach|socket hang up|network error|无法连接/i, '无法连接模型服务，请检查网络、代理或接口地址后重试。'],
  [/request was aborted|aborted|请求被中断|已中断/i, '请求被中断，请重试。'],
  [/timeout|timed out|超时/i, '本次请求等待超时，请重试或换用更快的模型。'],
  [/provider returned an error|error stop reason|服务返回了错误/i, '模型服务返回了错误，请重试；原始错误见详情。'],
];

const STATUS_SUMMARIES = new Map([
  [400, '请求被模型服务拒绝，可能是参数、模型或内容问题；原始错误见详情。'],
  [401, 'API Key 无效或已失效，请在「设置 → 创作助手」中更新连接。'],
  [402, '模型账户余额不足，请到服务商充值后重新发送。'],
  [403, '服务端拒绝了本次请求，可能是权限、区域或内容限制；原始错误见详情。'],
  [404, '模型或接口不存在，请在设置中检查接口地址并更换可用模型。'],
  [408, '模型服务响应超时，请稍后重试。'],
  [413, '本次内容过大，模型服务拒绝接收；请减少图片或缩短输入。'],
  [429, '请求过于频繁或触发额度限制，请稍后再试。'],
  [500, '模型服务内部错误，请稍后重试。'],
  [502, '模型服务网关异常，请稍后重试。'],
  [503, '模型服务暂时不可用，请稍后重试。'],
  [504, '模型服务响应超时，请稍后重试。'],
]);

/** 本地业务错误已经是中文可读文案，原样保留，不再追加详情。 */
const isLocalReadable = raw => /[\u4e00-\u9fff]/.test(raw)
  && !/^\s*\d{3}\s*:/.test(raw)
  && !raw.includes('{"')
  && !/^(?:fetch failed|request was aborted)/i.test(raw);

/** 返回 `{ summary, detail }`：summary 可直接展示，detail 为空表示无需展开。 */
export const humanizeAgentError = message => {
  const parsed = parseAgentError(message);
  const raw = parsed.raw;
  if (!raw) return { summary: '助手执行失败，请稍后重试。', detail: '' };
  if (isLocalReadable(raw)) return { summary: raw, detail: '' };
  const haystack = `${raw} ${parsed.body}`;
  const matched = TEXT_SUMMARIES.find(([pattern]) => pattern.test(haystack))?.[1]
    || STATUS_SUMMARIES.get(parsed.status);
  // 未命中常见错误时保留原文：本地 IO、工具失败等错误自带排查线索，换成通用句反而丢信息。
  if (!matched) return { summary: raw, detail: '' };
  const detail = raw.length > MAX_DETAIL ? `${raw.slice(0, MAX_DETAIL)}…（已截断 ${raw.length - MAX_DETAIL} 字符）` : raw;
  return { summary: matched, detail: detail === matched ? '' : detail };
};
