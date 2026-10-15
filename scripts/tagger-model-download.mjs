import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

export const fileSize = async path => { try { return (await stat(path)).size; } catch (error) { if (error.code === 'ENOENT') return 0; throw error; } };
export async function verifiedFile(path, file, signal) {
  signal?.throwIfAborted();
  if (await fileSize(path) !== file.size) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex') === file.sha256;
}

/** 仅处理注册表内的固定文件；保留中断副本，下一次由用户操作续传。 */
export async function downloadTaggerFile({ model, file, directory, fetchRemote, signal, onProgress }) {
  signal.throwIfAborted();
  await mkdir(directory, { recursive: true });
  const destination = join(directory, file.name);
  const partial = `${destination}.download`;
  if (await fileSize(destination) === file.size) onProgress(file.size, 'verifying');
  if (await verifiedFile(destination, file, signal)) { onProgress(file.size, 'verified'); return; }
  let offset = await fileSize(partial);
  if (offset >= file.size) {
    if (offset === file.size) onProgress(offset, 'verifying');
    if (offset === file.size && await verifiedFile(partial, file, signal)) {
      signal.throwIfAborted(); await rename(partial, destination); onProgress(file.size, 'verified'); return;
    }
    await unlink(partial); offset = 0;
  }
  onProgress(offset, 'downloading');
  const response = await fetchRemote(`https://huggingface.co/${model.id}/resolve/${model.revision}/${file.sourcePath || file.name}`, {
    redirect: 'follow', signal,
    headers: { 'user-agent': file.label ? 'NAI-Atelier local resource downloader' : 'NAI-Atelier local image tagger', 'accept-encoding': 'identity', ...(offset ? { range: `bytes=${offset}-` } : {}) },
  });
  const rejectResponse = async message => { await response.body?.cancel().catch(() => {}); throw new Error(message); };
  const label = file.label || '模型';
  if (!response.ok || !response.body) return rejectResponse(`${label}下载失败（HTTP ${response.status}），请检查 Hugging Face 网络连接`);
  if (response.status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
    if (!range || Number(range[1]) !== offset || Number(range[2]) !== file.size - 1 || Number(range[3]) !== file.size) {
      await unlink(partial).catch(error => { if (error.code !== 'ENOENT') throw error; });
      return rejectResponse('续传响应范围不正确；临时副本已清理，请重新下载');
    }
  } else if (response.status === 200) offset = 0;
  else return rejectResponse(`${label}下载响应不正确`);
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) !== file.size - offset) return rejectResponse(`${label}下载长度与固定版本不一致`);
  let received = offset;
  const counter = new Transform({ transform(chunk, _encoding, done) {
    if (received + chunk.length > file.size) return done(new Error(`${label}下载内容超过预期大小`));
    received += chunk.length; onProgress(received, 'downloading'); done(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(partial, { flags: offset ? 'a' : 'w' }), { signal });
  if (received !== file.size) throw new Error(`${label}下载中断；再次下载可从已接收位置继续`);
  onProgress(received, 'verifying');
  if (!await verifiedFile(partial, file, signal)) { await unlink(partial); throw new Error(`${label} SHA-256 校验失败；损坏的下载副本已移除，请重新下载`); }
  signal.throwIfAborted();
  await rename(partial, destination); onProgress(received, 'verified');
}
