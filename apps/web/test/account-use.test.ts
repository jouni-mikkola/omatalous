import { describe, expect, it } from "vitest";
import { choiceOf, fieldsOf, isEqual, JOINT, optionsOf, peopleOf, proposalText, questionOf, readFields, sameShares, sharedUseText, sharesText, usersFor } from "../src/pages/settings/account-use.ts";
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

describe("the fields of Omat osuudet", () => {
  const people = peopleOf(account(joint()), meta);

  it("600 and 400 send 60000 and 40000", () => {
    expect(readFields(people, { [MATTI]: "600", "": "400" })).toEqual({ users: [{ userId: MATTI, weight: 60000 }, { userId: null, weight: 40000 }] });
    expect(readFields(people, { [MATTI]: "1 234,5", "": "0,05" })).toEqual({ users: [{ userId: MATTI, weight: 123450 }, { userId: null, weight: 5 }] });
  });

  it("an empty field and 0 drop the user", () => {
    expect(readFields(people, { [MATTI]: "600", "": "0" })).toEqual({ users: [{ userId: MATTI, weight: 60000 }] });
    expect(readFields(people, { [MATTI]: "600" })).toEqual({ users: [{ userId: MATTI, weight: 60000 }] });
  });

  it("nothing above zero, or text that is no amount, is refused before a request is made", () => {
    expect(readFields(people, { [MATTI]: "0", "": "" })).toEqual({ problem: "Ainakin yhdellä käyttäjällä pitää olla osuus." });
    expect(readFields(people, {})).toEqual({ problem: "Ainakin yhdellä käyttäjällä pitää olla osuus." });
    expect(readFields(people, { [MATTI]: "kuusisataa", "": "400" })).toEqual({ problem: "Anna osuus euroina, esimerkiksi 600." });
    expect(readFields(people, { [MATTI]: "-5", "": "400" })).toEqual({ problem: "Anna osuus euroina, esimerkiksi 600." });
  });

  it("starts empty for equal parts and from the euros of a said use", () => {
    expect(isEqual(joint())).toBe(true);
    expect(fieldsOf(people, joint())).toEqual({ [MATTI]: "", "": "" });
    expect(fieldsOf(people, joint([60000, 40050]))).toEqual({ [MATTI]: "600", "": "400,50" });
  });

  it("says what the euros come to in percents that add up to 100", () => {
    expect(sharesText([60000, 40000])).toBe("60 % ja 40 %");
    expect(sharesText([1, 1, 1])).toBe("34 %, 33 % ja 33 %");
    expect(sharesText([500, 300, 200])).toBe("50 %, 30 % ja 20 %");
    expect(sharesText([60000, 0])).toBe("100 %");
    expect(sharesText([0, 0])).toBe("");
  });
});

describe("the proposal", () => {
  const people = peopleOf(account(joint()), meta);
  const proposal = [{ userId: MATTI, weight: 60000 }, { userId: null, weight: 40000 }];

  it("names each user with the euros a month", () => {
    expect(proposalText(proposal, people).replace(/\s/g, " ")).toBe("Matti on maksanut tilille keskimäärin 600 € ja KORHONEN ELISA 400 €");
  });

  it("is not offered again once the use gives the same shares, whatever the unit", () => {
    expect(sameShares(proposal, joint([60000, 40000]).users)).toBe(true);
    expect(sameShares(proposal, joint([3, 2]).users)).toBe(true);
    expect(sameShares(proposal, joint().users)).toBe(false);
    expect(sameShares(proposal, joint([60000, 0]).users)).toBe(false);
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
