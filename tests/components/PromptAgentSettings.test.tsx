// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { PromptAgentSettings } from '../../components/PromptAgentSettings';

vi.mock('../../components/MobileUI', () => ({ useMobileHistoryLayer: (_open: boolean, close: () => void) => close }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('设置只加载模型与 API，保留生图协作，不再请求或展示注入预设', async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/config')) return Response.json({ provider: '', model: '', configured: false, configuredProviders: [], backendVersion: 'synthetic', sourceVersion: 'synthetic' });
    if (url.endsWith('/available-models') || url.endsWith('/custom-providers')) return Response.json({ items: [] });
    throw new Error(`不应调用的接口：${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const notify = vi.fn();
  render(<ConfirmDialogProvider><PromptAgentSettings notify={notify} /></ConfirmDialogProvider>);
  expect(await screen.findByText('尚未配置模型服务')).toBeTruthy();
  expect(screen.getByRole('region', { name: '生图协作' })).toBeTruthy();
  expect(screen.queryByText(/注入|预设管理/)).toBeNull();
  expect(fetch.mock.calls.some(([url]) => String(url).includes('creative-presets'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '连接 API' }));
  expect(screen.getByRole('dialog', { name: '连接 API' })).toBeTruthy();
  expect(screen.getByLabelText('API 地址')).toBeTruthy();
  expect(notify).not.toHaveBeenCalledWith('读取 AI 模型服务失败', 'error');
});

it('破限模式读取服务端默认状态与规则，保存失败保留开关，重试成功后再次打开仍使用保存值', async () => {
  let enabled = true, attempts = 0;
  const updates: unknown[] = [];
  const config = () => ({ provider: '', model: '', configured: false, configuredProviders: [], backendVersion: 'synthetic', sourceVersion: 'synthetic', creativeDirect: enabled, creativeDirectRules: 'synthetic direct rules' });
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config')) return Response.json(config());
    if (url.endsWith('/available-models') || url.endsWith('/custom-providers')) return Response.json({ items: [] });
    if (url.endsWith('/library-prompts')) return Response.json({ spec: '', extra: '' });
    if (url.endsWith('/creative-direct')) {
      expect(init?.method).toBe('PUT'); updates.push(JSON.parse(String(init?.body)));
      if (++attempts === 1) return Response.json({ error: 'synthetic save failure' }, { status: 500 });
      enabled = JSON.parse(String(init?.body)).enabled;
      return Response.json(config());
    }
    throw new Error(`不应调用的接口：${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  const notify = vi.fn();
  const mount = () => render(<ConfirmDialogProvider><PromptAgentSettings notify={notify} /></ConfirmDialogProvider>);
  mount();
  const toggle = screen.getByRole('checkbox', { name: '破限模式' }) as HTMLInputElement;
  await waitFor(() => expect(toggle.checked).toBe(true));
  expect(screen.getByText('synthetic direct rules')).toBeTruthy();
  fireEvent.click(toggle);
  await waitFor(() => expect(notify).toHaveBeenCalledWith('synthetic save failure', 'error'));
  expect(toggle.checked).toBe(true);
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.checked).toBe(false));
  expect(updates).toEqual([{ enabled: false }, { enabled: false }]);
  cleanup(); mount();
  await waitFor(() => expect((screen.getByRole('checkbox', { name: '破限模式' }) as HTMLInputElement).disabled).toBe(false));
  expect((screen.getByRole('checkbox', { name: '破限模式' }) as HTMLInputElement).checked).toBe(false);
});
