/**
 * Asetukset > Tilit: who uses an account, as the page chooses it and as a request says it. What a use means (deriveUse,
 * partOf) is core's; this decides what the select offers, what each choice sends, how typed percents read and what the
 * shares of a joint account are called. No request is made here.
 */
import type { AccountUse, AccountUser, Part } from "@banking/core";
import { date } from "../../format.ts";
import type { Account, AccountQuestion, Meta, SharedAccount } from "../../types.ts";

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

/** What a joint account is cut by, as the page's three buttons say it. */
export type Split = "source" | "equal" | "percent";

/** The pressed button: what the account has. `mode` (who paid, set by the app or by a member), else equal weights, else percents. */
export const splitOf = (use: AccountUse): Split => (use.mode === "source" ? "source" : isEqual(use) ? "equal" : "percent");

/** "70" as 700, "70,5" as 705: tenths of a percent. null for anything else (a letter, a second decimal, over 100). */
export function parsePercent(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d))?$/.exec(text.trim());
  if (!match) return null;
  const tenths = Number(match[1]) * 10 + Number(match[2] ?? 0);
  return tenths <= 1000 ? tenths : null;
}

/** 700 as "70", 295 as "29,5": the text of a field. */
const tenthsText = (tenths: number): string => `${Math.floor(tenths / 10)}${tenths % 10 ? `,${tenths % 10}` : ""}`;

/** The tenths of a percent each of `people` has of a use, the last one taking the rest of 1000. */
function tenthsOf(people: readonly Person[], use: AccountUse): number[] {
  const weights = people.map((p) => Math.max(0, use.users.find((u) => u.userId === p.userId)?.weight ?? 0));
  const total = weights.reduce((sum, w) => sum + BigInt(w), 0n);
  const typed = people.slice(0, -1).map((_, i) => (total ? Number((BigInt(weights[i]!) * 1000n * 2n + total) / (total * 2n)) : 0));
  return [...typed, 1000 - typed.reduce((sum, t) => sum + t, 0)];
}

/** The fields of "Prosentit" for a use: the percent each user has, the last one's being the rest. */
export function percentFieldsOf(people: readonly Person[], use: AccountUse): Record<string, string> {
  const tenths = tenthsOf(people, use);
  return Object.fromEntries(people.map((p, i) => [keyOf(p.userId), tenthsText(tenths[i]!)]));
}

/** The last field: what is left of 100 after the others, or "" while they cannot be read or come to more than 100. */
export function restText(people: readonly Person[], fields: Readonly<Record<string, string>>): string {
  let rest = 1000;
  for (const p of people.slice(0, -1)) {
    const tenths = parsePercent(fields[keyOf(p.userId)] ?? "");
    if (tenths === null) return "";
    rest -= tenths;
  }
  return rest < 0 ? "" : tenthsText(rest);
}

/** Whether a field the member can type in differs from what the use gave: the weights stay exact until one does. */
export const fieldsChanged = (people: readonly Person[], fields: Readonly<Record<string, string>>, initial: Readonly<Record<string, string>>): boolean =>
  people.slice(0, -1).some((p) => (fields[keyOf(p.userId)] ?? "").trim() !== (initial[keyOf(p.userId)] ?? "").trim());

/**
 * What the fields say, as weights in tenths of a percent; a user with nothing is left out. Refused here, before any request,
 * with the key of the field at fault: a field that is no percent, empty, or one that takes the sum over 100.
 */
export function readPercents(people: readonly Person[], fields: Readonly<Record<string, string>>): { users: Said[] } | { problem: string } {
  const users: Said[] = [];
  let sum = 0;
  for (const p of people.slice(0, -1)) {
    const tenths = parsePercent(fields[keyOf(p.userId)] ?? "");
    if (tenths === null || sum + tenths > 1000) return { problem: keyOf(p.userId) };
    sum += tenths;
    if (tenths > 0) users.push({ userId: p.userId, weight: tenths });
  }
  const last = people.at(-1);
  if (last && sum < 1000) users.push({ userId: last.userId, weight: 1000 - sum });
  return { users };
}

/** "a", "a ja b", "a, b ja c" */
const list = (items: readonly string[]): string => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ja ${items.at(-1)}`);

/** The offer as a value: "Aino 96 % ja Ville 4 %". */
export function offerText(offer: readonly { userId: string | null; percent: number }[], people: readonly Person[]): string {
  const label = (userId: string | null) => people.find((p) => p.userId === userId)?.label ?? "";
  return list(offer.map((o) => `${label(o.userId)} ${o.percent} %`));
}

/** The users who have a part of the account, the viewer first: whom a question can be answered with. */
export function ownersOf(account: Pick<Account, "use">, meta: Pick<Meta, "user" | "members">): Person[] {
  return peopleOf(account, meta).filter((p) => account.use?.users.some((u) => u.userId === p.userId && u.weight > 0));
}

/** The owner a request says for a user: `u:<id>`, and `u:` for the holders who are no member. */
export const ownerOf = (userId: string | null): string => `u:${userId ?? ""}`;

/** The open questions of an account, the largest sum first. */
export const openQuestions = (account: Pick<Account, "questions">): AccountQuestion[] => [...(account.questions ?? [])].sort((a, b) => b.openCents - a.openCents);

/** What a question or an answer is about: the payer as the row shows it, or the opening with its day. */
export const questionLabel = (q: Pick<AccountQuestion, "kind" | "label">): string => (q.kind === "opening" ? `Saldo ennen ${date(q.label)}` : q.label);

/** A request the page makes to give an answer or take it back. */
export interface Call {
  path: string;
  method: "PUT" | "DELETE";
  body: { kind: "in" | "opening"; key: string; owner?: string };
}

const answersPath = (accountId: string) => `/api/accounts/${encodeURIComponent(accountId)}/answers`;

/** Whose money a payer's (or the opening) was: what is asked, and the owner. */
export const answerCall = (accountId: string, q: Pick<AccountQuestion, "kind" | "key">, owner: string): Call => ({ path: answersPath(accountId), method: "PUT", body: { kind: q.kind, key: q.key, owner } });

/** The answer taken back, so the question stands again. */
export const takeBackCall = (accountId: string, a: Pick<AccountQuestion, "kind" | "key">): Call => ({ path: answersPath(accountId), method: "DELETE", body: { kind: a.kind, key: a.key } });

/** An answer in words: a user's name, "Yhteistä" or "En tiedä". */
export function answerLabel(owner: string, people: readonly Person[]): string {
  if (owner === "all") return "Yhteistä";
  if (owner === "none") return "En tiedä";
  return people.find((p) => ownerOf(p.userId) === owner)?.label ?? "";
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
