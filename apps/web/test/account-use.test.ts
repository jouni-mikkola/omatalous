import { describe, expect, it } from "vitest";
import { answerCall, answerLabel, choiceOf, fieldsChanged, JOINT, offerText, openQuestions, optionsOf, ownerOf, ownersOf, peopleOf, percentFieldsOf, questionLabel, questionOf, readPercents, restText, sharedUseText, splitOf, takeBackCall, usersFor } from "../src/pages/settings/account-use.ts";
import type { Account, Connection, Meta, SharedAccount } from "../src/types.ts";

const MATTI = "u-matti";
const ELISA = "u-elisa";
const user = (userId: string | null, label: string, weight = 1) => ({ userId, label, weight });
const joint = (weights: [number, number] = [1, 1]) => ({ users: [user(MATTI, "Matti", weights[0]), user(null, "KORHONEN ELISA", weights[1])], source: "bank" as const });
const meta = { user: { id: MATTI, displayName: "Matti" }, members: [{ id: MATTI, displayName: "Matti" }, { id: ELISA, displayName: "Elisa" }] } as Pick<Meta, "user" | "members">;
const account = (use: Account["use"], extra: Partial<Account> = {}) => ({ id: "a1", name: "Yhteistili", userId: MATTI, connectionId: "c2", use, ...extra }) as Account;

describe("what the select offers and selects", () => {
  it("offers the viewer, each other member, the other holder by the bank's name, and a joint account", () => {
    expect(optionsOf(account(joint()), meta)).toEqual([
      { value: `user:${MATTI}`, label: "Minä" },
      { value: `user:${ELISA}`, label: "Elisa" },
      { value: "user:", label: "KORHONEN ELISA" },
      { value: JOINT, label: "Yhteinen tili" },
    ]);
  });

  it("offers no joint account, and no choice at all, to a member alone with accounts of their own", () => {
    const alone = { user: meta.user, members: [meta.members[0]!] };
    const own = account({ users: [user(MATTI, "Matti")], source: "owner" });
    expect(optionsOf(own, alone)).toEqual([{ value: `user:${MATTI}`, label: "Minä" }]);
    // near miss: the other holder of a joint account is a second person, so there is a choice
    expect(optionsOf(account(joint()), alone).map((o) => o.value)).toContain(JOINT);
  });

  it("selects the answer the use gives: one user, or a joint account for two or more with a part", () => {
    expect(choiceOf(joint())).toBe(JOINT);
    expect(choiceOf({ users: [user(MATTI, "Matti")], source: "owner" })).toBe(`user:${MATTI}`);
    expect(choiceOf({ users: [user(null, "KORHONEN ELISA")], source: "said" })).toBe("user:");
    // a user with no part is no user: the other one uses it alone
    expect(choiceOf({ users: [user(MATTI, "Matti", 0), user(ELISA, "Elisa", 600)], source: "said" })).toBe(`user:${ELISA}`);
  });
});

describe("what a choice sends", () => {
  it("one user at weight 1, the holders who are no member with a null id", () => {
    const a = account(joint());
    expect(usersFor(`user:${ELISA}`, a, meta)).toEqual([{ userId: ELISA, weight: 1 }]);
    expect(usersFor("user:", a, meta)).toEqual([{ userId: null, weight: 1 }]);
  });

  it("a joint account sends everyone it is between at equal weights, the viewer first", () => {
    expect(usersFor(JOINT, account(joint()), meta)).toEqual([{ userId: MATTI, weight: 1 }, { userId: null, weight: 1 }]);
    // an account one member used is between the viewer and each other member
    expect(usersFor(JOINT, account({ users: [user(ELISA, "Elisa")], source: "said" }), meta)).toEqual([{ userId: MATTI, weight: 1 }, { userId: ELISA, weight: 1 }]);
  });
});

describe("the button that is pressed", () => {
  const said = (...weights: number[]) => ({ users: weights.map((w, i) => user(i ? null : MATTI, i ? "KORHONEN ELISA" : "Matti", w)), source: "said" as const });

  it("is who paid for a split the app set and for one a member chose", () => {
    expect(splitOf({ ...joint(), mode: "source" })).toBe("source");
    expect(splitOf({ ...said(600, 400), mode: "source" })).toBe("source");
  });

  it("is Tasan when nothing is said or 1 and 1 are, Prosentit for 600 and 400", () => {
    expect(splitOf(joint())).toBe("equal");
    expect(splitOf(said(1, 1))).toBe("equal");
    expect(splitOf(said(600, 400))).toBe("percent");
    expect(splitOf(said(60000, 40000))).toBe("percent");
  });
});

describe("the fields of Prosentit", () => {
  const people = peopleOf(account(joint()), meta);
  const trio = [...people, { userId: ELISA, label: "Elisa" }];

  it("fills the last field with the rest of 100 as the others are typed", () => {
    expect(restText(people, { [MATTI]: "70" })).toBe("30");
    expect(restText(people, { [MATTI]: "70,5" })).toBe("29,5");
    expect(restText(trio, { [MATTI]: "20", "": "35,5" })).toBe("44,5");
    expect(restText(people, { [MATTI]: "100" })).toBe("0");
  });

  it("sends the percents as weights, a user with nothing left out", () => {
    expect(readPercents(people, { [MATTI]: "70" })).toEqual({ users: [{ userId: MATTI, weight: 700 }, { userId: null, weight: 300 }] });
    expect(readPercents(people, { [MATTI]: "70,5" })).toEqual({ users: [{ userId: MATTI, weight: 705 }, { userId: null, weight: 295 }] });
    expect(readPercents(people, { [MATTI]: "100" })).toEqual({ users: [{ userId: MATTI, weight: 1000 }] });
    expect(readPercents(people, { [MATTI]: "0" })).toEqual({ users: [{ userId: null, weight: 1000 }] });
  });

  it("refuses 101, a letter, a second decimal and an empty first field before any request, naming the field", () => {
    for (const text of ["101", "70a", "abc", "70,55", "-5", ""]) expect(readPercents(people, { [MATTI]: text })).toEqual({ problem: MATTI });
    expect(restText(people, { [MATTI]: "101" })).toBe("");
    // near misses: 100 and one decimal pass
    expect(readPercents(people, { [MATTI]: "100,0" })).toEqual({ users: [{ userId: MATTI, weight: 1000 }] });
    expect(readPercents(people, { [MATTI]: "0,1" })).toEqual({ users: [{ userId: MATTI, weight: 1 }, { userId: null, weight: 999 }] });
    // three users: the sum may not pass 100 either, the field that takes it over is named
    expect(readPercents(trio, { [MATTI]: "60", "": "50" })).toEqual({ problem: "" });
    expect(readPercents(trio, { [MATTI]: "60", "": "40" })).toEqual({ users: [{ userId: MATTI, weight: 600 }, { userId: null, weight: 400 }] });
  });

  it("opens with the percents of the weights and is unchanged until a field is: 61050 and 40000 stay exact", () => {
    const stored = { users: [user(MATTI, "Matti", 61050), user(null, "KORHONEN ELISA", 40000)], source: "said" as const };
    const initial = percentFieldsOf(people, stored);
    expect(initial).toEqual({ [MATTI]: "60,4", "": "39,6" });
    expect(fieldsChanged(people, initial, initial)).toBe(false);
    // the last field is the rest and never counts as typed
    expect(fieldsChanged(people, { ...initial, "": "1" }, initial)).toBe(false);
    expect(fieldsChanged(people, { ...initial, [MATTI]: "60,5" }, initial)).toBe(true);
    expect(percentFieldsOf(people, joint())).toEqual({ [MATTI]: "50", "": "50" });
    expect(percentFieldsOf(trio, { users: [user(MATTI, "Matti", 1), user(null, "E", 1), user(ELISA, "Elisa", 1)], source: "said" })).toEqual({ [MATTI]: "33,3", "": "33,3", [ELISA]: "33,4" });
  });

  it("names the offer with each user's percent", () => {
    expect(offerText([{ userId: MATTI, percent: 96 }, { userId: null, percent: 4 }], people).replace(/\s/g, " ")).toBe("Matti 96 % ja KORHONEN ELISA 4 %");
  });
});

describe("the questions and the answers", () => {
  const q = (kind: "in" | "opening", key: string, openCents: number, label = key) => ({ kind, key, label, openCents });

  it("lists the questions largest first, the opening by its day", () => {
    const list = openQuestions({ questions: [q("in", "g:text:A", 20000), q("opening", "o", 55219, "2026-07-01"), q("in", "g:text:B", 90000)] });
    expect(list.map((x) => x.openCents)).toEqual([90000, 55219, 20000]);
    expect(questionLabel(list[1]!)).toBe("Saldo ennen 1.7.2026");
    expect(questionLabel(list[0]!)).toBe("g:text:B");
    expect(openQuestions({})).toEqual([]);
  });

  it("sends the kind, the key and the owner of an answer, and the delete of taking it back", () => {
    expect(answerCall("a1", q("in", "g:iban:FI01", 1), "u:u-matti")).toEqual({ path: "/api/accounts/a1/answers", method: "PUT", body: { kind: "in", key: "g:iban:FI01", owner: "u:u-matti" } });
    expect(answerCall("a1", q("opening", "o", 1), "all").body).toEqual({ kind: "opening", key: "o", owner: "all" });
    expect(answerCall("a1", q("in", "g:text:X", 1), "none").body.owner).toBe("none");
    expect(ownerOf(null)).toBe("u:");
    expect(takeBackCall("a/1", q("in", "g:iban:FI01", 1))).toEqual({ path: "/api/accounts/a%2F1/answers", method: "DELETE", body: { kind: "in", key: "g:iban:FI01" } });
  });

  it("names an answer by the user, Yhteistä or En tiedä, and offers the answers to the users with a part only", () => {
    const people = peopleOf(account(joint()), meta);
    expect(answerLabel("u:u-matti", people)).toBe("Matti");
    expect(answerLabel("u:", people)).toBe("KORHONEN ELISA");
    expect(answerLabel("all", people)).toBe("Yhteistä");
    expect(answerLabel("none", people)).toBe("En tiedä");
    expect(ownersOf(account(joint([600, 0])), meta).map((p) => p.label)).toEqual(["Matti"]);
    expect(ownersOf(account(joint()), meta).map((p) => p.label)).toEqual(["Matti", "KORHONEN ELISA"]);
  });
});

describe("what a member is told of an account shared with them", () => {
  const shared = (use: Account["use"], part?: SharedAccount["part"]) => ({ ...account(use), userId: "u-aino", part }) as SharedAccount;

  it("gives their part of a joint account, and says when they have none", () => {
    expect(sharedUseText(shared(joint([60000, 40000]), { from: 3, to: 5, of: 5 }), MATTI)).toBe("yhteinen tili, osuutesi 40 %");
    expect(sharedUseText(shared(joint(), { from: 0, to: 0, of: 1 }), MATTI)).toBe("yhteinen tili, sinulla ei ole osuutta");
  });

  it("says nothing when the owner uses it alone, and who does when somebody else does", () => {
    expect(sharedUseText(shared({ users: [user("u-aino", "Aino")], source: "owner" }), MATTI)).toBeNull();
    expect(sharedUseText(shared({ users: [user(MATTI, "Matti")], source: "said" }), MATTI)).toBe("käyttäjä: sinä");
    expect(sharedUseText(shared({ users: [user(ELISA, "Elisa")], source: "said" }), MATTI)).toBe("käyttäjä: Elisa");
  });
});

describe("the question after a consent", () => {
  const conn = (id: string, createdAt: string, extra: Partial<Connection> = {}) => ({ id, createdAt, history: false, state: "active", ...extra }) as Connection;
  const connections = [conn("c1", "2026-09-01T08:00:00Z"), conn("c2", "2026-10-09T08:00:00Z")];

  it("asks about the newest consent's accounts the bank gave two holders or more and nobody has said", () => {
    const asked = account(joint());
    const single = account({ users: [user(MATTI, "Matti")], source: "owner" }, { id: "a2" });
    expect(questionOf({ connections, accounts: [asked, single] }).map((a) => a.id)).toEqual(["a1"]);
  });

  it("leaves out an account linked earlier, a use that was said, and a consent that ended", () => {
    expect(questionOf({ connections, accounts: [account(joint(), { connectionId: "c1" })] })).toEqual([]);
    expect(questionOf({ connections, accounts: [account({ ...joint(), source: "said" })] })).toEqual([]);
    expect(questionOf({ connections: [conn("c2", "2026-10-09T08:00:00Z", { history: true })], accounts: [account(joint())] })).toEqual([]);
    expect(questionOf({ connections: [conn("c2", "2026-10-09T08:00:00Z", { state: "broken" })], accounts: [account(joint())] })).toEqual([]);
  });
});
