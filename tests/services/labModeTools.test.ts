import { describe, expect, it } from 'vitest';
import { createLabImageEditDraft } from '../../services/labWorkspace';
import { appendTagsToImageEditDraft, buildImageEditMetadataPatch, buildPromptFragmentPatch, canSaveLabModeToLibrary, mergePresetSettings } from '../../services/labModeTools';

const params = {
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  qualityToggle: true,
  ucPreset: 4,
};

describe('外部片段取用', () => {
  const current = { prompt: 'scene', negativePrompt: 'bad', params: { ...params, seed: 77, model: 'nai-diffusion-4-5-full', characters: [{ id: 'old', prompt: 'old role', x: 0.2, y: 0.8 }] } };
  it('追加保留权重、顺序、重复词、负面和参数', () => {
    const patch = buildPromptFragmentPatch(current, { mode: 'prompt-fragments', prompt: '{{artist:a}}, scene' });
    expect(patch).toEqual({ prompt: 'scene, {{artist:a}}, scene' });
  });
  it('替换只有角色时保留全局词和参考，设置不隐式导入 Seed 或模型', () => {
    const character = { id: 'new', prompt: '', negativePrompt: 'hat', x: 0.5, y: 0.5 };
    const patch = buildPromptFragmentPatch(current, { mode: 'prompt-fragments', characters: [character], replace: true, importSettings: true, params: { steps: 20, seed: 88, model: 'nai-diffusion-5-full-high' } });
    expect(patch.prompt).toBeUndefined(); expect(patch.negativePrompt).toBeUndefined();
    expect(patch.params).toMatchObject({ steps: 20, width: params.width, seed: 77, model: current.params.model, characters: [character] });
  });
  it('明确勾选时才能更新 Seed 和模型，空字段可清空，缺失 Seed 保持原值', () => {
    expect(buildPromptFragmentPatch(current, { mode: 'prompt-fragments', replace: true, prompt: '', importSeed: true, importModel: true, params: { seed: 88, model: 'nai-diffusion-5-full-high' } })).toMatchObject({ prompt: '', params: { seed: 88, model: 'nai-diffusion-5-full-high' } });
    expect(buildPromptFragmentPatch(current, { mode: 'prompt-fragments', importSeed: true, params: {} })).toEqual({});
  });
});

describe('元数据参数复用透明度规则', () => {
  it('旧透明配置按自身提示词恢复而非继承当前权重', () => {
    const current = { ...params, transparent: true, transparentWeight: 2.8 };
    expect(mergePresetSettings(current, { ...params, transparent: true }, '1girl, 2.1::transparent background::').transparentWeight).toBe(2.1);
    expect(mergePresetSettings(current, { ...params, transparent: true }, '1girl').transparentWeight).toBe(1);
    expect(mergePresetSettings(current, params).transparentWeight).toBe(2.8);
  });
});

describe('编辑页顶部工具路由', () => {
  it.each(['image-to-image', 'inpaint', 'outpaint'] as const)('为 %s 追加反推 Tag 并导入元数据', operation => {
    const current = createLabImageEditDraft(operation, 'old prompt', 'old negative', params);

    expect(appendTagsToImageEditDraft(current, '1girl, blue eyes')).toMatchObject({
      prompt: 'old prompt, 1girl, blue eyes',
      promptSource: 'custom',
    });
    expect(buildImageEditMetadataPatch('new prompt', 'new negative', { ...params, seed: 9 })).toMatchObject({
      prompt: 'new prompt',
      negativePrompt: 'new negative',
      params: { seed: 9 },
      promptSource: 'custom',
    });
  });

  it('只有文生图支持保存到现有预设库', () => {
    expect(canSaveLabModeToLibrary('text-to-image')).toBe(true);
    expect(canSaveLabModeToLibrary('image-to-image')).toBe(false);
    expect(canSaveLabModeToLibrary('inpaint')).toBe(false);
    expect(canSaveLabModeToLibrary('outpaint')).toBe(false);
  });
});
