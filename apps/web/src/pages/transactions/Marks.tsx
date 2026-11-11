/**
 * The account of a row of Tapahtumat as plain short text: no logo or disc, so the row stays one quiet line.
 */
import { t } from "../../text.ts";
import type { Account, AccountType, Meta } from "../../types.ts";

export interface AccountLook {
  /** The name the household knows the account by, with its owner's name on a shared one: the title and the screen reader's text. */
  name: string;
  /** What the row shows, never cut: the digits, a short own name or the type's word. */
  short: string;
}

const typeWord = (type: AccountType): string => (type === "credit_card" ? t("tx.type_card") : type === "checking" ? t("tx.type_checking") : type === "savings" ? t("tx.type_savings") : type === "loan" ? t("tx.type_loan") : t("tx.type_other"));

/** A name the user gave that fits the cell whole; a longer one would be cut, so the type's word stands instead. */
const SHORT_NAME = 14;

const shortOf = (a: Pick<Account, "digits" | "customName" | "type">): string =>
  a.digits ? `•• ${a.digits}` : a.customName && a.customName.length <= SHORT_NAME ? a.customName : typeWord(a.type);

/** The look of every account in view, by id: own accounts and the ones shared with the viewer. */
export function accountLooks(meta: Meta): Map<string, AccountLook> {
  const looks = new Map<string, AccountLook>();
  for (const a of [...meta.accounts, ...meta.sharedAccounts]) {
    const name = "ownerName" in a ? `${a.name} (${a.ownerName})` : a.name;
    looks.set(a.id, { name, short: shortOf(a) });
  }
  return looks;
}

/** An account on a row: the short text. The name is the title and the screen reader's text. */
export function AccountMark({ look, fallback }: { look: AccountLook | undefined; fallback: string }) {
  const name = look?.name ?? fallback;
  return (
    <span className="tx-acct" title={name}>
      <span className="sr-only">{name}</span>
      <span className="tx-acct-short" aria-hidden="true">
        {look?.short ?? "Tili"}
      </span>
    </span>
  );
}
