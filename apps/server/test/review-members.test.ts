/**
 * Money in from another member of the household that nothing explained, as Tarkistettavat's payer questions: found by
 * the member's account number or a name only one member has, asked once, and answered by the payer's role. Made-up
 * names and sums; the test clock is 9.10.2026 and the first user by id is "Aino".
 */
import type { RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";
import { AINO, IBAN, link, VILLE } from "./trace-world.ts";

type Item = { id: string; kind: string; cents: number; options?: string[]; proposal?: string | null; [field: string]: unknown };

const row = (bookingDate: string, euros: number, counterparty: string | null, iban: string | null): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: iban, description: null, reference: null, mcc: null,
});

/**
 * Aino's account takes the rows, which Ville's account has no other leg of. Ville's account is linked after Aino's rows
 * were read, so the rows that name its number are not yet a transfer (the next run of Aino's rows makes them one).
 */
async function householdWith(rows: RawTransaction[]) {
  const w = await setupApp();
  const ville = await w.member("ville", "Ville");
  const repo = w.s.finance(w.adminId);
  await link(w, w.adminId, "aino-own", AINO, IBAN.aino, "idn-aino");
  await ingestTransactions(repo, "aino-own", rows, "enablebanking");
  await reprocess(repo, w.s.settings);
  await link(w, ville.id, "ville-own", VILLE, IBAN.ville, "idn-ville");
  const queue = async () => (await w.admin.call("GET", "/api/review")).body.items as Item[];
  return { w, queue };
}

const IBAN_KEY = `iban:${IBAN.ville}`;
const NAME_KEY = "name:LAHTINEN VILLE";

describe("the review queue's money from another member", () => {
  it("asks a member's account number once, as a payer with no own money, and an answered role takes it away", async () => {
    // no name on the rows, so a row's item would ask of them too
    const { w, queue } = await householdWith([row("2026-08-03", 40, null, IBAN.ville), row("2026-09-03", 60, null, IBAN.ville)]);
    const items = await queue();
    const payers = items.filter((i) => i.kind === "payer");
    expect(payers).toEqual([expect.objectContaining({ id: `payer:${IBAN_KEY}`, key: IBAN_KEY, cents: 10000, count: 2 })]);
    expect(payers[0]!.options).not.toContain("own_money");
    expect(items.filter((i) => i.kind === "row")).toEqual([]);
    expect((await w.admin.call("PUT", "/api/payer-roles", { key: IBAN_KEY, role: "sales" })).body).toEqual({ ok: true });
    expect((await queue()).filter((i) => i.kind === "payer" || i.kind === "row")).toEqual([]);
  });

  it("keeps one item where the payer's own question asks of the same member, with no own money, in the same order every time", async () => {
    const months = ["2026-07-03", "2026-08-03", "2026-09-03"];
    const { queue } = await householdWith(months.map((d) => row(d, 300, VILLE, null)));
    const first = await queue();
    const payers = first.filter((i) => i.id === `payer:${NAME_KEY}`);
    expect(payers).toHaveLength(1);
    expect(payers[0]).toMatchObject({ cents: 90000, count: 3 });
    expect(payers[0]!.options).not.toContain("own_money");
    expect(payers[0]!.proposal).not.toBe("own_money");
    expect((await queue()).map((i) => i.id)).toEqual(first.map((i) => i.id));
  });

  it("asks nothing of a stranger who has a member's name", async () => {
    const { queue } = await householdWith([row("2026-09-04", 60, VILLE, IBAN.cecilia)]);
    expect((await queue()).filter((i) => i.kind === "payer" && (i.id === `payer:${IBAN_KEY}` || i.id === `payer:${NAME_KEY}`))).toEqual([]);
  });
});
