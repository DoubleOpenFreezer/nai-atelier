export const CODEX_SITE = 'https://novelai.quicktagcloud.com';
export const CODEX_ASSETS = 'https://assets.quicktagcloud.com';
const MAX_JSON_BYTES = 32 * 1024 * 1024;

// 数据地址限定到公开只读资源；不接受投稿、点赞、任意主机或重定向。
export function validateCodexDataUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.search) return null;
    if (url.origin === CODEX_SITE && (url.pathname === '/data-source.json' || url.pathname === '/api/community' || /^\/data\/[\w/-]+\.json$/.test(url.pathname))) return url.href;
    if (url.origin === CODEX_ASSETS && /^\/data\/(?:current\.json|releases\/r-[a-f0-9]+\/[\w/-]+\.json)$/.test(url.pathname)) return url.href;
    if (url.origin === 'https://prompt-vault-gallery.pages.dev' && url.pathname === '/data/prompt-vault.json') return url.href;
  } catch { /* 非 URL 由调用方显示来源错误。 */ }
  return null;
}

export async function fetchCodexData(value, remoteFetch = fetch, signal) {
  const target = validateCodexDataUrl(value);
  const failure = (message, status) => Response.json({ error: message }, { status });
  if (!target) return failure('不支持的法典数据地址', 400);
  try {
    const response = await remoteFetch(target, {
      redirect: 'manual', headers: { Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
    });
    if (!response.ok) { await response.body?.cancel(); return failure(`法典来源返回 HTTP ${response.status}`, response.status >= 400 ? response.status : 502); }
    if (!response.body || Number(response.headers.get('content-length')) > MAX_JSON_BYTES) { await response.body?.cancel(); return failure('法典数据超过读取上限', 413); }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        length += chunk.length;
        if (length > MAX_JSON_BYTES) { await reader.cancel(); return failure('法典数据超过读取上限', 413); }
        chunks.push(chunk);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new Response(bytes, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    if (signal?.aborted) throw signal.reason;
    return failure('法典连接失败，请稍后重试', 502);
  }
}
