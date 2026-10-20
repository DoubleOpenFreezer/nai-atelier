import { describe, expect, it } from 'vitest';
import type { NAIParams } from '../../types';
import type { RollRow } from '../../services/contentRoll';
import {
  applyContentRollToParams,
  pickByParticipation,
  planContentRollApply,
  undoContentRollApply,
} from '../../services/contentRollApply';

const row = (kind: string, text: string, filled = true, negative = ''): RollRow => ({
  kind, filled, name: `${kind} 条目`, text, negative, reason: filled ? 'ok' : 'empty',
  constraints: { facets: {}, absent: [], auto: [], values: [], unknown: [], notes: '', needsReview: false },
} as unknown as RollRow);

const picks = {
  appearance: row('appearance', 'blonde_hair, blue_eyes'),
  wardrobe: row('wardrobe', 'white_dress', true, 'coat'),
  pose: row('pose', '', false),
  expression: row('expression', 'smile'),
  scene: row('scene', 'rain, night'),
  camera: row('camera', 'close_up'),
};

const baseParams = (): NAIParams => ({
  width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
  seed: 12345,
  characters: [{ id: 'c1', prompt: 'old_role_text', x: 0.5, y: 0.5, sections: { appearance: 'old_hair' } }],
  _promptSections: { appearance: 'keep_me', wardrobe: '', pose: '', scene: 'old_scene', camera: 'old_camera', extra: 'old_extra' },
} as unknown as NAIParams);

describe('一键 Roll → 实验室：组计划', () => {
  it('只把「有内容」的栏位标为替换，未提供的保持原值并出现在 kept 里', () => {
    const plan = planContentRollApply(picks, baseParams(), { mode: 'existing', id: 'c1' });
    const byKind = Object.fromEntries(plan.rows.map(item => [item.kind, item]));
    expect(byKind.appearance.action).toBe('replace');
    expect(byKind.pose.action).toBe('keep');
    expect(plan.written).toEqual(['appearance', 'wardrobe', 'expression', 'scene', 'camera']);
    expect(plan.kept).toEqual(['pose']);
  });

  it('角色四类进 roleWrites（按栏），场景与镜头进各自的全局栏位', () => {
    const plan = planContentRollApply(picks, baseParams(), { mode: 'existing', id: 'c1' });
    expect(plan.roleWrites.map(item => item.kind)).toEqual(['appearance', 'wardrobe', 'expression']);
    expect(plan.roleWrites.find(item => item.kind === 'wardrobe')?.negative).toBe('coat');
    expect(plan.globalSections).toEqual({ scene: 'rain, night', camera: 'close_up' });
  });

  it('计划里带出每一栏的当前值，界面可直接显示「当前 → 将填入」', () => {
    const plan = planContentRollApply(picks, baseParams(), { mode: 'existing', id: 'c1' });
    expect(plan.rows.find(item => item.kind === 'appearance')?.current).toBe('old_hair');
    expect(plan.rows.find(item => item.kind === 'scene')?.current).toBe('old_scene');
    expect(plan.rows.find(item => item.kind === 'camera')?.current).toBe('old_camera');
  });

  it('没有目标角色时按「新建角色」规划', () => {
    const plan = planContentRollApply(picks, baseParams(), { mode: 'new' });
    expect(plan.target.mode).toBe('new');
    expect(plan.roleId).toBe('');
    expect(plan.roleName).toBe('角色 1');
  });
});

describe('一键 Roll → 实验室：写值与撤销', () => {
  const createId = () => 'new-id';

  it('只换服饰时，角色正文与其它分栏都不动（不再整段替换）', () => {
    const params = baseParams();
    const plan = planContentRollApply({ wardrobe: picks.wardrobe }, params, { mode: 'existing', id: 'c1' });
    const { params: next } = applyContentRollToParams(params, plan, createId);
    const character = next.characters?.[0];
    expect(character?.prompt).toBe('old_role_text');
    expect(character?.sections?.appearance).toBe('old_hair');
    expect(character?.sections?.wardrobe).toBe('white_dress');
    expect(character?.sections?.pose).toBeUndefined();
    /* 分类负面单独落在 sectionNegatives，不混进角色负面 */
    expect(character?.sectionNegatives?.wardrobe).toBe('coat');
    expect(character?.negativePrompt).toBeUndefined();
  });

  it('四类齐全时逐栏写入，正文仍保持原样', () => {
    const params = baseParams();
    const plan = planContentRollApply(picks, params, { mode: 'existing', id: 'c1' });
    const { params: next, written } = applyContentRollToParams(params, plan, createId);
    const character = next.characters?.[0];
    expect(character?.prompt).toBe('old_role_text');
    expect(character?.sections).toMatchObject({ appearance: 'blonde_hair, blue_eyes', wardrobe: 'white_dress', expression: 'smile' });
    expect(written).toContain('character:c1:wardrobe');
  });

  it('场景与镜头各写自己的全局栏位，补充栏与其它参数不动', () => {
    const params = baseParams();
    const plan = planContentRollApply(picks, params, { mode: 'existing', id: 'c1' });
    const { params: next, written } = applyContentRollToParams(params, plan, createId);
    expect(next._promptSections?.scene).toBe('rain, night');
    expect(next._promptSections?.camera).toBe('close_up');
    expect(next._promptSections?.extra).toBe('old_extra');
    expect(next._promptSections?.appearance).toBe('keep_me');
    expect(next.width).toBe(832);
    expect(next.steps).toBe(28);
    expect(next.seed).toBe(12345);
    expect(written).toContain('scene');
    expect(written).toContain('camera');
  });

  it('新建角色时正文留空、内容进分栏，不影响已有角色', () => {
    const params = baseParams();
    const plan = planContentRollApply(picks, params, { mode: 'new' });
    const { params: next, createdRoleId } = applyContentRollToParams(params, plan, createId);
    expect(createdRoleId).toBe('new-id');
    expect(next.characters).toHaveLength(2);
    expect(next.characters?.[0].prompt).toBe('old_role_text');
    expect(next.characters?.[1].prompt).toBe('');
    expect(next.characters?.[1].sections?.wardrobe).toBe('white_dress');
  });

  it('撤销恢复改动前的 params，并移除本次新建的角色', () => {
    const params = baseParams();
    const plan = planContentRollApply(picks, params, { mode: 'new' });
    const applied = applyContentRollToParams(params, plan, createId);
    const restored = undoContentRollApply(applied.params, applied.undoParams, applied.createdRoleId);
    expect(restored.characters).toHaveLength(1);
    expect(restored.characters?.[0].prompt).toBe('old_role_text');
    expect(restored.characters?.[0].sections?.appearance).toBe('old_hair');
    expect(restored._promptSections?.scene).toBe('old_scene');
  });

  it('没有任何内容可写时计划为空，写值不产生改动', () => {
    const empty: Record<string, RollRow> = {};
    for (const kind of Object.keys(picks)) empty[kind] = row(kind, '', false);
    const params = baseParams();
    const plan = planContentRollApply(empty, params, { mode: 'existing', id: 'c1' });
    expect(plan.written).toEqual([]);
    const { params: next, written } = applyContentRollToParams(params, plan, createId);
    expect(written).toEqual([]);
    expect(next.characters?.[0].sections?.appearance).toBe('old_hair');
    expect(next._promptSections?.scene).toBe('old_scene');
  });
});

describe('参与范围：取消勾选的栏位一律不参与', () => {
  it('即使这一栏还留着上次抽到的内容，也不进计划、不入库', () => {
    const checked = pickByParticipation(picks, { wardrobe: false });
    expect(checked.wardrobe).toBeUndefined();
    const plan = planContentRollApply(checked, baseParams(), { mode: 'existing', id: 'c1' });
    expect(plan.rows.find(item => item.kind === 'wardrobe')?.action).toBe('keep');
    expect(plan.roleWrites.map(item => item.kind)).not.toContain('wardrobe');
    const { params: next } = applyContentRollToParams(baseParams(), plan, () => 'x');
    expect(next.characters?.[0].sections?.wardrobe).toBeUndefined();
  });

  it('没有勾选信息时按「全部参与」处理', () => {
    expect(Object.keys(pickByParticipation(picks))).toHaveLength(6);
    expect(Object.keys(pickByParticipation(picks, {}))).toHaveLength(6);
  });
});
