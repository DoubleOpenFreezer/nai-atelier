// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainEditorPromptInputs, ChainEditorPromptInputsProps } from '../../../components/chain/ChainEditorPromptInputs';

vi.mock('../../../components/LabModuleSection', () => ({ LabModuleSection: ({ children }: React.PropsWithChildren) => <div>{children}</div> }));
afterEach(cleanup);

const setup = (overrides: Partial<ChainEditorPromptInputsProps> = {}) => {
  const props: ChainEditorPromptInputsProps = {
    prompt: 'original prompt', setPrompt: vi.fn(), presetSources: {}, tagAssistEnabled: false, canEdit: true,
    copyPromptToClipboard: vi.fn(), markPresetSectionModified: vi.fn(), markChange: vi.fn(),
    activeLabLayout: { order: ['prompt'], collapsed: {} }, mobileEditorTab: 'global', ...overrides,
  };
  render(<ChainEditorPromptInputs {...props} />);
  return props;
};

describe('提示词上下文工具隔离', () => {
  it('清空和撤销位于既有复制旁，仅更新当前全局文本并恢复焦点', () => {
    const mark = vi.fn(), preset = vi.fn();
    const Harness = () => {
      const [prompt, setPrompt] = useState('global prompt');
      return <ChainEditorPromptInputs prompt={prompt} setPrompt={setPrompt} presetSources={{}} tagAssistEnabled={false} canEdit
        copyPromptToClipboard={vi.fn()} markPresetSectionModified={preset} markChange={mark}
        activeLabLayout={{ order: ['prompt'], collapsed: {} }} mobileEditorTab="global" />;
    };
    render(<Harness />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const clear = screen.getByRole('button', { name: '清空当前提示词' });
    expect(clear.parentElement!.parentElement!.contains(screen.getByTitle('复制全局提示词'))).toBe(true);
    expect(textarea.parentElement!.contains(clear)).toBe(false);
    fireEvent.click(clear); expect(textarea.value).toBe(''); expect(document.activeElement).toBe(textarea);
    expect(preset).toHaveBeenLastCalledWith('base'); expect(mark).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '撤销清空' })); expect(textarea.value).toBe('global prompt');
  });
  it('实验室未传入资料工具时维持复制按钮，输入及复制行为不变', () => {
    const props = setup();
    expect(screen.queryByRole('button', { name: /识别|辅助/ })).toBeNull();
    fireEvent.click(screen.getByTitle('复制全局提示词'));
    expect(props.copyPromptToClipboard).toHaveBeenCalledWith('original prompt', '全局提示词');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated prompt' } });
    expect(props.setPrompt).toHaveBeenCalledWith('updated prompt');
    expect(props.markPresetSectionModified).toHaveBeenCalledWith('base');
    expect(props.markChange).toHaveBeenCalledOnce();
  });

  it('提示词区不重复顶栏的识别和辅助入口，只读时仍可复制', () => {
    const props = setup({ canEdit: false });
    expect(screen.queryByRole('button', { name: /识别|辅助/ })).toBeNull();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '清空当前提示词' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTitle('复制全局提示词'));
    expect(props.copyPromptToClipboard).toHaveBeenCalledWith('original prompt', '全局提示词');
  });
});
