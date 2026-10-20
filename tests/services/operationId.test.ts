import { describe, expect, it } from 'vitest';
import { stableOperationId } from '../../services/operationId';

describe('稳定操作标识', () => {
  it('同一份数据得到同一标识，字段顺序不影响结果', () => {
    const a = stableOperationId('content-roll', { seed: 'r1', picks: { appearance: 'a-1', scene: 's-1' } });
    const b = stableOperationId('content-roll', { picks: { scene: 's-1', appearance: 'a-1' }, seed: 'r1' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it('内容或用途变化得到不同标识', () => {
    const base = { seed: 'r1', picks: { appearance: 'a-1' } };
    expect(stableOperationId('content-roll', base)).not.toBe(stableOperationId('other-scope', base));
    expect(stableOperationId('content-roll', base)).not.toBe(stableOperationId('content-roll', { ...base, seed: 'r2' }));
    expect(stableOperationId('content-roll', base)).not.toBe(stableOperationId('content-roll', { seed: 'r1', picks: { appearance: 'a-2' } }));
  });

  it('数组顺序保留、空值与缺省区分得开', () => {
    expect(stableOperationId('s', [1, 2])).not.toBe(stableOperationId('s', [2, 1]));
    expect(stableOperationId('s', { a: null })).not.toBe(stableOperationId('s', {}));
  });
});
