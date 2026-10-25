/** CSV export and demo data for the signed-in user. */
import { buildReports, getCategory } from "@banking/core";
import { Hono } from "hono";
import { recordEvent } from "../services/security.ts";
import { DEMO_MONTHS, loadDemoData, loadExtensionDemos } from "../demo.ts";
import { exportEverything } from "../services/data-export.ts";
import { addChunk, cancelImport, commitImport, dryRun, type ImportChecks, startImport } from "../services/data-import.ts";
import { strictObject } from "../platform/validate.ts";
import { parseLoan } from "./loans.ts";
import { parseScope, requestInputs, rowsInView } from "../services/analysis.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { removeDemoData } from "../services/accounts.ts";
import { yieldToLoop } from "../platform/yield.ts";
import { body, cents, csv, csvBody, csvResponse, parseRange, requestInfo } from "./shared.ts";

/** An average the report has none of (no complete month in the range) is an empty cell, never a zero. */
const centsOrEmpty = (v: number | null) => (v === null ? null : cents(v));

/** Where a row came from, in the words of the pages: the bank itself, a file the household imported, the example data. */
const SOURCE_WORDS: Record<string, string> = { enablebanking: "pankki", csv: "tiedosto", demo: "esimerkki" };

export function dataRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  const checks: ImportChecks = { loan: (fields, accounts) => parseLoan(fields, s.today(), accounts as never) };

  /**
   * What the signed-in user sees, one JSON file (docs/DATA_EXPORT.md): their own data and what is shared with them, for a
   * member and an administrator alike. A POST, so it passes the CSRF guard of every other write: a link from another site
   * cannot start it. A GET (and the HEAD Hono answers from it) builds nothing and writes no event. Never cached.
   */
  app.get("/data/export", (c) => c.json({ error: "Virheellinen pyyntö. Lataa sivu uudelleen.", code: "method" }, 405, { Allow: "POST" }));
  app.post("/data/export", async (c) => {
    const user = c.get("user");
    const body = await exportEverything(s, user, s.build.version);
    await recordEvent(s, { kind: "ops_export", userId: user.id, ...requestInfo(c, s), detail: "tietojen vienti: tiedosto ladattu", notify: false });
    return c.body(body, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="omatalous-${s.today()}.json"`,
      "Cache-Control": "no-store",
    });
  });

  /**
   * "Tuo tiedot" (docs/DATA_EXPORT.md, Import): the file the export wrote goes into the signed-in user's own data, in
   * chunks to a session of 15 minutes. start (the file's head), chunk (the next rows), check (the dry run: writes nothing),
   * commit (adds what is missing in one transaction). Every user imports their own data only.
   */
  app.post("/data/import", async (c) => c.json(startImport(s, c.get("user"), strictObject(await body(c), ["format", "version", "appVersion", "exportedAt", "exportedBy"]))));
  app.post("/data/import/:id/chunk", async (c) => {
    const chunk = strictObject(await body(c), ["seq", "stores"]);
    return c.json(addChunk(s, c.get("user"), c.req.param("id"), chunk.seq, Buffer.byteLength(JSON.stringify(chunk.stores ?? null)), chunk.stores));
  });
  app.post("/data/import/:id/check", async (c) => c.json(await dryRun(s, c.get("user"), c.req.param("id"), checks)));
  app.post("/data/import/:id/commit", async (c) => {
    const user = c.get("user");
    const plan = await commitImport(s, user, c.req.param("id"), checks);
    const { add, exists, skipped } = plan.total;
    await recordEvent(s, { kind: "ops_import", userId: user.id, ...requestInfo(c, s), detail: `tietojen tuonti: lisätty ${add}, jo olemassa ${exists}, ohitettu ${skipped}`, notify: false });
    return c.json(plan);
  });
  app.delete("/data/import/:id", (c) => {
    cancelImport(s, c.get("user"), c.req.param("id"));
    return c.json({ ok: true });
  });

  /**
   * Same filters and the same accounts as the transaction list, every matching row with the amount the bank booked
   * (paged so a long history is complete). The category and the transfer mark are the ones the list of the view shows.
   */
  app.get("/export/transactions.csv", async (c) => {
    const user = c.get("user");
    const range = parseRange(c, s.today());
    const q = c.req.query();
    const repo = s.finance(user.id);
    const { shared, own } = await rowsInView(s, user.id, parseScope(q.scope));
    const filter = { ...range, accountId: q.accountId, category: q.category, kind: q.kind === "income" ? ("income" as const) : undefined, merchant: q.merchant, q: q.q?.slice(0, 100), own };
    const accounts = new Map([...(await repo.listAccounts()), ...shared].map((a) => [a.id, a.name]));
    const pieces = [
      csv([["Päivä", "Tili", "Kauppias", "Saaja/maksaja", "Viesti", "Kategoria", "Ryhmä", "Summa €", "Tila", "Lähde", "Siirto"]]),
    ];
    // pages by the last row seen (no OFFSET, no count), and the loop gives way between pages so other requests are served
    const PAGE = 2000;
    for (let after: { date: string; id: string } | undefined; ; ) {
      const page = await repo.exportPage(filter, shared.length ? shared.map((a) => a.id) : undefined, PAGE, after);
      if (page.length) {
        pieces.push(
          csvBody(
            page.map((stored) => {
              const t = { ...stored, ...own.told.get(stored.id) };
              const cat = getCategory(t.category);
              return [t.bookingDate, accounts.get(t.accountId) ?? t.accountId, t.merchant, t.counterparty, t.description, cat.label, cat.group, cents(t.amountCents), t.status === "pending" ? "varaus" : "kirjattu", SOURCE_WORDS[t.source] ?? t.source, t.isTransfer ? "kyllä" : ""];
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
    const { ctx, accounts } = await s.analysis.get(s, user.id, parseScope(c.req.query("scope")));
    const { balances, inputs } = await requestInputs(s, user.id, accounts);
    const reports = buildReports({ ctx, range, balances, inputs });
    const kind = c.req.query("report") ?? "pivot";
    if (kind === "categories") {
      const rows = [
        ["Ryhmä", "Kategoria", "Yhteensä €", "Osuus %", "Ostoja", "Keskiostos €", "Keskimäärin kuussa €", "Tavallisesti kuussa €", "Pienin kuukausi €", "Suurin kuukausi €", "Edellinen jakso €", "Muutos 3 kuukaudessa %"],
        ...reports.categories.groups.flatMap((g) =>
          g.categories.map((x) => [
            g.group, x.label, cents(x.totalCents), Math.round(x.share * 1000) / 10, x.count, cents(x.avgTxCents), centsOrEmpty(x.monthlyAvgCents),
            centsOrEmpty(x.medianMonthCents), centsOrEmpty(x.minMonthCents), centsOrEmpty(x.maxMonthCents), cents(x.previousCents), x.trend === null ? null : Math.round(x.trend * 100),
          ]),
        ),
      ];
      return csvResponse(c, `kategoriat_${range.from}_${range.to}.csv`, csv(rows));
    }
    if (kind === "cashflow") {
      const rows = [
        ["Kuukausi", "Tulot €", "Kulutus €", "Velanhoito €", "Säästöön €", "Luotonnostot €", "Erotus €", "Säästöaste %", "Tulos €"],
        ...reports.cashflow.rows.map((r) => [r.month, cents(r.incomeCents), cents(r.consumptionCents), cents(r.debtCents), cents(r.savedCents), cents(r.borrowedCents), cents(r.netCents), r.savingsRate === null ? null : Math.round(r.savingsRate * 100), cents(r.leftCents)]),
      ];
      return csvResponse(c, `kassavirta_${range.from}_${range.to}.csv`, csv(rows));
    }
    const p = reports.pivot;
    const rows = [
      ["Kategoria", "Ryhmä", ...p.months, "Yhteensä €", "Keskiarvo €"],
      ...p.rows.map((r) => [r.label, r.group, ...r.values.map(cents), cents(r.totalCents), centsOrEmpty(r.averageCents)]),
      ["Yhteensä", "", ...p.monthTotals.map(cents), cents(p.totalCents), ""],
    ];
    return csvResponse(c, `kuukausitaulukko_${range.from}_${range.to}.csv`, csv(rows));
  });

  // the history is one of an allowlist, never a number from the browser
  app.post("/demo", async (c) => {
    const userId = c.get("user").id;
    const months = DEMO_MONTHS.find((m) => String(m) === c.req.query("months")) ?? DEMO_MONTHS[0];
    const loaded = await loadDemoData(s.finance(userId), s.settings, s.today(), months);
    await loadExtensionDemos(s, userId, s.today());
    return c.json(loaded);
  });

  app.delete("/demo", async (c) => {
    await removeDemoData(s, c.get("user").id);
    return c.json({ ok: true });
  });

  return app;
}
