import { RefObject, useLayoutEffect, useRef } from 'react';

/**
 * 返回常驻列表时保留原视口；若目标卡片因排序变化离开视口，再将其滚回可见区域。
 */
export const useRestoreListAnchor = (
  scrollRef: RefObject<HTMLElement | null>,
  targetId?: string,
  readyKey?: string | number,
  resetKey?: unknown,
) => {
  const restoredTargetRef = useRef<string | undefined>(undefined);
  const previousResetKey = useRef(resetKey);

  useLayoutEffect(() => {
    // 主动筛选压过旧返回目标，即使该目标此时尚未出现在结果里。
    if (!Object.is(previousResetKey.current, resetKey)) {
      previousResetKey.current = resetKey;
      restoredTargetRef.current = targetId;
    }
    if (!targetId) {
      restoredTargetRef.current = undefined;
      return;
    }
    if (restoredTargetRef.current === targetId) return;

    const root = scrollRef.current;
    if (!root) return;
    const target = Array.from(root.querySelectorAll<HTMLElement>('[data-return-item-id]'))
      .find(element => element.dataset.returnItemId === targetId);
    if (!target) return;

    const rootRect = root.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const style = getComputedStyle(root);
    const topInset = parseFloat(style.scrollPaddingTop) || 0;
    const bottomInset = parseFloat(style.scrollPaddingBottom) || 0;
    const isVisible = targetRect.bottom > rootRect.top + topInset && targetRect.top < rootRect.bottom - bottomInset;
    if (!isVisible) {
      const centeredTop = root.scrollTop + targetRect.top - rootRect.top
        - (rootRect.height + topInset - bottomInset - targetRect.height) / 2;
      root.scrollTop = Math.max(0, centeredTop);
    }
    restoredTargetRef.current = targetId;
  }, [readyKey, scrollRef, targetId, resetKey]);
};
