import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { DESKTOP_TARGETS, desktopTarget, RUNTIME_FILES, DESKTOP_FILES, DESKTOP_SCRIPT_FILES, copyDesktopScripts, RUNTIME_DEPENDENCIES, createRuntimePackage, sameDependencies, isPrivateDistributionPath, isDistributionMetadata, pruneRuntimeMetadata } from '../../scripts/build-desktop.mjs';
import builder from '../../desktop/builder.config.mjs';

test('分发边界识别数据、缓存、词库、环境变量与测试资料，公开运行文件均不落保护区', async () => {
  assert.ok(RUNTIME_FILES.includes('locales/index.mjs'));
  assert.ok(RUNTIME_FILES.includes('locales/messages.json'));
  assert.deepEqual(builder.nsis.installerLanguages, ['zh_CN', 'zh_TW', 'en_US', 'ja_JP', 'ko_KR']);
  assert.ok(RUNTIME_FILES.includes('worker/naiBilling.mjs'), '安装版必须包含网关共用的计费模块');
  assert.ok(RUNTIME_FILES.includes('services/httpErrors.mjs'), '安装版必须包含生图错误解析共用模块');
  assert.ok(RUNTIME_FILES.includes('worker/cloudQueueTarget.mjs'), '安装版必须包含通用生图中转地址识别');
  assert.ok(RUNTIME_FILES.includes('worker/codexRemote.mjs'), '安装版必须包含法典远端读取模块');
  assert.ok(RUNTIME_FILES.includes('scripts/artist-samples.mjs'), '安装版必须包含画师图包下载与索引模块');
  for (const name of ['local-data/prompt-agent.key', 'PUBLIC/TAG-DATA/tags.json', 'x\\local-cache\\model.onnx', '.env.local', '.dev.vars', '.git/config', 'logs/tests/gateway.log', 'tests/fixtures/synthetic.json', '.wrangler/tmp/test']) assert.equal(isPrivateDistributionPath(name), true, name);
  for (const name of RUNTIME_FILES) {
    assert.equal(isPrivateDistributionPath(name), false, name);
    await readFile(new URL('../../' + name, import.meta.url));
  }
  assert.deepEqual(DESKTOP_FILES, ['main.mjs', 'preload.cjs', 'startup.html', 'startup.js', 'app-updater.mjs']);
});

test('桌面运行依赖锁文件单独维护，不带开发工具，版本跟随根包', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
  const overrides = JSON.parse(await readFile(new URL('../../desktop/runtime-dependencies.json', import.meta.url)));
  const runtime = createRuntimePackage(pkg, overrides);
  const lock = JSON.parse(await readFile(new URL('../../desktop/runtime-package-lock.json', import.meta.url)));
  assert.deepEqual(runtime.dependencies, lock.packages[''].dependencies);
  assert.equal(sameDependencies({ first: '1', second: '2' }, { second: '2', first: '1' }), true);
  assert.equal(sameDependencies({ first: '1' }, { first: '2' }), false);
  assert.equal(sameDependencies({ first: '1' }, { first: '1', second: '2' }), false);
  assert.equal(runtime.version, pkg.version);
  assert.equal(runtime.devDependencies, undefined);
  assert.equal(runtime.dependencies.electron, undefined);
  assert.equal(runtime.dependencies.wrangler, overrides.wrangler);
  assert.deepEqual(runtime.scripts, {});
  for (const name of ['react', 'react-dom', 'lucide-react']) assert.equal(runtime.dependencies[name], undefined);
  // 公开 Node 脚本新增外部 import 时，必须同步安装版直接依赖白名单。
  for (const file of RUNTIME_FILES.filter(name => name.endsWith('.mjs'))) {
    const source = await readFile(new URL('../../' + file, import.meta.url), 'utf8');
    const imports = [...source.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
    for (const name of imports.filter(name => !/^(?:[./]|node:)/.test(name))) {
      const dependency = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
      if (builtinModules.includes(dependency)) continue;
      assert.ok(RUNTIME_DEPENDENCIES.includes(dependency), `${file} 缺少运行依赖 ${dependency}`);
    }
  }
});
test('Electron 主进程的脚本依赖同时放入 app 包，迁移后台使用公开 runtime 脚本', async () => {
  const root = createWorkspace('desktop-storage-package-');
  try {
    await copyDesktopScripts(root);
    assert.deepEqual(DESKTOP_SCRIPT_FILES, ['desktop-runtime.mjs', 'storage-locations.mjs', 'export-locations.mjs']);
    for (const name of DESKTOP_SCRIPT_FILES) assert.ok((await readFile(join(root, 'scripts', name), 'utf8')).length > 0);
    // 打包白名单必须放行主进程导入的每个脚本，否则 app.asar 缺文件，启动即报错。
    for (const name of DESKTOP_SCRIPT_FILES) assert.ok(builder.files.includes(`scripts/${name}`), `builder.files 缺少 scripts/${name}`);
    const source = await readFile(new URL('../../desktop/main.mjs', import.meta.url), 'utf8');
    assert.match(source, /join\(runtimeRoot, 'scripts', 'storage-locations\.mjs'\)/);
  } finally { removeWorkspace(root); }
});

test('精简只删除映射和类型声明，保留可执行文件、资源与许可证', async () => {
  const root = createWorkspace('desktop-prune-');
  const deps = join(root, 'node_modules');
  try {
    await mkdir(deps);
    const removed = ['index.js.map', 'module.mjs.map', 'types.d.ts', 'types.d.mts', 'types.d.cts.map'];
    const retained = ['index.js', 'module.mjs', 'native.node', 'library.dll', 'model.onnx', 'LICENSE', 'NOTICE', 'README.md', 'data.map', 'source.ts'];
    for (const file of [...removed, ...retained]) await writeFile(join(deps, file), 'synthetic');
    const report = await pruneRuntimeMetadata(deps);
    assert.equal(report.removedFiles, removed.length);
    assert.equal(report.removedBytes, removed.length * 9);
    for (const file of removed) { assert.equal(isDistributionMetadata(file), true); await assert.rejects(readFile(join(deps, file)), { code: 'ENOENT' }); }
    for (const file of retained) { assert.equal(isDistributionMetadata(file), false); assert.equal(await readFile(join(deps, file), 'utf8'), 'synthetic'); }
    assert.deepEqual(builder.electronLanguages, ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']);
  } finally { removeWorkspace(root); }
});

test('安装向导允许选择目录、保留用户数据，原生检查在解包前执行且无下载执行脚本', async () => {
  assert.equal(builder.nsis.oneClick, false);
  assert.equal(builder.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(builder.nsis.deleteAppDataOnUninstall, false);
  assert.deepEqual(builder.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.deepEqual(builder.publish, { provider: 'github', owner: 'HelloQun54321', repo: 'nai-atelier', releaseType: 'release' });
  const installer = await readFile(new URL('../../desktop/installer.nsh', import.meta.url), 'utf8');
  for (const name of ['install-prerequisites.ps1', 'uninstall-integration.ps1']) {
    assert.equal(builder.extraResources.some(entry => entry.from === `desktop/${name}`), false);
    await assert.rejects(readFile(new URL(`../../desktop/${name}`, import.meta.url)), { code: 'ENOENT' });
  }
  assert.doesNotMatch(installer, /powershell|ExecutionPolicy|nsExec/i);
  assert.match(installer, /!macro customInit[\s\S]*Call AtelierCheckRuntime[\s\S]*SetErrorLevel 2/);
  assert.match(installer, /ExecShell "open" "https:\/\/learn\.microsoft\.com\//);
  assert.match(installer, /!insertmacro AtelierUnregisterPixiv/);
});

test('构建目标按本机平台选择官方 Node 包，macOS 版临时签名且不启用 Hardened Runtime', () => {
  assert.deepEqual(Object.keys(DESKTOP_TARGETS), ['win32-x64', 'darwin-arm64', 'darwin-x64']);
  assert.deepEqual(desktopTarget('win32', 'x64'), { os: 'win32', arch: 'x64', ...DESKTOP_TARGETS['win32-x64'] });
  assert.equal(desktopTarget('darwin', 'arm64').node, 'darwin-arm64');
  assert.equal(desktopTarget('darwin', 'arm64').archive, 'tar.gz');
  assert.equal(desktopTarget('darwin', 'arm64').nodeFile, 'node');
  assert.throws(() => desktopTarget('linux', 'x64'), /不支持 linux-x64/);
  assert.deepEqual(builder.mac.target, [{ target: 'dmg', arch: ['arm64'] }]);
  assert.equal(builder.mac.identity, '-');
  assert.equal(builder.mac.hardenedRuntime, false);
});

test('公开运行脚本的相对导入全部列入分发清单，安装版后台不缺模块', async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  // runtime/package.json 由打包脚本生成；SillyTavern 扩展的上级导入在酒馆内解析。
  const generated = new Set(['package.json']);
  const queue = RUNTIME_FILES.filter(name => /\.m?js$/.test(name) && !name.startsWith('sillytavern-extension/')), seen = new Set();
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(join(root, file), 'utf8');
    for (const [, specifier] of source.matchAll(/(?:from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = relative(root, resolve(dirname(join(root, file)), specifier)).replaceAll('\\', '/');
      if (generated.has(target)) continue;
      assert.ok(RUNTIME_FILES.includes(target), `${file} 导入的 ${target} 未列入 RUNTIME_FILES`);
      if (/\.m?js$/.test(target)) queue.push(target);
    }
  }
});
