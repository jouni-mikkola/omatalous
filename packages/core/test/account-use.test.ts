/**
 * Who uses an account and what a part of money is: the arithmetic of a part (the users' parts add up to every row),
 * the use the bank's holder names give when nobody has said one, and the user's own name from their accounts.
 */
import { describe, expect, it } from "vitest";
import { billCents, deriveUse, NONE, OTHER_HOLDER, partCents, partOf, saidUse, type UseMember, WHOLE } from "../src/account-use.ts";
import { holdersOf } from "../src/categorize-people.ts";
import { nameOf, samePerson, userNameOf } from "../src/person-names.ts";
import type { Account, AccountUse, AccountUser, Part } from "../src/types.ts";
import { rng } from "./gen.ts";
import { tx } from "./helpers.ts";

const MATTI = "MEIKALAINEN MATTI";
const ELISA = "KORHONEN ELISA";
const VILLE = "MEIKALAINEN VILLE";
const JOINT = { holder: `${MATTI}, ${ELISA}` };

const member = (id: string, label: string, name: string | null): UseMember => ({ id, label, name: name === null ? null : nameOf(name) });
const matti = member("u-1", "Matti", MATTI);
const elisa = member("u-2", "Elisa", ELISA);
const ville = member("u-3", "Ville", VILLE);
/** A member whose own accounts tell no name: every account they linked is a joint one. */
const elisaUnnamed = member("u-2", "Elisa", null);

const user = (userId: string | null, label: string, weight = 1): AccountUser => ({ userId, label, weight });
const said = (...users: [string | null, number][]): AccountUse => ({ users: users.map(([userId, weight]) => user(userId, "", weight)), source: "said" });
const partsOf = (use: AccountUse, amountCents: number) => use.users.map((u) => partCents(amountCents, partOf(use, u.userId)));

describe("a part of money", () => {
  it("the users' parts add up to the row and a part of the whole is the row, for 2 000 random rows and weights", () => {
    const rand = rng(18);
    for (let i = 0; i < 2000; i++) {
      const count = 1 + Math.floor(rand() * 8);
      // weights as typed: small numbers, euros a month in cents, and up to the largest the server takes
      const weight = () => Math.floor(rand() * [4, 250_000, 100_000_001][Math.floor(rand() * 3)]!);
      const users: [string | null, number][] = Array.from({ length: count }, (_, k) => [k === 0 && rand() < 0.3 ? null : `u-${k}`, weight()]);
      if (!users.some(([, w]) => w > 0)) users[0]![1] = 1;
      const use = said(...users);
      // money in and money out, from cents to a billion euros
      const amount = Math.round((rand() - 0.5) * 2 * [300, 500_000, 100_000_000_000][Math.floor(rand() * 3)]!);
      const parts = partsOf(use, amount);
      expect(parts.reduce((sum, cents) => sum + cents, 0), `${amount} by ${JSON.stringify(users)}`).toBe(amount);
      // no part against the row's direction, and none more than a cent off its exact size
      const of = users.reduce((sum, [, w]) => sum + w, 0);
      use.users.forEach((u, k) => {
        expect(Math.sign(parts[k]!) * Math.sign(amount), `${amount} by ${JSON.stringify(users)}`).toBeGreaterThanOrEqual(0);
        const off = BigInt(parts[k]!) * BigInt(of) - BigInt(amount) * BigInt(u.weight);
        expect(off <= BigInt(of) && off >= -BigInt(of), `${amount} by ${JSON.stringify(users)}`).toBe(true);
      });
      expect(partCents(amount, WHOLE)).toBe(amount);
      expect(partCents(amount, NONE)).toBe(0);
    }
  });

  it("money in, money out and a refund are cut alike, so a purchase and its refund cancel in each part", () => {
    const use = said(["u-1", 60_000], ["u-2", 40_000]);
    const [mine, hers] = [partOf(use, "u-1"), partOf(use, "u-2")];
    expect(partCents(250_000, mine)).toBe(150_000);
    expect(partCents(250_000, hers)).toBe(100_000);
    // 19,99 at 3 of 5 is 11,994: both ends round the same way, and the other part is what is left
    expect(partCents(-1999, mine)).toBe(-1199);
    expect(partCents(-1999, hers)).toBe(-800);
    expect(partCents(1999, mine) + partCents(-1999, mine)).toBe(0);
    expect(partCents(1999, hers) + partCents(-1999, hers)).toBe(0);
  });

  it("rounds a half up at both ends of the range: the odd cent goes to one user and is never lost or doubled", () => {
    const two = said(["u-1", 1], ["u-2", 1]);
    expect(partsOf(two, 1)).toEqual([1, 0]);
    expect(partsOf(two, -1)).toEqual([-1, 0]);
    // no part is a negative zero, which would not equal a zero in a comparison of rows
    expect(Object.is(partCents(-1, partOf(two, "u-2")), 0)).toBe(true);
    expect(partsOf(two, 3)).toEqual([2, 1]);
    expect(partsOf(said(["u-1", 1], ["u-2", 1], ["u-3", 1]), 100)).toEqual([33, 34, 33]);
    expect(partsOf(said(["u-1", 1], ["u-2", 1], ["u-3", 1]), -100)).toEqual([-33, -34, -33]);
  });

  it("is exact past what a double holds: a large amount by large weights matches whole-number arithmetic", () => {
    const exact = (abs: number, weight: number, of: number) => Number((2n * BigInt(abs) * BigInt(weight) + BigInt(of)) / (2n * BigInt(of)));
    const rand = rng(53);
    for (let i = 0; i < 2000; i++) {
      // on both sides of the largest whole number a double holds (9 007 199 254 740 991)
      const of = 2 + Math.floor(rand() * 800_000_000);
      const weight = 1 + Math.floor(rand() * (of - 1));
      const abs = Math.floor((2 ** (49 + Math.floor(rand() * 6)) * (1 + rand())) / weight);
      expect(partCents(abs, { from: 0, to: weight, of }), `${abs} * ${weight} / ${of}`).toBe(exact(abs, weight, of));
      expect(partCents(-abs, { from: weight, to: of, of }), `${abs} * ${weight} / ${of}`).toBe(exact(abs, weight, of) - abs);
    }
  });

  it("billCents is the bank's amount, also on a row cut to a part", () => {
    expect(billCents(tx({ bookingDate: "2026-09-01", amountCents: -85_000 }))).toBe(-85_000);
    expect(billCents({ ...tx({ bookingDate: "2026-09-01", amountCents: -42_500 }), wholeCents: -85_000 })).toBe(-85_000);
    // money in, and a row whose whole amount is nothing
    expect(billCents({ amountCents: 600, wholeCents: 1200 })).toBe(1200);
    expect(billCents({ amountCents: 0, wholeCents: 0 })).toBe(0);
  });
});

describe("the part of a user", () => {
  it("is a range of the weights in lowest terms, in the order of the ids, the user with no id last", () => {
    // as stored: the order of the rows does not count
    const use = said([null, 20_000], ["u-2", 40_000], ["u-1", 60_000]);
    expect(partOf(use, "u-1")).toEqual({ from: 0, to: 1, of: 2 });
    expect(partOf(use, "u-2")).toEqual({ from: 3, to: 5, of: 6 });
    expect(partOf(use, null)).toEqual({ from: 5, to: 6, of: 6 });
    // ids compare by their code units, as SQLite compares them: an upper case letter before a lower case one
    expect(partOf(said(["u-a", 1], ["u-B", 1]), "u-B")).toEqual({ from: 0, to: 1, of: 2 });
  });

  it("is WHOLE itself for the only user, and NONE itself for nobody's part", () => {
    const alone = said(["u-1", 600]);
    expect(partOf(alone, "u-1")).toBe(WHOLE);
    expect(partOf(alone, "u-2")).toBe(NONE);
    expect(partOf(alone, null)).toBe(NONE);
    // a user the household gave nothing: listed, and no cent is theirs
    const zero = said(["u-1", 600], ["u-2", 0]);
    expect(partOf(zero, "u-2")).toBe(NONE);
    expect(partOf(zero, "u-1")).toBe(WHOLE);
    // near miss: one cent a month is a part
    expect(partOf(said(["u-1", 599], ["u-2", 1]), "u-2")).toEqual<Part>({ from: 599, to: 600, of: 600 });
    expect(partOf({ users: [], source: "owner" }, "u-1")).toBe(NONE);
  });
});

describe("the use the bank's holders give", () => {
  it("two holders who are both members: a joint account at 1 and 1", () => {
    const use = deriveUse(JOINT, ["u-1"], [matti, elisa]);
    expect(use).toEqual({ users: [user("u-1", "Matti"), user("u-2", "Elisa")], source: "bank" });
    expect(partOf(use, "u-1")).toEqual({ from: 0, to: 1, of: 2 });
    expect(partOf(use, "u-2")).toEqual({ from: 1, to: 2, of: 2 });
    // whoever linked it, both of them, and in whichever order the bank and the server list things
    expect(deriveUse(JOINT, ["u-2"], [elisa, matti])).toEqual(use);
    expect(deriveUse({ holder: `${ELISA} MARIA, MATTI JUHANI MEIKALAINEN` }, ["u-2", "u-1"], [matti, elisa])).toEqual(use);
  });

  it("the other holder is no member: the member and one user with no id, named as the bank names them", () => {
    expect(deriveUse(JOINT, ["u-1"], [matti])).toEqual({ users: [user("u-1", "Matti"), user(null, "Korhonen Elisa")], source: "bank" });
    // the bank's upper case is the payee list's normal case, one holder or several
    expect(deriveUse({ holder: `${MATTI}, ÅKERBLOM-VIERAS VEIKKO` }, ["u-1"], [matti]).users[1]).toEqual(user(null, "Åkerblom-Vieras Veikko"));
    // three holders: the two who are no member are one user, so the member's part is a half
    const three = deriveUse({ holder: `${MATTI}, ${ELISA}, VIERAS VEIKKO` }, ["u-1"], [matti]);
    expect(three.users).toEqual([user("u-1", "Matti"), user(null, "Korhonen Elisa, Vieras Veikko")]);
    expect(partOf(three, "u-1")).toEqual({ from: 0, to: 1, of: 2 });
  });

  it("a member who linked the account is a user of it, also when no holder is them", () => {
    // a parent with the right to use an account two others hold
    const use = deriveUse({ holder: `${ELISA}, VIERAS VEIKKO` }, ["u-1"], [matti]);
    expect(use).toEqual({ users: [user("u-1", "Matti"), user(null, "Korhonen Elisa, Vieras Veikko")], source: "bank" });
  });

  it("one holder who is another member uses the account alone, and a holder who is no member leaves it to whoever linked it", () => {
    const childs = deriveUse({ holder: VILLE }, ["u-1"], [matti, elisa, ville]);
    expect(childs).toEqual({ users: [user("u-3", "Ville")], source: "bank" });
    expect(partOf(childs, "u-1")).toBe(NONE);
    expect(partOf(childs, "u-3")).toBe(WHOLE);
    // near miss: the child is no member
    expect(deriveUse({ holder: VILLE }, ["u-1"], [matti, elisa])).toEqual({ users: [user("u-1", "Matti")], source: "owner" });
    // the holder linked it and so did a member with the right to use it: the holder's alone, for both copies
    expect(deriveUse({ holder: MATTI }, ["u-1", "u-2"], [matti, elisa])).toEqual({ users: [user("u-1", "Matti")], source: "bank" });
  });

  it("one holder who linked it, no holder, and a line not read yet: whoever linked it, whole", () => {
    for (const holder of [MATTI, "", null, undefined, "MEIKALAINEN"]) {
      const use = deriveUse({ holder }, ["u-1"], [matti, elisa]);
      expect(use, String(holder)).toEqual({ users: [user("u-1", "Matti")], source: "owner" });
      expect(partOf(use, "u-1"), String(holder)).toBe(WHOLE);
    }
  });

  it("\"SURNAME, FIRST\" is one person the line cannot name, never a joint account that halves the user's own", () => {
    expect(deriveUse({ holder: "MEIKALAINEN, MATTI" }, ["u-1"], [matti, elisa])).toEqual({ users: [user("u-1", "Matti")], source: "owner" });
    // near miss: two words each are two holders
    expect(deriveUse({ holder: "MEIKALAINEN MATTI, MATTI MEIKALAINEN" }, ["u-1"], [matti, elisa])).toEqual({ users: [user("u-1", "Matti")], source: "bank" });
  });

  it("a member whose accounts tell no name is the holder nobody matched, not a third user", () => {
    // she linked the joint account only, so her own name is a tie
    expect(deriveUse(JOINT, ["u-2"], [matti, elisaUnnamed])).toEqual({ users: [user("u-1", "Matti"), user("u-2", "Elisa")], source: "bank" });
    expect(deriveUse(JOINT, ["u-1", "u-2"], [member("u-1", "Matti", null), elisaUnnamed])).toEqual({ users: [user("u-1", "Matti"), user("u-2", "Elisa")], source: "bank" });
    // the other holder is no member: one of the two names is hers, so neither is shown as somebody else's
    expect(deriveUse(JOINT, ["u-2"], [elisaUnnamed])).toEqual({ users: [user("u-2", "Elisa"), user(null, OTHER_HOLDER)], source: "bank" });
    // near miss: her name is known and stands on no holder, so both holders are other people
    expect(deriveUse({ holder: `${MATTI}, VIERAS VEIKKO` }, ["u-2"], [elisa])).toEqual({ users: [user("u-2", "Elisa"), user(null, "Meikalainen Matti, Vieras Veikko")], source: "bank" });
  });

  it("two members of one name: the one who linked the account, else the line cannot tell and names neither", () => {
    const senior = member("u-1", "Matti", MATTI);
    const junior = member("u-4", "Matti nuorempi", `${MATTI} JUHANI`);
    expect(deriveUse(JOINT, ["u-4"], [senior, junior, elisa]).users).toEqual([user("u-2", "Elisa"), user("u-4", "Matti nuorempi")]);
    expect(deriveUse(JOINT, ["u-2"], [senior, junior, elisa]).users).toEqual([user("u-2", "Elisa"), user(null, "Meikalainen Matti")]);
  });
});

describe("the use the household said", () => {
  it("is the stored rows in the order of the parts, with a label for each", () => {
    const use = saidUse([{ userId: null, weight: 100 }, { userId: "u-2", weight: 40_000 }, { userId: "u-1", weight: 60_000 }], { holder: `${MATTI}, ${ELISA}, VIERAS VEIKKO` }, ["u-1"], [matti, elisa]);
    expect(use).toEqual({ users: [user("u-1", "Matti", 60_000), user("u-2", "Elisa", 40_000), user(null, "Vieras Veikko", 100)], source: "said" });
    // every holder is a member: the user with no id is somebody the bank does not name
    expect(saidUse([{ userId: null, weight: 1 }, { userId: "u-1", weight: 1 }], JOINT, ["u-1"], [matti, elisa])!.users).toEqual([user("u-1", "Matti"), user(null, OTHER_HOLDER)]);
    // somebody who is no user by the bank may be said to use it, and whoever linked it may be left out
    expect(saidUse([{ userId: "u-3", weight: 1 }], { holder: MATTI }, ["u-1"], [matti, ville])).toEqual({ users: [user("u-3", "Ville")], source: "said" });
  });

  it("rows that give nobody a part say nothing", () => {
    expect(saidUse([], JOINT, ["u-1"], [matti, elisa])).toBeNull();
    expect(saidUse([{ userId: "u-1", weight: 0 }, { userId: null, weight: 0 }], JOINT, ["u-1"], [matti, elisa])).toBeNull();
    // near miss: one cent is a part
    expect(saidUse([{ userId: "u-1", weight: 0 }, { userId: "u-2", weight: 1 }], JOINT, ["u-1"], [matti, elisa])!.users).toEqual([user("u-1", "Matti", 0), user("u-2", "Elisa", 1)]);
  });
});

describe("the user's own name", () => {
  const account = (id: string, holder: string | null): Account => ({ id, name: id, iban: null, currency: "EUR", type: "checking", holder });
  const is = (holder: string) => (name: ReadonlySet<string> | null) => name !== null && samePerson(name, nameOf(holder));

  it("a joint account, an own one and a child's still name the user: the name on the most accounts", () => {
    const accounts = [account("joint", `${MATTI}, ${ELISA}`), account("own", MATTI), account("child", VILLE)];
    expect(userNameOf(accounts)).toSatisfy(is(MATTI));
    // the category rules read the same name, and everybody else as a co-holder
    const holders = holdersOf(accounts);
    expect(holders.user).toSatisfy(is(MATTI));
    expect(holders.others.map((name) => [...name].sort().join(" "))).toEqual(["ELISA KORHONEN", "MEIKALAINEN VILLE"]);
  });

  it("a tie names nobody: a joint account alone, and two people's own accounts", () => {
    expect(userNameOf([account("joint", `${MATTI}, ${ELISA}`)])).toBeNull();
    expect(userNameOf([account("his", MATTI), account("hers", ELISA)])).toBeNull();
    expect(userNameOf([account("card", null), account("old", "")])).toBeNull();
    expect(holdersOf([account("joint", `${MATTI}, ${ELISA}`)])).toEqual({ user: null, others: [] });
    // near miss: one person written two ways on two accounts is one name
    expect(userNameOf([account("a", "MATTI JUHANI MEIKALAINEN"), account("b", MATTI), account("joint", `${MATTI}, ${ELISA}`)])).toSatisfy(is(MATTI));
  });
});
