import { useSyncExternalStore } from 'react';

/** Phones and portrait tablets: the stage sits above a bottom sheet (must match styles.css). */
export const NARROW_LAYOUT_QUERY = '(max-aspect-ratio: 4 / 5), (max-width: 760px)';
/** Small landscape tablets and laptops get a slimmer sidebar (must match styles.css). */
export const COMPACT_SIDEBAR_QUERY = '(max-width: 1100px)';

/** Live `matchMedia` result; false where matchMedia is unavailable. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = globalThis.matchMedia?.(query);
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    () => globalThis.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
