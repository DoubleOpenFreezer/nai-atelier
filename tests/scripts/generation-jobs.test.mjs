import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationTasks } from '../../worker/generationTasks.mjs';
import { GenerationJobs } from '../../worker/generationJobs.mjs';

const a = 'a'.repeat(32), b = 'b'.repeat(32), c = 'c'.repeat(32);
const descriptor = (approvedCost = 0) => ({ payload: { model: 'nai-diffusion-4-5-full', action: 'generate', parameters: { n_samples: 1, width: 832, height: 1216 } }, history: { prompt: 'synthetic', negativePrompt: '', params: { width: 832, height: 1216 } }, randomSeed: true, stream: false, approvedCost });
const tick = () => new Promise(resolve => setTimeout(resolve, 1));
const until = async predicate => {
  for (let i = 0; i < 1000; i++) { if (predicate()) return; await tick(); }
  assert.fail('后台任务没有进入预期状态');
};
const setup = (overrides = {}) => {
  let now = 0;
  const tasks = new GenerationTasks({ intervalSeconds: 0, now: () => now });
  const calls = [];
  const jobs = new GenerationJobs({ tasks, sleep: tick, now: () => now,
    validate: data => { assert.equal(data.payload.parameters.n_samples, 1); },
    readCleanup: job => job.lastQueueTaskId ? 'synthetic-cleanup-warning' : undefined,
    estimate: async () => 0,
    generate: async (job, payload) => { const finish = tasks.enter(job.key, job.token); calls.push({ token: job.token, seed: payload.parameters.seed }); finish(); return { seed: payload.parameters.seed }; },
    save: async (_job, _output, metadata) => ({ ...metadata, imageUrl: '/api/local-history/' + metadata.id + '/image' }),
    ...overrides,
  });
  return { tasks, jobs, calls, advance: value => { now += value; } };
};

test('预览按客户端版本发送，保存后等待与暂停释放图片，旧客户端仍可读取', async () => {
  let releaseSave, emitPreview;
  const f = setup({
    generate: async (_job, _payload, preview) => { emitPreview = preview; preview({ image: 'data:image/png;base64,AQID', step: 1 }); return {}; },
    save: async (_job, _output, metadata) => { await new Promise(resolve => { releaseSave = resolve; }); return { ...metadata, imageUrl: '/saved/' + metadata.id }; },
  });
  f.jobs.start('key', a, 2, undefined, descriptor(), {});
  const job = f.jobs.get('key', a); await until(() => Boolean(releaseSave));
  const first = f.jobs.snapshot(job);
  assert.ok(first.preview); assert.equal(f.jobs.snapshot(job, String(first.previewVersion)).preview, undefined);
  assert.deepEqual(f.jobs.snapshot(job).preview, first.preview);
  emitPreview({ image: 'data:image/png;base64,BAUG', step: 2 });
  const next = f.jobs.snapshot(job, first.previewVersion); assert.equal(next.preview.step, 2);
  f.tasks.pause('key', true); releaseSave(); await until(() => job.state === 'paused');
  const saved = f.jobs.snapshot(job, next.previewVersion);
  assert.equal(saved.preview, undefined); assert.ok(saved.previewVersion > next.previewVersion); assert.equal(saved.completedCount, 1);
  f.jobs.cancel('key', a); await job.running;
});

test('无浏览器轮询或心跳仍逐张生成保存，超过空闲租期不失效，回执与种子对应', async () => {
  let continueSaving;
  const fixture = setup({ save: async (_job, _output, metadata) => { await new Promise(resolve => { continueSaving = resolve; }); return { ...metadata, imageUrl: '/saved/' + metadata.id }; } });
  const { jobs, tasks, calls } = fixture;
  jobs.start('key', a, 2, undefined, descriptor(), {});
  await until(() => Boolean(continueSaving));
  fixture.advance(360_000);
  assert.equal(tasks.current('key').token, a);
  assert.throws(() => tasks.enter('key'), { code: 'generation_busy' });
  const firstSeed = calls[0].seed;
  continueSaving();
  await until(() => calls.length === 2 && jobs.get('key', a).state === 'saving');
  assert.equal(jobs.snapshot(jobs.get('key', a)).lastSavedItem.params.seed, firstSeed);
  continueSaving();
  await jobs.get('key', a).running;
  const result = jobs.snapshot(jobs.get('key', a));
  assert.equal(result.state, 'succeeded'); assert.equal(result.completedCount, 2);
  assert.equal(new Set(result.historyIds).size, 2); assert.equal(result.lastSavedItem.params.seed, calls[1].seed);
  assert.equal(tasks.current('key'), undefined);
});

test('额度准备期间暂停可继续，但未继续前绝不提交生成', async () => {
  let finishEstimate;
  const fixture = setup({ estimate: async () => { await new Promise(resolve => { finishEstimate = resolve; }); return 0; } });
  fixture.jobs.start('key', a, 1, undefined, descriptor(), {});
  await until(() => Boolean(finishEstimate));
  const paused = fixture.tasks.pause('key', true);
  assert.equal(paused.pausing, false);
  finishEstimate(); await tick();
  assert.equal(fixture.calls.length, 0);
  fixture.tasks.pause('key', false);
  await until(() => fixture.jobs.get('key', a).state === 'preparing');
  finishEstimate(); await fixture.jobs.get('key', a).running;
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.jobs.snapshot(fixture.jobs.get('key', a)).state, 'succeeded');
});

test('跨客户端取消在途任务仍收图保存，取消终态保留部分历史且不执行后续', async () => {
  const fixture = setup();
  let finishUpstream;
  fixture.jobs.generate = async (job, payload) => {
    const finish = fixture.tasks.enter(job.key, job.token);
    fixture.calls.push({ token: job.token, seed: payload.parameters.seed });
    await new Promise(resolve => { finishUpstream = resolve; });
    finish(); return { seed: payload.parameters.seed };
  };
  fixture.jobs.start('key', a, 3, undefined, descriptor(), {});
  await until(() => Boolean(finishUpstream));
  fixture.jobs.cancel('key', a);
  assert.throws(() => fixture.tasks.enter('key'), { code: 'generation_busy' });
  finishUpstream(); await fixture.jobs.get('key', a).running;
  const result = fixture.jobs.snapshot(fixture.jobs.get('key', a));
  assert.equal(result.state, 'cancelled'); assert.equal(result.code, 'generation_cancelled');
  assert.equal(result.completedCount, 1); assert.equal(result.historyIds[0], result.lastSavedItem.id);
  assert.equal(fixture.calls.length, 1);
  assert.throws(() => fixture.jobs.cancel('another-key', a), { status: 404 });
});

test('后台插队以保存为边界，插入任务完成后恢复原任务余量及队尾', async () => {
  const fixture = setup(); let finishFirst;
  const generate = fixture.jobs.generate;
  fixture.jobs.generate = async (job, payload, preview) => {
    if (!fixture.calls.length) await new Promise(resolve => { finishFirst = resolve; });
    return generate(job, payload, preview);
  };
  fixture.jobs.start('key', a, 3, undefined, descriptor(), {});
  await until(() => Boolean(finishFirst));
  fixture.jobs.start('key', c, 1, 'end', descriptor(), {});
  fixture.jobs.start('key', b, 2, 'next', descriptor(), {});
  finishFirst();
  await Promise.all([a, b, c].map(token => fixture.jobs.get('key', token).running));
  assert.deepEqual(fixture.calls.map(call => call.token[0]), ['a', 'b', 'b', 'a', 'a', 'c']);
  assert.equal(fixture.tasks.snapshot('key').completed, 6);
});

test('费用上涨保持停止，重新授权剩余费用后继续，不允许较低授权绕过', async () => {
  const fixture = setup(); let checks = 0;
  fixture.jobs.estimate = async () => ++checks === 1 ? 0 : 12;
  fixture.jobs.start('key', a, 2, undefined, descriptor(), {});
  await until(() => fixture.jobs.get('key', a).state === 'awaiting_confirmation');
  assert.equal(fixture.calls.length, 1);
  const pending = fixture.jobs.snapshot(fixture.jobs.get('key', a));
  assert.equal(pending.cost, 12); assert.equal(pending.completedCount, 1);
  assert.throws(() => fixture.jobs.approve('key', a, 11), { code: 'generation_confirmation_required' });
  fixture.jobs.approve('key', a, 12);
  await fixture.jobs.get('key', a).running;
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.jobs.snapshot(fixture.jobs.get('key', a)).state, 'succeeded');
});

test('保存失败不计完成、不补张，终态保留未保存图片而非伪报取消或成功', async () => {
  const fixture = setup({ save: async () => { throw Object.assign(new Error('synthetic-save-failure'), { preview: { image: 'data:image/png;base64,AQID' } }); } });
  fixture.jobs.start('key', a, 3, undefined, descriptor(), {});
  await fixture.jobs.get('key', a).running;
  const result = fixture.jobs.snapshot(fixture.jobs.get('key', a));
  assert.equal(result.state, 'failed'); assert.equal(result.code, 'history_save_failed');
  assert.equal(result.completedCount, 0); assert.equal(result.preview.image, 'data:image/png;base64,AQID');
  assert.equal(fixture.calls.length, 1); assert.equal(fixture.tasks.size, 0);
});

test('同 token 重复投递不增张数、不重复消费，另一个 Key 不可查询回执', async () => {
  const fixture = setup();
  fixture.jobs.start('key', a, 1, undefined, descriptor(), {});
  fixture.jobs.start('key', a, 8, 'end', descriptor(100), {});
  await fixture.jobs.get('key', a).running;
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.jobs.snapshot(fixture.jobs.get('key', a)).requestedCount, 1);
  assert.throws(() => fixture.jobs.get('other', a), { status: 404 });
});

test('冻结超过终态清理时间仍能收取已保存回执，收取后才开始过期', async () => {
  const fixture = setup();
  fixture.jobs.start('key', a, 1, undefined, descriptor(), {});
  await fixture.jobs.get('key', a).running;
  fixture.advance(600_000);
  const receipt = fixture.jobs.snapshot(fixture.jobs.get('key', a));
  assert.equal(receipt.state, 'succeeded');
  assert.equal(receipt.completedCount, 1);
  assert.equal(receipt.historyIds[0], receipt.lastSavedItem.id);
  fixture.advance(300_001);
  assert.throws(() => fixture.jobs.get('key', a), { code: 'generation_job_not_found' });
});
