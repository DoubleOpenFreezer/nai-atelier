import React, { useEffect, useState } from 'react';
import { Bot, X } from 'lucide-react';
import type { PromptChain } from '../../types';
import { t, useLanguage } from '../../services/i18n';
import { createRoleModeCopy, loadRoleModeState, saveRoleModeConfig, saveRoleModeReview, type RoleModeCopy, type RoleModeConfig } from '../../services/chainRoleMode';
import { markComparisonRole } from '../../services/chainComparisonApi';
import { parsePromptTags } from '../../services/tagTranslations';
import { getActiveCharacters } from '../../services/characterPrompts';
import { ImagePreviewPortal } from '../ImagePreviewPortal';
import { useModalA11y } from '../useModalA11y';
import { useMobileHistoryLayer } from '../MobileUI';
import { ToolbarButton } from '../DesignSystem';

interface Props { source?: PromptChain; onClose: () => void; onSaved?: () => void; onOpenEditor: (source: PromptChain) => void; notify: (message: string, type?: 'success' | 'error') => void }
const input = 'mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 p-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
export const ChainRoleModeDialog: React.FC<Props> = props => <ImagePreviewPortal><RoleModeForm {...props} /></ImagePreviewPortal>;
const RoleModeForm: React.FC<Props> = ({ source, onClose, onSaved, onOpenEditor, notify }) => {
  useLanguage();
  const [config, setConfig] = useState<RoleModeConfig | null>(null), [copy, setCopy] = useState<RoleModeCopy | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const ref = useModalA11y<HTMLDivElement>(true);
  useMobileHistoryLayer(true, () => { if (busy) return false; onClose(); }, 'chain-role');
  useEffect(() => { let alive = true; void loadRoleModeState().then(state => { if (alive) { setConfig(state.config); if (source) setCopy(structuredClone(state.copies.find(item => item.sourceId === source.id) || createRoleModeCopy(source, state.config))); } }).catch(cause => { if (alive) setError((cause as Error).message); }); return () => { alive = false; }; }, [source?.id]);
  const save = async () => { if (!config || busy) return; setBusy(true); try { if (source && copy) await saveRoleModeReview(copy); else await saveRoleModeConfig(config); onSaved?.(); onClose(); } catch (cause) { setError((cause as Error).message); notify((cause as Error).message, 'error'); } finally { setBusy(false); } };
  return <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-3" onClick={() => { if (!busy) onClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-label={t(source ? '拆分角色混合词' : '统一角色设置')} onClick={event => event.stopPropagation()} className="appearance-panel flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-xl border border-gray-200 bg-white text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
    <div className="flex items-center gap-2 border-b border-gray-200 p-3 dark:border-gray-700"><strong className="min-w-0 flex-1 truncate text-sm">{source ? source.name : t('统一角色设置')}</strong><button type="button" disabled={busy} onClick={onClose} aria-label={t('关闭')} className="mobile-touch p-2"><X className="h-4 w-4" /></button></div>
    <fieldset disabled={busy} className="min-h-0 space-y-3 overflow-y-auto p-3">
      {error && <p role="alert" className="text-sm text-red-500">{t(error)}</p>}
      {!config ? <p>{t('加载中…')}</p> : !source ? <>{(['prompt', 'negativePrompt'] as const).map(key => <label key={key} className="block text-xs">{t(key === 'prompt' ? '统一角色正面词' : '统一角色负面词')}<textarea rows={3} className={input} value={config.characters[0][key] || ''} onChange={event => setConfig({ ...config, characters: [{ ...config.characters[0], [key]: event.target.value }] })} /></label>)}</> : copy && <>
        <p className="text-xs text-gray-500">{getActiveCharacters(copy.source.params.characters).length ? t('检测到 {0} 个独立角色，本轮替换', [getActiveCharacters(copy.source.params.characters).length]) : t('未检测到独立角色，请检查全局混合内容')}</p>
        {copy.fields.map((field, index) => <details key={field.id} open={!field.reviewed} className="rounded-lg border border-gray-200 p-2 dark:border-gray-700"><summary className="text-xs font-semibold">{field.reviewed ? '✓ ' : ''}{t(field.kind === 'base' ? '全局提示词' : field.kind === 'subject' ? '主体提示词' : field.kind === 'negative' ? '负面提示词' : '提示词模块')}</summary>
          <pre className="my-2 max-h-24 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-500">{field.original || '—'}</pre>
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">{parsePromptTags(field.kept).map(token => <button type="button" key={token.id} title={t('标记为替换的原角色')} className="rounded border px-2 py-1 text-xs" onClick={() => setCopy({ ...copy, fields: copy.fields.map((value, position) => position === index ? markComparisonRole(value, token.id) : value) })}>{token.displayTag}</button>)}</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{(['kept', 'replaced'] as const).map(key => <label key={key} className="text-xs">{t(key === 'kept' ? '保留风格' : '替换的原角色')}<textarea rows={3} className={input} value={field[key]} onChange={event => setCopy({ ...copy, fields: copy.fields.map((value, position) => position === index ? { ...value, [key]: event.target.value, reviewed: false } : value) })} /></label>)}</div>
          <label className="mt-2 flex min-h-10 items-center gap-2 text-xs"><input type="checkbox" checked={field.reviewed} onChange={event => setCopy({ ...copy, fields: copy.fields.map((value, position) => position === index ? { ...value, reviewed: event.target.checked } : value) })} />{t('已审查此字段')}</label>
        </details>)}
      </>}
    </fieldset><div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 p-3 dark:border-gray-700">
      {source && <ToolbarButton disabled={busy} onClick={() => { onClose(); onOpenEditor(source); }}><Bot />{t('在工作台用助手整理')}</ToolbarButton>}
      <ToolbarButton disabled={busy} onClick={onClose}>{t('取消')}</ToolbarButton><ToolbarButton tone="primary" disabled={!config || busy} onClick={() => void save()}>{t('保存')}</ToolbarButton>
    </div></div></div>;
};
