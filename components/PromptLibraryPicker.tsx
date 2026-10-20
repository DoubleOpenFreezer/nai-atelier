import React, { useEffect, useState } from 'react';
import { BookOpen, LoaderCircle } from 'lucide-react';
import { t, useLanguage } from '../services/i18n';
import { PROMPT_LIBRARY_KIND_LABELS, type PromptLibraryKind } from '../services/promptAgent';
import { db } from '../services/dbService';
import type { PromptChain } from '../types';
import { ToolbarPopover } from './ToolbarPopover';

export const appendPromptText = (current: string, addition: string): string => {
    const base = current.trim(), text = addition.trim();
    return !text || base.includes(text) ? base : base ? `${base}, ${text}` : text;
};

interface PromptLibraryPickerProps {
    kind: PromptLibraryKind;
    disabled?: boolean;
    onPick: (prompt: string) => void;
}

const LibraryOptions: React.FC<PromptLibraryPickerProps & { close: () => void }> = ({ kind, onPick, close }) => {
    const [chains, setChains] = useState<PromptChain[] | null>(null);
    const [query, setQuery] = useState('');
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let active = true;
        setChains(null); setFailed(false);
        void db.getAllChains().then(items => {
            if (active) setChains(items.filter(item => item.type === kind));
        }).catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [kind, retry]);
    const keyword = query.trim().toLowerCase();
    const shown = (chains || []).filter(item => [item.name, item.basePrompt, ...(item.tags || [])].join(' ').toLowerCase().includes(keyword));
    return <div className="flex min-w-0 flex-col gap-2">
        <input type="search" value={query} onChange={event => setQuery(event.target.value)}
            aria-label={t('搜索库条目')} placeholder={t('搜索名称、标签或提示词…')}
            className="mobile-touch w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-gray-700 dark:bg-gray-800" />
        {failed ? <div role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t('读取提示词库失败')} <button type="button" className="mobile-touch underline" onClick={() => setRetry(value => value + 1)}>{t('重试')}</button>
        </div> : chains === null ? <div role="status" className="flex items-center gap-2 py-4 text-sm text-gray-500"><LoaderCircle className="h-4 w-4 animate-spin" />{t('正在读取…')}</div>
            : shown.length ? <div className="max-h-80 space-y-1 overflow-y-auto">
                {shown.map(item => <button type="button" key={item.id} disabled={!item.basePrompt.trim()}
                    onClick={() => { onPick(item.basePrompt.trim()); close(); }}
                    className="mobile-touch flex w-full flex-col gap-1 rounded-lg border border-gray-200 px-3 py-2 text-left hover:border-indigo-500 disabled:opacity-40 dark:border-gray-700">
                    <span className="max-w-full truncate text-sm font-semibold">{item.name || t('未命名')}</span>
                    <span className="line-clamp-2 break-words font-mono text-xs text-gray-500 dark:text-gray-400">{item.basePrompt || t('还没有提示词')}</span>
                </button>)}
            </div> : <p className="py-4 text-center text-sm text-gray-500">{t(chains.length ? '没有匹配的条目' : '这个提示词库还是空的')}</p>}
    </div>;
};

/** 复用共用弹层：桌面避让视口，手机底部面板，关闭后再次打开读取最新条目。 */
export const PromptLibraryPicker: React.FC<PromptLibraryPickerProps> = props => {
    useLanguage();
    return <ToolbarPopover label="库导入" title={t('从{0}库导入', [t(PROMPT_LIBRARY_KIND_LABELS[props.kind])])}
        icon={<BookOpen className="h-4 w-4" />} disabled={props.disabled} width={360}>
        {close => <LibraryOptions {...props} close={close} />}
    </ToolbarPopover>;
};
