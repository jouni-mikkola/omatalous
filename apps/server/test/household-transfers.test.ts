/**
 * Money between two members' accounts is a transfer in both members' views by IBAN, whichever member connected their
 * account first, and is a payment to a person again when the other member is removed. The names, IBANs and amounts are
 * made up.
 */
import type { RawTransaction } from "@banking/core";
import { describe, expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { removeUser } from "../src/services/users.ts";
import { setupApp } from "./helpers.ts";

const AINO_IBAN = "FI2112345600000785";
const EERO_IBAN = "FI4950009420028730";

const sent = (toIban: string): RawTransaction => ({
  externalId: null, bookingDate: "2026-10-02", valueDate: null, amountCents: -5_000, currency: "EUR", status: "booked",
  counterparty: "KORHONEN EERO", counterpartyIban: toIban, description: null, reference: null, mcc: null,
});

const account = (id: string, holder: string, iban: string) => ({ id, connectionId: null, provider: "enablebanking", externalId: null, identity: `idn-${id}`, name: id, holder, iban, currency: "EUR", type: "checking" as const });

async function household() {
  const app = await setupApp();
  const eero = await app.member("eero", "Eero");
  const ainoRepo = app.s.finance(app.adminId);
  await ainoRepo.upsertAccount(account("aino-own", "MEIKALAINEN AINO", AINO_IBAN));
  await ingestTransactions(ainoRepo, "aino-own", [sent(EERO_IBAN)], "enablebanking");
  await reprocess(ainoRepo, app.s.settings);
  return { ...app, eeroId: eero.id };
}

const transfersOf = async (app: Awaited<ReturnType<typeof household>>) => (await app.db.all<{ is_transfer: number }>("SELECT is_transfer FROM transactions WHERE user_id = ?", [app.adminId])).map((r) => r.is_transfer);

describe("money between members' accounts", () => {
  it("is a payment to a person until the other member connects the account, then a transfer in the first member's rows", async () => {
    const app = await household();
    expect(await transfersOf(app)).toEqual([0]);

    await app.s.finance(app.eeroId).upsertAccount(account("eero-own", "KORHONEN EERO", EERO_IBAN));
    await reprocess(app.s.finance(app.eeroId), app.s.settings);
    expect(await transfersOf(app)).toEqual([1]);
    expect(await app.s.settings.get(`household_ibans:${app.eeroId}`)).toBe(EERO_IBAN);
  });

  it("is a payment to a person again when the other member is removed, and their stored IBANs go", async () => {
    const app = await household();
    await app.s.finance(app.eeroId).upsertAccount(account("eero-own", "KORHONEN EERO", EERO_IBAN));
    await reprocess(app.s.finance(app.eeroId), app.s.settings);
    expect(await transfersOf(app)).toEqual([1]);

    await removeUser(app.s, app.eeroId, "test");
    expect(await transfersOf(app)).toEqual([0]);
    expect(await app.s.settings.get(`household_ibans:${app.eeroId}`)).toBeNull();
  });
});
