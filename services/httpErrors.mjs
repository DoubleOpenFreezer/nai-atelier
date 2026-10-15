/** 错误正文可来自上游网页或包在 JSON 内；不把网页源码交给界面和后台任务回执。 */
export function parseHttpError(body, status, fallback = status ? `请求失败 (${status})` : '请求失败') {
  if (typeof body !== 'string') body = '';
  let message = fallback, code, retryAfter;
  try {
    const value = JSON.parse(body);
    if (value && typeof value === 'object') {
      if (typeof value.code === 'string' && value.code) code = value.code;
      if (typeof value.retryAfter === 'number' && Number.isFinite(value.retryAfter) && value.retryAfter > 0) retryAfter = Math.ceil(value.retryAfter);
      message = (typeof value.error === 'string' && value.error) || (typeof value.message === 'string' && value.message) || code || fallback;
    } else if (typeof value === 'string' && value.trim()) message = value;
  } catch { message = body.trim() || fallback; }
  if (/<!doctype\s+html\b|<\/?(?:html|head|body|title|script|style)\b/i.test(message)) {
    message = status >= 500 && status <= 599 ? `服务暂时不可用 (HTTP ${status})，请稍后重试`
      : status >= 400 && status <= 499 ? `服务返回了错误页面 (HTTP ${status})，请检查网络或代理后重试`
      : '服务返回了错误页面，请稍后重试';
  }
  return { message: message.length > 500 ? `${message.slice(0, 500)}…` : message, ...(code ? { code } : {}), ...(retryAfter ? { retryAfter } : {}) };
}
