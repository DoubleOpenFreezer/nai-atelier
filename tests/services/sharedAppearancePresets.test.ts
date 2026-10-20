// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api';
import { sharedAppearancePresets } from '../../services/sharedAppearancePresets';
import { BUILTIN_APPEARANCE_PRESET } from '../../services/appearancePreferences';

vi.mock('../../services/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
const { isBuiltin: _builtin, ...base } = BUILTIN_APPEARANCE_PRESET;
const legacy = { ...base, id: 'legacy', name: '旧主题' };
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); });
describe('共享主题客户端', () => {
  it('旧主题上传成功后才记住完成，原件副本保留；后续只取共享库，不重新上传缓存', async () => {
    vi.mocked(api.get).mockResolvedValue({ presets: [] });
    vi.mocked(api.post).mockResolvedValue({ version: 3, presets: [legacy] });
    expect(await sharedAppearancePresets.load([legacy])).toEqual([legacy]);
    expect(api.post).toHaveBeenCalledWith('/appearance-presets/migrate', expect.objectContaining({ presets: [legacy] }));
    expect(localStorage.getItem('nai_legacy_appearance_presets_v1')).toContain('旧主题');
    expect(await sharedAppearancePresets.load([legacy])).toEqual([]);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('上传失败保留旧主题且下次可重试，不将失败当成空共享库', async () => {
    vi.mocked(api.get).mockResolvedValue({ presets: [] });
    vi.mocked(api.post).mockRejectedValueOnce(Error('offline')).mockResolvedValue({ presets: [legacy] });
    await expect(sharedAppearancePresets.load([legacy])).rejects.toThrow('offline');
    expect(localStorage.getItem('nai_shared_appearance_presets_v1')).toBeNull();
    expect(await sharedAppearancePresets.load([legacy])).toEqual([legacy]);
    expect(api.post).toHaveBeenCalledTimes(2);
  });
  it('各操作只写对应主题，拒绝错误响应', async () => {
    vi.mocked(api.post).mockResolvedValue({ presets: [legacy] });
    vi.mocked(api.put).mockResolvedValue({ presets: [legacy] });
    vi.mocked(api.delete).mockResolvedValue({ presets: [] });
    await sharedAppearancePresets.add([legacy]);
    await sharedAppearancePresets.update(legacy);
    await sharedAppearancePresets.rename('legacy', '改名');
    await sharedAppearancePresets.remove('legacy');
    expect(api.put).toHaveBeenCalledWith('/appearance-presets/legacy', { name: '改名' });
    expect(api.delete).toHaveBeenCalledWith('/appearance-presets/legacy');
    vi.mocked(api.get).mockResolvedValue({ error: 'bad' });
    await expect(sharedAppearancePresets.load([])).rejects.toThrow('主题库响应无效');
  });
});
