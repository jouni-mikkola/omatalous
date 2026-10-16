/** What the two pages of Asetukset share: the run of one action with its message, and the scroll to a card an address names. */
import { useCallback, useEffect, useRef, useState } from "react";

export type Message = { tone: "good" | "warning"; text: string };

/** One action at a time: `busy` names the one running, `message` is what it said. The page reloads what it shows through `onChange`. */
export function useRunner(onChange: () => void, initial: () => Message | null = () => null) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(initial);
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    try {
      const text = await fn();
      if (text) setMessage({ tone: "good", text });
      onChange();
    } catch (err) {
      setMessage({ tone: "warning", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return { busy, message, setMessage, run };
}

/**
 * An address names a card (`#kirjautuminen`): scroll to it once, after the cards above it have loaded their own data, so
 * the card does not move away after the scroll. `key` changes with the address, so a link on the open page scrolls again.
 */
export function useCardScroll(target: string | undefined, key: string, settled: boolean): void {
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!target || !settled || scrolledFor.current === key) return;
    scrolledFor.current = key;
    const card = document.getElementById(target);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    // a part of a card above that loads on its own (the remote access in Palvelin) grows after the card has its data and
    // moves the target: follow it for a moment, until the reader scrolls or presses a key
    const follow = new ResizeObserver(() => card.scrollIntoView({ block: "start" }));
    follow.observe(document.body);
    const reader = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    const stop = () => {
      follow.disconnect();
      clearTimeout(timer);
      for (const type of reader) window.removeEventListener(type, stop);
    };
    const timer = setTimeout(stop, 3000);
    for (const type of reader) window.addEventListener(type, stop, { passive: true });
    return stop;
  }, [key, target, settled]);
}

/** Counts the cards that report their data loaded. A page is settled when the count reaches the number of cards it waits for. */
export function useLoadedCount(): [number, () => void] {
  const [count, setCount] = useState(0);
  const loaded = useCallback(() => setCount((n) => n + 1), []);
  return [count, loaded];
}

/** Tells the page once, when `done` turns true, that this card has its data, or (`failed`) that its read failed and the card shows its error. */
export function useReportLoaded(done: boolean, onLoaded?: (failed: boolean) => void, failed = false): void {
  useEffect(() => {
    if (done) onLoaded?.(failed);
  }, [done, failed, onLoaded]);
}
