// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalGenItem, PromptChain } from '../../types';
import { api } from '../../services/api';
import { IMPORT_SESSION_KEY } from '../../services/metadataService';
import { buildArtistSampleTemplateFromChain, canSaveArtistSample, getDefaultArtistSampleTemplate, prepareArtistSampleImport, saveArtistOwnSample, saveArtistSampleTemplate } from '../../services/artistSampleDrafts';

vi.mock('../../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), uploadFile: vi.fn() }, notifyLanAccessRequired: vi.fn(), parseErrorResponse: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });

describe('按需自建画师样张', () => {
  it('只替换画师占位符并取用完整固定配置，准备草稿不提交生成或保存', () => {
    const template = getDefaultArtistSampleTemplate('v45');
    template.params.characters = [{ id: 'actor', prompt: 'blue hair', negativePrompt: '', x: 0.5, y: 0.5 }];
    prepareArtistSampleImport('sample_artist', 'v45', template);
    const draft = JSON.parse(sessionStorage.getItem(IMPORT_SESSION_KEY)!);
    expect(draft.prompt).toBe(template.prompt.replace('{artist}', 'sample_artist'));
    expect(draft).toMatchObject({ targetMode: 'text-to-image', fullMetadata: true, importSeed: true,
      params: template.params, artistSampleTarget: { id: expect.any(String), tag: 'sample_artist', pack: 'v45', historyIds: [] } });
    expect(api.post).not.toHaveBeenCalled();
    expect(template.prompt).toContain('{artist}');
  });

  it('从现有串编译已启用模块及主体，保留完整参数并增加画师占位', () => {
    const params = getDefaultArtistSampleTemplate('v5').params;
    const chain: PromptChain = { id: 'synthetic-chain', userId: 'synthetic-user', type: 'style', name: '合成画风', description: '', tags: [], createdAt: 1, updatedAt: 1,
      basePrompt: 'solo', negativePrompt: 'low quality', variableValues: { subject: 'blue hair' }, params,
      modules: [{ id: 'active', name: '合成启用模块', content: 'simple background', isActive: true, position: 'pre' }, { id: 'off', name: '合成停用模块', content: 'unused', isActive: false }] };
    const template = buildArtistSampleTemplateFromChain(chain);
    expect(template.prompt).toBe('solo, simple background, blue hair, artist:{artist}');
    expect(template.params).toEqual(params);
    expect(template.params).not.toBe(params);
    expect(template.negativePrompt).toBe('low quality');
  });

  it('拒绝跨模型配置、随机Seed及无画师占位符配置', async () => {
    const template = getDefaultArtistSampleTemplate('v45');
    await expect(saveArtistSampleTemplate('v5', template)).rejects.toThrow('版本不一致');
    await expect(saveArtistSampleTemplate('v45', { ...template, prompt: 'solo' })).rejects.toThrow('占位符');
    await expect(saveArtistSampleTemplate('v45', { ...template, params: { ...template.params, seed: undefined } })).rejects.toThrow('Seed');
    expect(api.post).not.toHaveBeenCalled();
  });

  const item = (): LocalGenItem => ({ id: 'synthetic-history', imageUrl: '/api/assets/original.png', prompt: 'solo, artist:sample artist',
    negativePrompt: 'low quality', params: getDefaultArtistSampleTemplate('v45').params, createdAt: 20 } as LocalGenItem);
  const target = { id: 'synthetic-target', tag: 'sample_artist', pack: 'v45' as const, historyIds: ['synthetic-history'] };
  it('不能把补图前的旧图片、另一个模型或另一个画师当成当前样张', () => {
    expect(canSaveArtistSample(item(), target)).toBe(true);
    expect(canSaveArtistSample({ ...item(), id: 'previous-history', createdAt: 999999 }, target)).toBe(false);
    expect(canSaveArtistSample({ ...item(), createdAt: 1 }, target)).toBe(true);
    expect(canSaveArtistSample(item(), { ...target, pack: 'v5' })).toBe(false);
    expect(canSaveArtistSample(item(), { ...target, tag: 'another artist' })).toBe(false);
    expect(canSaveArtistSample({ ...item(), prompt: 'artist:sample artist extra' }, target)).toBe(false);
    expect(canSaveArtistSample({ ...item(), prompt: '1.2::artist:sample artist::' }, target)).toBe(true);
    expect(canSaveArtistSample({ ...item(), prompt: 'solo, sample_artist' }, target)).toBe(true);
    expect(canSaveArtistSample({ ...item(), prompt: 'solo' }, target)).toBe(false);
  });

  it('保存的是已生成图片的真实参数与持久原图地址，不覆盖图包', async () => {
    await saveArtistOwnSample(target, item());
    expect(api.uploadFile).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith('/artist-sample-data', { action: 'sample', pack: 'v45', sample: {
      id: 'sample-v45-synthetic-history', tag: 'sample_artist', pack: 'v45', imageUrl: '/api/assets/original.png',
      prompt: item().prompt, negativePrompt: item().negativePrompt, params: item().params, createdAt: 20,
    } });
  });

  it('旧历史没有负面提示词时按空内容保存样张，不补造提示词', async () => {
    await saveArtistOwnSample(target, { ...item(), negativePrompt: undefined });
    expect(api.post).toHaveBeenCalledWith('/artist-sample-data', expect.objectContaining({ sample: expect.objectContaining({ negativePrompt: '' }) }));
  });
});
