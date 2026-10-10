import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import JSZip from 'jszip';
import { composeGenerationOutput, generationImageBytes, readGenerationResponse } from '../../scripts/generation-output.mjs';

const png = async (width, height, rgba) => sharp({ create: { width, height, channels: 4, background: { r: rgba[0], g: rgba[1], b: rgba[2], alpha: rgba[3] / 255 } } }).png().toBuffer();
const uri = bytes => 'data:image/png;base64,' + bytes.toString('base64');

test('聚焦回贴保留选区外像素，只在整图真实选区混合羽化像素', async () => {
  const base = await png(16, 16, [20, 40, 60, 255]);
  const generated = await png(8, 8, [220, 140, 60, 255]);
  const mask = await png(8, 8, [255, 255, 255, 128]);
  const result = await composeGenerationOutput(generated, { originalImage: uri(base), compositeMask: uri(mask), focusedGeometry: { crop: { x: 4, y: 4, width: 8, height: 8 } } });
  const image = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(image.info.width, 16); assert.equal(image.info.height, 16);
  const pixel = (x, y) => [...image.data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
  assert.deepEqual(pixel(0, 0), [20, 40, 60, 255]);
  assert.deepEqual(pixel(3, 8), [20, 40, 60, 255]);
  assert.deepEqual(pixel(8, 8), [120, 90, 60, 255]);
  assert.deepEqual(pixel(12, 8), [20, 40, 60, 255]);
});

test('扩图新区域的全量蒙版不混回白色底图，透明回贴保持输出 alpha', async () => {
  const base = await png(8, 8, [255, 255, 255, 255]);
  const generated = await png(8, 8, [10, 70, 130, 128]);
  const mask = await png(8, 8, [255, 255, 255, 255]);
  const result = await composeGenerationOutput(generated, { originalImage: uri(base), compositeMask: uri(mask) });
  const actual = await sharp(result.bytes).raw().toBuffer();
  assert.deepEqual([...actual.subarray(0, 4)], [10, 70, 130, 128]);
});

test('ZIP 最终图片、真实 seed 与记账失败独立收回，不把附属 JSON 损坏当作再次生成理由', async () => {
  const image = await png(8, 8, [10, 20, 30, 255]);
  const zip = new JSZip(); zip.file('image.png', image); zip.file('metadata.json', JSON.stringify({ parameters: { seed: 123 } }));
  const decoded = await readGenerationResponse(new Response(await zip.generateAsync({ type: 'nodebuffer' }), { headers: { 'X-Nai-Anlas-Accounting-Failed': '1' } }));
  assert.equal(decoded.seed, 123); assert.equal(decoded.accountingFailed, true); assert.deepEqual(decoded.bytes, image);
});

test('浏览器平台不支持 nodebuffer 时仍能解包并交付可读取的 PNG', async t => {
  const nodebuffer = JSZip.support.nodebuffer;
  t.after(() => { JSZip.support.nodebuffer = nodebuffer; });
  JSZip.support.nodebuffer = false;
  const zip = new JSZip();
  zip.file('image.png', await png(8, 8, [40, 80, 120, 255]));
  const decoded = await readGenerationResponse(new Response(await zip.generateAsync({ type: 'uint8array' })));
  const image = await sharp(decoded.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(image.info.width, 8);
  assert.deepEqual([...image.data.subarray(0, 4)], [40, 80, 120, 255]);
});

test('SSE final 后中断仍交付成图，只有 intermediate 时不能伪报成功', async () => {
  const image = await png(8, 8, [10, 20, 30, 255]);
  const final = `event: final\ndata: ${JSON.stringify({ image: image.toString('base64'), seed: 321 })}\n\n`;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(final)); setTimeout(() => controller.error(new Error('synthetic-late-disconnect')), 0); } });
  const result = await readGenerationResponse(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
  assert.deepEqual(result.bytes, image); assert.equal(result.seed, 321); assert.equal(result.accountingFailed, true);
  await assert.rejects(readGenerationResponse(new Response(`event: intermediate\ndata: ${JSON.stringify({ image: image.toString('base64') })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })), { code: 'generation_output_invalid' });
});

test('后台回贴拒绝越界选区和任意外部原料地址', async () => {
  const image = await png(8, 8, [10, 20, 30, 255]);
  assert.throws(() => generationImageBytes('https://example.invalid/image.png'), { code: 'generation_output_invalid' });
  await assert.rejects(composeGenerationOutput(image, { originalImage: uri(image), compositeMask: uri(image), focusedGeometry: { crop: { x: 7, y: 0, width: 2, height: 8 } } }), { code: 'generation_output_invalid' });
});
