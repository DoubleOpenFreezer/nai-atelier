// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptLibraryPicker } from '../../components/PromptLibraryPicker';
import { db } from '../../services/dbService';

vi.mock('../../services/dbService', () => ({ db: { getAllChains: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('只读取当前分类，选择返回英文片段并收起共用弹层，重开读取最新条目', async () => {
  const onPick = vi.fn();
  vi.mocked(db.getAllChains).mockResolvedValue([
    { id: 'a', name: '形象', type: 'appearance', basePrompt: 'silver_hair' },
    { id: 'w', name: '蓝裙', type: 'wardrobe', basePrompt: 'blue_dress' },
  ] as any);
  render(<PromptLibraryPicker kind="wardrobe" onPick={onPick} />);
  expect(db.getAllChains).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '库导入' }));
  fireEvent.click(await screen.findByRole('button', { name: '蓝裙 blue_dress' }));
  expect(onPick).toHaveBeenCalledWith('blue_dress'); expect(screen.queryByRole('dialog')).toBeNull();
  vi.mocked(db.getAllChains).mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole('button', { name: '库导入' }));
  await screen.findByText('这个提示词库还是空的');
  expect(db.getAllChains).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('读取失败明确显示错误并允许重试，不把错误伪装为空库', async () => {
  vi.mocked(db.getAllChains).mockRejectedValueOnce(new Error('synthetic failure'));
  render(<PromptLibraryPicker kind="scene" onPick={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '库导入' }));
  expect((await screen.findByRole('alert')).textContent).toContain('读取提示词库失败');
  expect(screen.queryByText('这个提示词库还是空的')).toBeNull();
  vi.mocked(db.getAllChains).mockResolvedValueOnce([]);
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await screen.findByText('这个提示词库还是空的');
});

it('提供 onPickEntry 时只走该回调，来源不会被第二次回调覆盖', async () => {
  const onPick = vi.fn();
  const onPickEntry = vi.fn();
  vi.mocked(db.getAllChains).mockResolvedValue([
    { id: 'w1', name: '蓝裙', type: 'wardrobe', basePrompt: 'blue_dress' },
  ] as any);
  render(<PromptLibraryPicker kind="wardrobe" current="blonde_hair" onPick={onPick} onPickEntry={onPickEntry} />);
  fireEvent.click(screen.getByRole('button', { name: '库导入' }));
  fireEvent.click(await screen.findByRole('button', { name: /蓝裙/ }));
  expect(onPick).not.toHaveBeenCalled();
  expect(onPickEntry).toHaveBeenCalledTimes(1);
  const payload = onPickEntry.mock.calls[0][0];
  expect(payload.entryId).toBe('w1');
  expect(payload.entryName).toBe('蓝裙');
  expect(payload.mode).toBe('append');
  expect(payload.prompt).toBe('blonde_hair, blue_dress');
});
