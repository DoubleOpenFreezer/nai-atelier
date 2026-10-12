// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DataBackupManager } from '../../components/DataBackupManager';

const mocks = vi.hoisted(() => ({
  storageStatus: vi.fn(), pickDirectory: vi.fn(), backupStatus: vi.fn(), saveConfig: vi.fn(),
}));

vi.mock('../../services/storageLocations', () => ({
  getStorageLocationStatus: mocks.storageStatus,
  pickStorageDirectory: mocks.pickDirectory,
}));
vi.mock('../../services/localBackup', () => ({
  getLocalBackupStatus: mocks.backupStatus,
  saveLocalBackupConfig: mocks.saveConfig,
  formatBackupDate: () => 'date', formatBytes: () => '0 B',
  openLocalBackupFolder: vi.fn(), startLocalBackup: vi.fn(), deleteLocalBackup: vi.fn(),
}));

const backupStatus = {
  running: false, phase: 'idle', startedAt: null, finishedAt: null, error: null,
  progress: { copiedFiles: 0, totalFiles: 0, copiedBytes: 0, totalBytes: 0, currentItem: '', percent: 0 },
  targetDir: 'C:\\Backups', targetDirExists: false, sourceDir: 'local-data',
  sourceStats: { fileCount: 0, totalBytes: 0 }, currentBackup: null, lastBackup: null, backups: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.storageStatus.mockResolvedValue({ canManage: true });
  mocks.pickDirectory.mockResolvedValue({ cancelled: true, path: '' });
  mocks.backupStatus.mockResolvedValue(backupStatus);
  mocks.saveConfig.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

const openTargetEditor = async () => {
  render(<DataBackupManager notify={vi.fn()} />);
  await waitFor(() => expect(mocks.backupStatus).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '修改路径' }));
  return screen.getByRole('textbox', { name: '备份目标目录' }) as HTMLInputElement;
};

it('本机可浏览目录；取消选择保留编辑路径且不会保存', async () => {
  const input = await openTargetEditor();
  fireEvent.change(input, { target: { value: 'D:\\Typed backups' } });
  expect(screen.getByRole('button', { name: '浏览文件夹' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '浏览文件夹' }));
  await waitFor(() => expect(mocks.pickDirectory).toHaveBeenCalledWith('backup'));
  expect(input.value).toBe('D:\\Typed backups');
  expect(mocks.saveConfig).not.toHaveBeenCalled();
});

it('本机选择目录后填入输入框，并可通过现有保存按钮保存该路径', async () => {
  mocks.pickDirectory.mockResolvedValue({ cancelled: false, path: 'E:\\Selected backup' });
  const input = await openTargetEditor();
  fireEvent.click(screen.getByRole('button', { name: '浏览文件夹' }));
  await waitFor(() => expect(input.value).toBe('E:\\Selected backup'));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalledWith({ targetDir: 'E:\\Selected backup' }));
});

it('目录选择进行中显示选择状态并禁用按钮', async () => {
  let finishPick!: (value: { cancelled: boolean; path: string }) => void;
  mocks.pickDirectory.mockReturnValue(new Promise(resolve => { finishPick = resolve; }));
  await openTargetEditor();
  const browseButton = screen.getByRole('button', { name: '浏览文件夹' });
  fireEvent.click(browseButton);
  expect((screen.getByRole('button', { name: '选择中…' }) as HTMLButtonElement).disabled).toBe(true);
  finishPick({ cancelled: true, path: '' });
  await waitFor(() => expect((screen.getByRole('button', { name: '浏览文件夹' }) as HTMLButtonElement).disabled).toBe(false));
});

it('LAN 只显示手动路径编辑，不提供本机目录浏览', async () => {
  mocks.storageStatus.mockResolvedValue({ canManage: false });
  await openTargetEditor();
  expect(screen.queryByRole('button', { name: '浏览文件夹' })).toBeNull();
  expect(mocks.pickDirectory).not.toHaveBeenCalled();
});

it('备份卡片窄屏为可收缩单列，长路径不扩大整列宽度', async () => {
  mocks.backupStatus.mockResolvedValue({ ...backupStatus, targetDir: `D:\\${'很长的备份文件夹\\'.repeat(12)}` });
  render(<DataBackupManager notify={vi.fn()} />);
  const sourceCard = screen.getByText('当前本地源数据 (local-data)').closest('div.rounded-xl')!;
  const grid = sourceCard.parentElement!;
  expect(grid.classList.contains('grid-cols-1')).toBe(true);
  expect(grid.classList.contains('sm:grid-cols-2')).toBe(true);
  expect([...grid.children].every(card => card.classList.contains('min-w-0'))).toBe(true);
});
