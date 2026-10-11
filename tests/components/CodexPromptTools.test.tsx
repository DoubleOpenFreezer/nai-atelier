// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CodexBootstrap, CodexEntry } from '../../services/codexService';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), auxiliary: vi.fn() }));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), lookupTagTranslations: mocks.lookup }));
vi.mock('../../services/codexService', async original => ({ ...await original<typeof import('../../services/codexService')>(), loadCodexAuxiliary: mocks.auxiliary }));
import { CodexPromptTools } from '../../components/CodexPromptTools';

const boot = { release: 'synthetic', books: [], media: {} } as unknown as CodexBootstrap;
const entry = { bookId: 'synthetic', id: 'one', prompt: 'blue_eyes' } as CodexEntry;
const view = (prompt: string) => <CodexPromptTools entry={{ ...entry, prompt }} boot={boot} onOpenEntry={() => {}} />;
const toggle = (open: boolean) => {
  const details = screen.getByText('中文词义').closest('details')!;
  details.open = open; fireEvent(details, new Event('toggle'));
  return details;
};
beforeEach(() => { mocks.lookup.mockReset(); mocks.auxiliary.mockReset().mockResolvedValue({}); });
afterEach(cleanup);

it('展开后原图替换提示词会刷新词义，旧请求迟到不覆盖新词义', async () => {
  let finish!: (value: Map<string, { chinese: string }>) => void;
  mocks.lookup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  mocks.lookup.mockResolvedValueOnce(new Map([['red hair', { chinese: '红发' }]]));
  const { rerender } = render(view(entry.prompt));
  expect(mocks.lookup).not.toHaveBeenCalled();
  const details = toggle(true);
  await waitFor(() => expect(mocks.lookup).toHaveBeenCalledOnce());
  rerender(view('red_hair'));
  expect(await screen.findByText('红发')).toBeTruthy(); expect(details.open).toBe(true);
  await act(async () => finish(new Map([['blue eyes', { chinese: '蓝眼' }]])));
  expect(screen.queryByText('蓝眼')).toBeNull(); expect(screen.getByText('红发')).toBeTruthy();
  toggle(false); toggle(true);
  expect(mocks.lookup).toHaveBeenCalledTimes(2);
});
it('已完成的词义缓存随提示词更换失效，全部来源失败可重试', async () => {
  mocks.lookup.mockResolvedValueOnce(new Map([['blue eyes', { chinese: '蓝眼' }]]));
  const { rerender } = render(view(entry.prompt)); toggle(true);
  await screen.findByText('蓝眼');
  mocks.lookup.mockRejectedValueOnce(new Error('offline'));
  mocks.auxiliary.mockRejectedValue(new Error('offline'));
  rerender(view('red_hair'));
  const retry = await screen.findByRole('button', { name: '词义读取失败，请重试' });
  expect(screen.queryByText('蓝眼')).toBeNull();
  mocks.lookup.mockResolvedValueOnce(new Map([['red hair', { chinese: '红发' }]]));
  fireEvent.click(retry);
  expect(await screen.findByText('红发')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '词义读取失败，请重试' })).toBeNull();
});
