import { type PointerEvent as ReactPointerEvent, type RefObject, useEffect, useRef } from 'react';

const MIN_THUMB = 28;

/**
 * A thin scrollbar drawn over the edge of `target` (whose native bar is hidden in CSS), so the
 * content never loses width or jumps sideways when it starts or stops overflowing. Render it as a
 * sibling of `target` inside a positioned wrapper. Purely visual: wheel, touch and keyboard still
 * scroll the element itself, and the thumb can be dragged with a mouse.
 */
export function OverlayScrollbar({ target }: { target: RefObject<HTMLElement | null> }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerY: number; scrollTop: number } | null>(null);

  useEffect(() => {
    const el = target.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb) return;

    const sync = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const scrollable = scrollHeight - clientHeight > 1;
      track.dataset.visible = String(scrollable);
      if (!scrollable) return;
      const thumbHeight = Math.max(MIN_THUMB, (clientHeight * clientHeight) / scrollHeight);
      const offset = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - thumbHeight);
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.transform = `translateY(${offset}px)`;
    };

    // Content height changes (sections folding, mode switches) don't resize the scroller itself,
    // so watch its children too, and re-watch them whenever they change.
    const resize = new ResizeObserver(sync);
    const observeChildren = () => {
      resize.disconnect();
      resize.observe(el);
      for (const child of el.children) resize.observe(child);
      sync();
    };
    const mutations = new MutationObserver(observeChildren);
    mutations.observe(el, { childList: true });
    observeChildren();
    el.addEventListener('scroll', sync, { passive: true });
    return () => {
      el.removeEventListener('scroll', sync);
      mutations.disconnect();
      resize.disconnect();
    };
  }, [target]);

  /** Scroll distance per pixel of thumb travel. */
  const ratio = (el: HTMLElement) => {
    const thumbHeight = thumbRef.current?.offsetHeight ?? MIN_THUMB;
    const travel = el.clientHeight - thumbHeight;
    return travel > 0 ? (el.scrollHeight - el.clientHeight) / travel : 0;
  };

  const onThumbDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = target.current;
    if (!el || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerY: event.clientY, scrollTop: el.scrollTop };
    trackRef.current?.setAttribute('data-dragging', 'true');
  };

  const onThumbMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = target.current;
    if (!el || !drag.current) return;
    el.scrollTop = drag.current.scrollTop + (event.clientY - drag.current.pointerY) * ratio(el);
  };

  const onThumbUp = () => {
    drag.current = null;
    trackRef.current?.removeAttribute('data-dragging');
  };

  // A click on the bare track pages towards the click, like a native scrollbar.
  const onTrackDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = target.current;
    const thumb = thumbRef.current;
    if (!el || !thumb || event.button !== 0) return;
    const above = event.clientY < thumb.getBoundingClientRect().top;
    el.scrollBy({ top: (above ? -1 : 1) * el.clientHeight * 0.9, behavior: 'smooth' });
  };

  return (
    <div ref={trackRef} className="overlay-scrollbar" aria-hidden onPointerDown={onTrackDown}>
      <div
        ref={thumbRef}
        className="overlay-scrollbar-thumb"
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
      />
    </div>
  );
}
