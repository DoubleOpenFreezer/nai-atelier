import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOfficialVibeBilling } from '../live/nai-live-sync.mjs';
import { NAI_BILLING_BUNDLE } from '../fixtures/nai-runtime.mjs';

test('Vibe 对照执行独立官方函数，错误的提取值与新编码费用都不能自证通过', async () => {
  const billing = { freeVibeCount: 4, extraVibeCost: 2, vibeEncodingCost: 2 };
  await compareOfficialVibeBilling(NAI_BILLING_BUNDLE, billing);
  for (const field of Object.keys(billing)) {
    await assert.rejects(compareOfficialVibeBilling(NAI_BILLING_BUNDLE, { ...billing, [field]: billing[field] + 1 }), /不一致/);
  }
  const updated = NAI_BILLING_BUNDLE.replace('p=2;', 'p=3;').replace('e-4', 'e-2').replace('price:2}', 'price:7}');
  await compareOfficialVibeBilling(updated, { freeVibeCount: 2, extraVibeCost: 3, vibeEncodingCost: 7 });
  await assert.rejects(compareOfficialVibeBilling('', billing), /未识别/);
});
