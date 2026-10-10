// 仅缓存浏览数据；收藏原件继续存入工坊持久层。
const memory = new Map<string, unknown>();
let opening: Promise<IDBDatabase> | undefined;
const open = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === 'undefined') { reject(new Error('浏览缓存不可用')); return; }
  const request = indexedDB.open('nai-codex-cache', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'key' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function readCodexCache<T>(key: string): Promise<T | undefined> {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const db = await open();
    return await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction('records').objectStore('records').get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  } catch { return undefined; }
}

export async function writeCodexCache(key: string, value: unknown) {
  memory.set(key, value);
  while (memory.size > 40) memory.delete(memory.keys().next().value!);
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      const store = transaction.objectStore('records');
      store.put({ key, value, at: Date.now() });
      const request = store.getAll();
      request.onsuccess = () => {
        // 保留每本书最近一次快照，辅助资源按访问时间淘汰；不累积发布版本。
        const records = request.result.sort((a, b) => b.at - a.at);
        for (const record of records.slice(40)) store.delete(record.key);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch { /* 存储额度不足仍保留本次浏览；原图收藏的写入错误不能走此缓存路径。 */ }
}
