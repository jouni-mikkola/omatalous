/**
 * The marks of a row of Tapahtumat: the payee's (VT4's MerchantAvatar) and the account's (VT4's AccountMark, the bank's
 * logo or the account's initials) with the short text beside it. Nothing is fetched but the bank logos the app serves.
 */
import { AccountMark as BankMark } from "../../components/BankLogo.tsx";
import { MerchantAvatar } from "../../components/MerchantAvatar.tsx";
import type { Account, AccountType, BankOption, Meta } from "../../types.ts";

/** The payee's mark: initials on a tinted disc, a person glyph for a payment to or from a person. */
export function PayeeMark({ name, person }: { name: string; person?: boolean }) {
  return <MerchantAvatar name={name} person={person} />;
}

export interface AccountLook {
  /** The name the household knows the account by, with its owner's name on a shared one: the title and the screen reader's text. */
  name: string;
  bank: string;
  /** The offered banks, for the logo (AccountMark reads the account's own name before the connection's bank). */
  banks: readonly BankOption[];
  /** What the row shows beside the plate, never cut: the digits, a short own name or the type's word. */
  short: string;
}

const TYPE_WORD: Partial<Record<AccountType, string>> = { credit_card: "Kortti", checking: "Käyttötili", savings: "Säästötili", loan: "Laina" };

/** A name the user gave that fits the cell whole; a longer one would be cut, so the type's word stands instead. */
const SHORT_NAME = 14;

const shortOf = (a: Pick<Account, "digits" | "customName" | "type">): string =>
  a.digits ? `•• ${a.digits}` : a.customName && a.customName.length <= SHORT_NAME ? a.customName : (TYPE_WORD[a.type] ?? "Tili");

/** The look of every account in view, by id: own accounts and the ones shared with the viewer. */
export function accountLooks(meta: Meta): Map<string, AccountLook> {
  const looks = new Map<string, AccountLook>();
  for (const a of [...meta.accounts, ...meta.sharedAccounts]) {
    const bank = meta.connections.find((c) => c.id === a.connectionId)?.institution ?? "";
    const name = "ownerName" in a ? `${a.name} (${a.ownerName})` : a.name;
    looks.set(a.id, { name, bank, banks: meta.bank.banks, short: shortOf(a) });
  }
  return looks;
}

/** An account on a row: its mark and the short text. The name is the title and the screen reader's text. */
export function AccountMark({ look, fallback }: { look: AccountLook | undefined; fallback: string }) {
  const name = look?.name ?? fallback;
  return (
    <span className="tx-acct" title={name}>
      <BankMark name={name} institution={look?.bank || null} banks={look?.banks ?? []} />
      <span className="sr-only">{name}</span>
      <span className="tx-acct-short" aria-hidden="true">
        {look?.short ?? "Tili"}
      </span>
    </span>
  );
}
