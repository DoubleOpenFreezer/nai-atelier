import type { LocalGenItem, NAIParams } from '../../types';
import { parsePromptTags } from '../../services/tagTranslations';
import { normalizeTagQuery } from '../../services/tagDictionary';
import { error, json, type RouteContext } from './types';

const modelMatches = (pack: string, model: unknown) => typeof model === 'string' && !model.endsWith('-inpainting') &&
  (pack === 'v45' ? /^nai-diffusion-4-5-/.test(model) : /^nai-diffusion-5-/.test(model));
const validText = (value: unknown, maximum = 32_000): value is string => typeof value === 'string' && value.length <= maximum;
const invalidSample = (message: string) => Object.assign(new Error(message), { status: 400 });
const validParams = (pack: string, value: unknown): value is NAIParams => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const params = value as NAIParams;
  return modelMatches(pack, params.model) && [params.width, params.height, params.steps].every(item => Number.isSafeInteger(item) && item > 0) &&
    Number.isFinite(params.scale) && typeof params.sampler === 'string' && params.sampler.length < 100;
};

async function saveOwnSample(context: RouteContext, pack: string, sample: any, overwrite: boolean) {
  const { db, currentUser, env } = context;
  if (!sample || sample.pack !== pack || !validText(sample.id, 160) || !/^[a-zA-Z0-9_-]+$/.test(sample.id) ||
    !validText(sample.tag, 500) || !sample.tag.trim() || !validText(sample.prompt) || !validText(sample.negativePrompt) || !validParams(pack, sample.params) ||
    !Number.isFinite(sample.createdAt) || !validText(sample.imageUrl, 2048) || !sample.imageUrl.startsWith('/api/assets/')) throw invalidSample('画师样张资料无效');
  let assetKey: string;
  try { assetKey = decodeURIComponent(sample.imageUrl.slice('/api/assets/'.length)); } catch { throw invalidSample('样张图片地址无效'); }
  if (assetKey.includes('?') || assetKey.includes('#') || assetKey.includes('..') || !env.BUCKET || !await env.BUCKET.get(assetKey)) throw invalidSample('样张原图尚未保存，请重试');
  const value = { id: sample.id, tag: sample.tag.trim(), pack, imageUrl: sample.imageUrl, prompt: sample.prompt,
    negativePrompt: sample.negativePrompt, params: sample.params, createdAt: sample.createdAt };
  await db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO ${overwrite ? 'UPDATE SET value = excluded.value' : 'NOTHING'}`)
    .bind(`artist_sample_v1:${currentUser.id}:sample:${pack}:${sample.id}`, JSON.stringify(value)).run();
}

/** 只有卡片本轮明确标记的新历史才能自动归档；复用已持久化的同一原图。 */
export async function archiveArtistSampleHistory(context: RouteContext, item: LocalGenItem, imageKey: string): Promise<void> {
  if (context.currentUser.role === 'guest' || item.edit || (item.params as NAIParams & { _local_edit?: unknown })._local_edit || !Array.isArray(item.modules)) return;
  const markers = item.modules.filter(module => typeof module?.id === 'string' && module.id.startsWith('artist-sample-target:'));
  if (markers.length !== 1) return;
  const marker = markers[0];
  if (marker.isActive !== false || marker.name !== '画师样张') return;
  let target: { id?: unknown; tag?: unknown; pack?: unknown };
  try { target = JSON.parse(marker.content); } catch { return; }
  if (!target || typeof target.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(target.id) ||
    marker.id !== `artist-sample-target:${target.id}` || !validText(target.tag, 500) || !target.tag.trim() ||
    (target.pack !== 'v45' && target.pack !== 'v5') || !validParams(target.pack, item.params) ||
    item.sourceChainId !== `artist-sample:${target.pack}:${encodeURIComponent(target.tag)}` ||
    !parsePromptTags(item.prompt).some(token => token.lookupTag === normalizeTagQuery(target.tag as string))) return;
  await saveOwnSample(context, target.pack, { id: `sample-${target.pack}-${item.id}`, tag: target.tag, pack: target.pack,
    imageUrl: `/api/assets/${encodeURIComponent(imageKey)}`, prompt: item.prompt, negativePrompt: item.negativePrompt ?? '',
    params: item.params, createdAt: item.createdAt }, false);
}

/** 私人样张和配置沿用 settings；原图仍在 R2，不改变图库源文件或数据库结构。 */
export async function handleArtistSampleRoute(context: RouteContext): Promise<Response | null> {
  const { path, method, request, db, currentUser } = context;
  if (path !== '/api/artist-sample-data') return null;
  const prefix = `artist_sample_v1:${currentUser.id}:`;
  if (method === 'GET') {
    const rows = await db.prepare('SELECT key, value FROM settings WHERE key >= ? AND key < ?').bind(prefix, prefix + '\uffff').all<{ key: string; value: string }>();
    const templates: Record<string, unknown> = {}, samples: unknown[] = [];
    for (const row of rows.results) {
      let value: unknown;
      try { value = JSON.parse(row.value); } catch { return error('画师样张资料损坏，请保留资料并检查备份', 500); }
      if (row.key.startsWith(prefix + 'template:')) templates[row.key.slice((prefix + 'template:').length)] = value;
      else if (row.key.startsWith(prefix + 'sample:')) samples.push(value);
    }
    return json({ templates, samples });
  }
  if (method !== 'POST') return error('Method not allowed', 405);
  if (currentUser.role === 'guest') return error('访客无法保存画师样张', 403);
  const raw = await request.text();
  if (raw.length > 256_000) return error('样张配置过大，请减少参考内容', 413);
  let body: { action?: string; pack?: string; template?: any; sample?: any };
  try { body = JSON.parse(raw); } catch { return error('样张配置格式无效', 400); }
  if (!body || !['v45', 'v5'].includes(body.pack || '')) return error('不支持的样张版本', 400);
  const pack = body.pack!;
  let key: string, value: unknown;
  if (body.action === 'template') {
    const template = body.template;
    if (!template || !validText(template.prompt) || !template.prompt.includes('{artist}') || !validText(template.negativePrompt) || !validParams(pack, template.params) ||
      !Number.isSafeInteger(template.params.seed) || template.params.seed < 0) return error('请设置公共提示词、对应模型和固定 Seed', 400);
    key = prefix + 'template:' + pack;
    value = { prompt: template.prompt, negativePrompt: template.negativePrompt, params: template.params };
  } else if (body.action === 'sample') {
    try { await saveOwnSample(context, pack, body.sample, true); }
    catch (cause) {
      if (cause instanceof Error && 'status' in cause && cause.status === 400) return error(cause.message, 400);
      throw cause;
    }
    return json({ success: true });
  } else return error('不支持的样张操作', 400);
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(value)).run();
  return json({ success: true });
}
