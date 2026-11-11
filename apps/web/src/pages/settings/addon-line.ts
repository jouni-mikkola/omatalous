/** The status line of Asetukset > Palvelin > Lisäosa, from GET /api/modules (apps/server services/modules.ts). */
import { t } from "../../text.ts";

export type AddOnView =
  | { state: "none" }
  | { state: "connected"; id: string; version: string; label?: string }
  | { state: "pending"; id: string; version: string }
  | { state: "waiting" }
  | { state: "refused"; reason: string }
  | { state: "checking" };

/** The server's reason is English for its log; the card says which of four things went wrong. */
function whyText(reason: string): string {
  if (/signature|signer/.test(reason)) return t("set.addon.why_signature");
  if (/code does not open/.test(reason)) return t("set.addon.why_code");
  if (/release service|redirect|https|list of releases|too large$/.test(reason)) return t("set.addon.why_fetch");
  return t("set.addon.why_content");
}

export function addOnLine(v: AddOnView): string {
  switch (v.state) {
    case "none":
      return t("set.addon.state_none");
    case "connected":
      return v.label ? t("set.addon.state_connected_named", { label: v.label, version: v.version }) : t("set.addon.state_connected", { version: v.version });
    case "pending":
      return t("set.addon.state_pending", { version: v.version });
    case "waiting":
      return t("set.addon.state_waiting");
    case "refused":
      return t("set.addon.state_refused", { why: whyText(v.reason) });
    case "checking":
      return t("set.addon.state_checking");
  }
}
