/*
 * P0 验证用 CDP 小工具（只读浏览器交互，不写任何业务数据）。
 * 用法（被其它脚本 import）：
 *   const { launch, sleep } = await import('./p0-cdp.mjs');
 *   const c = await launch({ port: 9721, profile: '.chrome-p0a' });
 *   await c.goto('http://127.0.0.1:3000/');
 *   const v = await c.eval('1+1');
 *   await c.close();
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe' : '',
].filter(Boolean);

export const sleep = ms => new Promise(r => setTimeout(r, ms));

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.logs = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const c = new Cdp(ws);
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && c.pending.has(m.id)) {
        const { resolve, reject } = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method === 'Runtime.consoleAPICalled') {
        c.logs.push({ type: m.params.type, text: (m.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ') });
      } else if (m.method === 'Network.responseReceived') {
        c.lastResponses = c.lastResponses || [];
        c.lastResponses.push({ url: m.params.response.url, status: m.params.response.status });
      }
    });
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails) };
    return r.result.value;
  }
  /** 等页面出现某个表达式为真（返回真值），超时抛错。 */
  async waitFor(expression, { timeout = 60000, step = 700, label = expression } = {}) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = await this.eval(expression);
      if (v && v !== 0 && !(v && v.__error)) return v;
      await sleep(step);
    }
    throw new Error('waitFor 超时: ' + label);
  }
  async screenshot(file) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png' });
    const fs = await import('node:fs');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    return file;
  }
  async close() {
    try { await this.send('Browser.close'); } catch { /* ignore */ }
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

export async function launch({ port = 9721, profile = '.chrome-p0', width = 1500, height = 1100, url = 'about:blank' } = {}) {
  const chrome = CHROME_CANDIDATES.find(p => existsSync(p));
  if (!chrome) throw new Error('找不到 chrome.exe');
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile.startsWith('C:') || profile.startsWith('/') ? profile : process.cwd() + '\\' + profile}`,
    `--remote-debugging-port=${port}`, `--window-size=${width},${height}`, url,
  ], { stdio: 'ignore', windowsHide: true });
  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(400);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* 还没起来 */ }
  }
  if (!target) { try { child.kill(); } catch {} throw new Error('CDP 未就绪'); }
  const c = await Cdp.connect(target.webSocketDebuggerUrl);
  c.child = child;
  await c.send('Runtime.enable');
  await c.send('Network.enable');
  await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  await c.send('Page.enable');
  c.goto = async (u) => { await c.send('Page.navigate', { url: u }); };
  return c;
}
