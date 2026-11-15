import { t } from "../../text.ts";
import type { DashboardData } from "../../types.ts";

type Row = NonNullable<DashboardData["ahead"]>["outside"][number];

/** "Yhteinen tili ·· 0381": the account that pays a row the balance leaves out; null when the answer names none. */
export const payingAccount = (r: Pick<Row, "account">): string | null => (r.account ? (r.account.digits ? `${r.account.name} ·· ${r.account.digits}` : r.account.name) : null);

/** The name of the sum of such rows: the accounts that pay them (two names at most, then how many more), or that other accounts pay when a row names none. */
export function elsewhereLabel(rows: readonly Pick<Row, "account">[]): string {
  const accounts = [...new Set(rows.map(payingAccount))];
  const [first, second] = accounts;
  if (!first || accounts.includes(null)) return t("bills.elsewhere");
  if (!second) return t("bills.elsewhere_account", { account: first });
  if (accounts.length === 2) return t("bills.elsewhere_two", { first, second });
  return t("bills.elsewhere_more", { first, second, count: accounts.length - 2 });
}
