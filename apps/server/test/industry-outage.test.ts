import type { RawTransaction } from "@banking/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupIndustries } from "../src/services/industry.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { reprocess } from "../src/services/enrich.ts";
import { setupApp } from "./helpers.ts";

afterEach(() => vi.restoreAllMocks());

const raw = (bookingDate: string, euros: number, counterparty: string): RawTransaction => ({
  externalId: null,
  bookingDate,
  valueDate: null,
  amountCents: Math.round(euros * 100),
  currency: "EUR",
  status: "booked",
  counterparty,
  counterpartyIban: null,
  description: "KORTTIOSTO",
  reference: null,
  mcc: null,
});

const NAMES = ["PIKKU PUOTI", "SAUMAUS NIEMINEN OY", "LANKAPUOTI RUUSU", "KONELIIKE ESIMERKKI", "KAHVIO ESIMERKKI OY"];

async function setup(respond: () => Response | Promise<Response>) {
  let calls = 0;
  const fetchMock = (async () => {
    calls++;
    return respond();
  }) as unknown as typeof fetch;
  const t = await setupApp({ INDUSTRY_LOOKUP: "true" }, fetchMock);
  const repo = t.s.finance(t.adminId);
  await repo.upsertAccount({ id: "chk", connectionId: null, provider: "csv", externalId: null, identity: null, name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" });
  await ingestTransactions(repo, "chk", NAMES.map((n, i) => raw(`2026-09-0${i + 1}`, -10, n)), "csv");
  await reprocess(repo, t.s.settings);
  return { s: t.s, calls: () => calls };
}

const errorRows = (s: Awaited<ReturnType<typeof setup>>["s"]) => s.db.all("SELECT merchant FROM merchant_industry WHERE status = 'error'");

describe("a register outage costs no names", () => {
  const outages: [string, () => Response | Promise<Response>][] = [
    ["unreachable", () => Promise.reject(new TypeError("fetch failed"))],
    ["a 503", () => new Response("busy", { status: 503 })],
    ["a 429", () => new Response("slow down", { status: 429 })],
  ];
  for (const [label, respond] of outages) {
    it(`${label}: no error row, the names are due again at the next call`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { s, calls } = await setup(respond);
      await lookupIndustries(s, { pauseMs: 0 });
      expect(calls()).toBe(3);
      expect(await errorRows(s)).toEqual([]);
      await lookupIndustries(s, { pauseMs: 0 });
      expect(calls()).toBe(6);
    });
  }

  const unreadable: [string, () => Response][] = [
    ["an unreadable body", () => new Response("<html>", { status: 200 })],
    ["a body too large", () => new Response("{}", { status: 200, headers: { "content-length": "5000000" } })],
  ];
  for (const [label, respond] of unreadable) {
    it(`${label}: still one error row per name, and three failures stop the run`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { s, calls } = await setup(respond);
      await lookupIndustries(s, { pauseMs: 0 });
      expect(calls()).toBe(3);
      expect(await errorRows(s)).toHaveLength(3);
      await lookupIndustries(s, { pauseMs: 0 });
      expect(calls()).toBe(5);
    });
  }
});
