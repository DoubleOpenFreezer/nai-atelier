import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppearancePreferences, AppearancePreset } from '../services/appearancePreferences';
import { sharedAppearancePresets } from '../services/sharedAppearancePresets';

export function useSharedAppearancePresets(open: boolean, preferences: AppearancePreferences, setPreferences: Dispatch<SetStateAction<AppearancePreferences>>) {
  const current = useRef(preferences);
  current.current = preferences;
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const writing = useRef(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (writing.current) return;
    const request = ++sequence.current;
    try {
      const customPresets = await sharedAppearancePresets.load(current.current.customPresets);
      if (request !== sequence.current) return;
      setPreferences(previous => ({ ...previous, customPresets }));
      setError(false);
      setReady(true);
    } catch {
      if (request === sequence.current) setError(true);
    }
  }, [setPreferences]);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const focus = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { sequence.current++; window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [open, refresh]);
  const change = async (operation: () => Promise<AppearancePreset[]>, patch?: (previous: AppearancePreferences) => Partial<AppearancePreferences>) => {
    if (!ready || writing.current) return false;
    writing.current = true;
    sequence.current++;
    setBusy(true);
    try {
      const customPresets = await operation();
      setPreferences(previous => ({ ...previous, ...patch?.(previous), customPresets }));
      setError(false);
      return true;
    } catch { setError(true); return false; }
    finally { writing.current = false; setBusy(false); }
  };
  return { ready, busy, error, refresh, change };
}
