/**
 * Modules a build adds to the web app from outside the shared code, the web half of the server's extensions.ts. The
 * shared build leaves the list empty; a build of its own fills it from an entry that then imports main.tsx.
 */
import type { ComponentType } from "react";
import type { TransactionItem } from "./types.ts";

export interface WebExtension {
  /** The server extension's id, which is also its flag: nothing shows while `meta.features[id]` is off. */
  readonly id: string;
  /** A card of Asetukset, after Lainat. */
  readonly settingsCard?: ComponentType;
  /** A page of its own at `#/<id>`, its nav entry after the shared ones. */
  readonly page?: { readonly label: string; readonly component: ComponentType<{ params: URLSearchParams }> };
  /** Labels of its security events in Asetukset > Turvallisuus. */
  readonly securityLabels?: Readonly<Record<string, string>>;
  /** Under a row of Tapahtumat: what the server extension adds to the row; nothing for a row it adds nothing to. */
  readonly rowPart?: ComponentType<{ row: TransactionItem }>;
  /** On a row's line in Tapahtumat, beside its tags: a mark that keeps the row one line high. */
  readonly rowMark?: ComponentType<{ row: TransactionItem }>;
}

export const WEB_EXTENSIONS: WebExtension[] = [];
