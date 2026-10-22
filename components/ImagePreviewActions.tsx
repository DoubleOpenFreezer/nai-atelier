import { t, useLanguage } from '../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Image, ImageMinus, ListX, LoaderCircle, Palette, Upload } from 'lucide-react';
import { IMAGE_CARD_ACTION_CLASS, ImageShareActions } from './ImageShareActions';
import type { CollectionTarget } from '../services/collectionFavorites';
import type { ImageGenerationData } from '../services/imageClipboardContext';

const IMAGE_PREVIEW_BUTTON_CLASS = `${IMAGE_CARD_ACTION_CLASS} inline-flex shrink-0 items-center justify-center transition disabled:cursor-wait disabled:opacity-50`;
const PREVIEW_MENU_CLASS = 'absolute top-0 z-40 flex min-w-max flex-col gap-0.5 rounded-xl border border-white/20 bg-gray-900/90 p-1 text-white shadow-lg backdrop-blur';
const PREVIEW_MENU_ITEM_CLASS = 'mobile-touch flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold hover:bg-white/15 focus-visible:bg-white/15 focus-visible:outline-none disabled:opacity-50';

interface Props {
  imageUrl?: string | null;
  filename: string;
  generationData?: ImageGenerationData;
    favorite?: CollectionTarget;
  notify?: (message: string, type?: 'success' | 'error') => void;
  canManageHistoryGroup?: boolean;
  onRemoveCurrentHistory?: () => void;
  onClearHistoryGroup?: () => void;
  onSetCover?: () => void;
  onUploadCover?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isUploading?: boolean;
  onSaveArtistSample?: () => void;
  savingArtistSample?: boolean;
  onBack?: () => void;
  backButtonRef?: React.Ref<HTMLButtonElement>;
}

/**
 * 小图与大图共用操作位置、紧凑尺寸及权限，仅大图增加返回入口。
 * 移除／清空只影响预览、历史页保留，合为一个「管理」菜单；设封面与上传封面合为一个封面按钮，两项都可用时展开选择。
 */
export const ImagePreviewActions: React.FC<Props> = ({
  imageUrl, filename, generationData, favorite, notify, canManageHistoryGroup, onRemoveCurrentHistory, onClearHistoryGroup,
  onSetCover, onUploadCover, isUploading = false, onSaveArtistSample, savingArtistSample = false, onBack, backButtonRef,
}) => {
  useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<'manage' | 'cover' | null>(null);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const visibility = onBack ? 'hover-reveal-md' : 'hover-reveal-lg';
  const canManage = Boolean(imageUrl && canManageHistoryGroup);
  const coverActions = [
    ...(imageUrl && onSetCover ? [{ key: 'set', label: '设为当前图片', run: onSetCover }] : []),
    ...(onUploadCover ? [{ key: 'upload', label: '从电脑上传', run: () => fileInputRef.current?.click() }] : []),
  ];
  const coverLabel = coverActions.length > 1 ? '设置封面' : coverActions[0]?.key === 'upload' ? '手动上传封面' : '设为封面';
  const coverTip = isUploading ? '封面处理中…' : coverActions.length > 1 ? '设置封面：当前图片或从电脑上传' : coverActions[0]?.key === 'upload' ? '手动上传封面并保存' : '设为封面并保存';
  // 菜单打开时点外部或 Esc 关闭；Esc 不再继续关闭全屏大图。
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRootRef.current?.contains(event.target as Node)) setMenu(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(null); } };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', key, true); };
  }, [menu]);
  useEffect(() => { if (!canManage && menu === 'manage') setMenu(null); }, [canManage, menu]);
  const choose = (run?: () => void) => { setMenu(null); run?.(); };
  return <div ref={menuRootRef} className="contents">
    {(onBack || canManage) && <div data-card-action="true" className={`pointer-events-none absolute top-4 left-4 z-30 flex flex-col items-start ${onBack ? 'gap-6' : 'gap-2'} ${onBack ? '' : visibility}`} onClick={event => event.stopPropagation()}>
      {onBack && <button ref={backButtonRef} type="button" onClick={onBack} aria-label={t("返回小图")} data-tip={t("返回小图")} data-tip-side="right" className={`${IMAGE_PREVIEW_BUTTON_CLASS} pointer-events-auto !h-12 !w-12`}>
        <ArrowLeft className="h-7 w-7" aria-hidden="true" />
      </button>}
      {canManage && <div className={`relative ${visibility}`}>
        <button type="button" onClick={() => setMenu(value => value === 'manage' ? null : 'manage')} aria-haspopup="menu" aria-expanded={menu === 'manage'}
          aria-label={t("管理预览图片")} data-tip={menu ? undefined : t("从预览移除图片（历史页保留）")} data-tip-side="right" className={`${IMAGE_PREVIEW_BUTTON_CLASS} !bg-gray-900/85 hover:!bg-gray-800`}>
          <ImageMinus className="h-4 w-4" aria-hidden="true" />
        </button>
        {menu === 'manage' && <div role="menu" aria-label={t("管理预览图片")} className={`${PREVIEW_MENU_CLASS} left-full ml-2`}>
          <button type="button" role="menuitem" onClick={() => choose(onRemoveCurrentHistory)} className={`${PREVIEW_MENU_ITEM_CLASS} text-red-300`}><ImageMinus className="h-4 w-4" aria-hidden="true" />{t("移除当前图片")}</button>
          <button type="button" role="menuitem" onClick={() => choose(onClearHistoryGroup)} className={PREVIEW_MENU_ITEM_CLASS}><ListX className="h-4 w-4" aria-hidden="true" />{t("清空当前历史组")}</button>
          <p className="px-3 pb-1 text-mini font-normal text-white/60">{t("只从预览中移除，历史页仍会保留")}</p>
        </div>}
      </div>}
    </div>}
    {(imageUrl || coverActions.length > 0) && <div data-card-action="true" className={`absolute top-4 right-4 z-30 flex flex-col items-center gap-2`} onClick={event => event.stopPropagation()}>
      {imageUrl && <ImageShareActions imageUrl={imageUrl} generationData={generationData} favorite={favorite} filename={filename} notify={notify} variant="card" className="flex-col" revealClassName={visibility} />}
      {imageUrl && onSaveArtistSample && <button type="button" onClick={onSaveArtistSample} disabled={savingArtistSample} aria-busy={savingArtistSample} aria-label={t('保存为画师样张')} data-tip={t('保存为画师样张')} className={`${visibility} ${IMAGE_PREVIEW_BUTTON_CLASS}`}>
        {savingArtistSample ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Palette className="h-4 w-4" />}
      </button>}
      {coverActions.length > 0 && <div className={`relative ${visibility}`}>
        <input aria-label={t("上传作品封面")} type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={event => onUploadCover?.(event)} />
        <button type="button" disabled={isUploading} aria-busy={isUploading} aria-label={t(coverLabel)} data-tip={menu ? undefined : t(coverTip)}
          {...(coverActions.length > 1 ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': menu === 'cover' } : {})}
          onClick={() => coverActions.length > 1 ? setMenu(value => value === 'cover' ? null : 'cover') : coverActions[0].run()}
          className={`${IMAGE_PREVIEW_BUTTON_CLASS} !bg-indigo-600/90 hover:!bg-indigo-600`}>
          {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : coverActions.length === 1 && coverActions[0].key === 'upload'
            ? <Upload className="h-4 w-4" aria-hidden="true" />
            : <span className="relative h-4 w-4" aria-hidden="true"><Image className="h-4 w-4" /><Check className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-indigo-600" strokeWidth={3} /></span>}
        </button>
        {menu === 'cover' && <div role="menu" aria-label={t("设置封面")} className={`${PREVIEW_MENU_CLASS} right-full mr-2`}>
          {coverActions.map(action => <button key={action.key} type="button" role="menuitem" onClick={() => choose(action.run)} className={PREVIEW_MENU_ITEM_CLASS}>
            {action.key === 'upload' ? <Upload className="h-4 w-4" aria-hidden="true" /> : <Image className="h-4 w-4" aria-hidden="true" />}{t(action.label)}
          </button>)}
        </div>}
      </div>}
    </div>}
  </div>;
};
