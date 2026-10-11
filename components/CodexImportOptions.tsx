import React from 'react';
import { t } from '../services/i18n';
import type { CodexEntry, CodexImageMetadata } from '../services/codexService';
import type { PromptFragmentImport } from '../services/metadataService';
import { findNaiModelInfo, getNaiModelDisplayLabel } from '../services/naiModels';
import { ToolbarButton } from './DesignSystem';

/** 次级选项直接调整当前取用内容，主操作不再经过确认弹窗。 */
export function CodexImportOptions({ entry, metadata, source, value, onChange: update }: {
  entry: CodexEntry; metadata?: CodexImageMetadata; source: PromptFragmentImport; value: PromptFragmentImport;
  onChange: (value: PromptFragmentImport) => void;
}) {
  const onChange = (next: PromptFragmentImport) => update({ ...next, fullMetadata: false });
  const prompt = metadata ? value.importSettings ? metadata.prompt : metadata.rawPrompt : entry.prompt;
  const negative = metadata ? value.importSettings ? metadata.negativePrompt : metadata.rawNegative : entry.negative;
  const characters = source.characters || [];
  const selected = new Set(value.characters?.map(character => character.id));
  const checkbox = (label: string, checked: boolean, change: (value: boolean) => void, disabled = false) => (
    <label className={`flex min-h-11 items-center gap-3 text-sm ${disabled ? 'text-gray-400' : 'text-gray-700 dark:text-gray-200'}`}>
      <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={checked} disabled={disabled} onChange={event => change(event.target.checked)} />{label}
    </label>
  );
  return <div className="space-y-1">
    {checkbox(t('正向提示词'), value.prompt !== undefined, checked => onChange({ ...value, prompt: checked ? prompt : undefined }), !prompt)}
    {checkbox(t('负面提示词'), value.negativePrompt !== undefined, checked => onChange({ ...value, negativePrompt: checked ? negative : undefined }), !negative)}
    {characters.map((character, i) => <div key={character.id}>
      {checkbox(t('角色 {0}', [i + 1]), selected.has(character.id), checked => {
        const ids = new Set(selected); if (checked) ids.add(character.id); else ids.delete(character.id);
        const next = characters.filter(character => ids.has(character.id));
        onChange({ ...value, characters: next.length ? next : undefined });
      })}
      <p className="truncate text-xs text-gray-500">{character.prompt}</p>
      {character.negativePrompt && <p className="truncate text-xs text-gray-400">{t('负面提示词')}：{character.negativePrompt}</p>}
    </div>)}
    {metadata && <div className="border-t border-gray-200 pt-2 dark:border-gray-800">
      {checkbox(t('生成参数'), Boolean(value.importSettings), checked => onChange({ ...value, importSettings: checked,
        ...(value.prompt !== undefined ? { prompt: checked ? metadata.prompt : metadata.rawPrompt } : {}),
        ...(value.negativePrompt !== undefined ? { negativePrompt: checked ? metadata.negativePrompt : metadata.rawNegative } : {}) }))}
      <p className="text-xs text-gray-500">{[metadata.params.width && metadata.params.height ? `${metadata.params.width} × ${metadata.params.height}` : '', metadata.params.steps ? `${metadata.params.steps} ${t('步')}` : '', metadata.params.sampler].filter(Boolean).join(' · ')}</p>
      {checkbox(t('Seed'), Boolean(value.importSeed), checked => onChange({ ...value, importSeed: checked }), metadata.params.seed === undefined)}
      {checkbox(metadata.params.model ? t('模型：{0}', [getNaiModelDisplayLabel(metadata.params.model)]) : t('模型'), Boolean(value.importModel), checked => onChange({ ...value, importModel: checked }), !metadata.params.model || !findNaiModelInfo(metadata.params.model))}
    </div>}
    <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
      <span className="mr-auto text-sm text-gray-500">{t('取用方式')}</span>
      <ToolbarButton aria-pressed={!value.replace} tone={!value.replace ? 'primary' : 'neutral'} onClick={() => onChange({ ...value, replace: false })}>{t('追加')}</ToolbarButton>
      <ToolbarButton aria-pressed={Boolean(value.replace)} tone={value.replace ? 'primary' : 'neutral'} onClick={() => onChange({ ...value, replace: true })}>{t('替换所选字段')}</ToolbarButton>
    </div>
  </div>;
}
