import { t, useLanguage } from '../../services/i18n';
import React, { useId, useRef } from 'react';
import { LabPageLayout } from '../../services/appearancePreferences';
import { mergePromptSections, resolvePromptSections } from '../../services/labWorkspace';
import { PERSON_SECTION_KEYS } from '../../services/promptSections.mjs';
import { LabModuleSection } from '../LabModuleSection';
import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';
import { PromptLibraryPicker } from '../PromptLibraryPicker';
import { PresetSection, PresetSource, PresetSourceBadges, PromptCopyButton } from './PresetSourceBadges';
import type { PromptLibraryKind } from '../../services/promptAgent';
import type { PromptSectionSource, PromptSections } from '../../types';

const isPersonKey = (key: string) => (PERSON_SECTION_KEYS as string[]).includes(key);

/** 文本型栏位（排除只用于追溯的 sectionMeta） */
type SectionKey = Exclude<keyof PromptSections, 'sectionMeta' | 'sectionNegatives'>;

const SECTION_FIELDS: { key: SectionKey; label: string; library: PromptLibraryKind; placeholder: string }[] = [
    { key: 'appearance', label: '人物', library: 'appearance', placeholder: '外貌特征，如发色、瞳色与体型' },
    { key: 'wardrobe', label: '服饰', library: 'wardrobe', placeholder: '服装、鞋袜与配饰' },
    { key: 'pose', label: '姿势', library: 'pose', placeholder: '姿态、动作与视角' },
    { key: 'scene', label: '场景', library: 'scene', placeholder: '地点、时间、天气与氛围' },
    { key: 'camera', label: '镜头', library: 'camera', placeholder: '景别、视角、构图与成像效果' },
    { key: 'extra', label: '补充', library: 'scene', placeholder: '人数、场景、构图与光线等补充' },
];

interface PromptFieldProps {
    label: string;
    value: string;
    placeholder: string;
    library?: PromptLibraryKind;
    disabled: boolean;
    tagAssistEnabled: boolean;
    onChange: (value: string, source?: PromptSectionSource) => void;
    onCopy: (value: string, label: string) => void;
    /** 该栏现有来源（条目名），显示在标签旁做追溯 */
    sourceName?: string;
    /** 旧串遗留的全局人物栏：说明人物内容已改写在角色里，并提供移到角色 */
    legacyNotice?: string;
    onMoveToCharacter?: () => void;
}

const PromptField: React.FC<PromptFieldProps> = ({ label, value, placeholder, library, disabled, tagAssistEnabled, onChange, onCopy, sourceName, legacyNotice, onMoveToCharacter }) => {
    const id = useId();
    const clearSlot = useRef<HTMLSpanElement>(null);
    return <div role="group" aria-label={t(label)} className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
            <label htmlFor={id} className="min-w-0 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                {t(label)}
                {sourceName ? <span className="ml-1 text-micro font-normal text-gray-400">{t('来源：{0}', [sourceName])}</span> : null}
            </label>
            <div className="flex shrink-0 items-center gap-1">
                {onMoveToCharacter && <button type="button" disabled={disabled} onClick={onMoveToCharacter}
                    className="rounded border border-indigo-200 px-2 py-1 text-meta font-semibold text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
                    {t('移到角色')}
                </button>}
                {library && <PromptLibraryPicker kind={library} disabled={disabled} targetKind={library} current={value}
                    onPick={picked => onChange(picked, { source: 'library' })}
                    onPickEntry={result => onChange(result.prompt, { entryId: result.entryId, entryName: result.entryName, source: 'library', mode: result.mode })} />}
                <span ref={clearSlot} />
                <PromptCopyButton onClick={() => onCopy(value, label)} title={t('复制{0}', [t(label)])} />
            </div>
        </div>
        {legacyNotice && <p className="text-meta text-amber-700 dark:text-amber-300">{t(legacyNotice)}</p>}
        <TagAutocompleteTextarea id={id} aria-label={t(label)} clearActionSlotRef={clearSlot}
            tagAssistEnabled={tagAssistEnabled} disabled={disabled} value={value} onValueChange={onChange}
            placeholder={t(placeholder)}
            className={`min-h-[100px] w-full rounded-lg border p-3 font-mono text-sm font-normal leading-relaxed outline-none ${disabled
                ? 'cursor-not-allowed bg-gray-100 text-gray-500 dark:bg-gray-800'
                : 'border-gray-200 bg-gray-50 text-gray-900 focus:ring-1 focus:ring-indigo-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200'}`} />
    </div>;
};

export interface ChainEditorPromptInputsProps {
    prompt: string;
    setPrompt: (value: string) => void;
    sections?: PromptSections | null;
    /** 就地发起「Roll 场景 / 镜头」 */
    onContentRollForGlobal?: () => void;
    setSections?: (sections: PromptSections) => void;
    supplementPrompt?: string;
    setSupplementPrompt?: (value: string) => void;
    presetSources: Partial<Record<PresetSection, PresetSource>>;
    tagAssistEnabled: boolean;
    canEdit: boolean;
    copyPromptToClipboard: (value: string, label: string) => void;
    markPresetSectionModified: (section: PresetSection) => void;
    markChange: () => void;
    activeLabLayout: LabPageLayout;
    mobileEditorTab: 'global' | 'character' | 'params';
    /** 自定义角色工作台的全局各栏共同定义角色，人物栏常驻；其他界面人物内容写在「角色」里 */
    personSectionsInGlobal?: boolean;
    /** 把旧串遗留的全局人物栏内容移到角色槽对应分栏 */
    onMoveSectionToCharacter?: (key: 'appearance' | 'wardrobe' | 'pose') => void;
}

export const ChainEditorPromptInputs: React.FC<ChainEditorPromptInputsProps> = ({
    prompt, setPrompt, sections, setSections, supplementPrompt = '', setSupplementPrompt, onContentRollForGlobal,
    presetSources, tagAssistEnabled, canEdit, copyPromptToClipboard,
    markPresetSectionModified, markChange, activeLabLayout, mobileEditorTab, personSectionsInGlobal = false, onMoveSectionToCharacter,
}) => {
    useLanguage();
    const current = resolvePromptSections(sections, supplementPrompt);
        const writeSection = (key: SectionKey, value: string, source?: PromptSectionSource) => {
        const meta = { ...(current.sectionMeta || {}) } as Record<string, PromptSectionSource>;
        if (source) meta[key] = source;
        else if (String(value || '').trim()) meta[key] = { source: 'manual' };
        else delete meta[key];
        const next = { ...current, [key]: value, sectionMeta: meta } as PromptSections;
        setSections?.(next);
        setSupplementPrompt?.(mergePromptSections(next));
        markPresetSectionModified('subject');
        markChange();
    };
    return <LabModuleSection moduleId="prompt" label={t('全局提示词')}
        order={activeLabLayout.order.indexOf('prompt')} defaultCollapsed={Boolean(activeLabLayout.collapsed.prompt)}
        className={mobileEditorTab === 'global' ? 'block' : 'hidden'}>
        <section className={mobileEditorTab === 'global' ? 'block' : 'hidden'}>
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <PresetSourceBadges sources={Object.fromEntries(Object.entries({ base: presetSources.base, subject: presetSources.subject })
                    .filter((entry): entry is [string, PresetSource] => Boolean(entry[1])))} />
            </div>
            <div className="flex flex-col gap-3">
                {onContentRollForGlobal ? (
                    <div className="flex justify-end">
                        <button type="button" onClick={onContentRollForGlobal}
                            className="rounded border border-dashed border-indigo-300 px-2 py-1 text-meta font-semibold text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40">
                            {t('Roll 场景 / 镜头')}
                        </button>
                    </div>
                ) : null}
                <PromptField label="画师串" value={prompt} placeholder="画师标签与固定画风" disabled={!canEdit}
                    tagAssistEnabled={tagAssistEnabled} onCopy={copyPromptToClipboard} onChange={value => {
                        setPrompt(value); markPresetSectionModified('base'); markChange();
                    }} />
                {/* 人物内容写在「角色」里；旧串遗留的全局人物栏仅在仍有内容时显示，可移到角色，不自动搬动 */}
                {SECTION_FIELDS.filter(field => personSectionsInGlobal || !isPersonKey(field.key) || String(current[field.key] || '').trim()).map(field => {
                    const legacy = !personSectionsInGlobal && isPersonKey(field.key);
                    return <PromptField key={field.key} label={field.label} library={field.library}
                        value={String(current[field.key] || '')} placeholder={field.placeholder} disabled={!canEdit}
                        sourceName={current.sectionMeta?.[field.key]?.entryName}
                        tagAssistEnabled={tagAssistEnabled} onCopy={copyPromptToClipboard}
                        legacyNotice={legacy ? '人物内容现在写在「角色」里；这是旧内容，可移到角色' : undefined}
                        onMoveToCharacter={legacy && onMoveSectionToCharacter ? () => onMoveSectionToCharacter(field.key as 'appearance' | 'wardrobe' | 'pose') : undefined}
                        onChange={(value, source) => writeSection(field.key, value, source)} />;
                })}
            </div>
        </section>
    </LabModuleSection>;
};
