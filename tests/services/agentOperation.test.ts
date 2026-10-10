import { expect, it } from 'vitest';
import { agentGenerationFailure, agentOperationError, normalizeAgentGenerationResult } from '../../services/agentOperation.mjs';

it.each([false, undefined])('旧回调返回 %s 时仅表示未成功，不推断用户取消', value => {
  expect(normalizeAgentGenerationResult(value)).toMatchObject({ success: false, outcome: 'failed', code: 'generation_failed' });
});
it.each(['cancelled', 'blocked', 'failed'] as const)('结构化 %s 保留具体原因', outcome => {
  expect(agentGenerationFailure(agentOperationError('具体原因', 'test_error', outcome))).toEqual({ success: false, historySaved: false, outcome, code: 'test_error', error: '具体原因' });
});
it('生成成功和历史保存分别核实，不使用失败回执里的历史 ID', () => {
  expect(normalizeAgentGenerationResult({ success: true, historySaved: true, historyId: 'exact' })).toEqual({ success: true, historySaved: true, historyId: 'exact', outcome: 'succeeded' });
  expect(normalizeAgentGenerationResult({ success: false, historySaved: true, historyId: 'stale' })).not.toHaveProperty('historyId');
});
it('连续生成失败或停止时保留已保存的结果，完成张数按真实历史 ID 核对', () => {
  expect(normalizeAgentGenerationResult({ success: false, historySaved: false, outcome: 'cancelled', requestedCount: 5, completedCount: 5, historyIds: ['first', 'first', 'second'], historyId: 'stale' })).toMatchObject({
    success: false, outcome: 'cancelled', requestedCount: 5, completedCount: 2, historyId: 'second', historyIds: ['first', 'second'],
  });
  expect(normalizeAgentGenerationResult({ success: true, historySaved: true, requestedCount: 3, historyIds: ['first'] })).toMatchObject({ success: false, completedCount: 1 });
});
