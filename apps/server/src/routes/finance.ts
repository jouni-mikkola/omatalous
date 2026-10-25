/** Dashboard, reports, transactions, recurring, rules, accounts and sharing for the signed-in user. */
import { accountDigits, ACCOUNT_TYPES, type AccountType, billMonth, billMonthOf, calendarDays, buildDashboard, cancelledSubjects, cashAhead, type DashboardAnswer, type ReconcileVerdict, buildReports, CATEGORIES, fromDayNumber, isKnownCategory, KIND_LABEL, moneyBins, partCents, patternProblem, type RuleField, openingMonth, upcomingGroups } from "@banking/core";
import { Hono } from "hono";
import { parseScope, proposalsFor, requestInputs, rowsInView, sharedInView, usesWithTraces } from "../services/analysis.ts";
import { hasInstanceCredentials, instanceAppInactive, offeredBanks, registrationUrls } from "../connectors/enable-banking/app-setup.ts";
import { parseDateRange, parseLoanRef, parseOptionalBoolean, strictObject } from "../platform/validate.ts";
import { UserError } from "../platform/errors.ts";
import { chooseAccountSource, clearAccountUse, leaveAccountSource, ownKey, parseSaidUsers, sayAccountUse, suggestAccountUse } from "../services/account-use.ts";
import { accountSources } from "../services/account-sources.ts";
import { explainFigure, isExplained, MAX_ACCOUNTS } from "../services/explain.ts";
import { foreignRowsView } from "../services/foreign-rows.ts";
import { reconcileOf } from "../services/reconcile.ts";
import { renewalOf } from "../services/consent-round.ts";
import { accountsView, connectionView, deleteAccount, shareAccount, unshareAccount, updateAccount } from "../services/accounts.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { extensionRowFields } from "../extensions.ts";
import { sayAnswer, settledTrace, takeBackAnswer } from "../services/money-trace.ts";
import { runningSettlement } from "../services/settlement.ts";
import { addRule, deleteRule, publicTx, setTransactionCategory } from "../services/rules.ts";
import { body, optionalString, parseRange, parseReportIds, queryInt } from "./shared.ts";

const RULE_FIELDS: RuleField[] = ["merchant", "merchant_exact", "description", "counterparty", "any"];

/** A balance typed in by hand: whole cents, at most a billion euros either way. */
const MAX_BALANCE_CENTS = 100_000_000_000;

// the strip's histogram bins at most the last hundred years of a span (1 201 month bins, about 70 kB): no household's bank
// rows reach that far, and a span of 1900 to 2199 would be 3 600 bins (210 kB) on every load of the list
const HISTOGRAM_YEARS = 100;
const histogramFrom = (span: { from: string; to: string }): string => {
  const first = `${String(Number(span.to.slice(0, 4)) - HISTOGRAM_YEARS).padStart(4, "0")}-${span.to.slice(5, 7)}-01`;
  return span.from > first ? span.from : first;
};

/** The question a viewer is asked, and the answer given, with the text their own row of that payer shows (the opening: its day). */
async function tracedFields(s: Services, key: string, split: { by: "app" | "user"; at: string } | undefined, asker: boolean) {
  const t = asker ? await settledTrace(s, key) : null;
  const label = (kind: "in" | "opening", answerKey: string) => (kind === "opening" ? (t ? fromDayNumber(t.raw.openingDay) : "") : (t?.labels.get(answerKey) ?? ""));
  const answers = (t?.answers ?? []).map((a) => ({ kind: a.kind, key: a.key, label: label(a.kind, a.key), owner: a.owner })).filter((a) => a.label);
  return {
    ...(split ? { split } : {}),
    ...(t?.questions.length ? { questions: t.questions.map((q) => ({ ...q, label: label(q.kind, q.key) })) } : {}),
    ...(answers.length ? { answers } : {}),
    ...(t?.offer ? { offer: t.offer } : {}),
  };
}

/** The answer a request names: what was asked, whose money it was. */
function parseAnswer(value: unknown, withOwner: boolean): { kind: "in" | "opening"; key: string; owner: string } {
  const raw = strictObject(value, withOwner ? (["kind", "key", "owner"] as const) : (["kind", "key"] as const)) as { kind?: unknown; key?: unknown; owner?: unknown };
  if (raw.kind !== "in" && raw.kind !== "opening") throw new UserError("Kysymystä ei löydy.");
  if (typeof raw.key !== "string" || !raw.key || raw.key.length > 300) throw new UserError("Kysymystä ei löydy.");
  if (withOwner && (typeof raw.owner !== "string" || !raw.owner || raw.owner.length > 100)) throw new UserError("Valitse yksi tilin käyttäjistä.");
  return { kind: raw.kind, key: raw.key, owner: withOwner ? (raw.owner as string) : "" };
}

export function financeRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  const repoOf = (userId: string) => s.finance(userId);

  app.get("/meta", async (c) => {
    const user = c.get("user");
    const repo = repoOf(user.id);
    const accounts = await repo.listAccounts();
    const [connections, runs, sharedAccounts, members, creds, shared, inactive, banks] = await Promise.all([
      repo.listConnections(),
      repo.listSyncRuns(1),
      // the household view's own list: a joint account linked by both partners is shown once
      sharedInView(s, user.id, accounts),
      s.users.list(),
      s.users.getBankCredentials(user.id),
      hasInstanceCredentials(s),
      instanceAppInactive(s),
      // the banks the instance's own application lists, asked once a day (app-setup.ts)
      offeredBanks(s),
    ]);
    const today = s.today();
    const views = connections.map((conn) => connectionView(conn, today, s.instance.current.timezone, accounts, connections));
    // the month Yhteenveto opens on, by the viewer's own pay: the running one once its pay has come
    const own = await s.analysis.get(s, user.id, "own");
    const opening = openingMonth(cashAhead(own.ctx, [], (await requestInputs(s, user.id, own.accounts)).inputs));
    // the accounts the bank types as a loan that carry a loan's instalments only: one view of the own accounts decides it
    const paying = accounts.some((a) => a.type === "loan") ? own.ctx.paymentAccounts : new Set<string>();
    const { privacyUrl, termsUrl } = registrationUrls(s);
    // who uses each account in view, and the viewer's part of it
    const { uses, traces } = await usesWithTraces(s, user.id, [...accounts, ...sharedAccounts]);
    // the facts of a split: served for what the viewer sees; the questions and answers only to the member who linked the account
    // the reconcile answer of every account the viewer sees: the own ones and those shared with them, nobody else's
    const reconciled = await reconcileOf(s, user.id, [...accounts, ...sharedAccounts]);
    const split = async (a: { id: string }, own: boolean) => {
      const facts = traces.get(a.id);
      return facts ? tracedFields(s, facts.key, facts.split, own) : {};
    };
    return c.json({
      today,
      opening,
      user,
      categories: CATEGORIES,
      kinds: KIND_LABEL,
      accounts: await Promise.all((await accountsView(s, user.id, accounts)).map(async (account) => ({ ...account, digits: accountDigits(account), ...(paying.has(account.id) ? { loanPayment: true as const } : {}), ...uses.get(account.id), ...(await split(account, true)), reconcile: reconciled.get(account.id) ?? null }))),
      // without the bank of the owner's connection: the member sees the account by its name, and a card has no IBAN that tells more
      sharedAccounts: await Promise.all(sharedAccounts.map(async ({ bank: _bank, ...account }) => ({ ...account, digits: accountDigits(account), ...uses.get(account.id), ...(await split(account, false)), reconcile: reconciled.get(account.id) ?? null }))),
      members: members.map((m) => ({ id: m.id, displayName: m.displayName })),
      shares: await s.household.sharesOf(user.id),
      connections: views,
      renewal: await renewalOf(s, user.id, views, new Set(banks.map((b) => b.id))),
      lastSync: runs[0] ?? null,
      bank: {
        // the household's app counts once Enable Banking says it is active; a member's own key is not checked
        configured: !!creds || (!!shared && !inactive),
        // why it is off: the picker says the app is not active yet instead of asking to set it up
        inactive: !creds && !!shared && inactive,
        source: creds ? "user" : shared ? "instance" : null,
        // `logo` says the server serves the bank's logo (routes/bank-logos.ts); the address itself stays on the server
        banks: banks.map(({ id, name, country, logo }) => ({ id, name, country, logo })),
        redirectUrl: s.redirectUrl(),
        // a member making their own app types these into the Control Panel's form
        privacyUrl,
        termsUrl,
        redirectMode: s.redirectMode(),
        canStoreOwnKeys: !!s.config.appSecret,
      },
      sync: { hours: s.instance.current.syncHours },
      // the web app compares this with the value it started with and offers a reload after an upgrade
      version: { app: s.build.version, build: s.build.id },
      // the wizard is shown to admins until it has been completed or skipped
      setupDone: s.instance.current.setupDone,
      // the web app hides the nav entry of a module that is off
      features: s.instance.features(),
    });
  });

  // the rows in another currency, per account of the viewer, for Asetukset > Tilit
  app.get("/foreign-rows", async (c) => {
    const userId = c.get("user").id;
    const own = await repoOf(userId).listAccounts();
    return c.json(await foreignRowsView(s, userId, [...own, ...(await sharedInView(s, userId, own))]));
  });

  app.get("/dashboard", async (c) => {
    const { ctx, accounts } = await s.analysis.get(s, c.get("user").id, parseScope(c.req.query("scope")));
    const { balances, inputs } = await requestInputs(s, c.get("user").id, accounts);
    const userId = c.get("user").id;
    const dashboard = buildDashboard(ctx, parseRange(c, s.today()), balances, inputs, await proposalsFor(s, userId));
    // the same answer as Asetukset > Tilit, in three words; an account that is not reconciled (a loan) has none to give
    const shown = new Set([...dashboard.holdings.accounts, ...dashboard.holdings.cards].map((h) => h.id));
    const reconciled = await reconcileOf(s, userId, accounts.filter((a) => shown.has(a.id)));
    const word: Record<string, ReconcileVerdict> = { proved: "ok", differs: "diff" };
    const verdict = (id: string): ReconcileVerdict => word[reconciled.get(id)?.status ?? "unknown"] ?? "unknown";
    const answer: DashboardAnswer = { ...dashboard, holdings: { ...dashboard.holdings, accounts: dashboard.holdings.accounts.map((a) => ({ ...a, reconcile: verdict(a.id) })), cards: dashboard.holdings.cards.map((c) => ({ ...c, reconcile: verdict(c.id) })) }, settlement: await runningSettlement(s, userId) };
    return c.json(answer);
  });

  // what is due in the next days: the answer Yhteenveto's block and Laskut's list both draw, without the rest of the dashboard
  app.get("/ahead", async (c) => {
    const userId = c.get("user").id;
    const { ctx, accounts } = await s.analysis.get(s, userId, parseScope(c.req.query("scope")));
    const { balances, inputs } = await requestInputs(s, userId, accounts);
    const ahead = cashAhead(ctx, balances, inputs);
    // Laskut's groups of the bills ahead come with their sums: the page adds up nothing
    return c.json({ ahead: { ...ahead, groups: upcomingGroups(ahead) } });
  });

  app.get("/reports", async (c) => {
    const { ctx, accounts } = await s.analysis.get(s, c.get("user").id, parseScope(c.req.query("scope")));
    const { balances, inputs } = await requestInputs(s, c.get("user").id, accounts);
    return c.json(buildReports({ ctx, range: parseRange(c, s.today()), balances, inputs }, parseReportIds(c.req.query("reports"))));
  });

  // "Miksi?": the rows of one figure and why each counts so; the figure's own access, no names in the answer
  app.get("/explain", async (c) => {
    const figure = c.req.query("figure") ?? "";
    if (!isExplained(figure)) throw new UserError("Tuntematon raportti.");
    const ids = c.req.query("accounts");
    const accountIds = ids ? ids.split(",", MAX_ACCOUNTS + 1) : undefined;
    if (accountIds && (accountIds.length > MAX_ACCOUNTS || accountIds.some((id) => !id))) throw new UserError("Tuntematon raportti.");
    return c.json(await explainFigure(s, c.get("user").id, { figure, scope: parseScope(c.req.query("scope")), range: parseRange(c, s.today()), accountIds, category: c.req.query("category"), rowId: c.req.query("row"), loanId: parseLoanRef(c.req.query("loan")) }));
  });

  app.get("/recurring", async (c) => {
    const userId = c.get("user").id;
    const { ctx } = await s.analysis.get(s, userId, parseScope(c.req.query("scope")));
    // the household view shows the viewer's own marks, as the dashboard does
    return c.json({ series: ctx.recurring.map(({ transactionIds: _ids, ...rest }) => rest), marks: await repoOf(userId).listMarks() });
  });

  /**
   * The month board of Laskut: each bill of the month paid, missing or coming, with the totals of each and the fixed
   * costs of a month (core `billMonth`). The month is clamped to the twelve before this one and the next. The viewer's
   * own marks say what is cancelled, and an instalment plan whose answered last month has passed is over, as on the dashboard.
   */
  app.get("/bill-month", async (c) => {
    const userId = c.get("user").id;
    const { ctx, accounts } = await s.analysis.get(s, userId, parseScope(c.req.query("scope")));
    const { inputs } = await requestInputs(s, userId, accounts);
    return c.json({ board: billMonth(ctx, billMonthOf(ctx.today, c.req.query("month")), cancelledSubjects(inputs, ctx.today)) });
  });

  // ── transactions ─────────────────────────────────────
  /**
   * The rows of the accounts in view as the bank booked them, in both views. In the own view a row of a joint account
   * carries the viewer's part beside its amount (`partCents`), and `inCents` and `outCents` add up parts. A row has the
   * category and the transfer mark the view counts it by, so the list, its sums and the front page say the same of it.
   */
  app.get("/transactions", async (c) => {
    const user = c.get("user");
    const q = c.req.query();
    const range = parseDateRange(q.from || undefined, q.to || undefined);
    const { shared, own } = await rowsInView(s, user.id, parseScope(q.scope));
    const { total, inCents, outCents, days, items: stored } = await repoOf(user.id).listTransactions(
      {
        from: range.from,
        to: range.to,
        accountId: q.accountId,
        category: q.category,
        kind: q.kind === "income" ? "income" : undefined,
        merchant: q.merchant,
        q: q.q?.slice(0, 100),
        limit: queryInt(q.limit),
        offset: queryInt(q.offset),
        own,
      },
      shared.map((a) => a.id),
    );
    const items = stored.map((t) => ({ ...t, ...own.told.get(t.id) }));
    // which company and industry an "industry" category came from, shown on hover; a shared
    // row's category came from its owner's lookups, so the owners' requests count too
    const industry = await repoOf(user.id).industryDetails(
      items.filter((t) => t.categorySource === "industry").map((t) => t.merchant),
      shared.map((a) => a.userId),
    );
    const extra = await extensionRowFields(s, user.id, items.filter((t) => t.userId === user.id));
    // the period the sums cover: the filter's, or from the first to the last matching row
    const span = days.length ? { from: range.from ?? days[0]!.date, to: range.to ?? days[days.length - 1]!.date } : null;
    const onPage = new Set(items.map((t) => t.bookingDate));
    return c.json({
      total,
      inCents,
      outCents,
      netCents: inCents - outCents,
      span,
      // the totals strip's histogram, the calendar of the last 53 weeks of the span, and each listed day's whole sums
      histogram: span ? moneyBins(days, histogramFrom(span), span.to) : null,
      calendar: span ? calendarDays(days, span.from, span.to, s.today(), q.kind === "income") : null,
      daySums: days.filter((d) => onPage.has(d.date)),
      items: items.map((t) => {
        const part = own.parts.get(t.accountId);
        const share = own.shares?.get(t.id);
        return {
          ...publicTx(t),
          own: t.userId === user.id,
          ...(share ? { partCents: share.cents, ...(share.openCents !== 0 ? { openCents: share.openCents } : {}) } : part ? { partCents: partCents(t.amountCents, part) } : {}),
          ...(industry.has(t.merchant) && t.categorySource === "industry" ? { industry: industry.get(t.merchant) } : {}),
          ...extra.get(t.id),
        };
      }),
    });
  });

  app.patch("/transactions/:id", async (c) => {
    const input = strictObject(await body(c), ["category", "createRule"] as const);
    // required: null takes the category set by hand away, a missing field is a mistake and changes nothing
    if (input.category === undefined) throw new UserError("Valitse kategoria.");
    const category = input.category;
    if (category !== null && (typeof category !== "string" || !isKnownCategory(category))) throw new UserError("Tuntematon kategoria.");
    return c.json(await setTransactionCategory(s, c.get("user").id, c.req.param("id"), category, parseOptionalBoolean(input.createRule)));
  });

  // ── rules ────────────────────────────────────────────
  app.get("/rules", async (c) => c.json({ rules: await repoOf(c.get("user").id).listRules() }));

  app.post("/rules", async (c) => {
    const input = strictObject(await body(c), ["field", "pattern", "category"] as const);
    const pattern = typeof input.pattern === "string" ? input.pattern.trim() : "";
    const field = input.field as RuleField;
    if (!RULE_FIELDS.includes(field) || !pattern || pattern.length > 200 || typeof input.category !== "string" || !isKnownCategory(input.category)) {
      throw new UserError("Virheellinen sääntö.");
    }
    const problem = patternProblem(pattern);
    if (problem) throw new UserError(problem);
    return c.json({ changed: await addRule(s, c.get("user").id, { field, pattern, category: input.category }) });
  });

  app.delete("/rules/:id", async (c) => c.json({ changed: await deleteRule(s, c.get("user").id, Number(c.req.param("id"))) }));

  // ── accounts & sharing ───────────────────────────────
  app.patch("/accounts/:id", async (c) => {
    const raw = strictObject(await body(c), ["name", "type", "balanceCents"] as const);
    const type = optionalString(raw.type) as AccountType | undefined;
    if (type && !ACCOUNT_TYPES.includes(type)) throw new UserError("Tuntematon tilityyppi.");
    const balance = raw.balanceCents;
    if (balance !== undefined && (typeof balance !== "number" || !Number.isInteger(balance) || Math.abs(balance) > MAX_BALANCE_CENTS)) {
      throw new UserError("Virheellinen saldo.");
    }
    return c.json(await updateAccount(s, c.get("user").id, c.req.param("id"), { name: optionalString(raw.name), type, balanceCents: balance as number | undefined }));
  });

  app.delete("/accounts/:id", async (c) => {
    await deleteAccount(s, c.get("user").id, c.req.param("id"));
    return c.json({ ok: true });
  });

  app.put("/accounts/:id/shares/:userId", async (c) => {
    await shareAccount(s, c.get("user").id, c.req.param("id"), c.req.param("userId"));
    return c.json({ ok: true });
  });

  app.delete("/accounts/:id/shares/:userId", async (c) => {
    await unshareAccount(s, c.get("user").id, c.req.param("id"), c.req.param("userId"));
    return c.json({ ok: true });
  });

  // who uses an account and at what weights: said by a member who linked it, for the real account
  app.put("/accounts/:id/use", async (c) => {
    const raw = strictObject(await body(c), ["users"] as const);
    await sayAccountUse(s, c.get("user").id, c.req.param("id"), parseSaidUsers(raw.users));
    return c.json({ ok: true });
  });

  app.delete("/accounts/:id/use", async (c) => {
    await clearAccountUse(s, c.get("user").id, c.req.param("id"));
    return c.json({ ok: true });
  });

  // an account cut by who paid it, or by its weights again: chosen by a member who linked it, for the real account
  app.put("/accounts/:id/split", async (c) => {
    const raw = strictObject(await body(c), ["mode"] as const);
    if (raw.mode !== "source") throw new UserError("Virheellinen jako.");
    await chooseAccountSource(s, c.get("user").id, c.req.param("id"));
    return c.json({ ok: true });
  });

  app.delete("/accounts/:id/split", async (c) => {
    await leaveAccountSource(s, c.get("user").id, c.req.param("id"));
    return c.json({ ok: true });
  });

  // whose money a payer's was, or the opening: said by a member who linked the account, for the real account
  app.put("/accounts/:id/answers", async (c) => {
    const user = c.get("user");
    const { kind, key, owner } = parseAnswer(await body(c), true);
    await sayAnswer(s, await ownKey(s, user.id, c.req.param("id")), { kind, key, owner }, user.id);
    return c.json({ ok: true });
  });

  app.delete("/accounts/:id/answers", async (c) => {
    const user = c.get("user");
    const { kind, key } = parseAnswer(await body(c), false);
    await takeBackAnswer(s, await ownKey(s, user.id, c.req.param("id")), kind, key);
    return c.json({ ok: true });
  });

  // what each member paid in, bore and moved, month by month, for a member who sees the account
  app.get("/accounts/:id/sources", async (c) => c.json(await accountSources(s, c.get("user").id, c.req.param("id"))));

  // the members the use names who cannot see the account: asked by who linked it
  app.get("/accounts/:id/use/suggestion", async (c) => c.json(await suggestAccountUse(s, c.get("user").id, c.req.param("id"))));

  return app;
}
