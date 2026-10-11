/** Dashboard, reports, transactions, recurring, rules, accounts and sharing for the signed-in user. */
import { ACCOUNT_TYPES, type AccountType, buildDashboard, buildReports, CATEGORIES, isKnownCategory, KIND_LABEL, patternProblem, type RuleField } from "@banking/core";
import { Hono } from "hono";
import { parseScope, requestInputs, sharedInView } from "../services/analysis.ts";
import { hasInstanceCredentials, instanceAppInactive } from "../connectors/enable-banking/app-setup.ts";
import { BANKS } from "../connectors/enable-banking/banks.ts";
import { parseIsoDate, parseOptionalBoolean, strictObject } from "../platform/validate.ts";
import { UserError } from "../platform/errors.ts";
import { accountsView, connectionView, deleteAccount, shareAccount, unshareAccount, updateAccount } from "../services/accounts.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { addRule, deleteRule, publicTx, setTransactionCategory } from "../services/rules.ts";
import { body, optionalString, parseRange, parseReportIds, queryInt } from "./shared.ts";

const RULE_FIELDS: RuleField[] = ["merchant", "merchant_exact", "description", "counterparty", "any"];

/** A balance typed in by hand: whole cents, at most a billion euros either way. */
const MAX_BALANCE_CENTS = 100_000_000_000;

export function financeRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  const repoOf = (userId: string) => s.finance(userId);

  app.get("/meta", async (c) => {
    const user = c.get("user");
    const repo = repoOf(user.id);
    const accounts = await repo.listAccounts();
    const [connections, runs, sharedAccounts, members, creds, shared, inactive] = await Promise.all([
      repo.listConnections(),
      repo.listSyncRuns(1),
      // the household view's own list: a joint account linked by both partners is shown once
      sharedInView(s, user.id, accounts),
      s.users.list(),
      s.users.getBankCredentials(user.id),
      hasInstanceCredentials(s),
      instanceAppInactive(s),
    ]);
    const today = s.today();
    return c.json({
      today,
      user,
      categories: CATEGORIES,
      kinds: KIND_LABEL,
      accounts: await accountsView(s, user.id, accounts),
      sharedAccounts,
      members: members.map((m) => ({ id: m.id, displayName: m.displayName })),
      shares: await s.household.sharesOf(user.id),
      connections: connections.map((conn) => connectionView(conn, today, accounts, connections)),
      lastSync: runs[0] ?? null,
      bank: {
        // the household's app counts once Enable Banking says it is active; a member's own key is not checked
        configured: !!creds || (!!shared && !inactive),
        // why it is off: the picker says the app is not active yet instead of asking to set it up
        inactive: !creds && !!shared && inactive,
        source: creds ? "user" : shared ? "instance" : null,
        banks: BANKS.map(({ id, name, country }) => ({ id, name, country })),
        redirectUrl: s.redirectUrl(),
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

  app.get("/dashboard", async (c) => {
    const { ctx, accounts } = await s.analysis.get(s, c.get("user").id, parseScope(c.req.query("scope")));
    const { balances, inputs } = await requestInputs(s, c.get("user").id, accounts);
    return c.json(buildDashboard(ctx, parseRange(c, s.today()), balances, inputs));
  });

  app.get("/reports", async (c) => {
    const { ctx, accounts } = await s.analysis.get(s, c.get("user").id, parseScope(c.req.query("scope")));
    const { balances, inputs } = await requestInputs(s, c.get("user").id, accounts);
    return c.json(buildReports({ ctx, range: parseRange(c, s.today()), balances, inputs }, parseReportIds(c.req.query("reports"))));
  });

  app.get("/recurring", async (c) => {
    const userId = c.get("user").id;
    const { ctx } = await s.analysis.get(s, userId, parseScope(c.req.query("scope")));
    // the household view shows the viewer's own marks, as the dashboard does
    return c.json({ series: ctx.recurring.map(({ transactionIds: _ids, ...rest }) => rest), marks: await repoOf(userId).listMarks() });
  });

  // ── transactions ─────────────────────────────────────
  app.get("/transactions", async (c) => {
    const user = c.get("user");
    const q = c.req.query();
    const inView = parseScope(q.scope) === "household" ? await sharedInView(s, user.id) : undefined;
    const shared = inView?.map((a) => a.id);
    const { total, inCents, outCents, items } = await repoOf(user.id).listTransactions(
      {
        from: q.from ? parseIsoDate(q.from, "Virheellinen aikaväli.") : undefined,
        to: q.to ? parseIsoDate(q.to, "Virheellinen aikaväli.") : undefined,
        accountId: q.accountId,
        category: q.category,
        merchant: q.merchant,
        q: q.q?.slice(0, 100),
        limit: queryInt(q.limit),
        offset: queryInt(q.offset),
      },
      shared,
    );
    // which company and industry an "industry" category came from, shown on hover; a shared
    // row's category came from its owner's lookups, so the owners' requests count too
    const industry = await repoOf(user.id).industryDetails(
      items.filter((t) => t.categorySource === "industry").map((t) => t.merchant),
      (inView ?? []).map((a) => a.userId),
    );
    return c.json({
      total,
      inCents,
      outCents,
      items: items.map((t) => ({ ...publicTx(t), own: t.userId === user.id, ...(industry.has(t.merchant) && t.categorySource === "industry" ? { industry: industry.get(t.merchant) } : {}) })),
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

  return app;
}
