/**
 * GET /api/meta names the month Yhteenveto opens on (core `openingMonth`): the last complete one until the running
 * month's pay has come. The test clock is 9.10.2026; the made-up salary comes on the 15th, or came on the 5th.
 */
import type { RawTransaction } from "@banking/core";
import { expect, it } from "vitest";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { setupApp } from "./helpers.ts";

const raw = (bookingDate: string, euros: number, counterparty: string, description: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: Math.round(euros * 100), currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description, reference: null, mcc: null,
});
const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"].map((m) => `2026-${m}`);

async function paidOn(day: string) {
  const t = await setupApp();
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: null, currency: "EUR", type: "checking" });
  const rows = MONTHS.flatMap((m) => [raw(`${m}-${day}`, 3200, "ESIMERKKITYÖNANTAJA OY", "PALKKA"), raw(`${m}-02`, -900, "VUOKRANANTAJA OY", "VUOKRA")]).filter((r) => r.bookingDate <= "2026-10-09");
  await ingestTransactions(repo, "chk", rows, "csv");
  await reprocess(repo, t.s.settings);
  return (await t.admin.call("GET", "/api/meta")).body.opening;
}

it("opens on the last month before the pay of the running month has come, and on the running month after it", async () => {
  expect(await paidOn("15")).toBe("last-month");
  expect(await paidOn("05")).toBe("month");
  // with no rows there is no pay to wait for
  const t = await setupApp();
  expect((await t.admin.call("GET", "/api/meta")).body.opening).toBe("month");
});
