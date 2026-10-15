// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtistSampleSettingsDialog } from '../../components/ArtistSampleSettingsDialog';
import type { ArtistSampleTemplate } from '../../services/artistSamples';

const mocks = vi.hoisted(() => ({
  data: vi.fn(), save: vi.fn(), defaults: vi.fn(), build: vi.fn(), models: vi.fn(), chains: vi.fn(),
}));
vi.mock('../../services/artistSampleDrafts', () => ({
  getArtistSampleData: mocks.data, saveArtistSampleTemplate: mocks.save,
  getDefaultArtistSampleTemplate: mocks.defaults, buildArtistSampleTemplateFromChain: mocks.build,
}));
vi.mock('../../services/naiRuntime', () => ({ getNaiRuntimeConfig: mocks.models }));
vi.mock('../../services/naiModels', () => ({
  NAI_MODELS: [
    { id: 'nai-diffusion-4-5-full', label: 'V4.5 Full' }, { id: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated' },
    { id: 'nai-diffusion-5-full', label: 'V5 Full' }, { id: 'nai-diffusion-5-curated', label: 'V5 Curated' },
  ], isNaiMediumModel: (model?: string) => /medium/.test(model || ''),
}));
vi.mock('../../services/dbService', () => ({ db: { getAllChains: mocks.chains } }));
vi.mock('../../services/platform', () => ({ isAndroidApp: () => false }));

const template: ArtistSampleTemplate = { prompt: '{artist}, portrait', negativePrompt: '', params: { model: 'nai-diffusion-4-5-full', width: 832, height: 1216, steps: 28, scale: 6, sampler: 'k_euler_ancestral', seed: 0 } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.data.mockResolvedValue({ templates: { v45: template }, samples: [] });
  mocks.defaults.mockReturnValue(template);
  mocks.save.mockResolvedValue(undefined);
  mocks.models.mockResolvedValue({ models: ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated', 'nai-diffusion-5-full', 'nai-diffusion-5-curated', 'nai-diffusion-5-full-medium'] });
  mocks.chains.mockResolvedValue([]);
});
afterEach(cleanup);

it.each(['v45', 'v5'] as const)('补图配置按%s加载、保存，提交后由调用方进入实验室', async pack => {
  const model = pack === 'v45' ? 'nai-diffusion-4-5-full' : 'nai-diffusion-5-full';
  mocks.data.mockResolvedValue({ templates: {}, samples: [] });
  mocks.defaults.mockReturnValue({ ...template, params: { ...template.params, model } });
  const saved = vi.fn(), close = vi.fn();
  render(<ArtistSampleSettingsDialog tag="synthetic artist" pack={pack} enterAfterSave onSaved={saved} onClose={close} />);
  await screen.findByLabelText('正向提示词');
  await waitFor(() => expect((screen.getByRole('button', { name: '保存并进入实验室' }) as HTMLButtonElement).disabled).toBe(false));
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '保存并进入实验室' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ model }) })));
  expect(mocks.save).toHaveBeenCalledWith(pack, expect.objectContaining({ params: expect.objectContaining({ model }) }));
  expect(close).not.toHaveBeenCalled();
});

it('读取失败留窗重试，保存失败保留编辑并可取消', async () => {
  mocks.data.mockRejectedValueOnce(new Error('读取失败'));
  const saved = vi.fn(), close = vi.fn();
  render(<ArtistSampleSettingsDialog tag="artist" pack="v45" enterAfterSave={false} onSaved={saved} onClose={close} />);
  await screen.findByText('读取失败');
  expect(mocks.defaults).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重试读取配置' }));
  await screen.findByLabelText('正向提示词');
  await waitFor(() => expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('正向提示词'), { target: { value: 'changed, {artist}' } });
  mocks.save.mockRejectedValueOnce(new Error('写入失败'));
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText('写入失败');
  expect((screen.getByLabelText('正向提示词') as HTMLTextAreaElement).value).toBe('changed, {artist}');
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(close).toHaveBeenCalledOnce();
});

it('已有模板修改仅保存，字段布局适配窄屏，不提交生图', async () => {
  const saved = vi.fn();
  const view = render(<ArtistSampleSettingsDialog tag="artist" pack="v45" enterAfterSave={false} onSaved={saved} onClose={vi.fn()} />);
  await screen.findByLabelText('正向提示词');
  await waitFor(() => expect((screen.getByRole('button', { name: '保存配置' }) as HTMLButtonElement).disabled).toBe(false));
  expect(view.container.ownerDocument.querySelector('.grid-cols-2')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '保存并进入实验室' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(template));
});
