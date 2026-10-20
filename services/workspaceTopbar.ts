import { useSyncExternalStore } from 'react';

/**
 * 页面顶栏收起状态：所有 keep-alive 页面共用一份，刷新后保留。
 * 收起后顶栏与状态行整体隐藏，只在顶边中央留下一个展开把手。
 */
const STORAGE_KEY = 'nai_workspace_topbar_collapsed';
const listeners = new Set<() => void>();

const read = (): boolean => {
  try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
};

let collapsed = typeof window === 'undefined' ? false : read();

const emit = () => listeners.forEach(listener => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** 跨标签页同步；同一窗口由模块内监听集合即时通知。 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    collapsed = read();
    emit();
  });
}

export const getTopbarCollapsed = () => collapsed;

export const setTopbarCollapsed = (value: boolean) => {
  if (collapsed === value) return;
  collapsed = value;
  try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* 隐私模式仍保留本次会话状态 */ }
  emit();
};

export const toggleTopbarCollapsed = () => setTopbarCollapsed(!collapsed);

export const useTopbarCollapsed = () => useSyncExternalStore(subscribe, getTopbarCollapsed, () => false);
