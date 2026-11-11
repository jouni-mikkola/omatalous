// Decision: connect or fetch what is missing before trusting a number
import { t, tn } from "../../text.ts";
import type { Meta } from "../../types.ts";

type Refused = NonNullable<Meta["accounts"][number]["refused"]>;

/**
 * How many rows of an account's last fetch were not stored, and why, in a sentence; null when every row was. Unreadable
 * rows are missing from the figures; a twin is the same payment stored already from another source, so it is counted once.
 */
export function refusedLine(name: string, refused: Refused | null | undefined): string | null {
  const rows = (n: number) => tn(n, "rpt.q_row_one", "rpt.q_row_many");
  const why = [
    refused?.status && t(refused.status === 1 ? "rpt.q_status_one" : "rpt.q_status_many", { rows: rows(refused.status) }),
    refused?.amount && t("rpt.q_no_amount", { rows: refused.amount }),
    refused?.date && t("rpt.q_no_date", { rows: refused.date }),
  ].filter((w): w is string => !!w);
  const unread = (refused?.status ?? 0) + (refused?.amount ?? 0) + (refused?.date ?? 0);
  const twins = refused?.twin ?? 0;
  const parts: string[] = [];
  if (why.length) {
    const listed = why.length > 1 ? `${why.slice(0, -1).join(", ")}${t("rpt.and")}${why.at(-1)}` : why[0]!;
    parts.push(t("rpt.q_unread", { rows: rows(unread), list: listed }));
  }
  const skipped = twins === 1 ? t("rpt.q_row_acc_one") : rows(twins);
  if (twins) parts.push(t("rpt.q_twins", { lead: why.length ? t("rpt.q_twins_also", { rows: skipped }) : t("rpt.q_twins_last", { rows: skipped }), once: t(twins === 1 ? "rpt.q_twins_once_one" : "rpt.q_twins_once_many") }));
  return parts.length ? t("rpt.q_account_line", { name, parts: parts.join(" ") }) : null;
}
