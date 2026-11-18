/** Dashboard, reports, transactions, recurring, rules, accounts and sharing for the signed-in user. */
import { accountDigits, ACCOUNT_TYPES, type AccountType, cashAhead, type DashboardAnswer, type ReconcileVerdict, buildReports, fromDayNumber, isKnownCategory, patternProblem, type RuleField, openingMonth, upcomingElsewhereCents, upcomingGroups } from "@banking/core";
import { Hono } from "hono";
import { parseScope, proposalsFor, requestInputs, sharedInView, usesWithTraces } from "../services/analysis.ts";
import { hasInstanceCredentials, instanceAppInactive, offeredBanks, registrationUrls } from "../connectors/enable-banking/app-setup.ts";
import { parseOptionalBoolean, strictObject } from "../platform/validate.ts";
import { UserError } from "../platform/errors.ts";
import { categoriesIn, kindLabelsIn } from "../services/category-names.ts";
import { chooseAccountSource, clearAccountUse, leaveAccountSource, ownKey, parseSaidUsers, sayAccountUse, suggestAccountUse } from "../services/account-use.ts";
import { memoOn } from "../services/context-memo.ts";
import { proposalsOf } from "../services/request-inputs.ts";
import { dashboardOf } from "../services/dashboard-memo.ts";
import { foreignRowsView } from "../services/foreign-rows.ts";
import { reconcileOf, withProof } from "../services/reconcile.ts";
import { renewalOf } from "../services/consent-round.ts";
import { accountsView, connectionView, deleteAccount, shareAccount, unshareAccount, updateAccount } from "../services/accounts.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { sayAnswer, settledTrace, takeBackAnswer } from "../services/money-trace.ts";
import { runningSettlement } from "../services/settlement.ts";
import { addRule, deleteRule, parseCategoryUndo, setTransactionCategory, undoTransactionCategory } from "../services/rules.ts";
import { transactionsView } from "../services/transactions-view.ts";
import { withoutWrongBills } from "../services/wrong-bills.ts";
import { body, optionalString, parseRange, parseReportIds, queryInt } from "./shared.ts";

const RULE_FIELDS: RuleField[] = ["merchant", "merchant_exact", "description", "counterparty", "any"];

/** A balance typed in by hand: whole cents, at most a billion euros either way. */
const MAX_BALANCE_CENTS = 100_000_000_000;

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
    const { inputs: ownInputs, stamp } = await requestInputs(s, user.id, own.accounts);
    const opening = memoOn(own.ctx, "opening", stamp, () => openingMonth(cashAhead(own.ctx, [], ownInputs)));
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
      categories: categoriesIn(user.language),
      kinds: kindLabelsIn(user.language),
      accounts: await Promise.all((await accountsView(s, user.id, accounts)).map(async (account) => ({ ...account, digits: accountDigits(account), ...(paying.has(account.id) ? { loanPayment: true as const } : {}), ...uses.get(account.id), ...(await split(account, true)), reconcile: reconciled.get(account.id) ?? null }))),
      // without the bank of the owner's connection: the member sees the account by its name, and a card has no IBAN that tells more
      sharedAccounts: await Promise.all(sharedAccounts.map(async ({ bank: _bank, ...account }) => ({ ...account, digits: accountDigits(account), ...uses.get(account.id), ...(await split(account, false)), reconcile: reconciled.get(account.id) ?? null }))),
      members: members.map((m) => ({ id: m.id, displayName: m.displayName })),
      shares: await s.household.sharesOf(user.id),
      householdHasAccounts: await s.household.othersHaveAccounts(user.id),
      connections: views,
      renewal: await renewalOf(s, user.id, views, new Set(banks.map((b) => b.id))),
      lastSync: runs[0] ?? null,
      // the version of the data the viewer sees (the analysis cache's key): the web app drops its cached answers when it moves
      dataVersion: await s.settings.dataVersionOf([user.id, ...sharedAccounts.map((a) => a.userId)]),
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
    });
  });

  // the rows in another currency, per account of the viewer, for Asetukset > Tilit
  app.get("/foreign-rows", async (c) => {
    const userId = c.get("user").id;
    const own = await repoOf(userId).listAccounts();
    return c.json(await foreignRowsView(s, userId, [...own, ...(await sharedInView(s, userId, own))]));
  });

  app.get("/dashboard", async (c) => {
    const scope = parseScope(c.req.query("scope"));
    const { ctx: all, accounts } = await s.analysis.get(s, c.get("user").id, scope);
    const userId = c.get("user").id;
    const read = await requestInputs(s, userId, accounts);
    const { balances: stated, inputs } = read;
    // what the bank's balances prove of each account's rows: the figures say which part of them is unproven
    const reconciled = await reconcileOf(s, userId, accounts);
    const balances = withProof(stated, reconciled);
    // a bill the member marked as no recurring bill is in no list and no sum of what is coming
    const ctx = withoutWrongBills(all, inputs.marks);
    // the questions read the member's own proposals, the total of unsaved loans those of the view asked for
    // (the view asked for is the one read above, so its proposals take what was read; the own view is read again only when it is another)
    const inView = proposalsOf(all, read);
    const own = scope === "own" ? inView : await proposalsFor(s, userId);
    const dashboard = dashboardOf(ctx, parseRange(c, s.today()), balances, inputs, own, c.get("user").language, inView);
    // the same answer as Asetukset > Tilit, in three words; an account that is not reconciled (a loan) has none to give
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
    // the same answer on every page that asks while the data, the balances and the member's inputs stay as they are
    const ahead = memoOn(ctx, "ahead", [balances, inputs], () => {
      const walked = cashAhead(withoutWrongBills(ctx, inputs.marks), balances, inputs);
      // Laskut's groups of the bills ahead come with their sums: the page adds up nothing
      return { ...walked, groups: upcomingGroups(walked), elsewhereCents: upcomingElsewhereCents(walked.upcoming) };
    });
    return c.json({ ahead });
  });

  app.get("/reports", async (c) => {
    const { ctx: all, accounts } = await s.analysis.get(s, c.get("user").id, parseScope(c.req.query("scope")));
    const { balances, inputs } = await requestInputs(s, c.get("user").id, accounts);
    const range = parseRange(c, s.today());
    const lang = c.get("user").language;
    const only = parseReportIds(c.req.query("reports"));
    // a bill the member marked as no recurring bill is in no list and no sum of what is coming
    return c.json(memoOn(all, "reports", [range, balances, inputs, lang, only], () => buildReports({ ctx: withoutWrongBills(all, inputs.marks), range, balances, inputs, lang }, only)));
  });

  app.get("/recurring", async (c) => {
    const userId = c.get("user").id;
    const { ctx } = await s.analysis.get(s, userId, parseScope(c.req.query("scope")));
    // the household view shows the viewer's own marks, as the dashboard does
    const marks = await repoOf(userId).listMarks();
    const series = memoOn(ctx, "recurring", marks, () => withoutWrongBills(ctx, marks).recurring.map(({ transactionIds: _ids, ...rest }) => rest));
    return c.json({ series, marks });
  });

  // ── transactions ─────────────────────────────────────
  // the rows of the accounts in view as the bank booked them, with their sums (services/transactions-view.ts)
  app.get("/transactions", async (c) => {
    const q = c.req.query();
    return c.json(await transactionsView(s, c.get("user").id, { ...q, limit: queryInt(q.limit), offset: queryInt(q.offset) }));
  });

  app.patch("/transactions/:id", async (c) => {
    const input = strictObject(await body(c), ["category", "createRule"] as const);
    // required: null takes the category set by hand away, a missing field is a mistake and changes nothing
    if (input.category === undefined) throw new UserError("Valitse kategoria.");
    const category = input.category;
    if (category !== null && (typeof category !== "string" || !isKnownCategory(category))) throw UserError.of("rule.unknown_category");
    return c.json(await setTransactionCategory(s, c.get("user").id, c.req.param("id"), category, parseOptionalBoolean(input.createRule)));
  });

  app.post("/transactions/:id/undo-category", async (c) => {
    const input = strictObject(await body(c), ["category", "rule"] as const);
    const undo = parseCategoryUndo(input);
    return c.json(await undoTransactionCategory(s, c.get("user").id, c.req.param("id"), undo));
  });

  // ── rules ────────────────────────────────────────────
  app.get("/rules", async (c) => c.json({ rules: await repoOf(c.get("user").id).listRules() }));

  app.post("/rules", async (c) => {
    const input = strictObject(await body(c), ["field", "pattern", "category"] as const);
    const pattern = typeof input.pattern === "string" ? input.pattern.trim() : "";
    const field = input.field as RuleField;
    if (!RULE_FIELDS.includes(field) || !pattern || pattern.length > 200 || typeof input.category !== "string" || !isKnownCategory(input.category)) {
      throw UserError.of("rule.invalid");
    }
    // patternProblem gives the Finnish sentence; the code carries it to a reader of either language.
    // A pattern with no word ("*") always gets the need-a-word sentence, so the other one is the slash refusal,
    // however either sentence is worded.
    const problem = patternProblem(pattern);
    if (problem) throw UserError.of(problem === patternProblem("*") ? "rule.need_word" : "rule.no_slashes");
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

  // the members the use names who cannot see the account: asked by who linked it
  app.get("/accounts/:id/use/suggestion", async (c) => c.json(await suggestAccountUse(s, c.get("user").id, c.req.param("id"))));

  return app;
}
