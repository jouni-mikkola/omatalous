import { useEffect, useRef, useState } from "react";

/**
 * The ref of a `<dialog>` that opens as a modal when it mounts. When it unmounts (Escape, Peruuta, a decision) the
 * focus goes back to what had it before, the button that opened it (for a menu item, the button of its menu), if that button is still on the page.
 */
export function useModal() {
  const ref = useRef<HTMLDialogElement>(null);
  // read in render: an autoFocus inside the dialog has moved the focus by the time an effect runs
  const [opener] = useState(() => {
    if (typeof document === "undefined" || !(document.activeElement instanceof HTMLElement)) return null;
    const active = document.activeElement;
    // a menu item that opened the dialog is gone when it closes: the button that opened its menu is still marked as open here, before the commit
    if (active.getAttribute("role") === "menuitem") return document.querySelector<HTMLElement>('[aria-haspopup][aria-expanded="true"]') ?? active;
    return active;
  });
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);
  return ref;
}
