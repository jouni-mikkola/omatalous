/**
 * How the pages word a part of a joint account. Core hands the part (`Part`, the viewer's share of an account) and
 * every figure already cut to it; nothing here multiplies or adds, it only names the share.
 * A loan another member typed in comes into a view by such an account, and its row says whose it is.
 */
import { type AccountUse, belowWhole, type Part } from "@banking/core";
import { percent } from "./format.ts";
import type { Account, Meta } from "./types.ts";

/** What /meta tells of an account beyond `Account`: who uses it and the viewer's part of it. */
type Told = Account & { use?: AccountUse; part?: Part };

/** The share a part is of the whole account, as a percent: 3 of 5 gives "60 %". */
const share = (part: Part): string => percent((part.to - part.from) / part.of);

/**
 * The words on a row of a figure the viewer has a part of: "Yhteinen tili, osuutesi 60 %" for an account, "osuutesi
 * 60 %" for a card or a loan. null for a row that is all the viewer's. A traced account is cut by who paid, so it has
 * no share to name: it says "Yhteinen tili" alone.
 */
export function partText(part: Part | undefined, kind: "account" | "debt", traced?: boolean): string | null {
  if (traced && kind === "account") return "Yhteinen tili";
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

/** The anchor of an account's parts on Tilit, where "Kenen?" and the notices of a split lead. */
export const partAnchor = (accountId: string): string => `tili-${accountId}`;
