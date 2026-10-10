/** CSV import, CSV export and demo data for the signed-in user. */
import { type AccountType, buildReports, daysBetween, getCategory, normalizeIban } from "@banking/core";
import { Hono } from "hono";
import { loadDemoData } from "../demo.ts";
import { parseBankCsv } from "../providers/csv/nordea.ts";
import { parseScope, sharedInView } from "../services/analysis.ts";
import { UserError } from "../services/errors.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { reprocess } from "../services/enrich.ts";
import { randomToken, stableId } from "../services/ids.ts";
import { startLookup } from "../services/industry.ts";
import { ingestTransactions } from "../services/ingest.ts";
import { body, cents, csv, csvResponse, optionalString, parseRange } from "./shared.ts";

/** Largest CSV text accepted (characters); the request body limit leaves room for the JSON escaping. */
export const CSV_CONTENT_MAX = 5_000_000;
export const CSV_BODY_MAX = 6 * 1024 * 1024;

const ACCOUNT_TYPES: AccountType[] = ["checking", "savings", "credit_card", "loan", "other"];

export function dataRoutes(s: Services) {
  const app = new Hono<AppEnv>();

  app.post("/import/csv", async (c) => {
    const user = c.get("user");
    const repo = s.finance(user.id);
    const raw = await body<Record<string, unknown>>(c);
    const content = optionalString(raw.content, CSV_CONTENT_MAX) ?? "";
    const input = { accountId: optionalString(raw.accountId), accountName: optionalString(raw.accountName), accountType: optionalString(raw.accountType) as AccountType | undefined };
    const parsed = parseBankCsv(content);
    // rows dated in the future are typos or a wrong date format; they would also confuse the sync window
    const today = s.today();
    const future = parsed.transactions.filter((t) => t.bookingDate > today).length;
    const transactions = parsed.transactions.filter((t) => t.bookingDate <= today);
    if (future) parsed.errors.unshift(future === 1 ? "Ohitettu 1 tulevaisuuteen päivätty rivi." : `Ohitettu ${future} tulevaisuuteen päivättyä riviä.`);
    if (!transactions.length) throw new UserError(parsed.errors[0] ?? "Tiedostosta ei löytynyt tapahtumia.");

    const accounts = await repo.listAccounts();
    // the file's own IBAN lets transfers to another imported account pair up; an IBAN that
    // another own account already has would make two accounts look like one, so it is left out
    const ownIban = parsed.ownIban && !accounts.some((a) => normalizeIban(a.iban) === parsed.ownIban) ? parsed.ownIban : null;
    let accountId = input.accountId;
    if (accountId) {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) throw new UserError("Tiliä ei löydy.");
      if (!account.iban && ownIban) await repo.setAccountIbanIfMissing(accountId, ownIban);
    } else {
      const name = input.accountName?.trim().slice(0, 80) || "Tuotu tili";
      // a second file under the same name would silently land in the first account
      const key = name.toLowerCase();
      if (accounts.some((a) => a.name.trim().toLowerCase() === key)) throw new UserError(`Tili ${name} on jo olemassa. Valitse se listasta tai anna toinen nimi.`);
      let identity = await stableId(`${user.id}|csv|${name}`);
      // an account imported under this name and renamed since keeps the id; the new one must not take it over
      if (accounts.some((a) => a.id === `csv-${identity}`)) identity = await stableId(`${user.id}|csv|${name}|${randomToken()}`);
      accountId = `csv-${identity}`;
      await repo.upsertAccount({
        id: accountId,
        connectionId: null,
        provider: "csv",
        externalId: null,
        identity,
        name,
        iban: ownIban,
        currency: "EUR",
        type: input.accountType && ACCOUNT_TYPES.includes(input.accountType) ? input.accountType : "checking",
      });
    }
    const result = await ingestTransactions(repo, accountId, transactions, "csv", { replacePending: false });
    await reprocess(repo, s.settings);
    if (result.inserted) startLookup(s);
    // the file's own dates, so an export that ends long ago is noticed now and not in Reports later
    const dates = transactions.map((t) => t.bookingDate).sort();
    const range = dates.length ? { firstDate: dates[0]!, lastDate: dates[dates.length - 1]!, daysOld: daysBetween(dates[dates.length - 1]!, s.today()) } : {};
    return c.json({ accountId, ...result, ...range, errors: parsed.errors.slice(0, 20) });
  });

  /** Same filters as the transaction list, every matching row (paged so a long history is complete). */
  app.get("/export/transactions.csv", async (c) => {
    const user = c.get("user");
    const range = parseRange(c, s.today());
    const q = c.req.query();
    const repo = s.finance(user.id);
    const shared = parseScope(q.scope) === "household" ? await sharedInView(s, user.id) : [];
    const filter = { ...range, accountId: q.accountId, category: q.category, merchant: q.merchant, q: q.q?.slice(0, 100) };
    const items = [];
    for (let offset = 0; ; offset += 5000) {
      const page = await repo.listTransactions({ ...filter, limit: 5000, offset }, shared.length ? shared.map((a) => a.id) : undefined);
      items.push(...page.items);
      if (page.items.length < 5000) break;
    }
    const accounts = new Map([...(await repo.listAccounts()), ...shared].map((a) => [a.id, a.name]));
    const rows = [
      ["Päivä", "Tili", "Kauppias", "Saaja/maksaja", "Viesti", "Kategoria", "Ryhmä", "Summa €", "Tila", "Siirto"],
      ...items.map((t) => {
        const cat = getCategory(t.category);
        return [t.bookingDate, accounts.get(t.accountId) ?? t.accountId, t.merchant, t.counterparty, t.description, cat.label, cat.group, cents(t.amountCents), t.status === "pending" ? "varaus" : "kirjattu", t.isTransfer ? "kyllä" : ""];
      }),
    ];
    return csvResponse(c, `tapahtumat_${range.from}_${range.to}.csv`, csv(rows));
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
