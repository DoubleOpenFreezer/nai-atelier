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
