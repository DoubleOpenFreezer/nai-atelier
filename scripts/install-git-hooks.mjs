#!/usr/bin/env node
// 通过 Git 定位 hook（支持 worktree 与 core.hooksPath），npm install 时自动执行。
// 手动执行：node scripts/install-git-hooks.mjs
import { mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = `#!/bin/sh
# 由 scripts/install-git-hooks.mjs 生成：提交前质量门禁，任一失败即阻止提交
cd "$(git rev-parse --show-toplevel)" || exit 1

node scripts/check-staged.mjs
`;

export const installGitHooks = (projectDir = root) => {
  const git = (...args) => execFileSync('git', args, { cwd: projectDir, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }).trim();
  if (!existsSync(path.join(projectDir, '.git'))) {
    console.error('项目没有自己的 Git 元数据，跳过 git hooks 安装');
    return;
  }
  const repositoryRoot = git('rev-parse', '--show-toplevel');
  if (path.resolve(repositoryRoot) !== path.resolve(projectDir)) {
    console.error('项目没有自己的 Git 元数据，跳过 git hooks 安装');
    return;
  }
  const hooksDir = git('rev-parse', '--path-format=absolute', '--git-path', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const target = path.join(hooksDir, 'pre-commit');
  writeFileSync(target, HOOK);
  chmodSync(target, 0o755);
  console.log(`pre-commit hook 已安装到 ${target}`);
  return target;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) installGitHooks();
