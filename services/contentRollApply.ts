import type { CharacterParams, CharacterSectionContent, NAIParams, PromptSections } from '../types';
import { KINDS, META } from './contentRoll';
import type { RollRow } from './contentRoll';
import { CHARACTER_SECTION_KEYS } from './characterPrompts';

/**
 * 一键 Roll → 实验室的「应用计划」。
 *
 * 只做纯规划与写值，不碰 React / 请求 / 存储：
 *   - 只写**本次抽到内容**的栏位；未参与 / 空库的栏位保持原值（不静默清空）；
 *   - 角色四类写进目标角色的**分栏**（`character.sections`），不再整段替换角色正文：
 *     正文由 `services/characterPrompts.compileCharacterContent` 在**实际请求**时编译，
 *     因此未参与的栏位、手动补充正文都不会被这次替换吃掉；
 *   - 每栏的内容负面写进 `character.sectionNegatives`，来源写进 `character.sectionMeta`（不进请求）；
 *   - 场景与镜头各写 `_promptSections.scene` / `.camera`（全局栏位，与「补充」栏互不占用）；
 *   - 画师串、风格负面、模型与全部生图参数一个字节都不动。
 *
 * 撤销：调用方保留 `undo`（改动前的 params 快照 + 新建角色 id），一次撤销恢复全部范围。
 */

export type ContentRollTarget =
  | { mode: 'new' }
  | { mode: 'existing'; id: string }
  /** 把同一套搭配写进所有启用角色（停用角色跳过，不新建） */
  | { mode: 'all-enabled' };

/** 抽取范围：只角色四类 / 只场景镜头 / 全部（与界面上的「范围」选择一致）。 */
export type ContentRollScope = 'all' | 'character' | 'global';

/** 按范围过滤要参与抽取的机型：角色四类进目标角色，场景镜头进全局栏位。 */
export const filterPicksByScope = (
  picks: Record<string, RollRow>,
  scope: ContentRollScope,
): Record<string, RollRow> => {
  if (scope === 'all') return { ...picks };
  const out: Record<string, RollRow> = {};
  for (const [kind, row] of Object.entries(picks || {})) {
    const isGlobal = META[kind]?.scope === 'global';
    if (scope === 'global' ? isGlobal : !isGlobal) out[kind] = row;
  }
  return out;
};

/** 启用中的目标角色（用于「所有启用角色」与默认目标）。 */
export const enabledCharactersOf = (params: NAIParams | null | undefined): CharacterParams[] =>
  charactersOf((params || {}) as NAIParams).filter(item => item.enabled !== false);

export interface ContentRollApplyRow {
  kind: string;
  title: string;
  /** 目标该栏当前值（角色分栏或全局栏位） */
  current: string;
  /** 本次将写入的值；未提供时为空串 */
  next: string;
  action: 'replace' | 'keep';
  note: string;
}

/** 一栏要写进角色分栏的内容（含内容负面与来源快照）。 */
export interface ContentRollRoleWrite {
  kind: keyof CharacterSectionContent;
  text: string;
  negative: string;
  meta: { entryId?: string; entryName?: string; notes?: string; source?: string };
}

export interface ContentRollApplyPlan {
  target: ContentRollTarget;
  roleId: string;
  roleName: string;
  rows: ContentRollApplyRow[];
  /** 角色四类合并文本（仅用于预览显示；写入走 roleWrites 的分栏） */
  characterText: string;
  /** 场景 + 镜头合并文本（兼容旧调用） */
  globalText: string;
  /** 场景 / 镜头按栏位分好的文本（写入 _promptSections.scene / .camera） */
  globalSections: Record<string, string>;
  /** 角色四类的分栏写入载荷 */
  roleWrites: ContentRollRoleWrite[];
  /** 实际会改动的落点 */
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
const negativeOfRow = (row: RollRow | undefined): string => (row && row.filled ? String(row.negative || '').trim() : '');

const noteOfRow = (row: RollRow | undefined): string => {
  if (!row) return '';
  if (!row.filled) return row.reason === 'empty' ? '该库当前 0 条，保持原值' : '本次未提供，保持原值';
  return row.constraints?.notes || '';
};

const charactersOf = (params: NAIParams): CharacterParams[] =>
  (Array.isArray(params.characters) ? params.characters : []);

/**
 * 组计划：target 决定写哪个角色（新建角色时 roleId 由 apply 阶段生成，这里先留空）。
 * 角色四类进 roleWrites（分栏写入），场景与镜头进 globalSections；未提供的栏位不进入 written。
 */
export const planContentRollApply = (
  picks: Record<string, RollRow>,
  params: NAIParams | null | undefined,
  target: ContentRollTarget,
): ContentRollApplyPlan => {
  const safeParams = params || {} as NAIParams;
  const characters = charactersOf(safeParams);
  const existing = target.mode === 'existing'
    ? characters.find(item => String(item.id) === String(target.id))
    : null;
  const sections = (existing?.sections || {}) as Record<string, string | undefined>;
  const promptText = String(existing?.prompt || '');
  const globalSectionsMap = (safeParams._promptSections || {}) as Record<string, unknown>;
  const rows: ContentRollApplyRow[] = [];
  const roleWrites: ContentRollRoleWrite[] = [];
  const characterParts: string[] = [];
  const globalParts: string[] = [];
  const globalSections: Record<string, string> = {};
  const written: string[] = [];
  const kept: string[] = [];

  for (const kind of KINDS) {
    const meta = META[kind];
    const row = picks[kind];
    const next = textOfRow(row);
    const negative = negativeOfRow(row);
    const isGlobal = meta.scope === 'global';
    const current = isGlobal
      ? String(globalSectionsMap[kind] || '')
      : String(sections[kind] || '');
    const action: 'replace' | 'keep' = next ? 'replace' : 'keep';
    if (next) {
      written.push(kind);
      if (isGlobal) {
        globalParts.push(next);
        globalSections[kind] = next;
      } else {
        characterParts.push(next);
        roleWrites.push({
          kind: kind as keyof CharacterSectionContent,
          text: next,
          negative,
          meta: {
            entryId: String(row?.id || '') || undefined,
            entryName: String(row?.name || '') || undefined,
            notes: row?.constraints?.notes || undefined,
            source: row?.reason || undefined,
          },
        });
      }
    } else {
      kept.push(kind);
    }
    const extraNote = !isGlobal && !next && promptText.trim() && !String(sections[kind] || '').trim()
      ? '该角色目前只有整段正文，本栏保持不动'
      : '';
    rows.push({ kind, title: meta.title, current, next, action, note: [noteOfRow(row), extraNote].filter(Boolean).join('；') });
  }

  return {
    target,
    roleId: existing ? String(existing.id) : '',
    roleName: target.mode === 'all-enabled'
      ? '所有启用角色（' + enabledCharactersOf(safeParams).length + ' 个）'
      : existing ? '角色 ' + (characters.findIndex(item => String(item.id) === String(existing.id)) + 1) : '角色 1',
    rows,
    characterText: joinTags(characterParts),
    globalText: joinTags(globalParts),
    globalSections,
    roleWrites,
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
 * 写值：角色四类**按栏写入** `character.sections`（同时写内容负面与来源快照），
 * 场景 / 镜头写各自的全局栏位；返回新 params 与撤销快照。其它字段原样保留。
 */
export const applyContentRollToParams = (
  params: NAIParams | null | undefined,
  plan: ContentRollApplyPlan,
  createId: () => string,
): ContentRollApplyResult => {
  const before: NAIParams = params ? { ...params } : {} as NAIParams;
  const next: NAIParams = { ...before };
  const written: string[] = [];
  const target = plan.target;
  const characters = charactersOf(before).map(item => ({
    ...item,
    sections: { ...(item.sections || {}) },
    sectionNegatives: { ...(item.sectionNegatives || {}) },
    sectionMeta: { ...(item.sectionMeta || {}) },
  }));
  let createdRoleId = '';

  if (plan.roleWrites.length && target.mode === 'all-enabled') {
    characters.forEach((character, index) => {
      if (character.enabled === false) return;
      for (const write of plan.roleWrites) {
        characters[index] = {
          ...characters[index],
          sections: { ...(characters[index].sections || {}), [write.kind]: write.text },
          sectionNegatives: write.negative
            ? { ...(characters[index].sectionNegatives || {}), [write.kind]: write.negative }
            : characters[index].sectionNegatives,
          sectionMeta: { ...(characters[index].sectionMeta || {}), [write.kind]: { ...write.meta } },
        };
        written.push('character:' + String(character.id) + ':' + write.kind);
      }
    });
  }

  if (plan.roleWrites.length && target.mode !== 'all-enabled') {
    let index = target.mode === 'existing'
      ? characters.findIndex(item => String(item.id) === String(target.id))
      : -1;
    if (index < 0 && target.mode === 'new') {
      createdRoleId = createId();
      characters.push({ id: createdRoleId, prompt: '', x: 0.5, y: 0.5, sections: {}, sectionNegatives: {}, sectionMeta: {} });
      index = characters.length - 1;
      written.push('character:new');
    }
    if (index >= 0) {
      const character = characters[index];
      for (const write of plan.roleWrites) {
        character.sections = { ...(character.sections || {}), [write.kind]: write.text };
        if (write.negative) {
          character.sectionNegatives = { ...(character.sectionNegatives || {}), [write.kind]: write.negative };
        }
        character.sectionMeta = { ...(character.sectionMeta || {}), [write.kind]: { ...write.meta } };
        written.push('character:' + String(character.id) + ':' + write.kind);
      }
    }
  }
  if (characters.length) next.characters = characters;

  const globalWrites = plan.globalSections || {};
  if (Object.keys(globalWrites).length) {
    const sections: PromptSections = { ...(before._promptSections || {}) };
    for (const [kind, text] of Object.entries(globalWrites)) {
      if (!text) continue;
      (sections as Record<string, string>)[kind] = text;
      written.push(kind);
    }
    next._promptSections = sections;
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
    restored.characters = charactersOf(restored).filter(item => String(item.id) !== String(createdRoleId));
  }
  return restored;
};

/**
 * 参与范围过滤：**抽取、预览、填入、保存必须用同一个范围**。
 * 取消勾选的分类视为「本次不参与」—— 即使这一栏还留着上次抽到的内容，也不进计划、不入库。
 */
export const pickByParticipation = (
  picks: Record<string, RollRow>,
  checks?: Record<string, boolean> | null,
): Record<string, RollRow> => {
  const out: Record<string, RollRow> = {};
  for (const [kind, row] of Object.entries(picks || {})) {
    if (checks && checks[kind] === false) continue;
    out[kind] = row;
  }
  return out;
};
