// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppearancePaletteEditor } from '../../components/AppearancePaletteEditor';

afterEach(cleanup);
describe('主题文字对比度提示', () => {
  it('正文清楚但次要文字或工作区底色不可读时，仍提示所属明暗配色', () => {
    render(<AppearancePaletteEditor palette={{ light: { text: '#000000', mutedText: '#eeeeee', panel: '#ffffff', canvas: '#000000' } }} onChange={vi.fn()} />);
    const light = screen.getByRole('group', { name: '浅色配色', hidden: true });
    expect(within(light).queryByText('正文与面板对比度较低，请调整配色')).toBeNull();
    expect(within(light).getByText('次要文字与面板对比度较低，请调整配色')).toBeTruthy();
    expect(within(light).getByText('文字与工作区背景对比度较低，请调整配色')).toBeTruthy();
  });
  it('明暗文字与面板、工作区都达到阈值时不报低对比度', () => {
    render(<AppearancePaletteEditor palette={{
      light: { text: '#000000', mutedText: '#555555', panel: '#ffffff', canvas: '#ffffff' },
      dark: { text: '#ffffff', mutedText: '#bbbbbb', panel: '#111111', canvas: '#111111' },
    }} onChange={vi.fn()} />);
    expect(screen.queryAllByRole('status', { hidden: true })).toHaveLength(0);
  });
});
