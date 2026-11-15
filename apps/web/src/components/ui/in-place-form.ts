import { type KeyboardEvent, type SyntheticEvent, useEffect, useRef, useState } from "react";

const FIELD = "form :is(input, select, textarea):not([type=hidden]):not(:disabled)";

/**
 * A form that opens in place of its button. The button unmounts on open and the form on close, so without help the
 * focus falls to the start of the page both times. The region (the card around both) gets `region`: on open the focus
 * goes to the form's first field, on close back to the element marked `data-opener`. Escape closes a form nobody has
 * typed in yet; once a field changed, Escape does nothing, so a slip of the key loses no input.
 */
export function useInPlaceForm(initial = false) {
  const [open, setOpenState] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const was = useRef(open);
  const changed = useRef(false);
  useEffect(() => {
    if (open === was.current) return;
    was.current = open;
    const at = open ? FIELD : "[data-opener]";
    ref.current?.querySelector<HTMLElement>(at)?.focus();
  }, [open]);
  const setOpen = (next: boolean) => {
    changed.current = false;
    setOpenState(next);
  };
  // a dialog the card opens (Muokkaa, Poista) sits inside it in the React tree, so its keys and changes bubble here;
  // they are the dialog's own and must not close or mark the form
  const own = (e: SyntheticEvent) => (e.target as Element).closest("dialog") === (ref.current?.closest("dialog") ?? null);
  const region = {
    ref,
    onChange: (e: SyntheticEvent) => {
      if (own(e)) changed.current = true;
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !open || changed.current || !own(e)) return;
      e.preventDefault();
      setOpen(false);
    },
  };
  return { open, setOpen, region };
}
