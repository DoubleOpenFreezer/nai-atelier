import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { extractAndroidShared } from '../../scripts/android-shared.mjs';
import { projectRoot } from '../support/workspace.mjs';

const source = extractAndroidShared(join(projectRoot, 'scripts/update-tag-dictionary.mjs'), ['downloadTranslationDatabase'], '', {
  MANIFEST_FILE: "const MANIFEST_FILE = 'synthetic-manifest';"
}).replace(/export \{ downloadTranslationDatabase \};/, '');
const primary = 'https://primary.invalid/tag.sqlite', fallback = 'https://fallback.invalid/tag.sqlite';
const manifest = {
  version: 7, count: 123, artistPages: [], artistNamePages: [], characterPages: [], characterNamePages: [],
  characterSearchShards: [], characterSearchRecords: 'characters.json',
  sourceValidators: { [primary]: { etag: 'primary-etag' }, [fallback]: { lastModified: 'synthetic-date' } }
};

function fixture(fetchImpl, env = {}, current = manifest) {
  const calls = [], writes = [], agents = [], delays = [], logs = [];
  const context = {
    process: { env: { NAI_TAG_DATABASE_URL: primary, ...env } }, URL, AbortSignal, Uint8Array, Error,
    console: { log: value => logs.push(value), warn: value => logs.push(value) },
    readFile: async () => JSON.stringify(current),
    writeFile: async (file, bytes) => writes.push({ file, bytes }),
    setTimeout: (done, ms) => { delays.push(ms); done(); },
    ProxyAgent: class {
      constructor(uri) { this.uri = uri; this.closed = false; agents.push(this); }
      async close() { this.closed = true; }
    },
    fetch: async (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); }
  };
  return { download: runInNewContext(source + '\ndownloadTranslationDatabase', context), calls, writes, agents, delays, logs };
}

test('下载使用启动器解析后的代理，成功保存字节和来源校验值并释放连接', async () => {
  const proxy = 'http://127.0.0.1:7897';
  const f = fixture((_url, options) => {
    assert.equal(options.dispatcher.uri, proxy);
    return new Response('synthetic-sqlite', { headers: { etag: 'new-etag', 'last-modified': 'new-date' } });
  }, { NAI_TAG_PROXY_URL: proxy, HTTPS_PROXY: 'http://ignored.invalid:1' });
  const result = await f.download('synthetic.sqlite');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.headers['If-None-Match'], 'primary-etag');
  assert.equal(new TextDecoder().decode(f.writes[0].bytes), 'synthetic-sqlite');
  assert.equal(result.downloadUrl, primary);
  assert.equal(result.validators[primary].etag, 'new-etag');
  assert.equal(result.validators[fallback].lastModified, 'synthetic-date');
  assert.equal(f.agents[0].closed, true);
});

test('命令行入口沿用代理环境变量；无代理时保持直接下载', async () => {
  for (const env of [{ HTTPS_PROXY: 'http://127.0.0.1:7890' }, {}]) {
    const f = fixture(() => new Response(null, { status: 304 }), env);
    assert.equal(await f.download('synthetic.sqlite'), null);
    assert.equal(f.calls[0].options.dispatcher?.uri, env.HTTPS_PROXY);
    assert.equal(f.writes.length, 0);
    assert.ok(f.logs.includes('TAG_UPDATE_RESULT=unchanged'));
    if (f.agents.length) assert.equal(f.agents[0].closed, true);
  }
});

test('未配置备用源时不访问失效的 jsDelivr；403 不做无效重试且不写词库', async () => {
  const f = fixture(() => new Response('Denied', { status: 403, statusText: 'Forbidden', headers: { 'content-type': 'text/plain' } }));
  await assert.rejects(f.download('synthetic.sqlite'), /主线路（primary.invalid）：下载服务器返回 403 Forbidden：Denied/);
  assert.deepEqual(f.calls.map(call => call.url), [primary]);
  assert.equal(f.delays.length, 0);
  assert.equal(f.writes.length, 0);
});

test('主线路中断后重试并切换配置的备用源，两条失败原因完整保留', async () => {
  const f = fixture(url => {
    if (url === primary) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return new Response('File size exceeded the configured limit of 20 MB.', { status: 403, statusText: 'Forbidden', headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }, { NAI_TAG_DATABASE_FALLBACK_URL: fallback, NAI_TAG_PROXY_URL: 'http://127.0.0.1:7897' });
  await assert.rejects(f.download('synthetic.sqlite'), error => {
    assert.match(error.message, /主线路（primary.invalid）：连接被远端中断（ECONNRESET）/);
    assert.match(error.message, /\n备用线路（fallback.invalid）：下载服务器返回 403 Forbidden：文件超过下载源的大小限制（20 MB）/);
    return true;
  });
  assert.deepEqual(f.calls.map(call => call.url), [primary, primary, primary, fallback]);
  assert.deepEqual(f.delays, [1500, 3000]);
  assert.equal(f.writes.length, 0);
  assert.equal(f.agents[0].closed, true);
});

test('主线路失败后备用源 304 保留现有词库，并使用备用源自己的校验值', async () => {
  const f = fixture(url => new Response(null, { status: url === primary ? 404 : 304 }), { NAI_TAG_DATABASE_FALLBACK_URL: fallback });
  assert.equal(await f.download('synthetic.sqlite'), null);
  assert.deepEqual(f.calls.map(call => call.url), [primary, fallback]);
  assert.equal(f.calls[1].options.headers['If-Modified-Since'], 'synthetic-date');
  assert.equal(f.calls[1].options.headers['If-None-Match'], undefined);
  assert.equal(f.writes.length, 0);
});

test('首次安装没有可复用清单时下载完整文件，不带旧缓存校验头', async () => {
  const f = fixture(() => new Response('new-dictionary'), {}, {});
  await f.download('synthetic.sqlite');
  assert.equal(f.calls[0].options.headers['If-None-Match'], undefined);
  assert.equal(f.calls[0].options.headers['If-Modified-Since'], undefined);
  assert.equal(f.writes.length, 1);
});
