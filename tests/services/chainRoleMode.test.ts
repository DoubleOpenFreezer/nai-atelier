// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { comparisonChainFixture } from '../fixtures/chainComparison';
import { createRoleModeCopy, emptyRoleModeConfig, materializeRoleModeCopy, validateRoleModeCopy, type RoleModeState } from '../../services/chainRoleModeModel';
import { ensureRoleModeCopy, getRoleModeCopy, loadRoleModeState, saveRoleModeChain, saveRoleModeConfig, saveRoleModeReview } from '../../services/chainRoleMode';
import { markComparisonRole } from '../../services/chainComparisonApi';
import { parsePromptTags } from '../../services/tagTranslations';
import { createLabWorkspaceSession, loadLabWorkspaceSession, saveLabWorkspaceSession } from '../../services/labWorkspace';
import { compilePrompt } from '../../services/promptUtils';
const mock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), state: null as unknown as RoleModeState }));
vi.mock('../../services/api', () => ({ api: { get: mock.get, put: mock.put } }));
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  const config = emptyRoleModeConfig(); config.characters[0].prompt = 'shared character';
  mock.state = { config, copies: [] }; mock.get.mockReset().mockImplementation(async () => structuredClone(mock.state));
  mock.put.mockReset().mockImplementation(async (_url, body) => {
    if (body.kind === 'config') { mock.state.config = { ...structuredClone(body.config), revision: body.config.revision + 1 }; return { config: structuredClone(mock.state.config) }; }
    const copy = { ...structuredClone(body.copy), revision: body.copy.revision + 1 };
    mock.state.copies = [...mock.state.copies.filter(item => item.sourceId !== copy.sourceId), copy]; return { copy: structuredClone(copy) };
  });
});
it('只读打开模式不预复制，单卡按需建立无结果封面的独立副本，源参数和原文不变', async () => {
  const source = { ...comparisonChainFixture(), previewImage: '/source-cover.png' }, original = structuredClone(source);
  await loadRoleModeState(); expect(mock.put).not.toHaveBeenCalled();
  const copy = await ensureRoleModeCopy(source);
  expect(copy.id).toBe('chain-role:alpha'); expect(copy.previewImage).toBe('');
  expect(copy.params.characters?.[0].prompt).toBe('shared character'); expect(copy.params.seed).toBe(42); expect(copy.basePrompt).toBe(source.basePrompt);
  expect(source).toEqual(original); expect(mock.state.copies).toHaveLength(1);
  await ensureRoleModeCopy(source); expect(mock.put).toHaveBeenCalledTimes(1);
});
it('全部串纯内存投影公共角色，结构化自动替换不泛标非空风格，混合全局文本才待处理', () => {
  const source = { ...comparisonChainFixture(), previewImage: '/original-cover.png' };
  const structured = createRoleModeCopy(source, mock.state.config);
  expect(structured.chain.previewImage).toBe(''); expect(structured.chain.params.characters).toEqual(mock.state.config.characters);
  expect(structured.fields.every(field => field.reviewed)).toBe(true);
  const mixed = createRoleModeCopy({ ...source, params: { ...source.params, characters: [] } }, mock.state.config);
  expect(mixed.fields.some(field => !field.reviewed)).toBe(true); expect(mixed.chain.basePrompt).toBe(source.basePrompt);
  const empty = createRoleModeCopy({ ...source, basePrompt: '', modules: [], variableValues: {}, params: { ...source.params, characters: [] } }, mock.state.config);
  expect(empty.fields.every(field => field.reviewed)).toBe(true);
  expect(mock.put).not.toHaveBeenCalled();
});
it('编辑/生成封面仅保存副本，新公共角色保留副本风格/真实参数/原source快照', async () => {
  const source = comparisonChainFixture(), first = await ensureRoleModeCopy(source);
  await saveRoleModeChain({ ...first, basePrompt: 'new style', previewImage: '/copy-result.png', params: { ...first.params, seed: 99 } });
  expect(mock.state.copies[0].source).toEqual(source); expect(mock.state.copies[0].fields[0].replaced).toBe(source.basePrompt);
  const config = structuredClone(mock.state.config); config.characters[0].prompt = 'second character'; await saveRoleModeConfig(config);
  const current = getRoleModeCopy(first.id)!;
  expect(current.params.characters?.[0].prompt).toBe('second character'); expect(current.params.seed).toBe(99); expect(current.basePrompt).toBe('new style'); expect(current.previewImage).toBe('/copy-result.png');
});
it('就近拆分保持权重与原文，并保留编辑器新增模块，不强制所有字段审完才打开工作台', async () => {
  await ensureRoleModeCopy(comparisonChainFixture()); const copy = structuredClone(mock.state.copies[0]);
  const token = parsePromptTags(copy.fields[0].kept).find(value => value.lookupTag === '1girl')!;
  copy.fields[0] = markComparisonRole(copy.fields[0], token.id); copy.chain.modules.push({ id: 'added', name: 'Added', content: 'new style module', isActive: true });
  const result = await saveRoleModeReview(copy);
  expect(result.basePrompt).toBe('{{artist:alpha}}, side view'); expect(result.modules.at(-1)?.content).toBe('new style module');
  expect(mock.state.copies[0].fields[0]).toMatchObject({ original: '{{artist:alpha, 1girl}}, side view', replaced: '{{1girl}}', reviewed: false });
});
it('损坏读取保持已有快照且不写空副本，存档拒绝伪造原文', async () => {
  const chain = await ensureRoleModeCopy(comparisonChainFixture()); mock.get.mockResolvedValueOnce({ config: {}, copies: [] });
  await expect(loadRoleModeState()).rejects.toThrow(); expect(getRoleModeCopy(chain.id)?.id).toBe(chain.id);
  const copy = createRoleModeCopy(comparisonChainFixture(), emptyRoleModeConfig()); copy.fields[0].original = 'fake';
  expect(() => validateRoleModeCopy(copy)).toThrow(); expect(materializeRoleModeCopy(mock.state.copies[0], mock.state.config).id).toBe(chain.id);
});
it('明确保存拆分更新副本文字草稿，保留自定义模式词/参数/蒙版及原串草稿', async () => {
  const source = comparisonChainFixture(), chain = await ensureRoleModeCopy(source);
  const fallback = createLabWorkspaceSession(chain.basePrompt, chain.variableValues?.subject || '', chain.negativePrompt, chain.params, {});
  const session = structuredClone(fallback); session.textToImage.params.seed = 123;
  session.edits['image-to-image'].prompt = compilePrompt(chain, chain.variableValues?.subject || '');
  session.edits.inpaint.prompt = 'custom inpaint words'; session.edits.inpaint.baseImageRef = 'synthetic-base'; session.edits.inpaint.maskRef = 'synthetic-mask';
  saveLabWorkspaceSession(chain.id, session); saveLabWorkspaceSession(source.id, fallback);
  const originalRaw = sessionStorage.getItem(`nai-lab-workspace-v1:${source.id}`);
  const copy = structuredClone(mock.state.copies[0]), token = parsePromptTags(copy.fields[0].kept).find(value => value.lookupTag === '1girl')!;
  copy.fields[0] = markComparisonRole(copy.fields[0], token.id); const saved = await saveRoleModeReview(copy);
  const result = loadLabWorkspaceSession(chain.id, fallback);
  expect(result.textToImage.basePrompt).toBe(saved.basePrompt); expect(result.textToImage.params.seed).toBe(123);
  expect(result.edits['image-to-image'].prompt).toBe(compilePrompt(saved, saved.variableValues?.subject || ''));
  expect(result.edits.inpaint).toMatchObject({ prompt: 'custom inpaint words', baseImageRef: 'synthetic-base', maskRef: 'synthetic-mask' });
  expect(sessionStorage.getItem(`nai-lab-workspace-v1:${source.id}`)).toBe(originalRaw);
});
