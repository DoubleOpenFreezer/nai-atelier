import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_SECTION_FIELDS, PERSON_SECTION_KEYS, PROMPT_SECTION_FIELDS, mergePromptSectionText, resolvePromptSectionText, writePromptSections } from '../../services/promptSections.mjs';

const sections = { appearance: 'red hair', wardrobe: '', pose: 'standing', scene: 'forest', camera: '', extra: '',
  sectionMeta: { scene: { source: 'library', entryName: '森林' }, pose: { source: 'roll' } }, sectionNegatives: { scene: 'city' } };
const subject = 'red hair, standing, forest';

test('六栏名称与编辑器一致，按固定顺序合并为主体正文', () => {
  assert.deepEqual(PROMPT_SECTION_FIELDS.map(field => field.label), ['人物', '服饰', '姿势', '场景', '镜头', '补充']);
  assert.equal(mergePromptSectionText(sections), subject);
  assert.equal(mergePromptSectionText(null), '');
});

test('人物三栏属于角色，与角色槽分栏按 人物→形象、服饰→服饰、姿势→动作 对应', () => {
  assert.deepEqual(PERSON_SECTION_KEYS, ['appearance', 'wardrobe', 'pose']);
  assert.deepEqual(CHARACTER_SECTION_FIELDS.map(field => [field.key, field.label]), [['appearance', '形象'], ['wardrobe', '服饰'], ['pose', '动作'], ['expression', '表情']]);
});

test('主体与分栏不符时整段落入「补充」，与编辑器显示一致', () => {
  assert.equal(resolvePromptSectionText(sections, subject).scene, 'forest');
  assert.deepEqual(resolvePromptSectionText(sections, 'beach'), { appearance: '', wardrobe: '', pose: '', scene: '', camera: '', extra: 'beach' });
  assert.equal(resolvePromptSectionText(undefined, 'beach').extra, 'beach');
});

test('按栏写入只改指定栏：写入栏记为手动来源并保留分类负面，未改栏保留原来源', () => {
  const result = writePromptSections(sections, subject, { scene: 'beach', camera: 'close-up' });
  assert.deepEqual(result.written, ['scene', 'camera']);
  assert.equal(result.subject, 'red hair, standing, beach, close-up');
  assert.equal(result.sections.appearance, 'red hair');
  assert.deepEqual(result.sections.sectionMeta, { pose: { source: 'roll' }, scene: { source: 'manual' }, camera: { source: 'manual' } });
  assert.deepEqual(result.sections.sectionNegatives, { scene: 'city' });
  assert.equal(sections.scene, 'forest', '不修改传入对象');
});

test('清空的栏丢弃来源与分类负面；分栏已失效时不沿用旧来源', () => {
  const cleared = writePromptSections(sections, subject, { scene: '' });
  assert.equal(cleared.subject, 'red hair, standing');
  assert.equal(cleared.sections.sectionMeta.scene, undefined);
  assert.equal(cleared.sections.sectionNegatives, undefined);
  const stale = writePromptSections(sections, 'typed by hand', { camera: 'wide shot' });
  assert.equal(stale.subject, 'wide shot, typed by hand');
  assert.deepEqual(stale.sections.sectionMeta, { camera: { source: 'manual' } });
  assert.equal(stale.sections.sectionNegatives, undefined);
});
