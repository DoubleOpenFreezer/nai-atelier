import React, { useMemo, useState } from 'react';
import { t } from '../services/i18n';
import { CodexEntry, codexCharactersToParams, type CodexImageMetadata } from '../services/codexService';
import type { PromptFragmentImport } from '../services/metadataService';
import { findNaiModelInfo, getNaiModelDisplayLabel } from '../services/naiModels';
import { CloseButton, ToolbarButton } from './DesignSystem';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';

export function CodexImportDialog({ entry, metadata, onClose, onApply }: {
  entry: CodexEntry; metadata?: CodexImageMetadata; onClose: () => void; onApply: (data: PromptFragmentImport) => void;
}) {
  const ref = useModalA11y<HTMLDivElement>(true);
  const close = useMobileHistoryLayer(true, onClose, 'codex-import');
  const [settings, setSettings] = useState(Boolean(metadata));
  const prompt = metadata ? settings ? metadata.prompt : metadata.rawPrompt : entry.prompt;
  const negative = metadata ? settings ? metadata.negativePrompt : metadata.rawNegative : entry.negative;
  const characters = useMemo(() => metadata?.params.characters ?? codexCharactersToParams(entry.characters), [entry, metadata]);
  const [positive, setPositive] = useState(Boolean(prompt));
  const [useNegative, setUseNegative] = useState(Boolean(metadata && negative));
  const [selectedCharacters, setSelectedCharacters] = useState(() => new Set(characters.map((_, i) => i)));
  const [replace, setReplace] = useState(Boolean(metadata));
  const [seed, setSeed] = useState(false);
  const [model, setModel] = useState(false);
  const apply = () => {
    onApply({ mode: 'prompt-fragments', replace,
      ...(positive ? { prompt } : {}), ...(useNegative ? { negativePrompt: negative } : {}),
      ...(selectedCharacters.size ? { characters: characters.filter((_, i) => selectedCharacters.has(i)) } : {}),
      ...(metadata ? { params: metadata.params, importSettings: settings, importSeed: seed, importModel: model } : {}),
    });
  };
  const checkbox = (label: string, checked: boolean, onChange: (value: boolean) => void, disabled = false) => (
    <label className={`flex min-h-11 items-center gap-3 text-sm ${disabled ? 'text-gray-400' : 'text-gray-700 dark:text-gray-200'}`}>
      <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />{label}
    </label>
  );
  return <ImagePreviewPortal><div ref={ref} role="dialog" aria-modal="true" aria-label={t(metadata ? '取用原图配置' : '送往实验室')} className="fixed inset-0 z-[1850] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="appearance-panel flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
      <header className="flex h-14 flex-none items-center justify-between border-b border-gray-200 px-4 dark:border-gray-800"><p className="truncate font-semibold">{t(metadata ? '取用原图配置' : '送往实验室')}</p><CloseButton onClick={close} /></header>
      <div className="overflow-y-auto p-4">
        <p className="mb-2 truncate text-sm text-gray-500">{entry.title}</p>
        {checkbox(t('正向提示词'), positive, setPositive, !prompt)}
        {positive && <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-950">{prompt}</pre>}
        {checkbox(t('负面提示词'), useNegative, setUseNegative, !negative)}
        {useNegative && <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-xs dark:bg-gray-950">{negative}</pre>}
        {characters.map((character, i) => <div key={character.id}>
          {checkbox(t('角色 {0}', [i + 1]), selectedCharacters.has(i), checked => setSelectedCharacters(previous => { const next = new Set(previous); if (checked) next.add(i); else next.delete(i); return next; }))}
          <p className="truncate text-xs text-gray-500">{character.prompt}</p>
          {character.negativePrompt && <p className="truncate text-xs text-gray-400">{t('负面提示词')}：{character.negativePrompt}</p>}
        </div>)}
        {metadata && <div className="mt-3 border-t border-gray-200 pt-2 dark:border-gray-800">
          {checkbox(t('生成参数'), settings, setSettings)}
          <p className="text-xs text-gray-500">{[metadata.params.width && metadata.params.height ? `${metadata.params.width} × ${metadata.params.height}` : '', metadata.params.steps ? `${metadata.params.steps} ${t('步')}` : '', metadata.params.sampler].filter(Boolean).join(' · ')}</p>
          {checkbox(t('Seed'), seed, setSeed, metadata.params.seed === undefined)}
          {checkbox(t('模型：{0}', [getNaiModelDisplayLabel(metadata.params.model)]), model, setModel, !findNaiModelInfo(metadata.params.model))}
          <p className="mt-2 text-xs text-gray-500">{t('图片配置不包含可复用的参考图、底图或蒙版。')}</p>
        </div>}
        <div className="mt-4 flex items-center gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
          <span className="mr-auto text-sm text-gray-500">{t('取用方式')}</span>
          <ToolbarButton aria-pressed={!replace} tone={!replace ? 'primary' : 'neutral'} onClick={() => setReplace(false)}>{t('追加')}</ToolbarButton>
          <ToolbarButton aria-pressed={replace} tone={replace ? 'primary' : 'neutral'} onClick={() => setReplace(true)}>{t('替换所选字段')}</ToolbarButton>
        </div>
      </div>
      <footer className="flex justify-end gap-2 border-t border-gray-200 p-3 dark:border-gray-800"><ToolbarButton onClick={close}>{t('取消')}</ToolbarButton><ToolbarButton tone="primary" disabled={!positive && !useNegative && !selectedCharacters.size && !(metadata && (settings || seed || model))} onClick={apply}>{t('送往实验室')}</ToolbarButton></footer>
    </div>
  </div></ImagePreviewPortal>;
}
