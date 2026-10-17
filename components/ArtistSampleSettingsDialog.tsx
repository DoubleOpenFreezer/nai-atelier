import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ImagePreviewPortal } from './ImagePreviewPortal';
import { isTopmostModal, useModalA11y } from './useModalA11y';
import { useMobileHistoryLayer } from './MobileUI';
import type { NAIParams } from '../types';
import { t, useLanguage } from '../services/i18n';
import { db } from '../services/dbService';
import { getNaiRuntimeConfig } from '../services/naiRuntime';
import { NAI_MODELS, isNaiMediumModel } from '../services/naiModels';
import type { ArtistSamplePack } from '../services/artistSamples';
import {
  buildArtistSampleTemplateFromChain, getArtistSampleData,
  getDefaultArtistSampleTemplate, saveArtistSampleTemplate,
  type ArtistSampleTemplate,
} from '../services/artistSampleDrafts';

const packVersion = (pack: ArtistSamplePack) => pack === 'v45' ? /^nai-diffusion-4-5-(full|curated)$/ : /^nai-diffusion-5-(full|curated)$/;

const TemplateEditor: React.FC<{ pack: ArtistSamplePack; value: ArtistSampleTemplate; onChange: (value: ArtistSampleTemplate) => void; onModelValidChange: (valid: boolean) => void }> = ({ pack, value, onChange, onModelValidChange }) => {
  const [models, setModels] = useState<Array<{ id: string; label: string }>>([]);
  const [presets, setPresets] = useState<Array<{ id: string; name: string; template: ArtistSampleTemplate }>>([]);
  const [modelsReady, setModelsReady] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    let active = true;
    void getNaiRuntimeConfig().then(runtime => {
      if (!active) return;
      const allowed = runtime.models.filter(id => packVersion(pack).test(id) && !isNaiMediumModel(id) && !id.endsWith('-inpainting'));
      const options = allowed.map(id => ({ id, label: NAI_MODELS.find(model => model.id === id)?.label || id }));
      setModels(options);
      setModelsReady(true);
      const current = valueRef.current;
      if (options.length && !options.some(option => option.id === current.params.model)) onChange({ ...current, params: { ...current.params, model: options[0].id } });
      onModelValidChange(options.some(option => option.id === current.params.model) || options.length > 0);
    }).catch(() => { if (active) { setModels([]); setModelsReady(true); onModelValidChange(false); } });
    void db.getAllChains().then(chains => {
      if (!active) return;
      setPresets(chains.filter(chain => chain.type === 'style').map(chain => ({
        id: chain.id,
        name: chain.name,
        template: buildArtistSampleTemplateFromChain(chain),
      })));
    }).catch(() => { if (active) setPresets([]); });
    return () => { active = false; };
  // 编辑字段时不重复加载选项，避免异步结果覆盖当前输入。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack]);

  const update = (template: ArtistSampleTemplate) => {
    onModelValidChange(models.some(model => model.id === template.params.model));
    onChange(template);
  };
  const patchParams = (patch: Partial<NAIParams>) => update({ ...value, params: { ...value.params, ...patch } });
  const fieldClass = 'mobile-touch min-w-0 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  return <div className="mt-3 space-y-3 rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-800/40">
    <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">{t('自建配置，用于补充缺失样张。{artist} 会替换为画师 Tag。')}</p>
    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('载入风格串')}<select className={`${fieldClass} mt-1`} value="" onChange={event => { const preset = presets.find(item => item.id === event.target.value); if (preset) update(preset.template); }}><option value="">{t('选择已有风格串')}</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>
    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('正向提示词')}<textarea className={`${fieldClass} mt-1 min-h-20 resize-y`} value={value.prompt} onChange={event => update({ ...value, prompt: event.target.value })} /></label>
    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">{t('负面提示词')}<textarea className={`${fieldClass} mt-1 min-h-16 resize-y`} value={value.negativePrompt} onChange={event => update({ ...value, negativePrompt: event.target.value })} /></label>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('模型')}<select className={`${fieldClass} mt-1`} value={value.params.model || ''} disabled={!modelsReady || !models.length} onChange={event => patchParams({ model: event.target.value })}>{!modelsReady ? <option value="">{t('正在读取模型列表…')}</option> : models.length ? models.map(model => <option key={model.id} value={model.id}>{model.label}</option>) : <option value="">{t('暂无可用模型')}</option>}</select></label>
      {([
        ['width', t('宽度')], ['height', t('高度')], ['steps', t('步数')], ['scale', 'CFG'], ['seed', t('Seed')],
      ] as const).map(([key, label]) => <label key={key} className="text-xs font-semibold text-gray-600 dark:text-gray-300">{label}<input className={`${fieldClass} mt-1`} type="number" value={value.params[key] ?? ''} onChange={event => patchParams({ [key]: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>)}
      <label className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('采样器')}<select className={`${fieldClass} mt-1`} value={value.params.sampler || 'k_euler_ancestral'} onChange={event => patchParams({ sampler: event.target.value })}>{[['k_euler_ancestral', 'Euler Ancestral'], ['k_euler', 'Euler'], ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'], ['k_dpmpp_2m_sde', 'DPM++ 2M SDE'], ['k_dpmpp_2m', 'DPM++ 2M'], ['k_dpmpp_sde', 'DPM++ SDE']].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    </div>
  </div>;
};

export const ArtistSampleSettingsDialog: React.FC<{
  tag?: string; pack: ArtistSamplePack; generateAfterSave: boolean;
  onSaved: (template: ArtistSampleTemplate) => void; onClose: () => void;
}> = ({ tag, pack, generateAfterSave, onSaved, onClose }) => {
  useLanguage();
  const [template, setTemplate] = useState<ArtistSampleTemplate>();
  const [valid, setValid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const active = useRef(true);
  const dialogRef = useModalA11y<HTMLDivElement>(true);
  const close = useMobileHistoryLayer(true, () => { if (!saving) onClose(); }, 'artist-sample-settings');
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    setLoading(true); setError('');
    void getArtistSampleData().then(data => { if (!cancelled) setTemplate(data.templates[pack] || getDefaultArtistSampleTemplate(pack)); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; active.current = false; };
  }, [pack, retry]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && isTopmostModal(dialogRef.current)) { event.stopPropagation(); close(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [close, dialogRef]);
  const save = async () => {
    if (!template || saving) return;
    setSaving(true); setError('');
    try { await saveArtistSampleTemplate(pack, template); if (active.current) onSaved(template); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (active.current) setSaving(false); }
  };
  return <ImagePreviewPortal><div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('补图生成设置')} className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="appearance-panel flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <header className="flex flex-none items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700"><div className="min-w-0 flex-1"><h2 className="font-bold dark:text-white">{t('补图生成设置')}</h2><p className="mt-1 break-words text-xs text-gray-500">{tag ? `${tag} · ` : ''}NovelAI {pack === 'v45' ? 'V4.5' : 'V5'}</p></div><button type="button" aria-label={t('关闭')} disabled={saving} onClick={close} className="mobile-touch rounded-lg p-2 text-gray-500"><X className="h-4 w-4" /></button></header>
      <div className="min-h-0 overflow-y-auto p-4">
        {loading ? <p className="text-sm text-gray-500">{t('正在读取配置…')}</p> : template && <fieldset disabled={saving}><TemplateEditor pack={pack} value={template} onChange={setTemplate} onModelValidChange={setValid} /></fieldset>}
        {error && <p role="alert" className="mt-2 break-words text-xs text-red-600 dark:text-red-300">{error}{!template && <button type="button" className="mobile-touch ml-2 underline" onClick={() => setRetry(value => value + 1)}>{t('重试读取配置')}</button>}</p>}
      </div>
      <footer className="flex flex-none justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700"><button type="button" disabled={saving} onClick={close} className="mobile-touch rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:text-gray-300">{t('取消')}</button><button type="button" disabled={loading || saving || !valid || !template?.prompt.includes('{artist}') || !Number.isSafeInteger(template?.params.seed) || template!.params.seed! < 0} data-agent-action={generateAfterSave ? "business" : undefined} onClick={() => void save()} className="mobile-touch rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? t('保存中…') : generateAfterSave ? t('保存并生成样张') : t('保存配置')}</button></footer>
    </div>
  </div></ImagePreviewPortal>;
};
