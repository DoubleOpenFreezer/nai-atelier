import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NAI_MEDIUM_BILLING_BUNDLE, NAI_TURBOPACK_BILLING_BUNDLE } from '../fixtures/nai-runtime.mjs';
import { extractNaiRuntimeChunkPaths, extractNaiImagesPerPercent, extractNaiMetadataModelMappings,
  extractNaiBillingRules, computeNaiRuntimeSync, syncNaiRuntime, getNaiRuntime } from '../../scripts/media-gateway.mjs';
import { compareOfficialVibeBilling } from '../live/nai-live-sync.mjs';

const bundle = [
  NAI_TURBOPACK_BILLING_BUNDLE,
  '"usageImagesForPercent",0,function(e){return Math.round(21.4*e)},"usageRefillRatePerDay",0,function(e){return e.timeUntilNextPercent<=0?0:Math.round(86400/e.timeUntilNextPercent*10)/10}',
  'case"nai-diffusion-5-full":return{streamedResponses:!0,opusUsageLimit:!0}',
  'case"nai-diffusion-5-full-medium":case"nai-diffusion-5-full-medium-inpainting":return{...f("nai-diffusion-5-full"),fixedSettings:{steps:14,sampler:"k_euler",ucPresetId:"heavy"}}',
  'case n.ImageGenerationModels.naiDiffusionV5Full:case n.ImageGenerationModels.naiDiffusionV5FullMedium:case n.ImageGenerationModels.naiDiffusionV5FullMediumInpainting:return[{id:"standard",name:"standard",suffix:"synthetic"},{id:"none",name:"none"}]',
  'case n.ImageGenerationModels.naiDiffusionV5Full:case n.ImageGenerationModels.naiDiffusionV5FullMedium:case n.ImageGenerationModels.naiDiffusionV5FullMediumInpainting:return[{id:"heavy",name:"heavy",category:"heavy",prefix:"synthetic"},{id:"none",name:"none",category:"none"}]',
  'case"NovelAI Diffusion V5 AAAAAAAA":return tb.naiDiffusionV5Full;case"NovelAI Diffusion V5 BBBBBBBB":return tb.naiDiffusionV5FullMedium',
].join(';');

test('官方 chunk 保留部署参数、解码 HTML 查询分隔符并去重，不访问其他路径', () => {
  const html = '<script src="/_next/static/chunks/pages/image.old.js"></script>'
    + '<script src="/_next/static/chunks/new.js?dpl=synthetic&amp;x=1"></script>'
    + '<link href="/_next/static/chunks/new.js?dpl=synthetic&amp;x=1">'
    + '<script src="https://untrusted.invalid/_next/static/chunks/evil.js"></script>'
    + '<script src="/_next/static/chunks/../../evil.js"></script>'
    + '<script src="/_next/static/chunks/fake.js.css"></script>';
  assert.deepEqual(extractNaiRuntimeChunkPaths(html), ['/_next/static/chunks/pages/image.old.js', '/_next/static/chunks/new.js?dpl=synthetic&x=1']);
});

test('Turbopack 具名 Opus 张数函数不依赖排列，数值可更新且拒绝未知算式', () => {
  assert.equal(extractNaiImagesPerPercent(bundle), 21.4);
  assert.equal(extractNaiImagesPerPercent(bundle.replace('21.4*e', '32.8*e')), 32.8);
  assert.equal(extractNaiImagesPerPercent(bundle.replace('21.4*e', '21.4*e+1')), null);
  assert.equal(extractNaiImagesPerPercent('function(e){return Math.round(21.4*e)}'), null);
});

test('元数据枚举新旧命名与 Medium 只映射明确哈希，不把默认分支归给前一型号', () => {
  assert.deepEqual(extractNaiMetadataModelMappings(bundle + ';case"NovelAI Diffusion V5 CCCCCCCC":default:return tb.naiDiffusionV5Curated'), {
    'NovelAI Diffusion V5 AAAAAAAA': 'nai-diffusion-5-full', 'NovelAI Diffusion V5 BBBBBBBB': 'nai-diffusion-5-full-medium',
  });
  assert.deepEqual(extractNaiMetadataModelMappings('case"NovelAI Diffusion V5 AAAAAAAA":return n.ImageGenerationModels.naiDiffusionV5Full'),
    extractNaiMetadataModelMappings('case"NovelAI Diffusion V5 AAAAAAAA":return n.oM.naiDiffusionV5Full'));
});

test('Turbopack 计价保留旧算式语义，未知附加费或步数表达式仍失败', async () => {
  assert.deepEqual(extractNaiBillingRules(NAI_TURBOPACK_BILLING_BUNDLE), extractNaiBillingRules(NAI_MEDIUM_BILLING_BUNDLE));
  await compareOfficialVibeBilling(NAI_TURBOPACK_BILLING_BUNDLE, extractNaiBillingRules(NAI_TURBOPACK_BILLING_BUNDLE));
  for (const broken of [
    NAI_TURBOPACK_BILLING_BUNDLE.replace('g=0+(await', 'g=1+(await'),
    NAI_TURBOPACK_BILLING_BUNDLE.replace('g=0+(await', 'g+=7;g=0+(await'),
    NAI_TURBOPACK_BILLING_BUNDLE.replace('g=0+(await', 'g=7;g=0+(await'),
    NAI_TURBOPACK_BILLING_BUNDLE.replace('2*Math.max(0,e-4)', '2*Math.max(0,e-4)+1'),
    NAI_TURBOPACK_BILLING_BUNDLE.replace('return e+t}', 'return e+t+1}'),
    NAI_TURBOPACK_BILLING_BUNDLE.replace('return e.enabled}', 'return true}'),
    NAI_TURBOPACK_BILLING_BUNDLE.replace('return y*v', 'y*=2;return y*v'),
    NAI_TURBOPACK_BILLING_BUNDLE.replace('default:return 1', 'default:return 2'),
    NAI_TURBOPACK_BILLING_BUNDLE.replace('*l*a*i', '*l*a*unknown'),
    NAI_TURBOPACK_BILLING_BUNDLE.replace('let u={...a};', 'let u={...a};u.characterRef=true;'),
  ]) {
    assert.equal(extractNaiBillingRules(broken), null);
    assert.ok(computeNaiRuntimeSync(broken).health.missed.includes('billing'));
  }
});

test('部署查询参数新页面完成全部提取，部分失败保持完整快照与磁盘记录', async () => {
  const path = join(process.cwd(), 'local-data', 'novelai-webapp-sync.json');
  const backup = await readFile(path, 'utf8');
  const requests = [];
  const remote = async url => {
    requests.push(url);
    return new Response(url.endsWith('/image') ? '<script src="/_next/static/chunks/synthetic.js?dpl=synthetic"></script>' : bundle);
  };
  try {
    assert.deepEqual(computeNaiRuntimeSync(bundle).health.missed, []);
    assert.equal(await syncNaiRuntime(remote), true);
    assert.equal(getNaiRuntime().health.ok, true);
    assert.equal(getNaiRuntime().imagesPerPercent, 21.4);
    assert.deepEqual(requests, ['https://novelai.net/image', 'https://novelai.net/_next/static/chunks/synthetic.js?dpl=synthetic']);
    const saved = await readFile(path, 'utf8');
    assert.equal(await syncNaiRuntime(async url => new Response(url.endsWith('/image')
      ? '<script src="/_next/static/chunks/synthetic.js?dpl=synthetic"></script>' : bundle.replace('21.4*e', 'unknown*e'))), false);
    assert.equal(getNaiRuntime().health.ok, false);
    assert.ok(getNaiRuntime().health.missed.includes('imagesPerPercent'));
    assert.equal(getNaiRuntime().imagesPerPercent, 21.4);
    assert.equal(await readFile(path, 'utf8'), saved);
  } finally { await writeFile(path, backup); }
});
