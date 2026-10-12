import { loadAppearancePreferences } from './appearancePreferences';
import { serializeLabWorkspaceMemory } from './labWorkspace';

export interface AppUpdateState {
  phase: 'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'downloaded' | 'installing' | 'error';
  currentVersion: string;
  version: string;
  progress: number;
  allowPrerelease: boolean;
  message: string;
  releaseNotes: string;
}

export interface DesktopUpdateBridge {
  status: () => Promise<AppUpdateState>;
  check: () => Promise<AppUpdateState>;
  download: () => Promise<AppUpdateState>;
  install: () => Promise<AppUpdateState>;
  channel: (value: boolean) => Promise<AppUpdateState>;
  releases: () => Promise<AppUpdateState>;
  onStatus: (callback: (state: AppUpdateState) => void) => () => void;
}

declare global { interface Window { atelierUpdate?: DesktopUpdateBridge } }

export const desktopUpdateBridge = () => window.atelierUpdate;

const UPDATE_DRAFTS_KEY = 'nai-update-lab-drafts';
const LAB_DRAFT_PREFIX = 'nai-lab-workspace-v1:';
/** 更新草稿遵循记忆偏好，只保留文字与参数，不复制图片、Key 或授权状态。 */
export function preserveUpdateDrafts() {
  const preferences = loadAppearancePreferences();
  if (!preferences.rememberGenerationSettings) { clearUpdateDrafts(); return; }
  const entries: Record<string, string> = {};
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key?.startsWith(LAB_DRAFT_PREFIX)) {
      try {
        entries[key] = serializeLabWorkspaceMemory(JSON.parse(sessionStorage.getItem(key) || 'null'), preferences.generationMemory);
      } catch { /* 损坏的草稿不能作为更新恢复记录。 */ }
    }
  }
  localStorage.setItem(UPDATE_DRAFTS_KEY, JSON.stringify({ savedAt: Date.now(), entries }));
}

export const clearUpdateDrafts = () => localStorage.removeItem(UPDATE_DRAFTS_KEY);

export function restoreUpdateDrafts() {
  try {
    const preferences = loadAppearancePreferences();
    if (!preferences.rememberGenerationSettings) { clearUpdateDrafts(); return; }
    const saved = JSON.parse(localStorage.getItem(UPDATE_DRAFTS_KEY) || 'null');
    if (!saved || typeof saved.savedAt !== 'number' || Date.now() - saved.savedAt > 24 * 60 * 60 * 1000 || !saved.entries || typeof saved.entries !== 'object') return;
    for (const [key, value] of Object.entries(saved.entries)) {
      if (!key.startsWith(LAB_DRAFT_PREFIX) || typeof value !== 'string' || sessionStorage.getItem(key)) continue;
      try {
        const draft = JSON.parse(value);
        if (!draft || draft.version !== 1 || !draft.textToImage || !draft.edits || typeof draft.updatedAt !== 'number') continue;
        const remembered = JSON.parse(localStorage.getItem(key) || 'null');
        if (remembered?.updatedAt >= draft.updatedAt) continue;
        // 恢复为持久副本，由工作台按本条目原配置补齐未勾选字段；不能经完整会话绕过范围。
        localStorage.setItem(key, serializeLabWorkspaceMemory(draft, preferences.generationMemory));
      } catch { /* 单个旧草稿损坏不阻断其余工作区恢复。 */ }
    }
    clearUpdateDrafts();
  } catch { /* 浏览器存储不可用时保留现有会话，不覆盖当前草稿。 */ }
}
