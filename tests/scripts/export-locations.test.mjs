import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createWorkspace, removeWorkspace } from '../support/workspace.mjs';
import { exportWithPreferences, getDefaultExportDirectory, handleExportLocationRequest, saveExportFile } from '../../scripts/export-locations.mjs';
import { getStoragePreferences, updateStoragePreferences } from '../../scripts/storage-locations.mjs';

test('导出状态仅展示安装版注入的真实默认目录，源码默认路径保持未知', async () => {
  const root = createWorkspace('export-system-');
  try {
    for (const systemDirectory of ['', 'E:\\实际下载目录']) {
      const req = Readable.from([]); req.method = 'GET'; req.url = '/api/local-maintenance/export-location';
      let result; const res = { writeHead() {}, end(value) { result = JSON.parse(value); } };
      await handleExportLocationRequest(req, res, { workspace: root, canManage: true, systemDirectory });
      assert.equal(result.systemDirectory, systemDirectory);
    }
  } finally { removeWorkspace(root); }
});

test('选择请求断开后迟到路径不得保存，取消的排队偏好写入保持原设置', { skip: process.platform !== 'win32' }, async () => {
  const root = createWorkspace('export-abort-');
  try {
    await updateStoragePreferences({ exportMode: 'system', exportDir: 'original' }, root);
    const req = Readable.from([Buffer.from(JSON.stringify({ action: 'pick' }))]); req.method = 'POST'; req.url = '/api/local-maintenance/export-location'; req.headers = { 'x-nai-local-control': 'true' };
    const res = new EventEmitter(); res.writeHead = () => {}; res.end = () => {};
    let finish, reached; const called = new Promise(done => { reached = done; });
    const pending = handleExportLocationRequest(req, res, { workspace: root, canManage: true, pickDirectory: () => new Promise(done => { finish = done; reached(); }) });
    await called; res.destroyed = true; res.emit('close'); finish({ cancelled: false, path: 'E:\\迟到目录' }); await pending;
    assert.equal((await getStoragePreferences(root)).exportDir, 'original');
    const controller = new AbortController();
    const queued = updateStoragePreferences({ exportDir: 'late' }, root, { signal: controller.signal });
    controller.abort(); await assert.rejects(queued, /abort/i);
    assert.equal((await getStoragePreferences(root)).exportDir, 'original');
  } finally { removeWorkspace(root); }
});

test('导出副本原子避让同名文件，拒绝越界文件名与不可用目录', async () => {
  const root = createWorkspace('export-copies-');
  try {
    const copies = await Promise.all([1,2,3].map(value => saveExportFile({data:Buffer.from(String(value)),filename:'作品.png',directory:root})));
    assert.equal(new Set(copies.map(value=>value.path)).size,3);
    assert.deepEqual((await Promise.all(copies.map(value=>readFile(value.path,'utf8')))).sort(),['1','2','3']);
    await assert.rejects(saveExportFile({data:Buffer.from('x'),filename:'../private.png',directory:root}),/文件名无效/);
    await assert.rejects(saveExportFile({data:Buffer.from('x'),filename:'x.png',directory:join(root,'missing')}),/ENOENT/);
    assert.equal((await readdir(root)).length,3);
  } finally { removeWorkspace(root); }
});
test('明确目录实际写入，系统浏览器默认只移交下载，每次询问取消不生成文件',async()=>{
  const root=createWorkspace('export-modes-');
  try{
    const directory=join(root,'exports');await mkdir(directory);
    const options={workspace:root,data:Buffer.from('synthetic'),filename:'work.png',pickDirectory:async()=>({cancelled:true,path:''})};
    assert.deepEqual(await exportWithPreferences(options),{saved:false,cancelled:false,browserDownload:true});
    await updateStoragePreferences({exportMode:'directory',exportDir:directory},root);
    assert.equal(await getDefaultExportDirectory(root),directory);
    assert.equal((await exportWithPreferences(options)).saved,true);
    await updateStoragePreferences({exportMode:'ask'},root);
    assert.equal(await getDefaultExportDirectory(root),'');
    assert.deepEqual(await exportWithPreferences(options),{saved:false,cancelled:true});
    assert.deepEqual(await readdir(directory),['work.png']);
  }finally{removeWorkspace(root);}
});
test('目录选择取消保留偏好，LAN请求无权读取或写入电脑导出目录',async()=>{
  const root=createWorkspace('export-auth-');
  const request=async(canManage,body)=>{
    const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.url='/api/local-maintenance/export-location';req.method='POST';req.headers={'x-nai-local-control':'true'};
    let status=0,result;const res={writeHead(value){status=value;},end(value){result=JSON.parse(value);}};
    assert.equal(await handleExportLocationRequest(req,res,{workspace:root,canManage,pickDirectory:async()=>({cancelled:true,path:''})}),true);
    return {status,result};
  };
  try{
    await updateStoragePreferences({exportMode:'system',exportDir:'remembered'},root);
    assert.equal((await request(false,{action:'clear'})).status,403);
    if(process.platform==='win32')assert.deepEqual((await request(true,{action:'pick'})).result,{cancelled:true});
    assert.equal((await getStoragePreferences(root)).exportDir,'remembered');
    assert.equal((await request(true,{action:'save',data:'!',filename:'x.png'})).status,400);
  }finally{removeWorkspace(root);}
});
