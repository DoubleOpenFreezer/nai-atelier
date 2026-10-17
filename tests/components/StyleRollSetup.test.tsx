// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rollFixture, candidateFixture } from '../fixtures/styleRoll';
import { StyleRollSetup } from '../../components/roll/StyleRollSetup';
import type { PromptChain } from '../../types';
import type { RollExperiment } from '../../services/styleRoll';
const mocks = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../../services/tagDictionary', async original => ({ ...await original<typeof import('../../services/tagDictionary')>(), searchArtistDictionary: mocks.search }));
vi.mock('../../components/ChainEditorParams', () => ({ ChainEditorParams: () => null }));
beforeEach(() => { vi.clearAllMocks(); mocks.search.mockResolvedValue([]); vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('加权风格串提取使用既有解析器，保留剩余权重组和完整角色负面词', async () => {
  const initial = rollFixture(); initial.revision = 0; initial.artists = [];
  const chain: PromptChain = { id: 'source', userId: 'u', type: 'style', name: '合成原串', description: '', tags: [], modules: [], createdAt: 1, updatedAt: 1,
    basePrompt: '1.2::artist:alpha, flowers ::, artist:beta, landscape', negativePrompt: 'negative', params: { ...initial.template.params, characters: [{ id: 'r', prompt: 'person', negativePrompt: 'sad', x: 0.2, y: 0.7 }] } };
  const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup initial={initial} chains={[chain]} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '生成配置' }));
  fireEvent.change(await screen.findByRole('combobox', { name: '载入生成配置' }), { target: { value: 'source' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const value = save.mock.calls[0][0]; expect(value.artists.map(artist => artist.tag)).toEqual(['alpha', 'beta']);
  expect(value.template.prompt).toContain('1.2::flowers ::'); expect(value.template.prompt).not.toContain('artist:'); expect(value.template.prompt.match(/\{style\}/g)).toHaveLength(1);
  expect(value.template.params.characters).toEqual(chain.params.characters); expect(value.template.negativePrompt).toBe('negative');
});
it('已有候选冻结生成配置，画师锁定及排除仍可保存且不改旧候选', async () => {
  const initial = rollFixture(); initial.candidates = [candidateFixture('a')]; const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup initial={initial} chains={[]} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('锁定／排除画师（可选）'));
  fireEvent.click(await screen.findByRole('checkbox', { name: '锁定画师：alpha' }));
  fireEvent.change(screen.getByRole('spinbutton', { name: '锁定权重：alpha' }), { target: { value: '1.7' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '排除画师：beta' }));
  fireEvent.click(screen.getByRole('button', { name: '生成配置' }));
  expect((screen.getByLabelText('公共提示词（{style} 为画风位置）') as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const value = save.mock.calls[0][0]; expect(value.artists[0]).toEqual(expect.objectContaining({ locked: true, weight: 1.7 })); expect(value.artists[1].excluded).toBe(true);
  expect(value.candidates).toEqual(initial.candidates); expect(value.template).toEqual(initial.template);
});
it('保存失败保留输入和窗口，空白 Seed 或无效规则不投递', async () => {
  const save = vi.fn(async () => { throw new Error('合成保存失败'); }), close = vi.fn();
  render(<StyleRollSetup initial={rollFixture()} chains={[]} enforceFreeStepLimit onSave={save} onClose={close} />);
  fireEvent.click(screen.getByText('锁定／排除画师（可选）'));
  fireEvent.change(await screen.findByLabelText('指定画师（逗号或换行分隔）'), { target: { value: 'new artist' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await screen.findByText('合成保存失败');
  expect(close).not.toHaveBeenCalled(); expect((screen.getByLabelText('指定画师（逗号或换行分隔）') as HTMLTextAreaElement).value).toBe('new artist');
  fireEvent.change(screen.getByLabelText('最少画师'), { target: { value: '0' } }); fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText('请检查画师数量和权重范围'); expect(save).toHaveBeenCalledOnce();
});
it('默认只需设置抽取数量，无需建画师池或从旧画师表导入', async () => {
  const initial = rollFixture(); initial.artists = []; const save = vi.fn(async (_value: RollExperiment) => {});
  render(<StyleRollSetup initial={initial} chains={[]} libraryCount={1205} enforceFreeStepLimit onSave={save} onClose={vi.fn()} />);
  expect(screen.getByText('从画师库自动抽取 · 1205 位画师')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '从已保存画师添加' })).toBeNull();
  fireEvent.change(screen.getByLabelText('最少画师'), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText('最多画师'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' })); await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].artists).toEqual([]); expect(save.mock.calls[0][0].rules).toMatchObject({ minArtists: 4, maxArtists: 4 });
});
