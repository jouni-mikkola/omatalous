/**
 * What an add-on module adds to the web app, the web half of the server's extensions.ts (docs/MODULES.md). Empty unless
 * the server loaded a module and the page names it; `module-host.ts` then fills it before the first render.
 */
import type { ComponentType } from "react";
import type { TransactionItem } from "./types.ts";

export interface WebExtension {
  /** The server extension's id: its route prefix and its page id. */
  readonly id: string;
  /** A card of Asetukset > Lisäosa, the target a loaded module brings, above the add-on's own card (AddOnPage.tsx). */
  readonly settingsCard?: ComponentType;
  /** The anchor of that card, so an address that names it opens Lisäosa. */
  readonly settingsAnchor?: string;
  /** A page of its own at `/<id>`, its nav entry after the shared ones. */
  readonly page?: { readonly label: string; readonly component: ComponentType<{ params: URLSearchParams }> };
  /** Labels of its security events in Asetukset > Turvallisuus. */
  readonly securityLabels?: Readonly<Record<string, string>>;
  /** Under a row of Tapahtumat: what the server extension adds to the row; nothing for a row it adds nothing to. */
  readonly rowPart?: ComponentType<{ row: TransactionItem }>;
  /** On a row's line in Tapahtumat, beside its tags: a mark that keeps the row one line high. */
  readonly rowMark?: ComponentType<{ row: TransactionItem }>;
}

export const WEB_EXTENSIONS: WebExtension[] = [];

let addOnFailed = false;

/** The page of a signed-in member named an add-on module and its files did not load: the shell says so once. */
export function markAddOnFailed(failed = true): void {
  addOnFailed = failed;
}

export function addOnLoadFailed(): boolean {
  return addOnFailed;
}

/**
 * A signed-in answer (the sign-in, the code of a second factor, or the state of a page that another tab signed in) says an
 * add-on module is loaded on the server and this page has none: the page was served before the sign-in and so does not
 * name the module (its files go to a signed-in user only).
 */
export function addOnAwaitsSignIn(answer: { addOn?: boolean }): boolean {
  return answer.addOn === true && WEB_EXTENSIONS.length === 0;
}

const RELOADED = "omatalous-addon-reload";

/**
 * Reloads the page to load the module a signed-in answer names, once per browser session: when the module is still
 * missing after that reload (its files failed, or the page came from a cache), the shell says so once and nothing
 * reloads again. A page that has the module forgets the mark, so a later sign-in can reload again. Returns true when it
 * started a reload.
 */
export function reloadForAddOn(answer: { addOn?: boolean }, reload: () => void = () => location.reload()): boolean {
  try {
    if (!addOnAwaitsSignIn(answer)) {
      if (answer.addOn === true) sessionStorage.removeItem(RELOADED);
      return false;
    }
    if (sessionStorage.getItem(RELOADED) === null) {
      sessionStorage.setItem(RELOADED, "1");
      reload();
      return true;
    }
  } catch {
    // a browser with no session storage cannot count: it does not reload
  }
  markAddOnFailed();
  return false;
}

/** The extensions with a page, in the order they were added. */
export function extensionPages(extensions: readonly WebExtension[] = WEB_EXTENSIONS): WebExtension[] {
  return extensions.filter((e) => e.page);
}
