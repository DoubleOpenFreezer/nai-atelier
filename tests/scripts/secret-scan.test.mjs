import test from 'node:test';
import assert from 'node:assert/strict';
import { isSensitivePath, scanRepository, scanText } from '../../scripts/secret-scan.mjs';
import { execFileSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';

test('secret scanner detects NovelAI and named literal credentials without echoing values', () => {
  const novelAiKey = ['pst', 'A'.repeat(48)].join('-');
  const namedPassword = ['GUEST_PASSCODE', ' = ', JSON.stringify('private-value-123')].join('');
  const findings = scanText('wrangler.toml', `${novelAiKey}\n${namedPassword}`);
  assert.deepEqual(findings.map(item => item.rule), ['NovelAI persistent token', 'named secret with literal value']);
  assert.equal(JSON.stringify(findings).includes(novelAiKey), false);
  assert.equal(JSON.stringify(findings).includes('private-value-123'), false);
});

test('secret scanner permits documented public constants and placeholder credential URLs', () => {
  const publicConstant = ['CLIENT_SECRET', ' = ', JSON.stringify('public-fixed-value'), ' // secret-scan: allow（公开协议固定值）'].join('');
  assert.deepEqual(scanText('public-client.mjs', publicConstant), []);
  assert.deepEqual(scanText('url.test.mjs', "https://user:pass@example.com"), []);
});

test('secret scanner blocks sensitive filenames but permits templates', () => {
  assert.equal(isSensitivePath('.env'), true);
  assert.equal(isSensitivePath('config/.env.production'), true);
  assert.equal(isSensitivePath('certs/private.key'), true);
  assert.equal(isSensitivePath('.env.example'), false);
  assert.equal(isSensitivePath('local-data/synthetic.txt'), true);
});

test('密钥扫描拦截 Wrangler 本地变量及环境变体，允许公开示例', () => {
  for (const file of ['.dev.vars', '.dev.vars.production', 'config/.dev.vars.staging', 'config\\.dev.vars.local']) {
    assert.equal(isSensitivePath(file), true, file);
  }
  for (const file of ['.env.example', '.env.sample', '.dev.vars.example', 'config/.dev.vars.sample']) {
    assert.equal(isSensitivePath(file), false, file);
  }
});

test('密钥扫描拦截常见无扩展名 SSH 私钥，保留公钥', () => {
  for (const name of ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519']) {
    assert.equal(isSensitivePath(name), true, name);
    assert.equal(isSensitivePath(`keys/${name}`), true, name);
    assert.equal(isSensitivePath(`keys/${name}.pub`), false, name);
  }
});

test('secret scanner detects sk-family variants, hf/gitlab/telegram tokens and unquoted named secrets', () => {
  const stripeKey = 'sk_live_' + 'A'.repeat(24);
  const openRouterKey = 'sk-or-v1-' + 'B'.repeat(24);
  const hfToken = 'hf_' + 'C'.repeat(30);
  const gitlabToken = 'glpat-' + 'D'.repeat(22);
  const telegramToken = '1234567890:' + 'AA' + 'E'.repeat(32);
  const unquoted = 'API_KEY = ' + 'F'.repeat(24);
  const findings = scanText('keys.env.local', [
    stripeKey, openRouterKey, hfToken, gitlabToken, telegramToken, unquoted,
  ].join('\n'));
  assert.deepEqual(findings.map(item => item.rule), [
    'OpenAI or Anthropic API key',
    'OpenAI or Anthropic API key',
    'HuggingFace token',
    'GitLab token',
    'Telegram bot token',
    'named secret with literal value',
  ]);
});

test('named secret rule ignores references to env/config lookups', () => {
  const computed = 'export const apiKey = process.env.NOVELAI_API_KEY;';
  assert.deepEqual(scanText('src.ts', computed), []);
});

test('带引号的常量形状和点号字符串仍是密钥，只有无引号引用豁免', () => {
  for (const value of ['ABCD_EFGHIJKLMNOPQRSTUVWXYZ', 'abc.def.ghi']) {
    const source = ['const PASSWORD = ', JSON.stringify(value), ';'].join('');
    assert.equal(scanText('config.ts', source).length, 1);
  }
  assert.deepEqual(scanText('config.ts', 'const API_KEY = CONFIG_API_KEY;'), []);
});

test('暂存 UTF-16 两种字节序都扫描，跟踪文件读取失败不伪报通过', () => {
  const root = createWorkspace('secret-scan-');
  const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, stdio: 'pipe' });
  try {
    git('init', '-q');
    const text = ['PASSWORD = ', JSON.stringify('synthetic-private-value')].join('');
    writeFileSync(join(root, 'little.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
    writeFileSync(join(root, 'big.txt'), Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]));
    writeFileSync(join(root, 'plain-le.txt'), Buffer.from(text, 'utf16le'));
    writeFileSync(join(root, 'plain-be.txt'), Buffer.from(text, 'utf16le').swap16());
    writeFileSync(join(root, 'image.bin'), Buffer.from([0, 1, 2, 3]));
    git('add', '.');
    assert.deepEqual(scanRepository({ staged: true, cwd: root }).map(item => item.file), ['big.txt', 'little.txt', 'plain-be.txt', 'plain-le.txt']);
    unlinkSync(join(root, 'little.txt'));
    assert.throws(() => scanRepository({ cwd: root }), { code: 'ENOENT' });
    git('update-index', '--add', '--cacheinfo', `100644,${'1'.repeat(40)},missing.txt`);
    assert.throws(() => scanRepository({ staged: true, cwd: root }));
  } finally { removeWorkspace(root); }
});
