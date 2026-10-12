import { beginExportTarget, saveExportBlob } from './exportLocation';

/** 用户主动导出文件；手机系统选择目录，成功写入后才给出完成回执。 */
export async function downloadFile(blob: Blob, filename: string, target = beginExportTarget()) {
  return saveExportBlob(blob, filename, target);
}
