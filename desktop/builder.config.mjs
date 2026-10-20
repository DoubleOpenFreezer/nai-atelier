export default {
  appId: 'com.naiatelier.desktop',
  productName: 'NAI Atelier',
  directories: { app: '.desktop-build/app', output: 'release', buildResources: 'desktop' },
  files: ['desktop/**/*', 'scripts/desktop-runtime.mjs', 'scripts/storage-locations.mjs', 'scripts/export-locations.mjs', 'services/appReleases.mjs', 'locales/**/*', 'package.json', '!node_modules{,/**/*}'],
  // extraResources 的根 node_modules 会被打包器默认跳过，需要独立映射。
  extraResources: [
    { from: '.desktop-build/runtime', to: 'runtime', filter: ['**/*'] },
    { from: '.desktop-build/runtime/node_modules', to: 'runtime/node_modules', filter: ['**/*'] },
  ],
  asar: true,
  npmRebuild: false,
  publish: { provider: 'github', owner: 'HelloQun54321', repo: 'nai-atelier', releaseType: 'release' },
  electronVersion: '44.5.1',
  electronLanguages: ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'public/nai-atelier.ico',
    artifactName: 'NAI-Atelier-Setup-${version}-${arch}.${ext}',
  },
  // macOS 版没有 Apple 开发者证书：使用临时（ad-hoc）签名让 Apple 芯片可以运行；
  // 不启用 Hardened Runtime，内置 Node 的 V8 JIT 才能在无授权文件时正常工作。
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    category: 'public.app-category.graphics-design',
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    artifactName: 'NAI-Atelier-${version}-mac-${arch}.${ext}',
  },
  dmg: {
    title: 'NAI Atelier ${version}',
    artifactName: 'NAI-Atelier-${version}-mac-${arch}.${ext}',
  },
  nsis: {
    useZip: true,
    differentialPackage: false,
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'NAI Atelier',
    uninstallDisplayName: 'NAI Atelier',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    installerLanguages: ['zh_CN', 'zh_TW', 'en_US', 'ja_JP', 'ko_KR'],
    displayLanguageSelector: true,
    language: '2052',
    license: 'LICENSE',
    include: 'desktop/installer.nsh',
  },
};
