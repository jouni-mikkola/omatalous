/**
 * Hae nyt: what the answer of `POST /api/sync` says, as the notice of the page.
 * Decision: the household sees whether the fetch worked, partly worked or failed, and which account to look at.
 */
import { t, tn } from "../../text.ts";
import type { Message } from "./use-settings-page.ts";

export interface SyncAnswer {
  status: "ok" | "partial" | "failed" | "skipped";
  inserted: number;
  messages: string[];
}

export function syncResult(r: SyncAnswer): Message {
  const found = `${tn(r.inserted, "set.banks.one_new_transaction", "set.banks.n_new_transactions")}.`;
  if (r.status === "skipped") return { tone: "info", text: r.messages.join(" ") };
  if (r.status === "failed") return { tone: "error", text: (r.messages.length ? r.messages : [`${t("set.conn.fetch_failed")}.`]).join(" ") };
  return { tone: r.status === "partial" ? "warning" : "good", text: [found, ...r.messages].join(" ") };
}
