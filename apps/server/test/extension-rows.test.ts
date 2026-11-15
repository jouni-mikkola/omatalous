/**
 * What an add-on module tells of rows (docs/MODULES.md) reaches the two answers the web draws it from: `rowFields` the
 * rows of Tapahtumat, `rowParts` the parts of a category in the categories report. The module is made up here.
 */
import type { RawTransaction } from "@banking/core";
import { afterEach, describe, expect, it } from "vitest";
import { EXTENSIONS, type ServerExtension } from "../src/extensions.ts";
import { reprocess } from "../src/services/enrich.ts";
import { ingestTransactions } from "../src/services/ingest.ts";
import { Hono } from "hono";
import { setupApp } from "./helpers.ts";

afterEach(() => {
  EXTENSIONS.splice(0);
});

const charge = (bookingDate: string, cents: number, counterparty: string): RawTransaction => ({
  externalId: null, bookingDate, valueDate: null, amountCents: -cents, currency: "EUR", status: "booked",
  counterparty, counterpartyIban: null, description: null, reference: null, mcc: null,
});

async function withRows() {
  const app = await setupApp();
  const repo = app.s.finance(app.adminId);
  await repo.upsertAccount({ id: "acc-a", connectionId: null, provider: "enablebanking", externalId: null, identity: "idn-acc-a", name: "acc-a", holder: "MEIKALAINEN AINO", iban: null, currency: "EUR", type: "checking" });
  await ingestTransactions(repo, "acc-a", [charge("2026-10-02", 4_000, "ESIMERKKI MARKET"), charge("2026-10-03", 1_500, "ESIMERKKI MARKET")], "enablebanking");
  await reprocess(repo, app.s.settings);
  return app;
}

const testModule = (told: (id: string) => boolean): ServerExtension => ({
  id: "example",
  routes: () => new Hono(),
  async rowFields(_s, _user, rows) {
    return new Map(rows.filter((r) => told(r.id)).map((r) => [r.id, { exampleNote: `noted ${r.amountCents}` }]));
  },
  rowParts: {
    stamp: async () => "1",
    async parts(_s, _user, rows) {
      return new Map(
        rows.filter((r) => told(r.id)).map((r) => [r.id, { category: r.category, estimated: false, parts: [{ id: "a", label: "Osa A", cents: -r.amountCents }] }]),
      );
    },
  },
});

describe("an add-on module's rows", () => {
  it("adds its fields to the rows it knows in Tapahtumat and nothing to the others", async () => {
    const { admin } = await withRows();
    const before = (await admin.call("GET", "/api/transactions")).body.items as { id: string; amountCents: number }[];
    expect(before).toHaveLength(2);
    const big = before.find((t) => t.amountCents === -4_000)!.id;
    EXTENSIONS.push(testModule((id) => id === big));
    const items = (await admin.call("GET", "/api/transactions")).body.items as { id: string; exampleNote?: string }[];
    expect(items.find((t) => t.id === big)!.exampleNote).toBe("noted -4000");
    expect(items.filter((t) => t.id !== big).every((t) => !("exampleNote" in t))).toBe(true);
  });

  it("splits a category of the categories report into its parts, the rows it says nothing of as one part", async () => {
    const { admin } = await withRows();
    const stats = async () => (await admin.call("GET", "/api/reports?reports=categories&from=2026-10-01&to=2026-10-09")).body.categories.groups.flatMap((g: { categories: unknown[] }) => g.categories) as { totalCents: number; parts?: { label: string; cents: number }[] }[];
    // with no module no category has parts
    expect((await stats()).some((c) => c.parts)).toBe(false);
    const ids = ((await admin.call("GET", "/api/transactions")).body.items as { id: string; amountCents: number }[]).filter((t) => t.amountCents === -4_000).map((t) => t.id);
    EXTENSIONS.push(testModule((id) => ids.includes(id)));
    const split = (await stats()).find((c) => c.parts)!;
    expect(split.totalCents).toBe(5_500);
    expect(split.parts!.map((p) => p.cents).reduce((a, b) => a + b, 0)).toBe(5_500);
    expect(split.parts!.find((p) => p.label === "Osa A")!.cents).toBe(4_000);
  });
});
