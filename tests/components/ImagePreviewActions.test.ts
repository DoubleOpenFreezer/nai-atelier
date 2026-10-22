// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImagePreviewActions } from '../../components/ImagePreviewActions';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('小图和全屏大图的共用操作', () => {
  it.each([false, true])('全屏=%s：辅助操作统一圆形尺寸与材质，移除／清空收进一个管理菜单，悬停即显示名称', fullscreen => {
    const remove = vi.fn();
    const clear = vi.fn();
    const cover = vi.fn();
    const back = vi.fn();
    const parentClick = vi.fn();
    const backButtonRef = React.createRef<HTMLButtonElement>();
    render(React.createElement('div', { onClick: parentClick }, React.createElement(ImagePreviewActions, {
      imageUrl: '/current.png', filename: 'NAI.png', canManageHistoryGroup: true,
      onRemoveCurrentHistory: remove, onClearHistoryGroup: clear, onSetCover: cover,
      onBack: fullscreen ? back : undefined, backButtonRef,
    })));
    const manageButton = screen.getByRole('button', { name: '管理预览图片' });
    const coverButton = screen.getByRole('button', { name: '设为封面' });
    const left = manageButton.closest<HTMLElement>('[data-card-action]')!;
    const right = coverButton.closest<HTMLElement>('[data-card-action]')!;
    expect(left.classList.contains('top-4')).toBe(true);
    expect(left.classList.contains('left-4')).toBe(true);
    expect(left.classList.contains(fullscreen ? 'gap-6' : 'gap-2')).toBe(true);
    expect(right.classList.contains('top-4')).toBe(true);
    expect(right.classList.contains('right-4')).toBe(true);
    expect(manageButton.parentElement?.classList.contains(fullscreen ? 'hover-reveal-md' : 'hover-reveal-lg')).toBe(true);
    expect(coverButton.parentElement?.classList.contains(fullscreen ? 'hover-reveal-md' : 'hover-reveal-lg')).toBe(true);
    expect(right.classList.contains('hover-reveal-lg')).toBe(false);
    expect(screen.getByRole('button', { name: '收藏' }).closest('.hover-reveal-lg')).toBeNull();
    expect(right.classList.contains('items-center')).toBe(true);
    expect(within(right).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['收藏', '下载图片', '复制图片', '设为封面']);
    expect(within(left).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(fullscreen ? ['返回小图', '管理预览图片'] : ['管理预览图片']);
    for (const button of [manageButton, coverButton, screen.getByRole('button', { name: '下载图片' }), screen.getByRole('button', { name: '复制图片' })]) {
      for (const token of ['rounded-full', 'h-11', 'w-11', 'md:h-8', 'md:w-8', 'mobile-touch', 'mobile-size-locked', 'border-white/60', 'backdrop-blur', 'focus-visible:ring-white', 'justify-center']) expect(button.classList.contains(token)).toBe(true);
      expect(button.textContent).toBe('');
      // 图标按钮悬停即显示名称，不再依赖浏览器延迟出现的 title。
      expect(button.getAttribute('data-tip')).toBeTruthy();
      expect(button.hasAttribute('title')).toBe(false);
    }
    expect(manageButton.classList.contains('!bg-gray-900/85')).toBe(true);
    expect(manageButton.querySelector('svg.lucide-image-minus')).toBeTruthy();
    expect(manageButton.getAttribute('data-tip')).toContain('历史页保留');
    expect(manageButton.getAttribute('data-tip-side')).toBe('right');
    expect(coverButton.classList.contains('!bg-indigo-600/90')).toBe(true);
    expect(coverButton.querySelector('svg.lucide-image')).toBeTruthy();
    expect(coverButton.querySelector('svg.lucide-check')).toBeTruthy();
    expect(coverButton.getAttribute('data-tip')).toBe('设为封面并保存');
    expect(coverButton.hasAttribute('aria-haspopup')).toBe(false);
    expect(manageButton.getAttribute('aria-haspopup')).toBe('menu');
    expect(manageButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(manageButton);
    expect(manageButton.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: '管理预览图片' });
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['移除当前图片', '清空当前历史组']);
    expect(within(menu).getByRole('menuitem', { name: '移除当前图片' }).classList.contains('text-red-300')).toBe(true);
    expect(menu.textContent).toContain('历史页仍会保留');
    fireEvent.click(within(menu).getByRole('menuitem', { name: '移除当前图片' }));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(manageButton);
    fireEvent.click(screen.getByRole('menuitem', { name: '清空当前历史组' }));
    fireEvent.click(manageButton);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(manageButton);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(coverButton);
    expect(remove.mock.calls).toEqual([[]]);
    expect(clear.mock.calls).toEqual([[]]);
    expect(cover).toHaveBeenCalledOnce();
    if (fullscreen) {
      expect(backButtonRef.current).toBe(screen.getByRole('button', { name: '返回小图' }));
      expect(backButtonRef.current?.querySelector('svg.lucide-arrow-left')).toBeTruthy();
      expect(backButtonRef.current?.classList.contains('!h-12')).toBe(true);
      expect(backButtonRef.current?.classList.contains('rounded-full')).toBe(true);
      expect(backButtonRef.current?.classList.contains('border-white/60')).toBe(true);
      expect(left.classList.contains('pointer-events-none')).toBe(true);
      expect(backButtonRef.current?.classList.contains('pointer-events-auto')).toBe(true);
      expect(backButtonRef.current?.classList.contains('!w-12')).toBe(true);
      expect(backButtonRef.current?.querySelector('svg')?.classList.contains('h-7')).toBe(true);
      fireEvent.click(backButtonRef.current!);
      expect(back).toHaveBeenCalledOnce();
    } else expect(screen.queryByRole('button', { name: '返回小图' })).toBeNull();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('编辑模式、封面图与无图状态保留各自权限，没有历史项不提供移除或清空', () => {
    const view = render(React.createElement(ImagePreviewActions, { imageUrl: '/edit.png', filename: 'NAI.png', onBack: vi.fn() }));
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['返回小图', '收藏', '下载图片', '复制图片']);
    expect(screen.queryByRole('button', { name: '设为封面' })).toBeNull();
    view.rerender(React.createElement(ImagePreviewActions, { imageUrl: null, filename: 'NAI.png' }));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it.each([false, true])('全屏=%s：设封面与上传封面合为一个封面按钮，两项都可用时展开选择，处理中尺寸与名称稳定且禁止重复操作', fullscreen => {
    const upload = vi.fn();
    const setCover = vi.fn();
    const props = { imageUrl: '/image.png', filename: 'NAI.png', onSetCover: setCover, onUploadCover: upload, onBack: fullscreen ? vi.fn() : undefined };
    const view = render(React.createElement(ImagePreviewActions, props));
    expect(screen.queryByRole('button', { name: '手动上传封面' })).toBeNull();
    const button = screen.getByRole('button', { name: '设置封面' });
    const group = button.closest<HTMLElement>('[data-card-action]')!;
    expect(group.classList.contains('top-4')).toBe(true);
    expect(group.classList.contains('right-4')).toBe(true);
    for (const token of ['rounded-full', 'h-11', 'w-11', 'md:h-8', 'md:w-8', 'mobile-touch', 'border-white/60', '!bg-indigo-600/90']) expect(button.classList.contains(token)).toBe(true);
    expect(button.getAttribute('data-tip')).toBe('设置封面：当前图片或从电脑上传');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    const originalClasses = button.className;
    const input = group.querySelector('input')!;
    const choose = vi.spyOn(input, 'click');
    fireEvent.click(button);
    expect(within(screen.getByRole('menu', { name: '设置封面' })).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['设为当前图片', '从电脑上传']);
    fireEvent.click(screen.getByRole('menuitem', { name: '从电脑上传' }));
    expect(choose).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { files: [new File(['test'], 'cover.png', { type: 'image/png' })] } });
    expect(upload).toHaveBeenCalledOnce();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: '设为当前图片' }));
    expect(setCover).toHaveBeenCalledOnce();
    view.rerender(React.createElement(ImagePreviewActions, { ...props, isUploading: true }));
    const busy = screen.getByRole('button', { name: '设置封面' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.getAttribute('data-tip')).toBe('封面处理中…');
    expect(busy.querySelector('svg.animate-spin')).toBeTruthy();
    expect(busy.className).toBe(originalClasses);
    fireEvent.click(busy);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(choose).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '复制图片' }).hasAttribute('disabled')).toBe(false);
  });

  it('只有上传可用时（还没有生成图）直接打开文件选择，不展开菜单', () => {
    const upload = vi.fn();
    render(React.createElement(ImagePreviewActions, { imageUrl: null, filename: 'NAI.png', onUploadCover: upload }));
    const button = screen.getByRole('button', { name: '手动上传封面' });
    expect(button.querySelector('svg.lucide-upload')).toBeTruthy();
    expect(button.getAttribute('data-tip')).toBe('手动上传封面并保存');
    expect(button.hasAttribute('aria-haspopup')).toBe(false);
    const choose = vi.spyOn(button.closest('[data-card-action]')!.querySelector('input')!, 'click');
    fireEvent.click(button);
    expect(choose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('button', { name: '收藏' })).toBeNull();
  });
});

// 收藏服务的持久化与并发在 services 定向测试中验证，这里隔离页面副作用。
vi.mock('../../services/collectionFavorites', async original => ({
  ...await original<typeof import('../../services/collectionFavorites')>(),
  ensureCollection: vi.fn(async () => {}), loadCollection: vi.fn(async () => []),
  subscribeCollection: () => () => {}, collectionRevision: () => 0, collectionTargetActive: () => false,
  toggleCollectionTarget: vi.fn(async () => true), syncHistoryCollectionFavorites: vi.fn(async () => {}),
}));
