import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, chmod, copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import JSZip from 'jszip';

export const NODE_RUNTIME_VERSION = '24.19.0';
// 只在同平台同架构的机器上构建：运行依赖的原生二进制由 npm 按本机平台安装。
export const DESKTOP_TARGETS = {
  'win32-x64': { label: 'Windows 10/11 x64', node: 'win-x64', archive: 'zip', nodeFile: 'node.exe' },
  'darwin-arm64': { label: 'macOS Apple Silicon', node: 'darwin-arm64', archive: 'tar.gz', nodeFile: 'node' },
  'darwin-x64': { label: 'macOS Intel', node: 'darwin-x64', archive: 'tar.gz', nodeFile: 'node' },
};
export function desktopTarget(os = process.platform, arch = process.arch) {
  const target = DESKTOP_TARGETS[`${os}-${arch}`];
  if (!target) throw new Error(`当前发布脚本不支持 ${os}-${arch}，请在 Windows x64 或 macOS 上构建`);
  return { os, arch, ...target };
}
export const PUBLIC_ICONS = ['nai-atelier.ico', 'app-icon.ico', 'app-icon.png', 'artist-palette-3d.ico', 'artist-palette-3d.png'];
// 明确列出公开运行文件，禁止将开发目录中的新增文件自动带入分发包。
export const RUNTIME_FILES = [
  ...['agent-web', 'agent-errors', 'agent-ui-bridge', 'agent-runtime', 'agent-page-tools', 'agent-local-images', 'artist-samples', 'collector-download', 'danbooru-loading', 'desktop-launcher', 'export-locations', 'storage-locations', 'generation-gateway', 'generation-output', 'image-tagger', 'local-backup', 'local-server', 'local-server-runtime', 'media-gateway', 'media-memory-cache', 'novelai-agent-knowledge', 'pixiv-local', 'pixiv-scheme-handler', 'pixiv-web-login', 'prompt-agent', 'st-chatu8-bridge', 'style-collector', 'tag-update-server', 'tagger-model-download', 'update-tag-dictionary'].map(name => `scripts/${name}.mjs`),
  'scripts/style-collector-window.ps1', 'scripts/style-collector-window.cs', 'scripts/pixiv-edge-callback-watcher.ps1', 'scripts/pixiv-login-complete.html',
  ...['agentOperation', 'agentLabSync', 'promptSections', 'agentConnection', 'danbooruErrors', 'httpErrors', 'agentThinking', 'imageTaggerModels', 'transparentBackground', 'pngMetadata'].map(name => `services/${name}.mjs`),
  ...['stChatu8Policy', 'sharedWhitelist', 'imageDimensions', 'cloudQueueNumbers', 'cloudQueueTarget', 'naiBilling', 'generationTasks', 'generationJobs', 'codexRemote'].map(name => `worker/${name}.mjs`),
  'LICENSE', 'PROJECT_AGENT.md', 'wrangler.toml', 'data/novelai-v45-tags.json',
  'locales/index.mjs', 'locales/messages.json',
  ...['index.js', 'style.css', 'manifest.json', 'README.md'].map(name => `sillytavern-extension/npm-bridge/${name}`),
  ...PUBLIC_ICONS.map(name => `public/${name}`),
];
export const DESKTOP_FILES = ['main.mjs', 'preload.cjs', 'startup.html', 'startup.js', 'app-updater.mjs'];
export const DESKTOP_SCRIPT_FILES = ['desktop-runtime.mjs', 'storage-locations.mjs', 'export-locations.mjs'];
export async function copyDesktopScripts(appRoot) {
  await mkdir(join(appRoot, 'scripts'), { recursive: true });
  for (const file of DESKTOP_SCRIPT_FILES) await copyFile(new URL(file, import.meta.url), join(appRoot, 'scripts', file));
}
// 前端依赖已经编译到 dist；只为实际运行的 Node 脚本安装这些直接依赖。
export const RUNTIME_DEPENDENCIES = ['@earendil-works/pi-agent-core', '@earendil-works/pi-ai', 'fast-png', 'jszip', 'onnxruntime-node', 'sharp', 'undici'];
export const sameDependencies = (left, right) => Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([name, version]) => right[name] === version);
export function createRuntimePackage(pkg, overrides) {
  const dependencies = Object.fromEntries(RUNTIME_DEPENDENCIES.map(name => {
    if (!pkg.dependencies[name]) throw new Error(`根包未声明所需运行依赖：${name}`);
    return [name, pkg.dependencies[name]];
  }));
  return { name: 'nai-atelier-runtime', private: true, version: pkg.version, type: 'module', scripts: {}, dependencies: { ...dependencies, ...overrides } };
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildRoot = join(root, '.desktop-build');
const runtime = join(buildRoot, 'runtime');
const appRoot = join(buildRoot, 'app');

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function isPrivateDistributionPath(file) {
  return /(^|\/)(?:local-data|local-cache|tag-data|\.git|\.wrangler(?:-logs)?|logs|tests|\.env(?:\.[^/]*)?|\.dev\.vars(?:\.[^/]*)?)(\/|$)/i.test(file.replaceAll('\\', '/'));
}

async function cleanBuildDirectory(directory) {
  const target = resolve(directory);
  if (dirname(target) !== buildRoot || !['runtime', 'app', 'public'].includes(relative(buildRoot, target))) throw new Error('拒绝清理打包边界外的目录');
  if ((await lstat(target).catch(() => null))?.isSymbolicLink()) throw new Error('打包目录不能是符号链接');
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

const run = (command, args, options = {}) => new Promise((done, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? done() : reject(new Error(`打包命令失败（${code}）：${command}`)));
});

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(150_000) });
  if (!response.ok) throw new Error(`下载失败：${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function prepareNode(target) {
  const filename = `node-v${NODE_RUNTIME_VERSION}-${target.node}.${target.archive}`;
  const origin = `https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}`;
  const sums = (await download(`${origin}/SHASUMS256.txt`)).toString('utf8');
  const expected = sums.split('\n').find(line => line.trim().endsWith(`  ${filename}`))?.split(/\s+/)[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('官方 Node 校验清单未包含所需运行环境');
  const cache = join(buildRoot, 'downloads', filename);
  await mkdir(dirname(cache), { recursive: true });
  let bytes = await readFile(cache).catch(() => null);
  if (!bytes || sha256(bytes) !== expected) { bytes = await download(`${origin}/${filename}`); await writeFile(cache, bytes); }
  if (sha256(bytes) !== expected) throw new Error('Node 运行环境 SHA-256 校验失败');
  const folder = filename.slice(0, -(target.archive.length + 1));
  if (target.archive === 'zip') {
    const zip = await JSZip.loadAsync(bytes);
    for (const [source, destination] of [['node.exe', 'node.exe'], ['LICENSE', 'NODE-LICENSE.txt']]) {
      const entry = zip.file(`${folder}/${source}`);
      if (!entry) throw new Error(`官方运行环境缺少 ${source}`);
      await writeFile(join(runtime, destination), await entry.async('nodebuffer'));
    }
  } else {
    // macOS 官方包为 tar.gz，只解出可执行文件与许可证，保留可执行权限。
    const extracted = join(buildRoot, 'downloads', folder);
    await rm(extracted, { recursive: true, force: true });
    await run('tar', ['-xzf', cache, '-C', dirname(extracted), `${folder}/bin/node`, `${folder}/LICENSE`]);
    await copyFile(join(extracted, 'bin', 'node'), join(runtime, target.nodeFile));
    await chmod(join(runtime, target.nodeFile), 0o755);
    await copyFile(join(extracted, 'LICENSE'), join(runtime, 'NODE-LICENSE.txt'));
    await rm(extracted, { recursive: true, force: true });
  }
  await writeFile(join(runtime, 'node-runtime.json'), JSON.stringify({ version: NODE_RUNTIME_VERSION, source: `${origin}/${filename}`, sha256: expected }, null, 2) + '\n');
}

async function copyProgramFiles() {
  for (const filename of RUNTIME_FILES) {
    const source = join(root, filename);
    if (!(await lstat(source)).isFile()) throw new Error(`公开运行文件不允许链接：${filename}`);
    await mkdir(dirname(join(runtime, filename)), { recursive: true });
    await copyFile(source, join(runtime, filename));
  }
}

async function pruneRuntimeDirectory(target) {
  const boundary = join(runtime, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');
  const resolved = resolve(target);
  if (!resolved.startsWith(boundary + sep) || (await lstat(resolved)).isSymbolicLink()) throw new Error('拒绝清理运行依赖边界外的目录');
  await rm(resolved, { recursive: true, force: true });
}

async function inventory(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`分发资源不允许符号链接：${name}`);
    if (entry.isDirectory()) files.push(...await inventory(join(directory, entry.name), name + '/'));
    else files.push(name);
  }
  return files;
}

export const isDistributionMetadata = file => /\.(?:[cm]?js|css)\.map$|\.d\.[cm]?ts(?:\.map)?$/i.test(file);
export async function pruneRuntimeMetadata(nodeModules) {
  const boundary = resolve(nodeModules);
  const files = await inventory(boundary); // 先完整核对没有符号链接，再清理该目录内的单个元数据文件。
  let removedBytes = 0, removedFiles = 0;
  for (const file of files.filter(isDistributionMetadata)) {
    const target = resolve(boundary, file);
    if (!target.startsWith(boundary + sep)) throw new Error('拒绝清理依赖目录外的文件');
    removedBytes += (await lstat(target)).size;
    await rm(target);
    removedFiles++;
  }
  return { removedFiles, removedBytes };
}

/** 桌面壳只捆绑更新器及其实际依赖，仍不复制开发 node_modules。 */
export async function bundleDesktopUpdater(destination) {
  const { build } = await import('esbuild');
  const result = await build({ absWorkingDir: root, entryPoints: [join(root, 'node_modules/electron-updater/out/main.js')], bundle: true, platform: 'node', format: 'cjs',
    external: ['electron'], outfile: join(destination, 'desktop/updater.cjs'), metafile: true, legalComments: 'eof' });
  const packages = new Set();
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.replaceAll('\\', '/').match(/^(.*\/)?node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (match) packages.add(resolve(root, (match[1] || '') + 'node_modules/' + match[2]));
  }
  for (const directory of packages) {
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    for (const file of (await readdir(directory)).filter(name => /^(?:licen[sc]e|notice|copyright)(?:\.|$)/i.test(name))) {
      const target = join(destination, 'desktop/updater-licenses', pkg.name.replaceAll('/', '_'), file);
      await mkdir(dirname(target), { recursive: true }); await copyFile(join(directory, file), target);
    }
  }
  return [...packages];
}

/** 由公开 PNG 图标生成 macOS 应用所需的 icns，只写入打包目录。 */
async function prepareMacIcon() {
  const iconset = join(buildRoot, 'nai-atelier.iconset');
  await rm(iconset, { recursive: true, force: true });
  await mkdir(iconset, { recursive: true });
  for (const [name, size] of [['16x16', 16], ['16x16@2x', 32], ['32x32', 32], ['32x32@2x', 64], ['128x128', 128], ['128x128@2x', 256], ['256x256', 256], ['256x256@2x', 512], ['512x512', 512]]) {
    await run('sips', ['-z', String(size), String(size), join(root, 'public', 'app-icon.png'), '--out', join(iconset, `icon_${name}.png`)], { stdio: 'ignore' });
  }
  const icon = join(buildRoot, 'nai-atelier.icns');
  await run('iconutil', ['-c', 'icns', iconset, '-o', icon]);
  await rm(iconset, { recursive: true, force: true });
  return icon;
}

async function findNpmCli() {
  // Windows 官方 Node 将 npm 放在 node.exe 同级；macOS／nvm／Homebrew 放在 lib/node_modules。
  for (const candidate of [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]) {
    if (await access(candidate).then(() => true, () => false)) return candidate;
  }
  throw new Error('找不到当前 Node 附带的 npm');
}

export async function buildDesktop({ unpacked = false, skipInstall = false } = {}) {
  const target = desktopTarget();
  const isMac = target.os === 'darwin';
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await mkdir(buildRoot, { recursive: true });
  if (!skipInstall) await cleanBuildDirectory(runtime);
  else await access(join(runtime, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js'));
  await cleanBuildDirectory(appRoot);
  const publicRoot = join(buildRoot, 'public');
  await cleanBuildDirectory(publicRoot);
  for (const icon of PUBLIC_ICONS) await copyFile(join(root, 'public', icon), join(publicRoot, icon));
  console.log('构建干净前端（仅包含公开图标，不复制本机词库或数据）…');
  const { build: viteBuild } = await import('vite');
  const viteEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('VITE_')));
  for (const key of Object.keys(viteEnvironment)) delete process.env[key];
  try { await viteBuild({ root, envDir: false, publicDir: publicRoot, build: { outDir: join(runtime, 'dist'), emptyOutDir: true } }); }
  finally { Object.assign(process.env, viteEnvironment); }
  const { build: workerBuild } = await import('esbuild');
  await workerBuild({ entryPoints: [join(root, 'worker/index.ts')], bundle: true, format: 'esm', outfile: join(runtime, 'dist', '_worker.js'), platform: 'browser' });
  await copyProgramFiles();
  // 新建依赖目录只使用锁文件；不从开发机复制 node_modules 或任何配置／凭据。
  const overrides = JSON.parse(await readFile(join(root, 'desktop', 'runtime-dependencies.json'), 'utf8'));
  const runtimePkg = createRuntimePackage(pkg, overrides);
  const lock = JSON.parse(await readFile(join(root, 'desktop', 'runtime-package-lock.json'), 'utf8'));
  if (!sameDependencies(lock.packages[''].dependencies, runtimePkg.dependencies)) throw new Error('桌面运行锁文件已过期，请按 Windows 发布文档同步');
  lock.version = pkg.version;
  lock.packages[''].version = pkg.version;
  if (skipInstall) {
    const previous = JSON.parse(await readFile(join(runtime, 'package-lock.json'), 'utf8'));
    previous.packages[''].version = pkg.version;
    if (JSON.stringify(previous.packages) !== JSON.stringify(lock.packages)) throw new Error('分发依赖已变化，不能复用旧依赖');
  }
  await writeFile(join(runtime, 'package.json'), JSON.stringify(runtimePkg, null, 2) + '\n');
  await writeFile(join(runtime, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  if (!skipInstall) {
    console.log('安装分发运行依赖…');
    const npmCli = await findNpmCli();
    // 不生成 .bin 链接：macOS 上为符号链接，分发审计禁止链接，运行时也直接调用各包入口。
    await run(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-bin-links', '--no-audit', '--no-fund'], { cwd: runtime });
    // ONNX npm 包包含各平台二进制；本安装包只保留目标平台与架构。
    const ortRoot = join(runtime, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3');
    for (const platform of await readdir(ortRoot)) {
      if (platform !== target.os) await pruneRuntimeDirectory(join(ortRoot, platform));
    }
    for (const architecture of await readdir(join(ortRoot, target.os))) {
      if (architecture !== target.arch) await pruneRuntimeDirectory(join(ortRoot, target.os, architecture));
    }
  }
  const metadata = await pruneRuntimeMetadata(join(runtime, 'node_modules'));
  console.log(`精简依赖元数据：移除 ${metadata.removedFiles} 个文件，${(metadata.removedBytes / 1024 / 1024).toFixed(1)} MiB；保留执行文件与许可材料。`);
  console.log('校验并准备内置 Node.js…');
  await prepareNode(target);
  await run(join(runtime, target.nodeFile), ['--no-warnings', '--input-type=module', '-e', "const sharp=(await import('sharp')).default; const ort=await import('onnxruntime-node'); await import('@earendil-works/pi-agent-core'); for(const api of ['openai-completions','openai-responses','anthropic-messages']) await import('@earendil-works/pi-ai/api/'+api); await sharp({create:{width:2,height:2,channels:4,background:'#fff'}}).png().toBuffer(); console.log('运行依赖验证通过：Node '+process.version+', sharp, ONNX, Agent 与模型提供方');"], { cwd: runtime });
  await mkdir(join(appRoot, 'desktop'), { recursive: true });
  for (const file of DESKTOP_FILES) await copyFile(join(root, 'desktop', file), join(appRoot, 'desktop', file));
  await copyDesktopScripts(appRoot);
  await mkdir(join(appRoot, 'services'), { recursive: true });
  await copyFile(join(root, 'services/appReleases.mjs'), join(appRoot, 'services/appReleases.mjs'));
  await mkdir(join(appRoot, 'locales'), { recursive: true });
  for (const file of ['index.mjs', 'messages.json']) await copyFile(join(root, 'locales', file), join(appRoot, 'locales', file));
  await bundleDesktopUpdater(appRoot);
  await writeFile(join(appRoot, 'package.json'), JSON.stringify({ name: 'nai-atelier-desktop', productName: 'NAI Atelier', version: pkg.version, description: 'NovelAI 个人本地创作工坊', author: 'NAI Atelier contributors', license: 'MIT', main: 'desktop/main.mjs', type: 'module', private: true }, null, 2) + '\n');
  const files = await inventory(runtime);
  const ownFiles = files.filter(file => !file.startsWith('node_modules/'));
  if (ownFiles.some(isPrivateDistributionPath)) throw new Error('分发资源包含禁止打包的目录或配置');
  if (files.some(file => file.startsWith('dist/tag-data/') || file.startsWith('public/tag-data/'))) throw new Error('分发资源意外包含本机词库');
  if (files.some(isDistributionMetadata)) throw new Error('分发资源仍包含调试映射或类型声明');
  await writeFile(join(buildRoot, 'distribution-audit.json'), JSON.stringify({ version: pkg.version, target: target.label, ownFiles, runtimeFileCount: files.length, metadataPruned: metadata, personalDataIncluded: false }, null, 2) + '\n');
  console.log(`分发审计通过，${ownFiles.length} 个公开工程文件；生成 ${unpacked ? '解包应用' : '安装包'}…`);
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  delete process.env.CSC_LINK;
  delete process.env.WIN_CSC_LINK;
  const { build, Platform, Arch } = await import('electron-builder');
  const config = (await import('../desktop/builder.config.mjs')).default;
  const platformConfig = isMac
    ? { mac: { ...config.mac, icon: await prepareMacIcon() } }
    : { win: { ...config.win, icon: join(root, 'public/nai-atelier.ico') }, nsis: { ...config.nsis, license: join(root, 'LICENSE'), include: join(root, 'desktop/installer.nsh') } };
  // iCloud 同步的目录（如「文稿」）会给 .app／.framework 加 Finder 信息，codesign 会拒绝签名；
  // macOS 先在系统临时目录组装签名，只把单文件 DMG 复制回 release。
  const release = join(root, 'release');
  const output = isMac ? join(tmpdir(), 'nai-atelier-desktop-release') : release;
  if (isMac) await rm(output, { recursive: true, force: true });
  const targets = isMac ? Platform.MAC.createTarget(unpacked ? 'dir' : 'dmg', Arch[target.arch]) : Platform.WINDOWS.createTarget(unpacked ? 'dir' : 'nsis');
  const artifacts = await build({ projectDir: appRoot, publish: 'never', config: { ...config, directories: { app: '.', output, buildResources: join(root, 'desktop') }, extraResources: config.extraResources.map(entry => ({ ...entry, from: join(root, entry.from) })), ...platformConfig, afterPack: async context => {
    const resourcesRoot = isMac ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : join(context.appOutDir, 'resources');
    const shipped = join(resourcesRoot, 'runtime');
    const resources = await readdir(resourcesRoot);
    for (const retired of ['install-prerequisites.ps1', 'uninstall-integration.ps1']) {
      if (resources.includes(retired)) throw new Error(`分发资源仍包含已移除的安装脚本：${retired}`);
    }
    await access(join(shipped, target.nodeFile));
    await access(join(shipped, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js'));
    await access(join(shipped, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3', target.os, target.arch, 'onnxruntime_binding.node'));
    const { listPackage } = await import('@electron/asar');
    const appFiles = listPackage(join(resourcesRoot, 'app.asar')).filter(file => !file.endsWith('/'));
    if (appFiles.some(file => file.includes('node_modules') || isPrivateDistributionPath(file))) throw new Error('桌面壳包含额外运行依赖或私人文件');
  } }, targets });
  const installers = [];
  for (const built of artifacts.filter(file => /\.(?:exe|dmg)$/.test(file))) {
    const artifact = join(release, basename(built));
    if (built !== artifact) { await mkdir(release, { recursive: true }); await copyFile(built, artifact); }
    await writeFile(`${artifact}.sha256`, `${sha256(await readFile(artifact))}  ${relative(dirname(artifact), artifact)}\n`);
    installers.push(artifact);
  }
  if (isMac) console.log(`签名后的应用位于 ${join(output, `mac-${target.arch}`, 'NAI Atelier.app')}`);
  console.log(`${target.label} 分发构建完成。`);
  return installers.length ? installers : artifacts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildDesktop({ unpacked: process.argv.includes('--dir'), skipInstall: process.argv.includes('--reuse-deps') }).catch(error => { console.error(error); process.exitCode = 1; });
}
