// 风格串全局提示词的六个分栏：键、界面名称与固定合并顺序。编辑器与助手共用，合并值即主体正文 subjectPrompt。
export const PROMPT_SECTION_FIELDS = [
  { key: 'appearance', label: '人物' },
  { key: 'wardrobe', label: '服饰' },
  { key: 'pose', label: '姿势' },
  { key: 'scene', label: '场景' },
  { key: 'camera', label: '镜头' },
  { key: 'extra', label: '补充' },
];
export const PROMPT_SECTION_KEYS = PROMPT_SECTION_FIELDS.map(field => field.key);
// 人物三栏属于角色：风格串与实验室把人物内容写进角色槽，全局只保留整图内容；自定义角色工作台的全局各栏共同定义该角色。
export const PERSON_SECTION_KEYS = ['appearance', 'wardrobe', 'pose'];
// 角色槽分栏与全局人物栏的对应：人物→形象、服饰→服饰、姿势→动作。
export const CHARACTER_SECTION_FIELDS = [
  { key: 'appearance', label: '形象' },
  { key: 'wardrobe', label: '服饰' },
  { key: 'pose', label: '动作' },
  { key: 'expression', label: '表情' },
];

const textOf = value => String(value ?? '');
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export const mergePromptSectionText = sections => PROMPT_SECTION_KEYS
  .map(key => textOf(sections?.[key]).trim()).filter(Boolean).join(', ');

/** 与编辑器显示规则一致：分栏合并值与主体正文不符时，整段主体落入「补充」，不拿旧分栏覆盖新内容。 */
export const resolvePromptSectionText = (sections, subject = '') => {
  const values = Object.fromEntries(PROMPT_SECTION_KEYS.map(key => [key, textOf(sections?.[key])]));
  if (object(sections) && mergePromptSectionText(values) === textOf(subject).trim()) return { ...values };
  return { ...Object.fromEntries(PROMPT_SECTION_KEYS.map(key => [key, ''])), extra: textOf(subject) };
};

/**
 * 只改 patch 中给出的栏，返回新的分栏对象（含仍有效的来源与分类负面）及其合并主体。
 * 与编辑器直接输入一致：写入的栏记为手动来源并保留本栏分类负面，清空的栏丢弃两者。
 */
export const writePromptSections = (sections, subject, patch) => {
  const current = resolvePromptSectionText(sections, subject);
  // 分栏与主体不符时已整体落入「补充」，旧来源和分类负面不再对应任何栏。
  const matched = object(sections) && mergePromptSectionText(sections) === textOf(subject).trim();
  const next = { ...current };
  // 原文未变的栏不算改写，保留来源。
  const written = PROMPT_SECTION_KEYS.filter(key => typeof patch?.[key] === 'string' && patch[key] !== current[key]);
  for (const key of written) next[key] = patch[key];
  const meta = {}, negatives = {};
  for (const key of PROMPT_SECTION_KEYS) {
    if (!textOf(next[key]).trim()) continue;
    if (written.includes(key)) meta[key] = { source: 'manual' };
    else if (matched && object(sections.sectionMeta?.[key])) meta[key] = { ...sections.sectionMeta[key] };
    if (matched && textOf(sections.sectionNegatives?.[key]).trim()) negatives[key] = textOf(sections.sectionNegatives[key]);
  }
  return {
    sections: { ...next, ...(Object.keys(meta).length ? { sectionMeta: meta } : {}), ...(Object.keys(negatives).length ? { sectionNegatives: negatives } : {}) },
    subject: mergePromptSectionText(next),
    written,
  };
};
