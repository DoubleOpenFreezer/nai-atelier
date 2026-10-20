import type { CharacterParams, NAIParams, PromptSections } from '../types';
import { KINDS, META } from './contentRoll';
import type { RollRow } from './contentRoll';

/**
 * 一键 Roll → 实验室的「应用计划」。
 *
 * 只做纯规划与写值，不碰 React / 请求 / 存储：
 *   - 只写**本次抽到内容**的栏位；未参与 / 空库的栏位保持原值（不静默清空）；
 *   - 角色四类（形象 / 服饰 / 动作 / 表情）拼进目标角色的 `prompt`；
 *   - 场景与镜头在源码的数据模型里没有独立栏位（`PromptSections` 只有 appearance / wardrobe / pose / extra），
 *     因此按「补充栏」写进 `_promptSections.extra`，并在计划里标注来源，避免被误认为独立分类；
 *   - 画师串、风格负面、模型与全部生图参数一个字节都不动（只改上面两处）。
 *
 * 撤销：调用方保留 `undo`（改动前的 params 快照 + 新建角色 id），一次撤销恢复全部范围。
 */

export type ContentRollTarget = { mode: 'new' } | { mode: 'existing'; id: string };

export interface ContentRollApplyRow {
  kind: string;
  title: string;
  /** 目标当前值（角色栏或全局补充栏） */
  current: string;
  /** 本次将写入的值；未提供时为空串 */
  next: string;
  action: 'replace' | 'keep';
  note: string;
}

export interface ContentRollApplyPlan {
  target: ContentRollTarget;
  roleId: string;
  roleName: string;
  rows: ContentRollApplyRow[];
  /** 角色四类拼好的文本（写入目标角色 prompt） */
  characterText: string;
  /** 场景 + 镜头拼好的文本（写入 _promptSections.extra） */
  globalText: string;
  /** 实际会改动的落点：character / extra */
  written: string[];
  /** 未提供内容的栏位（保持原值），用于界面说明 */
  kept: string[];
}

const splitTags = (value: unknown): string[] =>
  String(value == null ? '' : value).split(/[,，]/).map(item => String(item).trim()).filter(Boolean);

const probeTag = (value: string): string => String(value || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');

/** 去重合并（与实验室既有的负面/标签合并同一口径：按归一化 tag 去重、逗号连接）。 */
const joinTags = (lists: string[]): string => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const tag of splitTags(list)) {
      const probe = probeTag(tag);
      if (!probe || seen.has(probe)) continue;
      seen.add(probe);
      out.push(tag);
    }
  }
  return out.join(', ');
};

const textOfRow = (row: RollRow | undefined): string => (row && row.filled ? String(row.text || '').trim() : '');

const noteOfRow = (row: RollRow | undefined): string => {
  if (!row) return '';
  if (!row.filled) return row.reason === 'empty' ? '该库当前 0 条，保持原值' : '本次未提供，保持原值';
  return row.constraints?.notes || '';
};

const characterParamsOf = (params: NAIParams): CharacterParams[] =>
  (Array.isArray(params.characters) ? params.characters : []);

/**
 * 组计划：target 决定写哪个角色（新建角色时 roleId 由 apply 阶段生成，这里先留空）。
 * 角色四类与全局两类分别汇总，未提供的栏位不进入 written。
 */
export const planContentRollApply = (
  picks: Record<string, RollRow>,
  params: NAIParams | null | undefined,
  target: ContentRollTarget,
): ContentRollApplyPlan => {
  const safeParams = params || {} as NAIParams;
  const characters = characterParamsOf(safeParams);
  const existing = target.mode === 'existing' ? characters.find(item => String(item.id) === String(target.id)) : null;
  const currentCharacter = existing ? String(existing.prompt || '') : '';
  const currentExtra = String((safeParams._promptSections?.extra) || '');
  const characterParts: string[] = [];
  const globalParts: string[] = [];
  const rows: ContentRollApplyRow[] = [];
  const written: string[] = [];
  const kept: string[] = [];

  for (const kind of KINDS) {
    const meta = META[kind];
    const row = picks[kind];
    const next = textOfRow(row);
    const isGlobal = meta.scope === 'global';
    const current = isGlobal ? currentExtra : currentCharacter;
    const action: 'replace' | 'keep' = next ? 'replace' : 'keep';
    if (next) {
      written.push(kind);
      if (isGlobal) globalParts.push(next);
      else characterParts.push(next);
    } else {
      kept.push(kind);
    }
    rows.push({ kind, title: meta.title, current, next, action, note: noteOfRow(row) });
  }

  return {
    target,
    roleId: existing ? String(existing.id) : '',
    roleName: existing
      ? (characters.findIndex(item => String(item.id) === String(existing.id)) + 1 ? `角色 ${characters.findIndex(item => String(item.id) === String(existing.id)) + 1}` : '角色')
      : '角色 1',
    rows,
    characterText: joinTags(characterParts),
    globalText: joinTags(globalParts),
    written,
    kept,
  };
};

export interface ContentRollApplyResult {
  params: NAIParams;
  /** 撤销用：改动前的 params 快照 */
  undoParams: NAIParams;
  /** 本次新建的角色 id（没有新建则为空串），撤销时据此移除 */
  createdRoleId: string;
  written: string[];
}

/**
 * 写值：把计划落到 params 上，返回新 params 与撤销快照。
 * 只改两处 —— 目标角色的 prompt 与 `_promptSections.extra`；其它字段原样保留。
 */
export const applyContentRollToParams = (
  params: NAIParams | null | undefined,
  plan: ContentRollApplyPlan,
  createId: () => string,
): ContentRollApplyResult => {
  const before: NAIParams = params ? { ...params } : {} as NAIParams;
  const next: NAIParams = { ...before };
  const written: string[] = [];
  let createdRoleId = '';

  const characters = characterParamsOf(before).map(item => ({ ...item }));
  const target = plan.target;
  if (plan.characterText) {
    if (target.mode === 'new') {
      createdRoleId = createId();
      characters.push({ id: createdRoleId, prompt: plan.characterText, x: 0.5, y: 0.5 });
      written.push('character:new');
    } else {
      const index = characters.findIndex(item => String(item.id) === String(target.id));
      if (index >= 0) {
        characters[index] = { ...characters[index], prompt: plan.characterText };
        written.push('character:' + String(target.id));
      }
    }
  }
  if (characters.length) next.characters = characters;

  if (plan.globalText) {
    const sections: PromptSections = { ...(before._promptSections || {}) };
    sections.extra = plan.globalText;
    next._promptSections = sections;
    written.push('extra');
  }

  return { params: next, undoParams: before, createdRoleId, written };
};

/** 撤销：把 params 恢复到快照，并按需移除本次新建的角色。 */
export const undoContentRollApply = (
  current: NAIParams | null | undefined,
  undoParams: NAIParams | null | undefined,
  createdRoleId: string,
): NAIParams => {
  const restored: NAIParams = undoParams ? { ...undoParams } : {} as NAIParams;
  if (createdRoleId) {
    const characters = characterParamsOf(restored).filter(item => String(item.id) !== String(createdRoleId));
    restored.characters = characters;
  }
  return restored;
};
