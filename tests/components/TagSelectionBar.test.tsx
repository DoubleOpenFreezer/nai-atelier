// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TagSelectionBar } from '../../components/TagSelectionBar';

afterEach(cleanup);

it('手机选择栏脱离工作区隔离层，并抬到底部导航之上', async () => {
  const view = render(<TagSelectionBar count={2} unit="位画师" onClear={() => {}} onCopy={() => {}} onImport={() => {}} />);
  const label = await screen.findByText('已选 2 位画师');
  const fixed = label.closest('[class*="fixed"]') as HTMLElement | null;
  expect(fixed).not.toBeNull();
  expect(fixed?.className).toContain('bottom-[calc(4.25rem+env(safe-area-inset-bottom)+0.75rem)]');
  expect(fixed?.className).toContain('md:bottom-6');
  expect(fixed?.className).toContain('z-[60]');
  expect(view.container.contains(fixed)).toBe(false);
});
