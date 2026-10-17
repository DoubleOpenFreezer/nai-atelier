import type { PromptChain } from '../../types';
import { createComparison } from '../../services/chainComparison';
export const comparisonChainFixture = (id = 'alpha'): PromptChain => ({
  id, userId: 'synthetic-owner', type: 'style', name: `Style ${id}`, description: '', tags: [],
  basePrompt: '{{artist:alpha, 1girl}}, side view', negativePrompt: 'lowres, red hair', variableValues: { subject: 'blue eyes' },
  modules: [{ id: 'light', name: 'Light', content: '1.2::soft light, blonde hair::', isActive: true, position: 'pre' }],
  params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', seed: 42, qualityToggle: false, ucPreset: 4,
    characters: [{ id: 'old', prompt: 'old character', negativePrompt: 'old negative', x: 0.2, y: 0.8 }] }, createdAt: 1, updatedAt: 1,
});
export const comparisonFixture = (ready = false) => {
  const record = createComparison([comparisonChainFixture(), { ...comparisonChainFixture('beta'), params: { ...comparisonChainFixture().params, seed: 7, width: 1216, height: 832, scale: 6 } }], 'synthetic-compare', 1);
  record.draft.characters[0].prompt = 'new character'; record.draft.characters[0].negativePrompt = 'new negative';
  if (ready) record.draft.entries.forEach(entry => entry.fields.forEach(field => { field.reviewed = true; }));
  return record;
};
