// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AppearanceDetailEditor } from '../../components/AppearanceDetailEditor';
import type { ThemeDetails } from '../../services/themeDetails';

afterEach(cleanup);
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
