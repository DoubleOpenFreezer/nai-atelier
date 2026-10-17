// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { confirmationCostScope, confirmationIdentity, readDailyConfirmation, rememberConfirmationConnections, rememberDailyConfirmation } from '../../services/dailyConfirmation';

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it('按本地自然日过期，跨年与跨月不沿用，读回可跨会话', () => {
  const evening = new Date(2026, 11, 31, 23, 59);
  rememberDailyConfirmation('history.delete', 'confirm', evening);
  expect(readDailyConfirmation('history.delete', new Date(2026, 11, 31, 23, 59, 59))).toBe('confirm');
  expect(readDailyConfirmation('history.delete', new Date(2027, 0, 1))).toBeNull();
  expect(readDailyConfirmation('history.clear-all', evening)).toBeNull();
  expect(JSON.parse(localStorage.getItem('nai_daily_confirmations')!).choices['history.delete']).toBe('confirm');
});

it('类型和动态范围分别记住，持久化只存摘要', () => {
  const scope = ['synthetic-private-key', 'D:/synthetic-target'];
  const identity = confirmationIdentity('storage.migrate', scope);
  rememberDailyConfirmation(identity, 'save');
  expect(readDailyConfirmation(confirmationIdentity('storage.migrate', scope))).toBe('save');
  expect(readDailyConfirmation(confirmationIdentity('storage.open', scope))).toBeNull();
  expect(readDailyConfirmation(confirmationIdentity('storage.migrate', ['synthetic-private-key', 'D:/other-target']))).toBeNull();
  expect(localStorage.getItem('nai_daily_confirmations')).not.toContain('synthetic-private-key');
  expect(localStorage.getItem('nai_daily_confirmations')).not.toContain('synthetic-target');
});

it('费用隔离Key、接入、单价、张数与预算状态，正常扣减预算不会不断重问', async () => {
  const scope = () => confirmationIdentity('paid', confirmationCostScope('synthetic-A', 2, 3, 100));
  const initial = scope(); rememberDailyConfirmation(initial, 'confirm');
  expect(readDailyConfirmation(confirmationIdentity('paid', confirmationCostScope('synthetic-A', 2, 3, 90)))).toBe('confirm');
  const cases: [string, number, number, number][] = [['synthetic-B', 2, 3, 100], ['synthetic-A', 3, 3, 100], ['synthetic-A', 2, 4, 100], ['synthetic-A', 2, 3, 5], ['synthetic-A', 2, 3, 0]];
  for (const args of cases) {
    expect(readDailyConfirmation(confirmationIdentity('paid', confirmationCostScope(...args)))).toBeNull();
  }
  rememberConfirmationConnections([{ key: 'synthetic-A', id: 'entry', gatewayUrl: 'https://example.invalid/one' }]);
  const known = scope(); expect(known).not.toBe(initial);
  vi.resetModules();
  const reloaded = await import('../../services/dailyConfirmation');
  expect(reloaded.confirmationIdentity('paid', reloaded.confirmationCostScope('synthetic-A', 2, 3, 100))).toBe(known);
  expect(localStorage.getItem('nai_confirmation_connections')).not.toContain('synthetic-A');
  expect(localStorage.getItem('nai_confirmation_connections')).not.toContain('example.invalid');
  rememberConfirmationConnections([{ key: 'synthetic-A', id: 'entry', gatewayUrl: 'https://example.invalid/two' }]);
  expect(scope()).not.toBe(known);
});

it('损坏、未知选择和不可用storage不授权，也不妨碍明确确认', () => {
  localStorage.setItem('nai_daily_confirmations', '{broken');
  expect(readDailyConfirmation('delete')).toBeNull();
  rememberDailyConfirmation('delete', 'confirm');
  const stored = JSON.parse(localStorage.getItem('nai_daily_confirmations')!); stored.choices.delete = true;
  localStorage.setItem('nai_daily_confirmations', JSON.stringify(stored));
  expect(readDailyConfirmation('delete')).toBeNull();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('synthetic blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic full'); });
  expect(readDailyConfirmation('delete')).toBeNull();
  expect(() => rememberDailyConfirmation('delete', 'confirm')).not.toThrow();
});
