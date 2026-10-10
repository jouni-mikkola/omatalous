/** Dashboard, reports, transactions, recurring, rules, accounts and sharing for the signed-in user. */
import { type AccountType, buildDashboard, buildReports, CATEGORIES, daysBetween, isKnownCategory, KIND_LABEL, patternProblem, type RuleField } from "@banking/core";
import { Hono } from "hono";
import type { Connection, StoredTransaction } from "../db/rows.ts";
import { parseScope, sharedInView } from "../services/analysis.ts";
import { hasInstanceCredentials } from "../services/bank-app.ts";
import { BANKS } from "../services/banks.ts";
import { strictObject } from "../services/instance.ts";
import { UserError } from "../services/errors.ts";
import type { AppEnv, Services } from "../services/context.ts";
import { reprocess, reprocessDetailed } from "../services/enrich.ts";
import { checkRuleRoom } from "../services/rules.ts";
import { body, optionalString, parseRange, queryInt } from "./shared.ts";

const ACCOUNT_TYPES: AccountType[] = ["checking", "savings", "credit_card", "loan", "other"];
const RULE_FIELDS: RuleField[] = ["merchant", "merchant_exact", "description", "counterparty", "any"];

/** A balance typed in by hand: whole cents, at most a billion euros either way. */
const MAX_BALANCE_CENTS = 100_000_000_000;

/** Past its end date a consent shows as expired before the next fetch writes that status. */
function connectionView(conn: Connection, today: string) {
  const end = conn.validUntil?.slice(0, 10) ?? null;
  return {
    ...conn,
    status: conn.status === "active" && end !== null && end < today ? ("expired" as const) : conn.status,
    daysLeft: end === null ? null : Math.max(0, daysBetween(today, end)),
  };
}

/** Raw bank payloads stay on the server. */
export function publicTx({ raw: _raw, ...t }: StoredTransaction) {
  return t;
}

export function financeRoutes(s: Services) {
  const app = new Hono<AppEnv>();
  const repoOf = (userId: string) => s.finance(userId);

  app.get("/meta", async (c) => {
    const user = c.get("user");
    const repo = repoOf(user.id);
    const accounts = await repo.listAccounts();
    const [connections, runs, sharedAccounts, members, creds, shared] = await Promise.all([
      repo.listConnections(),
      repo.listSyncRuns(1),
      // the household view's own list: a joint account linked by both partners is shown once
      sharedInView(s, user.id, accounts),
      s.users.list(),
      s.users.getBankCredentials(user.id),
      hasInstanceCredentials(s),
    ]);
    const today = s.today();
    return c.json({
      today,
      user,
      categories: CATEGORIES,
      kinds: KIND_LABEL,
      accounts,
      sharedAccounts,
      members: members.map((m) => ({ id: m.id, displayName: m.displayName })),
      shares: await s.household.sharesOf(user.id),
      connections: connections.map((conn) => connectionView(conn, today)),
      lastSync: runs[0] ?? null,
      bank: {
        configured: !!creds || !!shared,
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
    });
  });

  app.get("/dashboard", async (c) => {
    const { ctx } = await s.analysis.get(s, c.get("user").id, parseScope(c.req.query("scope")));
    return c.json(buildDashboard(ctx, parseRange(c, s.today())));
  });

  app.get("/reports", async (c) => {
    const { ctx, accounts } = await s.analysis.get(s, c.get("user").id, parseScope(c.req.query("scope")));
    const balances = accounts.map((a) => ({ id: a.id, name: a.ownerName ? `${a.name} (${a.ownerName})` : a.name, type: a.type, balanceCents: a.balanceCents }));
    return c.json(buildReports({ ctx, range: parseRange(c, s.today()), balances }));
  });

  app.get("/recurring", async (c) => {
    const { ctx } = await s.analysis.get(s, c.get("user").id, parseScope(c.req.query("scope")));
    return c.json({ series: ctx.recurring.map(({ transactionIds: _ids, ...rest }) => rest) });
  });

  // ── transactions ─────────────────────────────────────
  app.get("/transactions", async (c) => {
    const user = c.get("user");
    const q = c.req.query();
    const inView = parseScope(q.scope) === "household" ? await sharedInView(s, user.id) : undefined;
    const shared = inView?.map((a) => a.id);
    const { total, inCents, outCents, items } = await repoOf(user.id).listTransactions(
      {
        from: q.from,
        to: q.to,
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
    const repo = repoOf(c.get("user").id);
    const id = c.req.param("id");
    const input = await body<{ category: string | null; createRule?: boolean }>(c);
    const tx = await repo.getTransaction(id);
    // someone else's (shared) transaction is read-only and looks the same as a missing one
    if (!tx) return c.json({ error: "Tapahtumaa ei löydy." }, 404);
    if (input.category !== null && !isKnownCategory(input.category)) throw new UserError("Tuntematon kategoria.");
    // replacing this merchant's rule keeps the count; a new one must fit under the cap
    if (input.createRule && input.category && !(await repo.hasMerchantRule(tx.merchant))) await checkRuleRoom(repo);
    await repo.setUserCategory(id, input.category);
    if (input.createRule && input.category) await repo.setMerchantRule(tx.merchant, input.category);
    const { recategorised } = await reprocessDetailed(repo, s.settings);
    const updated = await repo.getTransaction(id);
    // the row itself was set by hand before the rules ran, so reprocess did not count it
    const self = input.category !== null && input.category !== tx.category ? 1 : 0;
    return c.json({ transaction: updated ? publicTx(updated) : null, changed: recategorised + self });
  });

  // ── rules ────────────────────────────────────────────
  app.get("/rules", async (c) => c.json({ rules: await repoOf(c.get("user").id).listRules() }));

  app.post("/rules", async (c) => {
    const repo = repoOf(c.get("user").id);
    const input = strictObject(await body(c), ["field", "pattern", "category"] as const);
    const pattern = typeof input.pattern === "string" ? input.pattern.trim() : "";
    const field = input.field as RuleField;
    if (!RULE_FIELDS.includes(field) || !pattern || pattern.length > 200 || typeof input.category !== "string" || !isKnownCategory(input.category)) {
      throw new UserError("Virheellinen sääntö.");
    }
    const problem = patternProblem(pattern);
    if (problem) throw new UserError(problem);
    await checkRuleRoom(repo);
    await repo.addRule({ field, pattern, category: input.category, priority: 10 });
    return c.json({ changed: await reprocess(repo, s.settings) });
  });

  app.delete("/rules/:id", async (c) => {
    const repo = repoOf(c.get("user").id);
    await repo.deleteRule(Number(c.req.param("id")));
    return c.json({ changed: await reprocess(repo, s.settings) });
  });

  // ── accounts & sharing ───────────────────────────────
  app.patch("/accounts/:id", async (c) => {
    const repo = repoOf(c.get("user").id);
    const id = c.req.param("id");
    const raw = strictObject(await body(c), ["name", "type", "balanceCents"] as const);
    const input = { name: optionalString(raw.name), type: optionalString(raw.type) as AccountType | undefined, balanceCents: raw.balanceCents };
    if (input.type && !ACCOUNT_TYPES.includes(input.type)) throw new UserError("Tuntematon tilityyppi.");
    const balance = input.balanceCents;
    if (balance !== undefined && (typeof balance !== "number" || !Number.isInteger(balance) || Math.abs(balance) > MAX_BALANCE_CENTS)) {
      throw new UserError("Virheellinen saldo.");
    }
    const account = await repo.getAccount(id);
    if (!account) return c.json({ error: "Tiliä ei löydy." }, 404);
    // a bank-linked account gets its balance from the bank at every sync
    if (balance !== undefined && account.provider !== "csv") throw new UserError("Saldon voi asettaa vain tuodulle tilille.");
    if (input.name !== undefined || input.type !== undefined) {
      await repo.updateAccount(id, { name: input.name?.trim().slice(0, 80) || undefined, type: input.type });
    }
    if (balance !== undefined) await repo.setAccountBalance(id, balance, s.now().toISOString());
    // account type and a card's name decide whether a card bill is a transfer
    if (input.name !== undefined || input.type !== undefined) await reprocess(repo, s.settings);
    else await s.settings.bumpDataVersion();
    return c.json(await repo.getAccount(id));
  });

  /** Imported and demo accounts only: a bank-linked one would come back at the next sync. */
  app.delete("/accounts/:id", async (c) => {
    const repo = repoOf(c.get("user").id);
    const account = await repo.getAccount(c.req.param("id"));
    // another member's account looks the same as a missing one
    if (!account) return c.json({ error: "Tiliä ei löydy." }, 404);
    if (account.provider !== "csv" && account.provider !== "demo") throw new UserError("Pankkiyhteyden tiliä ei voi poistaa.");
    await repo.deleteAccount(account.id);
    // transfers that paired with the removed rows are counted again
    await reprocess(repo, s.settings);
    return c.json({ ok: true });
  });

  app.put("/accounts/:id/shares/:userId", async (c) => {
    const ok = await s.household.share(c.get("user").id, c.req.param("id"), c.req.param("userId"));
    if (!ok) throw new UserError("Tiliä ei voi jakaa.");
    await s.settings.bumpDataVersion();
    return c.json({ ok: true });
  });

  app.delete("/accounts/:id/shares/:userId", async (c) => {
    await s.household.unshare(c.get("user").id, c.req.param("id"), c.req.param("userId"));
    await s.settings.bumpDataVersion();
    return c.json({ ok: true });
  });

  return app;
}
