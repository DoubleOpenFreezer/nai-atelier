import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cache: new Map<string, unknown>(), extract: vi.fn() }));
vi.mock('../../services/codexCache', () => ({ readCodexCache: async (key: string) => mocks.cache.get(key), writeCodexCache: async (key: string, value: unknown) => { mocks.cache.set(key, value); } }));
vi.mock('../../services/api', () => ({ notifyLanAccessRequired: vi.fn(), parseErrorResponse: async () => new Error('upstream failed') }));
vi.mock('../../services/metadataService', async original => ({ ...await original<typeof import('../../services/metadataService')>(), extractMetadata: mocks.extract }));
import { codexEntryMatches, codexMediaUrl, fetchCodexJson, loadCodexBook, normalizeCodexBooks, normalizeCodexEntries, readCodexImageFile, readCodexImageMetadata, type CodexBootstrap } from '../../services/codexService';

const book = normalizeCodexBooks([{ id: 'synthetic', title: '合成书目', hasOriginal: false, originalSections: ['绘画'] }])[0];
const media = { baseUrl: 'https://assets.quicktagcloud.com', imagePrefix: 'images', originalPrefix: 'originals' };
const fixture = () => ({ entries: [{ id: 'one', title: '合成词条', path: ['绘画', '夜景'], tags: '1girl, {artist:synthetic}, blue_eyes', negative: 'red hair',
  characterPrompts: [{ label: '人物', prompt: 'girl', negative: 'boy' }, { label: '负面角色', uc: 'hat' }], note: '说明', author: '', assetRev: 'revision', assetCodexId: 'shared',
  image: 'one.jpg', original: 'one.png', imageWidth: 640, imageHeight: 960,
  images: [{ path: 'one.jpg', original: 'one.png', rawTag: 'independent raw', characterPrompts: [] }, { path: 'two.jpg', original: 'two.png', width: 960, height: 640, _hasOriginal: false }] }] });
const manifestFile = async (raw: string) => ({ size: new TextEncoder().encode(raw).length, sha256: Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))).toString('hex') });
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); mocks.cache.clear(); mocks.extract.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('法典数据归一', () => {
  it('保留多图、角色负面、当前图原文与资产来源；原图严格遵循发布能力', () => {
    const entry = normalizeCodexEntries(fixture(), book, media)[0];
    expect(entry.images).toHaveLength(2);
    expect(entry.images[0]).toMatchObject({ width: 640, height: 960, raw: 'independent raw', characters: [], originalUrl: 'https://assets.quicktagcloud.com/originals/shared/one.png?v=revision' });
    expect(entry.images[1]).toMatchObject({ width: 960, height: 640, originalUrl: '' });
    expect(entry.characters).toEqual([{ label: '人物', prompt: 'girl', negative: 'boy' }, { label: '负面角色', prompt: '', negative: 'hat' }]);
    expect(normalizeCodexEntries(fixture(), { ...book, originalSections: [] }, media)[0].images.every(image => !image.originalUrl)).toBe(true);
    expect(entry.sourceUrl).toBe('https://novelai.quicktagcloud.com/share/synthetic/one');
  });
  it('无图词条、外部实时图包和新书目来源独立处理', () => {
    const entry = normalizeCodexEntries({ entries: [{ title: '纯文字', tags: 'scene' }] }, book, media)[0];
    expect(entry.images).toEqual([]); expect(entry.prompt).toBe('scene'); expect(entry.id).toBe('synthetic-1');
    expect(normalizeCodexEntries({ entries: [{ title: '纯文字', tags: 'scene' }] }, book, media)[0].id).toBe(entry.id);
    expect(codexMediaUrl('folder/pic.jpg', { ...book, assetPathMode: 'relative', assetBaseUrl: 'https://prompt-vault-gallery.pages.dev' }, media, {})).toBe('https://prompt-vault-gallery.pages.dev/folder/pic.jpg');
    expect(normalizeCodexBooks([{ id: 'future', dataUrl: 'https://unknown.test/data.json' }])).toHaveLength(1);
    expect(() => normalizeCodexBooks([{ id: 'same' }, { id: 'same' }])).toThrow('重复');
    expect(() => normalizeCodexEntries({ entries: [{ id: 'same' }, { id: 'same' }] }, book, media)).toThrow('重复');
  });
  it('广场保留投稿分类、分级、作者、多图与异源标记，兼容旧图床路径', () => {
    const entry = normalizeCodexEntries({ entries: [{ id: 'post', prompt: 'raw prompt', comment: 'comment', submitter: 'author', nsfw: true, category: ['角色'], coverIndex: 1,
      images: [{ file: 'community/img/post/1.jpg', original: 'community/img/post/1.orig.png', params: { source: 'SD' } }, { file: 'https://novelai-strings.quicktagcloud.com/community/img/post/2.jpg' }] }] }, { ...book, id: 'community' }, media, true)[0];
    expect(entry).toMatchObject({ source: 'codex-community', prompt: 'raw prompt', note: 'comment', author: 'author', nsfw: true, coverIndex: 1, path: ['角色'] });
    expect(entry.images[0].originalUrl).toBe('https://pub-a66b6b5ffa0d44a89eb7dd6fa1070b58.r2.dev/community/img/post/1.orig.png');
    expect(entry.images[0].parameterSource).toBe('SD'); expect(entry.images).toHaveLength(2);
    expect(entry.images[0].id).toBe('/community/img/post/1.jpg');
  });
  it('逗号组合检索覆盖目录、角色负面和图片原文，保持提示词原样', () => {
    const entry = normalizeCodexEntries(fixture(), book, media)[0];
    expect(codexEntryMatches(entry, 'blue eyes, 夜景, hat, independent raw')).toBe(true);
    expect(codexEntryMatches(entry, 'blue eyes, missing')).toBe(false);
    expect(entry.prompt).toBe('1girl, {artist:synthetic}, blue_eyes');
  });
  it.each(['https://evil.test/image.png', 'http://assets.quicktagcloud.com/a.png', 'https://user@assets.quicktagcloud.com/a.png', 'https://assets.quicktagcloud.com:444/a.png'])('拒绝非公开媒体来源 %s', url => {
    expect(codexMediaUrl(url, book, media, {})).toBe('');
  });
});

it('数据损坏不覆盖上一份成功书目，离线回退受当前原图能力限制', async () => {
  const raw = JSON.stringify(fixture()); const file = await manifestFile(raw);
  const boot: CodexBootstrap = { release: 'r-synthetic', baseUrl: 'https://assets.quicktagcloud.com/data/releases/r-abc', books: [book], files: { 'synthetic.json': file }, media };
  const fetch = vi.fn().mockResolvedValueOnce(new Response(raw)).mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const good = await loadCodexBook(book, boot, true);
  const fallback = await loadCodexBook({ ...book, originalSections: [] }, boot, true);
  expect(fallback.offline).toBe(true); expect(fallback.error).toContain('校验失败');
  expect(fallback.entries[0].images[0].originalUrl).toBe('');
  expect(mocks.cache.get('book:synthetic')).toEqual(good);
});
it('完整性校验按原始 UTF-8 字节，拒绝错误的 SHA 或大小', async () => {
  const raw = '{"词条":"合成"}'; const file = await manifestFile(raw);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(raw))));
  expect(await fetchCodexJson('https://assets.quicktagcloud.com/data/current.json', file)).toEqual({ 词条: '合成' });
  await expect(fetchCodexJson('https://assets.quicktagcloud.com/data/current.json', { ...file, size: file.size + 1 })).rejects.toThrow('校验失败');
  await expect(fetchCodexJson('https://assets.quicktagcloud.com/data/current.json', { ...file, sha256: 'bad' })).rejects.toThrow('校验失败');
});
it('外部实时图包失败不读取工坊旧快照', async () => {
  mocks.cache.set('book:synthetic', { entries: [], release: 'old' });
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  await expect(loadCodexBook({ ...book, dataUrl: 'https://prompt-vault-gallery.pages.dev/data/prompt-vault.json' }, { release: 'r-new' } as CodexBootstrap, true)).rejects.toThrow('offline');
});

describe('原图元数据', () => {
  const file = new File(['synthetic'], 'source.png', { type: 'image/png' });
  it('读取原图验证当前网关响应，不复用旧跨域跳转，并保留文件字节', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const remote = vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', remote);
    const url = 'https://assets.quicktagcloud.com/originals/source.png?v=abc';
    const image = await readCodexImageFile(url);
    expect(remote).toHaveBeenCalledWith('/api/media?source=' + encodeURIComponent(url) + '&variant=original', { cache: 'no-cache' });
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes); expect(image.type).toBe('image/png');
  });
  it('NAI 旧版 Comment 保留真实配置，缺失字段不填默认值', async () => {
    mocks.extract.mockResolvedValue(JSON.stringify({ prompt: 'scene', uc: 'bad', steps: 20, sampler: 'k_euler', seed: 0 }));
    expect(await readCodexImageMetadata(file)).toMatchObject({ prompt: 'scene', negativePrompt: 'bad', rawPrompt: 'scene', params: { steps: 20, sampler: 'k_euler', seed: 0 } });
    const parsed = await readCodexImageMetadata(file);
    expect(parsed!.params.width).toBeUndefined(); expect(parsed!.params.model).toBeUndefined(); expect(parsed!.params.scale).toBeUndefined();
  });
  it('空全局词的 V4 角色配置完整配对负面词与坐标', async () => {
    mocks.extract.mockResolvedValue(JSON.stringify({ prompt: '', uc: '', steps: 28, sampler: 'k_euler', v4_prompt: { use_coords: true, caption: { base_caption: '', char_captions: [{ char_caption: 'girl', centers: [{ x: 0.2, y: 0.8 }] }] } },
      v4_negative_prompt: { caption: { base_caption: '', char_captions: [{ char_caption: 'boy' }] } } }));
    expect(await readCodexImageMetadata(file)).toMatchObject({ prompt: '', params: { useCoords: true, characters: [{ prompt: 'girl', negativePrompt: 'boy', x: 0.2, y: 0.8 }] } });
  });
  it.each([null, 'scene\nSteps: 20, Sampler: Euler', JSON.stringify({ prompt: 'SD text', negative_prompt: 'bad', steps: 20, sampler: 'Euler', model: 'SD' }), JSON.stringify({ '3': { class_type: 'KSampler' } })])('SD、Comfy、无元数据返回不可取用配置', async raw => {
    mocks.extract.mockResolvedValue(raw); expect(await readCodexImageMetadata(file)).toBeNull();
  });
});
