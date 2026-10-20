// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppearanceDetailEditor } from '../../components/AppearanceDetailEditor';
import type { ThemeDetails } from '../../services/themeDetails';

afterEach(cleanup);
it('全局滑条支持零值、明暗继承和清除覆盖，实验室暗度独立保留', () => {
  const Harness = () => {
    const [details, setDetails] = useState<ThemeDetails | undefined>({ opacity: .58, panelOpacity: .8, labEditorOpacity: .6, light: { labEditorOpacity: .3 } });
    return <><AppearanceDetailEditor details={details} onChange={setDetails} /><output data-testid="value">{JSON.stringify(details)}</output></>;
  };
  render(<Harness />);
  const global = screen.getByRole('slider', { name: '全局不透明度' }) as HTMLInputElement;
  const lab = screen.getByRole('slider', { name: '实验室编辑面板不透明度' }) as HTMLInputElement;
  expect(global.value).toBe('58');
  fireEvent.change(global, { target: { value: '40' } });
  expect((screen.getByLabelText('弹窗不透明度') as HTMLInputElement).disabled).toBe(true);
  expect(lab.value).toBe('60');
  fireEvent.change(screen.getByLabelText('编辑范围'), { target: { value: 'light' } });
  expect(global.value).toBe('40'); expect(lab.value).toBe('30');
  fireEvent.change(global, { target: { value: '0' } });
  expect(global.getAttribute('aria-valuetext')).toBe('0%');
  fireEvent.change(screen.getByLabelText('编辑范围'), { target: { value: 'dark' } });
  fireEvent.change(global, { target: { value: '100' } });
  expect(lab.value).toBe('60');
  fireEvent.click(screen.getByRole('button', { name: '清除全局覆盖' }));
  expect(global.value).toBe('40');
  expect(JSON.parse(screen.getByTestId('value').textContent!)).toEqual({ opacity: .58, panelOpacity: .8, globalOpacity: .4, labEditorOpacity: .6, light: { globalOpacity: 0, labEditorOpacity: .3 } });
  fireEvent.change(screen.getByLabelText('编辑范围'), { target: { value: 'common' } });
  fireEvent.click(screen.getByRole('button', { name: '清除全局覆盖' }));
  expect((screen.getByLabelText('弹窗不透明度') as HTMLInputElement).disabled).toBe(false);
  expect((screen.getByLabelText('弹窗不透明度') as HTMLInputElement).value).toBe('0.8');
});
it('实验室滑条实时显示百分比，明暗覆盖独立且支持完全透明与实色', () => {
  const Harness = () => {
    const [details, setDetails] = useState<ThemeDetails | undefined>({ panelOpacity: .8, dark: { highlight: .2 } });
    return <><AppearanceDetailEditor details={details} onChange={setDetails} /><output data-testid="value">{JSON.stringify(details)}</output></>;
  };
  render(<Harness />);
  const slider = screen.getByRole('slider', { name: '实验室编辑面板不透明度' }) as HTMLInputElement;
  expect(slider.value).toBe('60');
  fireEvent.change(screen.getByLabelText('编辑范围'), { target: { value: 'dark' } });
  fireEvent.change(slider, { target: { value: '74' } });
  expect(slider.getAttribute('aria-valuetext')).toBe('74%');
  fireEvent.change(screen.getByLabelText('编辑范围'), { target: { value: 'light' } });
  expect(slider.value).toBe('40');
  fireEvent.change(slider, { target: { value: '0' } });
  expect(slider.value).toBe('0');
  fireEvent.change(screen.getByLabelText('编辑范围'), { target: { value: 'common' } });
  fireEvent.change(slider, { target: { value: '100' } });
  expect(JSON.parse(screen.getByTestId('value').textContent!)).toEqual({ panelOpacity: .8, labEditorOpacity: 1, light: { labEditorOpacity: 0 }, dark: { highlight: .2, labEditorOpacity: .74 } });
  fireEvent.change(screen.getByLabelText('编辑范围'), { target: { value: 'dark' } });
  expect(slider.value).toBe('74');
  fireEvent.click(screen.getByText('清除当前明暗覆盖'));
  expect(slider.value).toBe('100');
});
it('编辑明暗覆盖保留共用参数及另一版本，清除后继承共用值', () => {
  const Harness = () => {
    const [details, setDetails] = useState<ThemeDetails | undefined>({ controlHeight: 36, dark: { highlight: .2 } });
    return <><AppearanceDetailEditor details={details} onChange={setDetails} /><output data-testid="value">{JSON.stringify(details)}</output></>;
  };
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('控件风格'), { target: { value: 'filled' } });
  fireEvent.change(screen.getByLabelText('编辑范围'), { target: { value: 'light' } });
  fireEvent.change(screen.getByLabelText('弹窗不透明度'), { target: { value: '.98' } });
  fireEvent.change(screen.getByLabelText('版本强调色'), { target: { value: '#006adc' } });
  expect(JSON.parse(screen.getByTestId('value').textContent!)).toMatchObject({ controlHeight: 36, controlStyle: 'filled', light: { panelOpacity: .98, accentColor: '#006adc' }, dark: { highlight: .2 } });
  fireEvent.click(screen.getByText('清除当前明暗覆盖'));
  expect(JSON.parse(screen.getByTestId('value').textContent!)).toEqual({ controlHeight: 36, controlStyle: 'filled', dark: { highlight: .2 } });
});
