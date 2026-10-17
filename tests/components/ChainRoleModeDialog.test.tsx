// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChainRoleModeDialog } from '../../components/chain/ChainRoleModeDialog';
import { comparisonChainFixture } from '../fixtures/chainComparison';
import { emptyRoleModeConfig } from '../../services/chainRoleModeModel';
const mock = vi.hoisted(() => ({ state: null as any, config: vi.fn(), review: vi.fn() }));
vi.mock('../../services/chainRoleMode', async original => ({ ...await original<typeof import('../../services/chainRoleMode')>(), loadRoleModeState: async () => mock.state, saveRoleModeConfig: mock.config, saveRoleModeReview: mock.review }));
vi.mock('../../components/ImagePreviewPortal', () => ({ ImagePreviewPortal: ({ children }: React.PropsWithChildren) => <>{children}</> }));
vi.mock('../../components/MobileUI', () => ({ useMobileHistoryLayer: () => {} }));
beforeEach(() => { mock.state = { config: emptyRoleModeConfig(), copies: [] }; mock.config.mockReset().mockResolvedValue({}); mock.review.mockReset().mockResolvedValue({}); });
afterEach(cleanup);
it('紧凑角色弹窗只保存公共正负词，不建立名单或触发生图', async () => {
  const onClose = vi.fn(), onSaved = vi.fn();
  render(<ChainRoleModeDialog onClose={onClose} onSaved={onSaved} onOpenEditor={vi.fn()} notify={vi.fn()} />);
  const positive = await screen.findByLabelText('统一角色正面词'); fireEvent.change(positive, { target: { value: 'new character' } });
  fireEvent.change(screen.getByLabelText('统一角色负面词'), { target: { value: 'bad face' } }); fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mock.config).toHaveBeenCalledWith(expect.objectContaining({ characters: [expect.objectContaining({ prompt: 'new character', negativePrompt: 'bad face' })] })));
  expect(onSaved).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1); expect(mock.review).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: '生成本轮' })).toBeNull();
});
it('公共角色词清空后仍可手动保存空配置', async () => {
  const onClose = vi.fn(), onSaved = vi.fn();
  render(<ChainRoleModeDialog onClose={onClose} onSaved={onSaved} onOpenEditor={vi.fn()} notify={vi.fn()} />);
  await screen.findByLabelText('统一角色正面词');
  const save = screen.getByRole('button', { name: '保存' });
  expect((save as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(save);
  await waitFor(() => expect(mock.config).toHaveBeenCalledWith(expect.objectContaining({ characters: [expect.objectContaining({ prompt: '', negativePrompt: '' })] })));
  expect(onSaved).toHaveBeenCalledTimes(1); expect(onClose).toHaveBeenCalledTimes(1);
});
it('单卡就近把同字段角色词拆出并保留权重，助手入口仍进入原工作台且不自动保存', async () => {
  const source = comparisonChainFixture(), onOpenEditor = vi.fn(), onClose = vi.fn();
  const view = render(<ChainRoleModeDialog source={source} onClose={onClose} onOpenEditor={onOpenEditor} notify={vi.fn()} />);
  const token = await screen.findByRole('button', { name: '1girl' }); fireEvent.click(token);
  const dialog = screen.getByRole('dialog', { name: '拆分角色混合词' });
  expect((within(dialog).getAllByLabelText('保留风格')[0] as HTMLTextAreaElement).value).toBe('{{artist:alpha}}, side view');
  expect((within(dialog).getAllByLabelText('替换的原角色')[0] as HTMLTextAreaElement).value).toBe('{{1girl}}');
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(mock.review).toHaveBeenCalledWith(expect.objectContaining({ sourceId: source.id, fields: expect.arrayContaining([expect.objectContaining({ replaced: '{{1girl}}', reviewed: false })]) })));
  view.unmount(); mock.review.mockClear();
  render(<ChainRoleModeDialog source={source} onClose={onClose} onOpenEditor={onOpenEditor} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '在工作台用助手整理' }));
  expect(onOpenEditor).toHaveBeenCalledWith(source); expect(mock.review).not.toHaveBeenCalled();
});
