import { RefObject, useEffect } from 'react';

/** 瀑布流按任一列的实际末尾追加；普通网格继续使用原列表底部哨兵。 */
export const useGalleryLoadMore = (
  rootRef: RefObject<HTMLElement | null>,
  sentinelRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  loadMore: () => void,
  rootMargin: string,
) => {
  useEffect(() => {
    const root = rootRef.current;
    const sentinel = sentinelRef.current;
    if (!enabled || !root || !sentinel || !('IntersectionObserver' in window)) return;
    let requested = false;
    const observer = new IntersectionObserver(entries => {
      if (!requested && entries.some(entry => entry.isIntersecting)) {
        requested = true;
        loadMore();
      }
    }, { root, rootMargin });
    const observeEnds = () => {
      observer.disconnect();
      // 分组列表只看最后一组；首帧还未测出列宽时等列尾出现，不误把空容器当成触底。
      const masonry = root.querySelectorAll('.chain-masonry');
      const targets = masonry.length ? masonry[masonry.length - 1].querySelectorAll('[data-masonry-load-end]') : [sentinel];
      targets.forEach(target => observer.observe(target));
    };
    observeEnds();
    const mutation = new MutationObserver(observeEnds);
    mutation.observe(root, { childList: true, subtree: true });
    return () => { observer.disconnect(); mutation.disconnect(); };
  }, [rootRef, sentinelRef, enabled, loadMore, rootMargin]);
};
