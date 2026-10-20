import { describe, expect, it } from 'vitest';
import { applyPromptText, coveredTagCount, kindConflictOf, PROMPT_APPLY_MODES } from '../../services/promptApply';

describe('选择器的三种应用模式', () => {
  it('replace 直接替换；append 去重追加；fill-missing 只补缺失', () => {
    expect(applyPromptText('blonde_hair, smile', 'white_dress, smile', 'replace')).toBe('white_dress, smile');
    expect(applyPromptText('blonde_hair, smile', 'white_dress, smile', 'append')).toBe('blonde_hair, smile, white_dress');
    /* fill-missing 只在栏位为空时生效：已有内容保持原样，不并入新条目 */
    expect(applyPromptText('blonde_hair, smile', 'white_dress, smile', 'fill-missing')).toBe('blonde_hair, smile');
    expect(applyPromptText('blonde_hair', 'blonde_hair', 'append')).toBe('blonde_hair');
    expect(PROMPT_APPLY_MODES).toEqual(['replace', 'append', 'fill-missing']);
  });

  it('当前为空时三种模式一致；条目为空则不改动当前内容', () => {
    for (const mode of PROMPT_APPLY_MODES) expect(applyPromptText('', 'white_dress', mode)).toBe('white_dress');
    expect(applyPromptText('blonde_hair', '', 'replace')).toBe('blonde_hair');
  });

  it('归一化后同名 Tag 视为同一个，不会重复追加', () => {
    expect(applyPromptText('Blue Eyes', 'blue_eyes', 'append')).toBe('Blue Eyes');
    expect(applyPromptText('blonde hair', 'blonde_hair, smile', 'fill-missing')).toBe('blonde hair');
  });

  it('分类冲突与已覆盖数量', () => {
    expect(kindConflictOf('wardrobe', 'appearance')).toBe(true);
    expect(kindConflictOf('wardrobe', 'wardrobe')).toBe(false);
    expect(kindConflictOf('', 'appearance')).toBe(false);
    expect(coveredTagCount('blonde_hair, smile', 'smile, white_dress')).toBe(1);
  });
});
