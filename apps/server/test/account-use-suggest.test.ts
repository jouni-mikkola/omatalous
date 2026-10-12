/**
 * GET /api/accounts/:id/use/suggestion: the weights a joint account's rows propose, and the members a use names who
 * cannot see the account. Only who linked the account asks; for anybody else the account is a missing one.
 */
import type { StoredTransaction } from "../src/db/rows.ts";
import { describe, expect, it } from "vitest";
import { type Client, setupApp } from "./helpers.ts";

const AINO = "MEIKALAINEN AINO";
const EERO = "KORHONEN EERO";
const AINO_IBAN = "FI2112345600000785";

type App = Awaited<ReturnType<typeof setupApp>>;

async function link(s: App["s"], userId: string, id: string, holder: string | null, identity: string | null, iban: string | null = null) {
  await s.finance(userId).upsertAccount({ id, connectionId: null, provider: "enablebanking", externalId: null, identity, name: id, holder, iban, currency: "EUR", type: "checking" });
}

/** Aino (pays from her own account, known by its IBAN) and Eero (known by the name on his rows), each with a copy of the joint account. */
async function household() {
  const app = await setupApp();
  const eero: Client & { id: string } = await app.member("eero", "Eero");
  const aino: Client & { id: string } = Object.assign(app.admin, { id: app.adminId });
  await link(app.s, aino.id, "aino-own", AINO, "idn-aino", AINO_IBAN);
  await link(app.s, eero.id, "eero-own", EERO, "idn-eero");
  await link(app.s, aino.id, "aino-joint", `${AINO}, ${EERO}`, "idn-joint");
  await link(app.s, eero.id, "eero-joint", `${EERO}, ${AINO}`, "idn-joint");
  return { ...app, aino, eero };
}

/** Money into the joint account on the 1st of a month: `paid` is who and how much, in cents. */
function deposits(month: string, paid: { counterparty: string | null; counterpartyIban: string | null; amountCents: number }[]): Omit<StoredTransaction, "userId">[] {
  return paid.map((p, i) => ({
    id: `${month}-${i}`,
    accountId: "aino-joint",
    bookingDate: `${month}-0${1 + i}`,
    valueDate: null,
    currency: "EUR",
    status: "booked" as const,
    description: "SIIRTO",
    reference: null,
    mcc: null,
    merchant: "Siirto",
    category: "other",
    categorySource: "default" as const,
    isTransfer: false,
    source: "test",
    raw: "{}",
    ...p,
  }));
}

const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const fromAino = (amountCents: number) => ({ counterparty: null, counterpartyIban: AINO_IBAN, amountCents });
const fromEero = (amountCents: number) => ({ counterparty: EERO, counterpartyIban: null, amountCents });

async function rows(app: Awaited<ReturnType<typeof household>>, months: string[], aino: number, eero: number) {
  const repo = app.s.finance(app.aino.id);
  await repo.batch(repo.upsertStatements(months.flatMap((m) => deposits(m, [fromAino(aino), fromEero(eero)])), "2026-10-09T10:00:00Z"));
}

const suggestion = (c: Client, accountId: string) => c.call("GET", `/api/accounts/${accountId}/use/suggestion`);
/** The weights as a map by user, whatever the order of the users. */
const byUser = (weights: { userId: string | null; weight: number }[]) => Object.fromEntries(weights.map((w) => [w.userId, w.weight]));

describe("GET /api/accounts/:id/use/suggestion", () => {
  it("the member who linked the account gets what each user paid in a month, told by IBAN for one and by name for the other", async () => {
    const app = await household();
    await rows(app, MONTHS, 60_000, 40_000);
    const { status, body } = await suggestion(app.aino, "aino-joint");
    expect(status).toBe(200);
    expect(byUser(body.weights)).toEqual({ [app.aino.id]: 60_000, [app.eero.id]: 40_000 });
    // both copies were linked, so nobody the use names is left without the account
    expect(body.unseen).toEqual([]);
  });

  it("answers null for an account whose rows tell no habit: too few months, or sums that are about equal", async () => {
    const app = await household();
    await rows(app, MONTHS.slice(4), 60_000, 40_000);
    expect((await suggestion(app.aino, "aino-joint")).body.weights).toBeNull();
    // near miss: a third month passes the floor
    await rows(app, MONTHS.slice(3, 4), 60_000, 40_000);
    expect(byUser((await suggestion(app.aino, "aino-joint")).body.weights)).toEqual({ [app.aino.id]: 60_000, [app.eero.id]: 40_000 });
    const equal = await household();
    await rows(equal, MONTHS, 50_000, 50_000);
    expect((await suggestion(equal.aino, "aino-joint")).body).toEqual({ weights: null, unseen: [] });
  });

  it("an account one member uses has nothing to propose", async () => {
    const app = await household();
    expect((await suggestion(app.aino, "aino-own")).body).toEqual({ weights: null, unseen: [] });
  });

  it("an account shared with a member, and one a use names them for, are missing ones to them", async () => {
    const app = await household();
    expect((await app.aino.call("PUT", `/api/accounts/aino-own/shares/${app.eero.id}`)).status).toBe(200);
    expect((await app.aino.call("PUT", "/api/accounts/aino-own/use", { users: [{ userId: app.eero.id, weight: 1 }] })).status).toBe(200);
    const missing = await suggestion(app.eero, "no-such-account");
    expect(missing.status).toBe(404);
    const shared = await suggestion(app.eero, "aino-own");
    expect(shared.status).toBe(404);
    expect(shared.body).toEqual(missing.body);
    // near miss: the member who linked it gets an answer
    expect((await suggestion(app.aino, "aino-own")).status).toBe(200);
  });

  it("lists the members a use names who cannot see the account, until it is shared with them", async () => {
    const app = await household();
    const named = await app.aino.call("PUT", "/api/accounts/aino-own/use", { users: [{ userId: app.eero.id, weight: 1 }] });
    expect(named.status).toBe(200);
    expect((await suggestion(app.aino, "aino-own")).body.unseen).toEqual([app.eero.id]);
    // a user the use gives no part is not named
    expect((await app.aino.call("PUT", "/api/accounts/aino-own/use", { users: [{ userId: app.aino.id, weight: 1 }, { userId: app.eero.id, weight: 0 }] })).status).toBe(200);
    expect((await suggestion(app.aino, "aino-own")).body.unseen).toEqual([]);
    await app.aino.call("PUT", "/api/accounts/aino-own/use", { users: [{ userId: app.eero.id, weight: 1 }] });
    await app.aino.call("PUT", `/api/accounts/aino-own/shares/${app.eero.id}`);
    expect((await suggestion(app.aino, "aino-own")).body.unseen).toEqual([]);
  });
});
