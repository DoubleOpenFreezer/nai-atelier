import { describe, expect, it } from 'vitest';
import type { NAIParams } from '../../types';
import type { RollRow } from '../../services/contentRoll';
import {
  applyContentRollToParams,
  planContentRollApply,
  undoContentRollApply,
} from '../../services/contentRollApply';

const row = (kind: string, text: string, filled = true): RollRow => ({
  kind, filled, name: `${kind} 条目`, text, reason: filled ? 'ok' : 'empty',
  constraints: { facets: {}, absent: [], auto: [], values: [], unknown: [], notes: '', needsReview: false },
} as unknown as RollRow);

const picks = {
  appearance: row('appearance', 'blonde_hair, blue_eyes'),
  wardrobe: row('wardrobe', 'white_dress'),
  pose: row('pose', '', false),
  expression: row('expression', 'smile'),
  scene: row('scene', 'rain, night'),
  camera: row('camera', 'close_up'),
};

const baseParams = (): NAIParams => ({
  width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral',
  seed: 12345, characters: [{ id: 'c1', prompt: 'old_role_text', x: 0.5, y: 0.5 }],
  _promptSections: { appearance: 'keep_me', wardrobe: '', pose: '', extra: 'old_extra' },
} as unknown as NAIParams);

describe('一键 Roll → 实验室：组计划', () => {
  it('只把「有内容」的栏位标为替换，未提供的保持原值并出现在 kept 里', () => {
    const plan = planContentRollApply(picks, baseParams(), { mode: 'existing', id: 'c1' });
    const byKind = Object.fromEntries(plan.rows.map(item => [item.kind, item]));
    expect(byKind.appearance.action).toBe('replace');
    expect(byKind.pose.action).toBe('keep');
    expect(byKind.pose.next).toBe('');
    expect(plan.written).toEqual(['appearance', 'wardrobe', 'expression', 'scene', 'camera']);
    expect(plan.kept).toEqual(['pose']);
  });

  it('角色四类拼成角色文本，场景与镜头拼成补充栏文本，各自去重合并', () => {
    const plan = planContentRollApply(
      { ...picks, appearance: row('appearance', 'blonde_hair, smile'), expression: row('expression', 'smile') },
      baseParams(), { mode: 'existing', id: 'c1' },
    );
    expect(plan.characterText).toBe('blonde_hair, smile, white_dress');
    expect(plan.globalText).toBe('rain, night, close_up');
  });

  it('计划里带出每一栏的当前值，界面可直接显示「当前 → 将填入」', () => {
    const plan = planContentRollApply(picks, baseParams(), { mode: 'existing', id: 'c1' });
    const appearance = plan.rows.find(item => item.kind === 'appearance');
    const scene = plan.rows.find(item => item.kind === 'scene');
    expect(appearance?.current).toBe('old_role_text');
    expect(scene?.current).toBe('old_extra');
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

  it('只改目标角色 prompt 与补充栏，画师串/负面/模型参数一个都不动', () => {
    const params = baseParams();
    const plan = planContentRollApply(picks, params, { mode: 'existing', id: 'c1' });
    const { params: next, written } = applyContentRollToParams(params, plan, createId);
    expect(next.characters?.[0].prompt).toBe('blonde_hair, blue_eyes, white_dress, smile');
    expect(next._promptSections?.extra).toBe('rain, night, close_up');
    /* 其它分区栏位保持原样，不被顺手清空 */
    expect(next._promptSections?.appearance).toBe('keep_me');
    /* 生成参数与角色几何不动 */
    expect(next.width).toBe(832);
    expect(next.steps).toBe(28);
    expect(next.seed).toBe(12345);
    expect(next.characters?.[0].x).toBe(0.5);
    expect(written).toContain('character:c1');
    expect(written).toContain('extra');
  });

  it('新建角色时把内容写在新区间，不影响已有角色', () => {
    const params = baseParams();
    const plan = planContentRollApply(picks, params, { mode: 'new' });
    const { params: next, createdRoleId } = applyContentRollToParams(params, plan, createId);
    expect(createdRoleId).toBe('new-id');
    expect(next.characters).toHaveLength(2);
    expect(next.characters?.[0].prompt).toBe('old_role_text');
    expect(next.characters?.[1].prompt).toBe('blonde_hair, blue_eyes, white_dress, smile');
  });

  it('撤销恢复改动前的 params，并移除本次新建的角色', () => {
    const params = baseParams();
    const plan = planContentRollApply(picks, params, { mode: 'new' });
    const applied = applyContentRollToParams(params, plan, createId);
    const restored = undoContentRollApply(applied.params, applied.undoParams, applied.createdRoleId);
    expect(restored.characters).toHaveLength(1);
    expect(restored.characters?.[0].prompt).toBe('old_role_text');
    expect(restored._promptSections?.extra).toBe('old_extra');
  });

  it('没有任何内容可写时计划为空，写值不产生改动', () => {
    const empty = { ...picks };
    for (const kind of Object.keys(empty)) empty[kind as keyof typeof empty] = row(kind, '', false);
    const params = baseParams();
    const plan = planContentRollApply(empty, params, { mode: 'existing', id: 'c1' });
    expect(plan.written).toEqual([]);
    const { params: next, written } = applyContentRollToParams(params, plan, createId);
    expect(written).toEqual([]);
    expect(next.characters?.[0].prompt).toBe('old_role_text');
    expect(next._promptSections?.extra).toBe('old_extra');
  });
});
