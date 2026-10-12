/**
 * How the pages word a part of a joint account. Core hands the part (`Part`, the viewer's share of an account) and
 * every figure already cut to it; nothing here multiplies or adds, it only names the share and says which view counts it.
 * A loan another member typed in comes into a view by such an account, and its row says whose it is.
 */
import { type AccountUse, belowWhole, type Part } from "@banking/core";
import { percent } from "./format.ts";
import type { Account, Meta, Scope } from "./types.ts";

/** What /meta tells of an account beyond `Account`: who uses it and the viewer's part of it. */
type Told = Account & { use?: AccountUse; part?: Part };

/** The share a part is of the whole account, as a percent: 3 of 5 gives "60 %". */
const share = (part: Part): string => percent((part.to - part.from) / part.of);

/**
 * The words on a row of a figure the viewer has a part of: "Yhteinen tili, osuutesi 60 %" for an account, "osuutesi
 * 60 %" for a card or a loan. null for a row that is all the viewer's.
 */
export function partText(part: Part | undefined, kind: "account" | "debt"): string | null {
  if (!belowWhole(part)) return null;
  return kind === "account" ? `Yhteinen tili, osuutesi ${share(part)}` : `osuutesi ${share(part)}`;
}

/**
 * The words on the row of a loan another member typed in: "Lisännyt Aino", the display name as it is. null for the
 * viewer's own loan and for an account's debt. A row with it offers no edit and no link to the loan's editor: the
 * loan is its typist's to change.
 */
export const typedByText = (typedBy: string | undefined): string | null => (typedBy ? `Lisännyt ${typedBy}` : null);

/** The viewer's part of one of their own accounts, where it is below the whole. */
export function ownPart(meta: Pick<Meta, "accounts">, accountId: string): Part | undefined {
  const part = (meta.accounts.find((a) => a.id === accountId) as Told | undefined)?.part;
  return belowWhole(part) ? part : undefined;
}

/** The viewer has an account of their own at a part below the whole: the own view counts parts, Koko talous the whole. */
export const viewsParts = (meta: Pick<Meta, "accounts">): boolean => meta.accounts.some((a) => belowWhole((a as Told).part));

/** Some account in view has more than one user, so a split of its income or its parts is there to be told. */
export const hasJointAccount = (meta: Pick<Meta, "accounts" | "sharedAccounts">): boolean =>
  [...meta.accounts, ...meta.sharedAccounts].some((a) => ((a as Told).use?.users.length ?? 0) > 1);

/** The page that reads whole accounts in every view (Säästövinkit): a contract is the household's. */
const WHOLE_PAGE = "optimise";

/**
 * The line under the header that says how joint accounts are counted in the view on show, or null when there is
 * nothing to say: a viewer with no account at a part below the whole, and the own view of every page but the one that
 * counts them whole (the rows of the other pages say "osuutesi 50 %" themselves). Koko talous names the members'
 * accounts that are in view as well.
 */
export function scopeLine(meta: Pick<Meta, "accounts" | "sharedAccounts">, scope: Scope, page: string): string | null {
  const parts = viewsParts(meta);
  if (scope === "household") {
    const owners = [...new Set(meta.sharedAccounts.map((a) => a.ownerName))];
    const shared = owners.length > 0 ? `Mukana jaetut tilit: ${owners.join(", ")}` : "";
    const whole = parts ? "Yhteiset tilit ovat luvuissa kokonaan." : "";
    return [shared && (parts ? `${shared}.` : shared), whole].filter(Boolean).join(" ") || null;
  }
  if (!parts) return null;
  return page === WHOLE_PAGE ? "Yhteiset tilit ovat tässä mukana kokonaan, koska sopimukset ovat koko talouden." : null;
}
