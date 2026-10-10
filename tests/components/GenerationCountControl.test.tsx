// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GenerationCountControl } from '../../components/GenerationCountControl';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const state = { busy: true, completed: 2, total: 8, paused: false, pausing: false, waiting: [] };
const props = { count: 3, onCountChange: vi.fn(), series: null, onStop: vi.fn(), onQueue: vi.fn(), onGenerate: vi.fn(), costLabel: '90 Anlas' };
it.each([1280, 390])('%s 宽度间隔默认显示 2.0 秒，保留一位小数、失焦保存，可设 0，非法输入恢复且不触发生图', width => {
  vi.stubGlobal('innerWidth', width); const interval = vi.fn(), generate = vi.fn();
  const view = render(<GenerationCountControl {...props} onGenerate={generate} onIntervalChange={interval} queueState={state} />);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  fireEvent.click(document.querySelector('[data-generation-menu]')!);
  const input = screen.getByLabelText('生成间隔') as HTMLInputElement;
  expect(input.value).toBe('2.0'); expect(input.min).toBe('0'); expect(input.max).toBe('3600'); expect(input.step).toBe('0.1'); expect(input.inputMode).toBe('decimal');
  fireEvent.change(input, { target: { value: '0.5' } }); expect(interval).not.toHaveBeenCalled(); fireEvent.blur(input);
  expect(interval).toHaveBeenLastCalledWith(0.5); expect(input.value).toBe('0.5');
  view.rerender(<GenerationCountControl {...props} onIntervalChange={interval} intervalSeconds={4} queueState={state} />);
  fireEvent.change(input, { target: { value: '4' } }); fireEvent.blur(input); expect(input.value).toBe('4.0'); expect(interval).toHaveBeenCalledOnce();
  fireEvent.change(input, { target: { value: '0' } }); fireEvent.blur(input); expect(interval).toHaveBeenLastCalledWith(0);
  for (const value of ['', '-1', '0.55', '3601']) { fireEvent.change(input, { target: { value } }); fireEvent.blur(input); expect(input.value).toBe('4.0'); }
  expect(interval).toHaveBeenCalledTimes(2); expect(generate).not.toHaveBeenCalled();
  view.rerender(<GenerationCountControl {...props} onIntervalChange={interval} intervalSeconds={4} intervalPending queueState={state} />);
  expect(input.disabled).toBe(true);
  view.rerender(<GenerationCountControl {...props} onIntervalChange={interval} intervalSeconds={4} queueState={state} />);
  expect(input.value).toBe('4.0'); expect(input.disabled).toBe(false);
});
it('静止区只有两个按钮，显示整队进度、本批张数与总资源，主按钮直接发送', () => {
  const queue = vi.fn(); const view = render(<GenerationCountControl {...props} onQueue={queue} queueState={state} />);
  expect(screen.getAllByRole('button')).toHaveLength(2); expect(screen.getByText('2/8')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /加入队列.*3 张.*90 Anlas/ })); expect(queue).toHaveBeenCalledWith('end');
  view.rerender(<GenerationCountControl {...props} queueState={{ ...state, total: 11, completed: 3 }} />);
  expect(screen.getByText('3/11')).toBeTruthy(); expect(screen.queryByLabelText('生成张数')).toBeNull();
});
it('整队快照暂不可读时按后台已保存张数回退，不把完成数误减一', () => {
  const view = render(<GenerationCountControl {...props} series={{ current: 2, total: 3, stopping: false }} />);
  expect(screen.getByText('2/3')).toBeTruthy();
  view.rerender(<GenerationCountControl {...props} series={{ current: 3, total: 3, stopping: false }} />);
  expect(screen.getByText('3/3')).toBeTruthy();
});
it('暂停中不可重复点击，保存后变继续，队列暂停仍能添加', () => {
  const toggle = vi.fn(), queue = vi.fn();
  const view = render(<GenerationCountControl {...props} onQueue={queue} onTogglePause={toggle} queueState={state} />);
  fireEvent.click(screen.getByRole('button', { name: '暂停生成' })); expect(toggle).toHaveBeenCalledOnce();
  view.rerender(<GenerationCountControl {...props} onTogglePause={toggle} queueState={{ ...state, paused: true, pausing: true }} />);
  expect(screen.getByRole('button', { name: '暂停中…' })).toHaveProperty('disabled', true);
  view.rerender(<GenerationCountControl {...props} onQueue={queue} onTogglePause={toggle} queueState={{ ...state, completed: 3, paused: true }} />);
  fireEvent.click(screen.getByRole('button', { name: '继续生成' })); expect(toggle).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: /加入队列/ })); expect(queue).toHaveBeenCalledOnce();
});
it.each([1280, 390])('%s 宽度菜单收纳张数、插队和取消，Esc 归还焦点', width => {
  vi.stubGlobal('innerWidth', width); const queue = vi.fn(), count = vi.fn(), cancel = vi.fn();
  render(<GenerationCountControl {...props} onQueue={queue} onCountChange={count} queueState={state} queued={[{ id: 'test', progress: { current: 0, total: 3, stopping: false, position: 1 }, onCancel: cancel }]} />);
  const button = screen.getByRole('button', { name: /加入队列/ }); button.focus(); fireEvent.keyDown(button, { key: 'ArrowDown', altKey: true });
  const panel = screen.getByRole('dialog', { name: '生成选项' }); expect(panel.classList.contains('mobile-sheet')).toBe(width < 768);
  fireEvent.change(within(panel).getByLabelText('生成张数'), { target: { value: '4' } }); expect(count).toHaveBeenCalledWith(4);
  fireEvent.click(within(panel).getByRole('button', { name: '取消待生成任务' })); expect(cancel).toHaveBeenCalledOnce();
  fireEvent.click(within(panel).getByRole('button', { name: '排到下一位' })); expect(queue).toHaveBeenCalledWith('next');
  fireEvent.keyDown(button, { key: 'ArrowDown', altKey: true }); fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(button);
});
it('画布未就绪主按钮不发送，菜单仍可查看；空闲恢复生成', () => {
  const generate = vi.fn(), queue = vi.fn(); const view = render(<GenerationCountControl {...props} onGenerate={generate} onQueue={queue} queueDisabled unavailableLabel="请先选择底图" />);
  fireEvent.click(screen.getByRole('button', { name: '请先选择底图' })); expect(generate).not.toHaveBeenCalled(); expect(queue).not.toHaveBeenCalled();
  view.rerender(<GenerationCountControl {...props} onGenerate={generate} queueState={{ ...state, busy: false, total: 0, completed: 0 }} />);
  expect(screen.getByRole('button', { name: '暂停生成' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: /生成.*3 张.*90 Anlas/ })); expect(generate).toHaveBeenCalledOnce();
});

it('菜单内的紧凑张数控件支持加减、直接输入和下限，调整不会触发生图', () => {
  const count = vi.fn(), generate = vi.fn();
  const view = render(<GenerationCountControl {...props} count={1} onCountChange={count} onGenerate={generate} />);
  fireEvent.keyDown(screen.getByRole('button', { name: /生成.*1 张/ }), { key: 'ArrowDown', altKey: true });
  expect(screen.getByRole('button', { name: '减少生成张数' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '增加生成张数' })); expect(count).toHaveBeenLastCalledWith(2);
  view.rerender(<GenerationCountControl {...props} count={2} onCountChange={count} onGenerate={generate} />);
  fireEvent.click(screen.getByRole('button', { name: '减少生成张数' })); expect(count).toHaveBeenLastCalledWith(1);
  fireEvent.change(screen.getByLabelText('生成张数'), { target: { value: '0' } });
  expect(count).toHaveBeenCalledTimes(2);
  fireEvent.blur(screen.getByLabelText('生成张数')); expect((screen.getByLabelText('生成张数') as HTMLInputElement).value).toBe('2');
  expect(generate).not.toHaveBeenCalled();
});

it.each([false, true])('空闲与忙碌（%s）时菜单始终保留加入队列和下一位，操作位置准确', busy => {
  const queue = vi.fn(); render(<GenerationCountControl {...props} onQueue={queue} queueState={{ ...state, busy, total: busy ? 8 : 0 }} />);
  const open = () => fireEvent.keyDown(screen.getByRole('button', { name: /^(生成|加入队列).*3 张/ }), { key: 'ArrowDown', altKey: true });
  open(); fireEvent.click(within(screen.getByRole('dialog', { name: '生成选项' })).getByRole('button', { name: '加入队列' }));
  expect(queue).toHaveBeenLastCalledWith('end');
  open(); fireEvent.click(within(screen.getByRole('dialog', { name: '生成选项' })).getByRole('button', { name: '排到下一位' }));
  expect(queue).toHaveBeenLastCalledWith('next'); expect(screen.queryByRole('dialog')).toBeNull();
});

it('桌面调整宽度时菜单保持展开，切到手机断点才关闭', () => {
  vi.stubGlobal('innerWidth', 1280); render(<GenerationCountControl {...props} />);
  fireEvent.click(document.querySelector('[data-generation-menu]')!);
  expect(screen.getByRole('dialog', { name: '生成选项' })).toBeTruthy();
  vi.stubGlobal('innerWidth', 1360); fireEvent(window, new Event('resize'));
  expect(screen.getByRole('dialog', { name: '生成选项' })).toBeTruthy();
  vi.stubGlobal('innerWidth', 390); fireEvent(window, new Event('resize'));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('桌面菜单锚定整个生成按钮的中心，不以右侧箭头为中心', () => {
  vi.stubGlobal('innerWidth', 1280); vi.stubGlobal('innerHeight', 800);
  render(<GenerationCountControl {...props} />);
  const button = screen.getByRole('button', { name: /生成.*3 张/ });
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ x: 600, y: 700, left: 600, top: 700, right: 800, bottom: 744, width: 200, height: 44, toJSON: () => ({}) });
  fireEvent.click(button.querySelector('[data-generation-menu]')!);
  expect(screen.getByRole('dialog', { name: '生成选项' }).style.left).toBe('700px');
});
