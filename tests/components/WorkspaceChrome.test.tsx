// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceChrome } from '../../components/DesignSystem';

let height = 72;
const callbacks = new Set<() => void>();
const disconnect = vi.fn();
beforeEach(() => {
  height = 72;
  callbacks.clear();
  disconnect.mockClear();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('workspace-chrome') ? height : 0;
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) { callbacks.add(callback); }
    observe() {}
    disconnect() { callbacks.delete(this.callback); disconnect(); }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('首屏与状态行换行使用同一实际高度，隐藏缓存页不会清空高度', () => {
  const { getByTestId } = render(<div data-testid="host"><WorkspaceChrome><header>工具栏</header><p>状态行</p></WorkspaceChrome><main>作品</main></div>);
  const host = getByTestId('host');
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('72px');
  height = 116;
  act(() => callbacks.forEach(callback => callback()));
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('116px');
  height = 0;
  act(() => callbacks.forEach(callback => callback()));
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('116px');
  height = 80;
  act(() => callbacks.forEach(callback => callback()));
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('80px');
});

it('卸载清理观察器并恢复宿主已有的高度值', () => {
  const style = { '--workspace-chrome-height': '40px' } as React.CSSProperties;
  const { getByTestId, rerender } = render(<div data-testid="host" style={style}><WorkspaceChrome><header>顶栏</header></WorkspaceChrome></div>);
  const host = getByTestId('host');
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('72px');
  rerender(<div data-testid="host" style={style} />);
  expect(host.style.getPropertyValue('--workspace-chrome-height')).toBe('40px');
  expect(disconnect).toHaveBeenCalledOnce();
});
