/** 明确区分用户取消、提交前拦截与执行失败；旧布尔回执不能推断用户取消。 */
export const normalizeAgentGenerationResult = value => {
  const source = value && typeof value === 'object' ? value : {};
  const series = Number.isSafeInteger(source.requestedCount) && source.requestedCount > 0;
  const historyIds = series && Array.isArray(source.historyIds) ? [...new Set(source.historyIds.filter(id => typeof id === 'string' && id.length > 0).map(id => id.slice(0, 200)))].slice(0, source.requestedCount) : [];
  const success = (value === true || source.success === true) && (!series || historyIds.length === source.requestedCount && source.historySaved === true);
  const outcome = success ? 'succeeded' : ['cancelled', 'blocked', 'failed'].includes(source.outcome) ? source.outcome : 'failed';
  const code = typeof source.code === 'string' && /^[a-z_]{1,60}$/.test(source.code) ? source.code : !success ? 'generation_failed' : '';
  const error = !success ? String(source.error || (outcome === 'cancelled' ? '用户取消了生图请求' : '未收到生成成功的回执，请先核实结果后再尝试。')).slice(0, 500) : '';
  return { success, historySaved: success && source.historySaved === true, outcome,
    ...(success && source.historySaved === true && typeof source.historyId === 'string' ? { historyId: source.historyId.slice(0, 200) } : {}),
    ...(code ? { code } : {}), ...(error ? { error } : {}),
    ...(series ? { requestedCount: source.requestedCount, completedCount: historyIds.length, historyIds, ...(historyIds.length ? { historyId: historyIds.at(-1) } : {}) } : {}),
  };
};

export const validateGenerationCount = (count = 1) => {
  if (!Number.isSafeInteger(count) || count < 1) throw agentOperationError('生成张数必须是大于 0 的整数', 'invalid_generation_count');
  return count;
};
export const validateGenerationPlacement = placement => {
  if (placement !== undefined && !['end', 'next'].includes(placement)) throw agentOperationError('排队位置无效', 'invalid_generation_queue');
  return placement;
};

export const agentOperationError = (message, code = 'preflight_failed', outcome = 'blocked') => Object.assign(new Error(message), { code, outcome });

export const agentGenerationFailure = error => normalizeAgentGenerationResult({ success: false, historySaved: false, outcome: error?.outcome, code: error?.code, error: error instanceof Error ? error.message : '生成失败，请查看具体回执。' });
