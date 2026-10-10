import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCodexData, validateCodexDataUrl } from '../../worker/codexRemote.mjs';
import worker from '../../worker/index';
import type { Env } from '../../worker/routes/types';
import { CODEX_MEDIA_HOSTS } from '../../worker/sharedWhitelist.mjs';
import { validateMediaSource } from '../../worker/mediaValidation';
import { canUseMediaGateway, getMobileOriginalUrl } from '../../services/mobileImageCache';
afterEach(() => vi.restoreAllMocks());
describe('法典只读数据代理', () => {
  it.each(CODEX_MEDIA_HOSTS)('手机与电脑共用媒体白名单 %s', host => {
    const url = `https://${host}/synthetic.png`;
    expect(validateMediaSource(url).internal).toBe(false); expect(canUseMediaGateway(url)).toBe(true);
    expect(getMobileOriginalUrl(url)).toContain('/api/media?');
  });
  it.each(['https://novelai.quicktagcloud.com/data-source.json', 'https://novelai.quicktagcloud.com/api/community', 'https://assets.quicktagcloud.com/data/current.json',
    'https://assets.quicktagcloud.com/data/releases/r-abc/tag_zh/core.json', 'https://prompt-vault-gallery.pages.dev/data/prompt-vault.json'])('公开数据地址 %s', url => expect(validateCodexDataUrl(url)).toBe(url));
  it.each(['https://evil.test/data.json', 'http://assets.quicktagcloud.com/data/current.json', 'https://assets.quicktagcloud.com:444/data/current.json', 'https://u:p@assets.quicktagcloud.com/data/current.json',
    'https://novelai.quicktagcloud.com/api/community/like', 'https://novelai.quicktagcloud.com/api/community?submit=1', 'https://assets.quicktagcloud.com/data/current.json#fragment', 'https://assets.quicktagcloud.com/data/releases/main/manifest.json'])('拒绝地址 %s', async url => {
    const remote = vi.fn(); expect((await fetchCodexData(url, remote)).status).toBe(400); expect(remote).not.toHaveBeenCalled();
  });
  it('保留原始字节供 SHA 校验，不带凭据、不跟重定向', async () => {
    const raw = '{ "词条": "合成" }'; const remote = vi.fn<typeof fetch>(async () => new Response(raw));
    const response = await fetchCodexData('https://novelai.quicktagcloud.com/api/community', remote);
    expect(await response.text()).toBe(raw); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(remote.mock.calls[0][1]).toMatchObject({ redirect: 'manual', headers: { Accept: 'application/json' } });
    expect((await fetchCodexData('https://novelai.quicktagcloud.com/api/community', async () => new Response('', { status: 302 }))).status).toBe(502);
  });
  it('限制超大响应并处理网络失败', async () => {
    expect((await fetchCodexData('https://novelai.quicktagcloud.com/api/community', async () => new Response('x', { headers: { 'content-length': String(33 * 1024 * 1024) } }))).status).toBe(413);
    expect((await fetchCodexData('https://novelai.quicktagcloud.com/api/community', async () => { throw new Error('offline'); })).status).toBe(502);
  });
  it('Worker 在存储初始化前读取公开数据，局域网认证和 GET 限制仍生效', async () => {
    const env = {} as Env; const remote = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"entries":[]}'));
    const path = '/api/codex/data?url=' + encodeURIComponent('https://novelai.quicktagcloud.com/api/community');
    expect((await worker.fetch(new Request('http://127.0.0.1' + path), env)).status).toBe(200);
    expect((await worker.fetch(new Request('http://127.0.0.1' + path, { method: 'POST' }), env)).status).toBe(405);
    expect((await worker.fetch(new Request('http://192.168.1.5' + path), env)).status).toBe(401);
    expect(remote).toHaveBeenCalledOnce();
  });
  it.each(CODEX_MEDIA_HOSTS)('Worker 对法典图床 %s 返回原始字节，不跨域跳转或转发凭据', async host => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const remote = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'image/png' } }));
    const source = `https://${host}/synthetic.png?v=abc`;
    const response = await worker.fetch(new Request('http://127.0.0.1/api/media?source=' + encodeURIComponent(source) + '&variant=original', {
      headers: { authorization: 'Bearer synthetic-private-key', cookie: 'session=synthetic-cookie' },
    }), {} as Env);
    expect(response.status).toBe(200); expect(response.headers.get('location')).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(remote).toHaveBeenCalledWith(source, expect.objectContaining({ redirect: 'manual', headers: { Accept: 'image/*' } }));
  });
  it('Worker 拒绝法典原图重定向和非图片响应', async () => {
    const remote = vi.spyOn(globalThis, 'fetch');
    const request = () => new Request('http://127.0.0.1/api/media?source=' + encodeURIComponent('https://assets.quicktagcloud.com/synthetic.png') + '&variant=original');
    remote.mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://evil.test/image.png' } }));
    expect((await worker.fetch(request(), {} as Env)).status).toBe(502);
    remote.mockResolvedValueOnce(new Response('<html>not an image</html>', { headers: { 'content-type': 'text/html' } }));
    expect((await worker.fetch(request(), {} as Env)).status).toBe(502);
  });
});
