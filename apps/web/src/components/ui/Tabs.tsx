import { type ReactNode, useEffect, useRef } from "react";

/** A sub-pixel scroll position or width is not a hidden tab. */
const SLACK = 1;

/** Which ends of the row have tabs out of sight: the start once it is scrolled, the end while more lies beyond. */
export function hiddenEdges(scrollLeft: number, viewWidth: number, rowWidth: number): { start: boolean; end: boolean } {
  return { start: scrollLeft > SLACK, end: scrollLeft + viewWidth < rowWidth - SLACK };
}

/** Where to scroll the row so the open tab is in sight: where it is when the tab is whole in view, else the tab in the middle. */
export function scrollToShow(scrollLeft: number, viewWidth: number, tabLeft: number, tabWidth: number): number {
  if (tabLeft >= scrollLeft && tabLeft + tabWidth <= scrollLeft + viewWidth) return scrollLeft;
  return Math.max(0, tabLeft - (viewWidth - tabWidth) / 2);
}

const mark = (el: HTMLElement, name: string, on: boolean) => (on ? el.setAttribute(name, "") : el.removeAttribute(name));

/**
 * The one row of tabs of the app: links to the views of one subject, the open one marked `aria-current` and underlined.
 * Where the tabs do not fit the row scrolls sideways with a fade at the end that has more (a page may wrap it where a
 * phone cannot hold them, settings.css), and the open tab is brought into sight when the row is drawn and when the open
 * tab changes. Choices that filter one list are
 * `Segmented`.
 */
export function Tabs({ label, children }: { label: string; children: ReactNode }) {
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const fade = () => {
      const edges = hiddenEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
      mark(el, "data-fade-start", edges.start);
      mark(el, "data-fade-end", edges.end);
    };
    const reveal = () => {
      const open = el.querySelector<HTMLElement>("[aria-current]");
      if (open) el.scrollLeft = scrollToShow(el.scrollLeft, el.clientWidth, open.offsetLeft, open.offsetWidth);
      fade();
    };
    reveal();
    el.addEventListener("scroll", fade, { passive: true });
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fade);
    resized?.observe(el);
    const changed = new MutationObserver(reveal);
    changed.observe(el, { attributes: true, attributeFilter: ["aria-current"], childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", fade);
      resized?.disconnect();
      changed.disconnect();
    };
  }, []);
  return (
    <nav ref={row} className="tabs" aria-label={label}>
      {children}
    </nav>
  );
}
