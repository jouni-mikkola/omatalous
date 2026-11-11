/**
 * What an add-on module adds to the web app, the web half of the server's extensions.ts (docs/MODULES.md). Empty unless
 * the server loaded a module and the page names it; `module-host.ts` then fills it before the first render.
 */
import type { ComponentType } from "react";
import type { TransactionItem } from "./types.ts";

export interface WebExtension {
  /** The server extension's id: its route prefix and its page id. */
  readonly id: string;
  /** A card of Asetukset > Kotitalous, after the rules. */
  readonly settingsCard?: ComponentType;
  /** The anchor of that card, so an address that names it opens Kotitalous. */
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

/**
 * The page names an add-on module that did not load: its files are served to a signed-in user only, so the sign-in
 * reloads the page once to load it.
 */
export function addOnAwaitsSignIn(): boolean {
  return WEB_EXTENSIONS.length === 0 && document.querySelector('meta[name="omatalous-module"]') !== null;
}

/** The extensions with a page, in the order they were added. */
export function extensionPages(extensions: readonly WebExtension[] = WEB_EXTENSIONS): WebExtension[] {
  return extensions.filter((e) => e.page);
}
