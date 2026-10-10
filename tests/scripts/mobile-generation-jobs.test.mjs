import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import JSZip from 'jszip';
import sharp from 'sharp';
import { GenerationTasks } from '../../worker/generationTasks.mjs';

// 执行真实手机适配器，只替换原生桥与 Canvas，全部产物留在内存。
const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../../mobile/generationJobs.ts', import.meta.url))],
  bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external',
  plugins: [{ name: 'mobile-test-boundaries', setup(builder) {
    builder.onResolve({ filter: /^mobile:generation-output$/ }, () => ({ path: fileURLToPath(new URL('../../scripts/generation-output.mjs', import.meta.url)) }));
    builder.onResolve({ filter: /^(mobile:gateway|\.\/native|\.\.\/services\/imageEdit)$/ }, args => ({ path: args.path, namespace: 'synthetic' }));
    builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: args.path === 'mobile:gateway'
      ? 'export const cacheNovelAiSubscription=()=>{}; export const estimateNovelAiGenerationCost=()=>0; export const keyHashFromAuthorization=x=>x; export const sanitizeNovelAiSubscription=x=>x;'
      : args.path === './native'
        ? 'export const bytesToBase64=x=>Buffer.from(x).toString("base64"); export const native={backgroundJob:async()=>{}};'
        : 'export const composeImageEditResult=async (_output, options)=>{if(options.focusedGeometry.crop.x===30) throw new Error("synthetic Canvas failure"); return options.originalImage;};' }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { createMobileGenerationJobs } = module.exports;

for (const failure of ['composition', 'storage', 'receipt']) test(`手机真实 ZIP 保存链路：${failure} 失败保留产物且不补发生图`, async t => {
  const png = width => sharp({ create: { width, height: width, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } }).png().toBuffer();
  const generated = await png(8), base = await png(16);
  const uri = image => 'data:image/png;base64,' + image.toString('base64');
  const zip = new JSZip(); zip.file('image.png', generated); const zipped = await zip.generateAsync({ type: 'nodebuffer' });
  let generations = 0, saves = 0;
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async url => {
    if (url === '/api/novelai-subscription') return new Response('{}');
    if (url === '/api/generate') { generations++; return new Response(zipped); }
    assert.equal(url, '/api/local-history'); saves++;
    return new Response(JSON.stringify(failure === 'storage' ? { error: 'synthetic storage failure' } : { item: { id: 'missing-image' } }), { status: failure === 'storage' ? 500 : 200 });
  };
  const { jobs } = createMobileGenerationJobs({ tasks: new GenerationTasks({ intervalSeconds: 0 }), queue: { get: () => undefined } });
  const token = 'synthetic-generation-token-0001';
  jobs.start('key', token, 2, undefined, {
    payload: { model: 'synthetic', action: 'infill', parameters: { n_samples: 1 } }, history: { prompt: 'synthetic', params: {} }, approvedCost: 0,
    composition: { originalImage: uri(base), compositeMask: uri(generated), focusedGeometry: { crop: { x: failure === 'composition' ? 30 : 4, y: 4, width: 8, height: 8 } } },
  }, { authorization: 'Bearer synthetic' });
  const job = jobs.get('key', token); await job.running;
  const snapshot = jobs.snapshot(job);
  assert.equal(snapshot.state, 'failed'); assert.equal(snapshot.code, 'history_save_failed'); assert.equal(snapshot.completedCount, 0);
  assert.equal(generations, 1); assert.equal(saves, failure === 'composition' ? 0 : 1);
  assert.deepEqual(Buffer.from(snapshot.preview.image.split(',')[1], 'base64'), failure === 'composition' ? generated : base);
});
