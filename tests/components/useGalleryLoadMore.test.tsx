// @vitest-environment jsdom
import React, { useRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGalleryLoadMore } from '../../components/useGalleryLoadMore';

class EndObserver {
  static instances: EndObserver[] = [];
  targets: Element[] = [];
  disconnected = false;
  constructor(private callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) { EndObserver.instances.push(this); }
  observe(target: Element) { this.targets.push(target); this.disconnected = false; }
  disconnect() { this.targets = []; this.disconnected = true; }
  intersect(states: boolean[]) {
    this.callback(this.targets.map((target, index) => ({ target, isIntersecting: states[index] ?? false } as IntersectionObserverEntry)), this as unknown as IntersectionObserver);
  }
}

const List = ({ loadMore, enabled = true, grid = false, pendingWidth = false, groups = 1 }: {
  loadMore: () => void; enabled?: boolean; grid?: boolean; pendingWidth?: boolean; groups?: number;
}) => {
  const root = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useGalleryLoadMore(root, sentinel, enabled, loadMore, '600px 0px');
  return <div ref={root} data-testid="scroll">
    {grid ? <div className="workspace-card-grid" /> : Array.from({ length: groups }, (_, group) => <div className="chain-masonry" key={group}>
      {!pendingWidth && Array.from({ length: 5 }, (_, column) => <div className="chain-masonry-column" key={column}>
        <article>{group}-{column}</article><div data-masonry-load-end="true" data-group={group} />
      </div>)}
    </div>)}
    <div ref={sentinel} data-testid="bottom" />
  </div>;
};

beforeEach(() => { EndObserver.instances = []; vi.stubGlobal('IntersectionObserver', EndObserver); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('最短列先到预取区域时追加，不等待最长列；同一轮多个列与DOM变化只请求一次', async () => {
  const loadMore = vi.fn();
  const { container } = render(<List loadMore={loadMore} />);
  const observer = EndObserver.instances[0];
  expect(observer.targets).toEqual([...container.querySelectorAll('[data-masonry-load-end]')]);
  expect(observer.targets).not.toContain(container.querySelector('[data-testid="bottom"]'));
  expect(observer.options).toEqual({ root: container.firstElementChild, rootMargin: '600px 0px' });
  act(() => observer.intersect([false, true, false, true, false]));
  expect(loadMore).toHaveBeenCalledTimes(1);
  container.querySelector('article')!.append(document.createElement('span'));
  await waitFor(() => expect(observer.targets).toHaveLength(5));
  act(() => observer.intersect([true, true, true, true, true]));
  expect(loadMore).toHaveBeenCalledTimes(1);
});

it('首帧未测列宽时等待真实列尾，几何节点出现后自动接入观察', async () => {
  const loadMore = vi.fn();
  const { container, rerender } = render(<List loadMore={loadMore} pendingWidth />);
  const observer = EndObserver.instances[0];
  expect(observer.targets).toEqual([]);
  rerender(<List loadMore={loadMore} />);
  await waitFor(() => expect(observer.targets).toEqual([...container.querySelectorAll('[data-masonry-load-end]')]));
  act(() => observer.intersect([false, false, true]));
  expect(loadMore).toHaveBeenCalledTimes(1);
});

it('分组列表只观察最后一组，避免前面日期组末尾可见时连续追加', () => {
  render(<List loadMore={vi.fn()} groups={2} />);
  expect(EndObserver.instances[0].targets).toHaveLength(5);
  expect(EndObserver.instances[0].targets.every(target => target.getAttribute('data-group') === '1')).toBe(true);
});

it('普通网格继续用原底部哨兵，loading或无更多时停止，下批就绪再启用', () => {
  const loadMore = vi.fn();
  const { container, rerender } = render(<List loadMore={loadMore} grid />);
  const original = EndObserver.instances[0];
  expect(original.targets).toEqual([container.querySelector('[data-testid="bottom"]')]);
  act(() => original.intersect([true]));
  rerender(<List loadMore={loadMore} grid enabled={false} />);
  expect(original.disconnected).toBe(true);
  expect(EndObserver.instances).toHaveLength(1);
  rerender(<List loadMore={loadMore} grid />);
  act(() => EndObserver.instances[1].intersect([true]));
  expect(loadMore).toHaveBeenCalledTimes(2);
});

it('没有IntersectionObserver时保留页面的手动更多入口且不启动观察', () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  // 旧浏览器通常不存在这个属性，而不是存在但值为undefined。
  delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  render(<List loadMore={vi.fn()} />);
  expect(EndObserver.instances).toHaveLength(0);
});
