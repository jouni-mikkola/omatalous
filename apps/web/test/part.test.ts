import type { AccountUse, Part } from "@banking/core";
import { describe, expect, it } from "vitest";
import { hasJointAccount, ownPart, partText, viewsParts } from "../src/part.ts";
import type { Account, Meta, SharedAccount } from "../src/types.ts";

/** The percent sign has a no-break space before it. */
const plain = (s: string) => s.replace(/ /g, " ");
const WHOLE: Part = { from: 0, to: 1, of: 1 };
const HALF: Part = { from: 0, to: 1, of: 2 };
const THREE_FIFTHS: Part = { from: 0, to: 3, of: 5 };
const NONE: Part = { from: 0, to: 0, of: 1 };

const TWO: AccountUse = { users: [{ userId: "u-1", label: "Matti", weight: 1 }, { userId: null, label: "Muu tilinomistaja", weight: 1 }], source: "bank" };
const ONE: AccountUse = { users: [{ userId: "u-1", label: "Matti", weight: 1 }], source: "owner" };

const account = (id: string, use: AccountUse, part: Part): Account => ({ id, name: id, use, part }) as unknown as Account;
const shared = (id: string, owner: string): SharedAccount => ({ ...account(id, ONE, WHOLE), ownerName: owner }) as SharedAccount;
const meta = (accounts: Account[], sharedAccounts: SharedAccount[] = []): Pick<Meta, "accounts" | "sharedAccounts"> => ({ accounts, sharedAccounts });

describe("the words on a row of a part", () => {
  it("an account says it is joint and what the viewer's share is, a card or a loan only the share", () => {
    expect(plain(partText(HALF, "account") ?? "")).toBe("Yhteinen tili, osuutesi 50 %");
    expect(plain(partText(THREE_FIFTHS, "account") ?? "")).toBe("Yhteinen tili, osuutesi 60 %");
    expect(plain(partText(THREE_FIFTHS, "debt") ?? "")).toBe("osuutesi 60 %");
  });

  it("a share of nothing is told too, a whole account or a row with no part is not", () => {
    expect(plain(partText(NONE, "debt") ?? "")).toBe("osuutesi 0 %");
    expect(partText(WHOLE, "account")).toBeNull();
    expect(partText(undefined, "debt")).toBeNull();
  });
});

describe("whether the viewer has a part below the whole", () => {
  it("is so for an own account at a part, also at no part", () => {
    expect(viewsParts(meta([account("a", ONE, WHOLE), account("j", TWO, HALF)]))).toBe(true);
    expect(viewsParts(meta([account("j", TWO, NONE)]))).toBe(true);
  });

  it("is not so when every own account is whole, or the part is only of an account shared with the viewer", () => {
    expect(viewsParts(meta([account("a", ONE, WHOLE)]))).toBe(false);
    expect(viewsParts(meta([account("a", ONE, WHOLE)], [{ ...shared("s", "Aino"), part: HALF } as SharedAccount]))).toBe(false);
    expect(viewsParts(meta([]))).toBe(false);
  });

  it("gives the part of one own account, and nothing for a whole one or one that is not theirs", () => {
    const m = meta([account("a", ONE, WHOLE), account("j", TWO, HALF)]);
    expect(ownPart(m, "j")).toEqual(HALF);
    expect(ownPart(m, "a")).toBeUndefined();
    expect(ownPart(m, "missing")).toBeUndefined();
  });

  it("knows a joint account by its users, in view as own or shared", () => {
    expect(hasJointAccount(meta([account("j", TWO, HALF)]))).toBe(true);
    expect(hasJointAccount(meta([account("a", ONE, WHOLE)], [{ ...shared("s", "Aino"), use: TWO } as SharedAccount]))).toBe(true);
    expect(hasJointAccount(meta([account("a", ONE, WHOLE)], [shared("s", "Aino")]))).toBe(false);
  });
});
