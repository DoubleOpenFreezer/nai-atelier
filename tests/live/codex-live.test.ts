import { afterEach, expect, it, vi } from 'vitest';
import { loadCodexBootstrap, loadCodexBook, loadCodexCommunity } from '../../services/codexService';
vi.mock('../../services/api', () => ({ notifyLanAccessRequired: () => {}, parseErrorResponse: async (response: Response) => new Error(`HTTP ${response.status}`) }));
afterEach(() => vi.unstubAllGlobals());

// 显式联网入口；只读公开 JSON，浏览缓存留在内存，不写私人资料或下载图片。
it.skipIf(process.env.CODEX_LIVE_TEST !== '1')('线上全部书目与共创广场沿当前发布清单读取并校验', async () => {
  const remoteFetch = globalThis.fetch;
  vi.stubGlobal('fetch', (input: string, options?: RequestInit) => {
    const url = new URL(input, 'http://127.0.0.1');
    return remoteFetch(url.searchParams.get('url')!, { ...options, signal: AbortSignal.timeout(45_000) });
  });
  const boot = await loadCodexBootstrap(true);
  expect(boot.offline).not.toBe(true); expect(boot.books.length).toBeGreaterThan(0);
  let images = 0; let entries = 0;
  for (const book of boot.books) {
    const result = await loadCodexBook(book, boot, true);
    expect(result.offline, book.title).not.toBe(true);
    expect(result.entries.length, book.title).toBeGreaterThan(0);
    if (!book.dataUrl) expect(result.entries.length, book.title).toBe(book.entryCount);
    const count = result.entries.reduce((sum, entry) => sum + entry.images.length, 0);
    const sample = result.entries.find(entry => entry.images.length)?.images[0];
    if (sample) {
      const response = await remoteFetch(sample.url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
      expect(response.ok, `${book.id} thumbnail: ${response.status}`).toBe(true);
      expect(response.headers.get('content-type'), book.id).toMatch(/^image\//);
    }
    entries += result.entries.length; images += count;
    console.info(`${book.id}: ${result.entries.length} entries, ${count} images`);
  }
  const community = await loadCodexCommunity();
  expect(community.offline).not.toBe(true); expect(community.entries.length).toBeGreaterThan(0);
  expect(community.entries.some(entry => entry.images.length > 1)).toBe(true);
  console.info(`${boot.release}: ${boot.books.length} books, ${entries} entries, ${images} images; community ${community.entries.length} posts`);
}, 240_000);
