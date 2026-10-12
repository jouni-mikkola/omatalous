/**
 * Asetukset > Tilit: who uses an account, as the page chooses it and as a request says it. What a use means (deriveUse,
 * partOf) is core's; this decides what the select offers, what each choice sends, how typed euros read and what the
 * shares of a joint account are called. No request is made here.
 */
import type { AccountUse, AccountUser, Part } from "@banking/core";
import { eurosText, money, parseEuros } from "../../format.ts";
import type { Account, Meta, SharedAccount } from "../../types.ts";

/** A user as a request says one. */
export type Said = Pick<AccountUser, "userId" | "weight">;

/** Somebody an account can be used by: a member, or (null) the holders who are none. */
interface Person {
  userId: string | null;
  label: string;
}

/** The option of a joint account. The others are `user:<id>`, and `user:` for the holders who are no member. */
export const JOINT = "joint";
const choiceFor = (userId: string | null) => `user:${userId ?? ""}`;
/** The key of a field and of a choice. */
export const keyOf = (userId: string | null) => userId ?? "";

const using = (use: AccountUse): AccountUser[] => use.users.filter((u) => u.weight > 0);

/** Two users or more have a part of it. */
export const isJoint = (use: AccountUse): boolean => using(use).length >= 2;

/** Every user has the same part: what "Tasan" says. */
export const isEqual = (use: AccountUse): boolean => use.users.length > 0 && use.users.every((u) => u.weight > 0 && u.weight === use.users[0]!.weight);

/** Whether the use names a member other than the viewer. */
export const namesOther = (use: AccountUse, viewerId: string): boolean => using(use).some((u) => u.userId !== null && u.userId !== viewerId);

/** The option a use selects. */
export function choiceOf(use: AccountUse): string {
  const users = using(use);
  return users.length === 1 ? choiceFor(users[0]!.userId) : JOINT;
}

/**
 * The people a joint account is between: the users it has, else the viewer and the other members. The viewer comes first,
 * the holders who are no member last.
 */
export function peopleOf(account: Pick<Account, "use">, meta: Pick<Meta, "user" | "members">): Person[] {
  const named = (account.use?.users ?? []).map((u): Person => ({ userId: u.userId, label: u.userId === meta.user.id ? meta.user.displayName : u.label }));
  const more = meta.members.filter((m) => !named.some((n) => n.userId === m.id)).map((m): Person => ({ userId: m.id, label: m.displayName }));
  const rank = (p: Person) => (p.userId === meta.user.id ? 0 : p.userId === null ? 2 : 1);
  return (named.length >= 2 ? named : [...named, ...more]).sort((a, b) => rank(a) - rank(b));
}

/** What the select of an account offers. Only the viewer: no choice to make. */
export function optionsOf(account: Pick<Account, "use">, meta: Pick<Meta, "user" | "members">): { value: string; label: string }[] {
  const options = [{ value: choiceFor(meta.user.id), label: "Minä" }];
  for (const m of meta.members) if (m.id !== meta.user.id) options.push({ value: choiceFor(m.id), label: m.displayName });
  const holder = account.use?.users.find((u) => u.userId === null);
  if (holder) options.push({ value: choiceFor(null), label: holder.label });
  if (peopleOf(account, meta).length >= 2) options.push({ value: JOINT, label: "Yhteinen tili" });
  return options;
}

/** What a choice sends: one user, or everyone the account is between at equal weights. */
export function usersFor(choice: string, account: Pick<Account, "use">, meta: Pick<Meta, "user" | "members">): Said[] {
  if (choice === JOINT) return peopleOf(account, meta).map((p) => ({ userId: p.userId, weight: 1 }));
  return [{ userId: choice.slice("user:".length) || null, weight: 1 }];
}

/** 60000 as "600", 61050 as "610,50": the text of a field. */
const weightText = (cents: number): string => (cents % 100 === 0 ? String(cents / 100) : eurosText(cents));

/** The fields of "Omat osuudet" for a use: the euros each user has, nothing for equal parts and for a user with no part. */
export function fieldsOf(people: readonly Person[], use: AccountUse): Record<string, string> {
  const equal = isEqual(use);
  return Object.fromEntries(
    people.map((p) => {
      const weight = use.users.find((u) => u.userId === p.userId)?.weight ?? 0;
      return [keyOf(p.userId), equal || weight <= 0 ? "" : weightText(weight)];
    }),
  );
}

/**
 * What the fields say, as weights in cents: an empty field or 0 leaves that person out. Refused here, before any request, when
 * a field is no amount or nobody has a part.
 */
export function readFields(people: readonly Person[], fields: Readonly<Record<string, string>>): { users: Said[] } | { problem: string } {
  const users: Said[] = [];
  for (const p of people) {
    const text = (fields[keyOf(p.userId)] ?? "").trim();
    if (!text) continue;
    const cents = parseEuros(text);
    if (cents === null || cents < 0) return { problem: "Anna osuus euroina, esimerkiksi 600." };
    if (cents > 0) users.push({ userId: p.userId, weight: cents });
  }
  return users.length ? { users } : { problem: "Ainakin yhdellä käyttäjällä pitää olla osuus." };
}

/** "a", "a ja b", "a, b ja c" */
const list = (items: readonly string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ja ${items.at(-1)}`);

/** What weights come to, in whole percents that add up to 100: "60 % ja 40 %". Nothing for none. */
export function sharesText(weights: readonly number[]): string {
  const positive = weights.filter((w) => w > 0);
  const total = positive.reduce((sum, w) => sum + w, 0);
  if (!total) return "";
  const exact = positive.map((w) => (w * 100) / total);
  const whole = exact.map(Math.floor);
  // the percents left over go to the largest remainders, so the parts always add up to 100
  const order = exact.map((x, i) => ({ i, rest: x - whole[i]! })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order.slice(0, 100 - whole.reduce((sum, w) => sum + w, 0))) whole[i]!++;
  return list(whole.map((p) => `${p} %`));
}

/** The proposal in euros a month for each user, the first one carrying the verb: "Matti on maksanut tilille keskimäärin 600 € ja Elisa 400 €". */
export function proposalText(weights: readonly Said[], people: readonly Person[]): string {
  const label = (userId: string | null) => people.find((p) => p.userId === userId)?.label ?? "";
  return list(weights.filter((w) => w.weight > 0).map((w, i) => `${label(w.userId)} ${i === 0 ? "on maksanut tilille keskimäärin " : ""}${money(w.weight, false)}`));
}

/** Whether two sets of weights give every user the same share (only the ratio counts), so a proposal already taken is not offered again. */
export function sameShares(a: readonly Said[], b: readonly Said[]): boolean {
  const [pa, pb] = [a.filter((u) => u.weight > 0), b.filter((u) => u.weight > 0)];
  if (pa.length !== pb.length) return false;
  const [ta, tb] = [pa.reduce((sum, u) => sum + BigInt(u.weight), 0n), pb.reduce((sum, u) => sum + BigInt(u.weight), 0n)];
  return pa.every((u) => {
    const other = pb.find((v) => v.userId === u.userId);
    return !!other && BigInt(u.weight) * tb === BigInt(other.weight) * ta;
  });
}

/** A part of an account in whole percents. */
const partPercent = (part: Part): number => Math.round(((part.to - part.from) / part.of) * 100);

/**
 * What the viewer is told of the use of an account another member shared with them, or null when there is nothing to tell:
 * the owner uses it alone.
 */
export function sharedUseText(account: Pick<SharedAccount, "use" | "part" | "userId">, viewerId: string): string | null {
  const users = account.use ? using(account.use) : [];
  if (users.length >= 2) {
    const share = account.part ? partPercent(account.part) : 0;
    return share > 0 ? `yhteinen tili, osuutesi ${share} %` : "yhteinen tili, sinulla ei ole osuutta";
  }
  const only = users[0];
  if (!only || only.userId === account.userId) return null;
  return only.userId === viewerId ? "käyttäjä: sinä" : `käyttäjä: ${only.label}`;
}

/**
 * The accounts the consent that just ended is asked about: its bank gave them two holders or more and nobody has said who
 * uses them. An account linked earlier is not asked about; its row in Tilit has the choice.
 */
export function questionOf(meta: Pick<Meta, "accounts" | "connections">): Account[] {
  const live = meta.connections.filter((c) => !c.history && c.state === "active");
  const newest = live.reduce<(typeof live)[number] | null>((late, c) => (!late || c.createdAt > late.createdAt ? c : late), null);
  if (!newest) return [];
  return meta.accounts.filter((a) => a.connectionId === newest.id && a.use?.source === "bank" && a.use.users.length >= 2);
}
