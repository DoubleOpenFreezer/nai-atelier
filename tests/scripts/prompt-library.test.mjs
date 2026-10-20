import '../support/node-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { createWorkspace, projectRoot, removeWorkspace } from '../support/workspace.mjs';
import * as library from '../../scripts/prompt-agent.mjs';

test('四库白名单与最终提示词预览支持场景', () => {
  assert.equal(library.isLibraryKind('scene'), true);
  assert.equal(library.isLibraryKind('__proto__'), false);
  assert.equal(library.isLibraryKind('unknown'), false);
  assert.match(library.buildLibrarySystemPrompt('scene', {spec: '自定义规范', extra: '附加要求'}), /场景|画面补充/);
});

test('服饰库过滤越界词并同步中英对照，保留独立的 hairband', () => {
  const item = {prompt: 'long_hair, hairband, white_dress, boots', bilingual: 'long_hair（长发）, hairband（发带）, white_dress（白裙）, boots（靴子）'};
  const result = library.filterLibraryItems([item], 'wardrobe');
  assert.equal(result.items[0].prompt, 'hairband, white_dress, boots');
  assert.equal(result.items[0].bilingual, 'hairband（发带）, white_dress（白裙）, boots（靴子）');
  assert.deepEqual(result.items[0].filtered, ['long_hair']);
  assert.equal(result.filteredCount, 1);
  assert.equal(item.prompt, 'long_hair, hairband, white_dress, boots');
});

test('过滤后不足三个词保留原文并警告，不计入实际删除数量', () => {
  const item = {prompt: 'long_hair, white_dress, boots', bilingual: ''};
  const result = library.filterLibraryItems([item], 'wardrobe');
  assert.equal(result.items[0].prompt, item.prompt);
  assert.equal(result.items[0].filteredWarning, true);
  assert.equal(result.filteredCount, 0);
});

test('场景库允许情境化动作，按词边界过滤外貌及服饰', () => {
  const result = library.filterLibraryItems([{prompt: 'sitting_at_cafe_table, rainy_street, neon_lights, blue_eyes, school_uniform'}], 'scene');
  assert.equal(result.items[0].prompt, 'sitting_at_cafe_table, rainy_street, neon_lights');
  assert.equal(result.filteredCount, 2);
});

test('库生成设置复用原子配置队列，与权限并发保存不互相覆盖，写入失败不发布', async t => {
  const root = createWorkspace('prompt-library-'); t.after(() => removeWorkspace(root));
  const service = new library.PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  await Promise.all([service.saveLibraryPrompts({ spec: 'synthetic format', extra: 'synthetic extra' }), service.setPermissionMode('read_only')]);
  const stored = JSON.parse(await readFile(service.configFilePath(), 'utf8'));
  assert.deepEqual(stored.libraryPrompts, service.getLibraryPrompts()); assert.equal(stored.permissionMode, 'read_only');
  service.configFileOverride = root;
  await assert.rejects(service.saveLibraryPrompts({ spec: 'must not publish' }));
  assert.equal(service.getLibraryPrompts().spec, 'synthetic format');
  await assert.rejects(service.generateLibraryPrompt({ kind: '__proto__', brief: 'synthetic' }), /分类无效/);
});

test('Android 共用的真实路由无需额外全局函数，设置读取、保存和未保存预览可用', async t => {
  const root = createWorkspace('prompt-library-route-'); t.after(() => removeWorkspace(root));
  const service = new library.PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  const source = await readFile(join(projectRoot, 'scripts/media-gateway.mjs'), 'utf8');
  const tree = ts.createSourceFile('gateway.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let branch;
  const visit = node => {
    if (ts.isIfStatement(node) && node.expression.getText(tree) === "url.pathname.startsWith('/api/prompt-agent/')") branch = node.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree); assert.ok(branch);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const handler = new AsyncFunction('req', 'res', 'url', 'promptAgent', 'sendJson', 'hasValidLanCookie', 'readRequestBody', `const lanSecret=''; ${branch}`);
  const invoke = (path, method, body) => handler({ method, headers: {} }, {}, { pathname: path }, service,
    (_res, status, value) => ({ status, value }), () => true, async () => Buffer.from(JSON.stringify(body || {})));
  const endpoint = '/api/prompt-agent/library-prompts';
  assert.deepEqual((await invoke(endpoint, 'GET')).value, { spec: '', extra: '' });
  assert.equal((await invoke(endpoint, 'PUT', { spec: 'saved spec', extra: 'saved extra' })).status, 200);
  const preview = await invoke(endpoint + '/preview', 'POST', { kind: 'scene', spec: 'unsaved spec', extra: '' });
  assert.equal(preview.status, 200); assert.match(preview.value.systemPrompt, /unsaved spec/);
  assert.doesNotMatch(preview.value.systemPrompt, /saved extra/);
  assert.equal(service.getLibraryPrompts().spec, 'saved spec');
  assert.equal((await invoke(endpoint + '/preview', 'POST', { kind: 'unknown' })).status, 400);
  const directEndpoint = '/api/prompt-agent/creative-direct';
  assert.equal(service.publicConfig().creativeDirect, true);
  assert.equal((await invoke(directEndpoint, 'PUT', { enabled: false })).value.creativeDirect, false);
  assert.equal((await invoke(directEndpoint, 'PUT', { enabled: 'true' })).status, 400);
  assert.equal((await invoke(directEndpoint, 'POST', { enabled: true })).status, 405);
  assert.equal(service.publicConfig().creativeDirect, false);
});

test('六类库分类都可生成系统提示（表情状态 / 镜头画面不再被拒）', async t => {
  const root = createWorkspace('prompt-library-kinds-'); t.after(() => removeWorkspace(root));
  const service = new library.PromptAgentService({ lanSecret: 'synthetic', configFile: root });
  for (const kind of ['appearance', 'wardrobe', 'pose', 'expression', 'scene', 'camera']) {
    const preview = service.previewLibrarySystemPrompt({ kind });
    assert.equal(preview.kind, kind);
    assert.ok(preview.systemPrompt.length > 200, kind + ' 的系统提示过短');
  }
  /* previewLibrarySystemPrompt 是同步方法：用 throws 断言，而不是 rejects */
  assert.throws(() => service.previewLibrarySystemPrompt({ kind: 'not-a-kind' }), /分类无效/);
});

test('详细补全三档与「保持留空」进入系统提示，未指定时默认详细', async () => {
  const strict = library.buildLibraryDetailInstruction('strict');
  const moderate = library.buildLibraryDetailInstruction('moderate');
  const detailed = library.buildLibraryDetailInstruction('detailed');
  assert.match(strict, /严格/);
  assert.match(moderate, /适度/);
  assert.match(detailed, /详细/);
  /* 非法/缺省值回落到详细 */
  assert.equal(library.buildLibraryDetailInstruction(undefined), detailed);
  assert.equal(library.buildLibraryDetailInstruction('whatever'), detailed);
  /* 默认是「未提到也尽量补全」（用户确认的口径）；明确要求留空时才排除 */
  assert.match(detailed, /按常见搭配补全/);
  assert.doesNotMatch(detailed, /保持留空/);
  assert.match(library.buildLibraryDetailInstruction('detailed', true), /保持留空/);
  assert.match(detailed, /单色依赖/);
  assert.doesNotMatch(library.buildLibraryDetailInstruction('detailed', false, false), /单色依赖/);

  /* 三档同时进入预览与实际请求共用的系统提示 */
  for (const detail of ['strict', 'moderate', 'detailed']) {
    const prompt = library.buildLibrarySystemPrompt('expression', { detail });
    assert.match(prompt, /【详细补全】/);
    assert.ok(prompt.includes(library.buildLibraryDetailInstruction(detail)), detail + ' 的指令没有进入系统提示');
  }
  assert.match(library.buildLibrarySystemPrompt('camera', { detail: 'strict' }), /严格/);
});

test('界面上的六类字段都能到达模型（后端 facets 清单与前端一致，不按数量验收）', async t => {
  /* 逐库列出「界面有、后端也必须读」的代表性新字段，全部走 collectLibraryFacets */
  const cases = [
    ['appearance', 'hair_length', '发型长度', '超长发'],
    ['appearance', 'bangs', '刘海', '空气刘海'],
    ['wardrobe', 'top_color', '上装颜色', '白色'],
    ['wardrobe', 'wear_state', '穿着状态', '半脱'],
    ['pose', 'hold_hand', '持握手', '左手'],
    ['pose', 'gaze', '视线目标', '看镜头'],
    ['scene', 'light_dir', '光源方向', '逆光'],
    ['scene', 'env_event', '环境事件', '下雨'],
    ['expression', 'eye_glow', '发光瞳', '强烈'],
    ['camera', 'motion', '运动趋势', '运动模糊'],
    /* 本轮按本机字段名补齐的项 */
    ['appearance', 'hair_detail', '发型细节', '层次'],
    ['appearance', 'eye_left', '左眼瞳色', '红色'],
    ['appearance', 'breasts_shape', '胸部·形态', '圆润'],
    ['appearance', 'temp_hair', '头发临时状态', '湿润'],
    ['wardrobe', 'outfit_scope', '生成范围', '完整穿搭'],
    ['scene', 'light_intensity', '光源强度', '柔和'],
    ['scene', 'light_softness', '光源软硬', '软光'],
    ['pose', 'direction', '方位（拍摄方向）', '侧面'],
  ];
  for (const [kind, key, label, value] of cases) {
    const facets = library.collectLibraryFacets(kind, { [key]: value });
    assert.deepEqual(facets, [[label, value]], kind + '.' + key + ' 没有到达模型');
  }
  /* 全量核对：六库字段数与本机对齐（28/29/16/17/10/11 = 111；职责划分也按本机调整） */
  const counts = { appearance: 28, wardrobe: 29, pose: 16, scene: 17, expression: 10, camera: 11 };
  for (const [kind, expected] of Object.entries(counts)) {
    const spec = library.PROMPT_LIBRARY_KIND_FACETS(kind);
    assert.equal(spec.length, expected, kind + ' 的后端字段数不对');
  }
});
