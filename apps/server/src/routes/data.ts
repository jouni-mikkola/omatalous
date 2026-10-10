/** CSV import, CSV export and demo data for the signed-in user. */
import { buildReports, getCategory } from "@banking/core";
import { Hono } from "hono";
import { importCsv } from "../connectors/csv-import/service.ts";
import { loadDemoData } from "../demo.ts";
import { parseScope, sharedInView } from "../services/analysis.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { reprocess } from "../services/enrich.ts";
import { yieldToLoop } from "../platform/yield.ts";
import { body, cents, csv, csvBody, csvResponse, optionalString, parseRange } from "./shared.ts";

/** Largest CSV text accepted (characters); the request body limit leaves room for the JSON escaping. */
export const CSV_CONTENT_MAX = 5_000_000;
export const CSV_BODY_MAX = 6 * 1024 * 1024;

export function dataRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.post("/import/csv", async (c) => {
    const raw = await body<Record<string, unknown>>(c);
    const content = optionalString(raw.content, CSV_CONTENT_MAX) ?? "";
    const input = { content, accountId: optionalString(raw.accountId), accountName: optionalString(raw.accountName), accountType: optionalString(raw.accountType) };
    return c.json(await importCsv(s, c.get("user").id, input));
  });

  /** Same filters as the transaction list, every matching row (paged so a long history is complete). */
  app.get("/export/transactions.csv", async (c) => {
    const user = c.get("user");
    const range = parseRange(c, s.today());
    const q = c.req.query();
    const repo = s.finance(user.id);
    const shared = parseScope(q.scope) === "household" ? await sharedInView(s, user.id) : [];
    const filter = { ...range, accountId: q.accountId, category: q.category, merchant: q.merchant, q: q.q?.slice(0, 100) };
    const accounts = new Map([...(await repo.listAccounts()), ...shared].map((a) => [a.id, a.name]));
    const pieces = [
      csv([["Päivä", "Tili", "Kauppias", "Saaja/maksaja", "Viesti", "Kategoria", "Ryhmä", "Summa €", "Tila", "Siirto"]]),
    ];
    // pages by the last row seen (no OFFSET, no count), and the loop gives way between pages so other requests are served
    const PAGE = 2000;
    for (let after: { date: string; id: string } | undefined; ; ) {
      const page = await repo.exportPage(filter, shared.length ? shared.map((a) => a.id) : undefined, PAGE, after);
      if (page.length) {
        pieces.push(
          csvBody(
            page.map((t) => {
              const cat = getCategory(t.category);
              return [t.bookingDate, accounts.get(t.accountId) ?? t.accountId, t.merchant, t.counterparty, t.description, cat.label, cat.group, cents(t.amountCents), t.status === "pending" ? "varaus" : "kirjattu", t.isTransfer ? "kyllä" : ""];
            }),
          ),
        );
        const last = page[page.length - 1]!;
        after = { date: last.bookingDate, id: last.id };
      }
      if (page.length < PAGE) break;
      await yieldToLoop();
    }
    return csvResponse(c, `tapahtumat_${range.from}_${range.to}.csv`, pieces.join(""));
  });

  app.get("/export/report.csv", async (c) => {
    const user = c.get("user");
    const range = parseRange(c, s.today());
    const { ctx } = await s.analysis.get(s, user.id, parseScope(c.req.query("scope")));
    const reports = buildReports({ ctx, range, balances: [] });
    const kind = c.req.query("report") ?? "pivot";
    if (kind === "categories") {
      const rows = [
        ["Ryhmä", "Kategoria", "Yhteensä €", "Osuus %", "Kpl", "Keskiostos €", "Kk-keskiarvo €", "Mediaani-kk €", "Pienin kk €", "Suurin kk €", "Edellinen jakso €", "Trendi 3 kk %"],
        ...reports.categories.groups.flatMap((g) =>
          g.categories.map((x) => [
            g.group, x.label, cents(x.totalCents), Math.round(x.share * 1000) / 10, x.count, cents(x.avgTxCents), cents(x.monthlyAvgCents),
            cents(x.medianMonthCents), cents(x.minMonthCents), cents(x.maxMonthCents), cents(x.previousCents), x.trend === null ? null : Math.round(x.trend * 100),
          ]),
        ),
      ];
      return csvResponse(c, `kategoriat_${range.from}_${range.to}.csv`, csv(rows));
    }
    if (kind === "cashflow") {
      const rows = [
        ["Kuukausi", "Tulot €", "Kulutus €", "Velanhoito €", "Säästöt €", "Luotonnostot €", "Erotus €", "Säästöaste %"],
        ...reports.cashflow.rows.map((r) => [r.month, cents(r.incomeCents), cents(r.consumptionCents), cents(r.debtCents), cents(r.savedCents), cents(r.borrowedCents), cents(r.netCents), r.savingsRate === null ? null : Math.round(r.savingsRate * 100)]),
      ];
      return csvResponse(c, `kassavirta_${range.from}_${range.to}.csv`, csv(rows));
    }
    const p = reports.pivot;
    const rows = [
      ["Kategoria", "Ryhmä", ...p.months, "Yhteensä €", "Keskiarvo €"],
      ...p.rows.map((r) => [r.label, r.group, ...r.values.map(cents), cents(r.totalCents), cents(r.averageCents)]),
      ["Yhteensä", "", ...p.monthTotals.map(cents), cents(p.totalCents), ""],
    ];
    return csvResponse(c, `kuukausitaulukko_${range.from}_${range.to}.csv`, csv(rows));
  });

  app.post("/demo", async (c) => c.json(await loadDemoData(s.finance(c.get("user").id), s.settings, s.today())));

  app.delete("/demo", async (c) => {
    const repo = s.finance(c.get("user").id);
    await repo.deleteProviderData("demo");
    await reprocess(repo, s.settings);
    return c.json({ ok: true });
  });

  return app;
}
