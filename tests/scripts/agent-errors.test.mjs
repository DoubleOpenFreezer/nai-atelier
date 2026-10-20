import test from 'node:test';
import assert from 'node:assert/strict';
import { humanizeAgentError, parseAgentError } from '../../scripts/agent-errors.mjs';

test('余额不足等 provider 错误转成可操作说明，原始 JSON 保留在详情', () => {
  const raw = '402: {"message":"Insufficient Balance (request_id: 41a67b6f-c4e3-4846-9b09-b5812978a44e)","type":"unknown_error","param":null,"code":"invalid_request_error"}';
  const result = humanizeAgentError(raw);
  assert.match(result.summary, /余额不足/);
  assert.match(result.detail, /request_id/);
  assert.equal(parseAgentError(raw).status, 402);
});

test('常见状态码与网络错误都有中文说明', () => {
  assert.match(humanizeAgentError('401: {"message":"Invalid API key"}').summary, /API Key 无效/);
  assert.match(humanizeAgentError('429: {"message":"Rate limit reached"}').summary, /过于频繁/);
  assert.match(humanizeAgentError('500: Internal Server Error').summary, /内部错误/);
  assert.match(humanizeAgentError('fetch failed').summary, /无法连接/);
  assert.match(humanizeAgentError('OpenAI (400): {"error":{"message":"content policy violation"}}').summary, /审核拦截/);
});

test('本地中文错误与未知原文原样返回，不换成无信息量的通用句', () => {
  const local = humanizeAgentError('电脑当前最多同时运行 3 个助手任务，请稍后再试');
  assert.equal(local.summary, '电脑当前最多同时运行 3 个助手任务，请稍后再试');
  assert.equal(local.detail, '');
  const unknown = humanizeAgentError('weird upstream failure');
  assert.equal(unknown.summary, 'weird upstream failure');
  assert.equal(unknown.detail, '');
  assert.match(humanizeAgentError('402 status code (no body)').summary, /余额不足/);
});

test('超长错误只保留有界详情，不无限增长', () => {
  const result = humanizeAgentError('402: ' + 'x'.repeat(5000));
  assert.ok(result.detail.length <= 2100);
  assert.match(result.detail, /已截断/);
});
