// @vitest-environment jsdom
import React, { useRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRestoreListAnchor } from '../../components/useRestoreListAnchor';

const Harness: React.FC<{ targetId?: string; readyKey?: number; resetKey?: string; showTarget?: boolean }> = ({ targetId, readyKey, resetKey, showTarget = true }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  useRestoreListAnchor(scrollRef, targetId, readyKey, resetKey);
  return React.createElement('div', { ref: scrollRef, 'data-testid': 'root' },
    showTarget && React.createElement('article', { 'data-return-item-id': 'chain-1' }));
};

afterEach(() => cleanup());

describe('useRestoreListAnchor', () => {
  it('主动清筛选消费尚未出现的旧目标，异步出现也不拉回；新的详情返回仍定位', () => {
    const { getByTestId, container, rerender } = render(React.createElement(Harness, { targetId: 'chain-1', resetKey: 'favorites', showTarget: false }));
    const root = getByTestId('root');
    root.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 } as DOMRect);
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 1500, bottom: 1700, height: 200 } as DOMRect);
    root.scrollTop = 0;
    rerender(React.createElement(Harness, { targetId: 'chain-1', resetKey: 'all', showTarget: false }));
    rerender(React.createElement(Harness, { targetId: 'chain-1', resetKey: 'all', readyKey: 1 }));
    expect(container.querySelector('[data-return-item-id="chain-1"]')).not.toBeNull();
    expect(root.scrollTop).toBe(0);
    rerender(React.createElement(Harness, { resetKey: 'all' }));
    rerender(React.createElement(Harness, { targetId: 'chain-1', resetKey: 'all' }));
    expect(root.scrollTop).toBe(1350);
    rect.mockRestore();
  });
  it('目标仍在原视口内时保持现有滚动位置', () => {
    const { getByTestId, container, rerender } = render(React.createElement(Harness));
    const root = getByTestId('root');
    const target = container.querySelector<HTMLElement>('[data-return-item-id="chain-1"]')!;
    root.getBoundingClientRect = () => ({ top: 0, bottom: 500 } as DOMRect);
    target.getBoundingClientRect = () => ({ top: 100, bottom: 300 } as DOMRect);

    rerender(React.createElement(Harness, { targetId: 'chain-1' }));
    expect(root.scrollTop).toBe(0);
  });

  it('目标仍有部分在原视口内时不会强制居中', () => {
    const { getByTestId, container, rerender } = render(React.createElement(Harness));
    const root = getByTestId('root');
    const target = container.querySelector<HTMLElement>('[data-return-item-id="chain-1"]')!;
    root.getBoundingClientRect = () => ({ top: 0, bottom: 500 } as DOMRect);
    target.getBoundingClientRect = () => ({ top: 450, bottom: 650 } as DOMRect);

    rerender(React.createElement(Harness, { targetId: 'chain-1' }));
    expect(root.scrollTop).toBe(0);
  });

  it('排序变化导致目标离开视口时将卡片居中，并允许下次返回再次定位', () => {
    const { getByTestId, container, rerender } = render(React.createElement(Harness));
    const root = getByTestId('root');
    const target = container.querySelector<HTMLElement>('[data-return-item-id="chain-1"]')!;
    root.scrollTop = 40;
    root.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 } as DOMRect);
    target.getBoundingClientRect = () => ({ top: 700, bottom: 900, height: 200 } as DOMRect);

    rerender(React.createElement(Harness, { targetId: 'chain-1', readyKey: 1 }));
    expect(root.scrollTop).toBe(590);

    rerender(React.createElement(Harness));
    root.scrollTop = 20;
    rerender(React.createElement(Harness, { targetId: 'chain-1', readyKey: 2 }));
    expect(root.scrollTop).toBe(570);
  });
});
