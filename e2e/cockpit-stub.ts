import type { BrowserContext, Page } from "@playwright/test";

/**
 * The cockpit's answers on top of the first page's own: the server of this build may not give them yet, so a spec shows
 * the page the answer it will have. Made-up figures; the bars are built from the month's own categories and add up to Yli jäi.
 */
export interface Cockpit {
  /** The month has no rows: the answer says so with null. */
  empty?: boolean;
  /** Spend more than comes in. */
  over?: boolean;
  /** The pools: one with a member who paid more, or all even. */
  settlement?: "uneven" | "even" | "none";
  /** The state of the ticks beside the balances, in the order of the accounts. */
  ticks?: ("ok" | "diff" | "unknown")[];
}

export function withCockpit(json: Record<string, any>, how: Cockpit = {}): void {
  const names: { category: string }[] = json.categories ?? [];
  const income = how.empty ? 0 : 320_000;
  // every bar has the one part that adds up to it, as the server's parts do
  const bar = (key: string, cents: number, part: string, more: { count?: number } = {}) => ({ key, cents, ...more, parts: [{ key: part, cents }] });
  const spent = names.slice(0, 4).map((c, i) => bar(`category:${c.category}`, -(60_000 - i * 12_000) * (how.over ? 2 : 1), "payee:ESIMERKKI KAUPPA"));
  const bars = [bar("income", income, "payee:ESIMERKKI OY"), ...spent, bar("other", -45_000 * (how.over ? 2 : 1), `category:${names[4]?.category ?? "other"}`, { count: 1 }), bar("transfers", 15_000, "borrowed")];
  json.waterfall = how.empty ? null : { month: String(json.range.from).slice(0, 7), bars, leftCents: bars.reduce((s, b) => s + b.cents, 0) };
  const line = (owner: string, name: string, overCents: number) => ({ owner, name, overCents });
  const month = String(json.range.from).slice(0, 7);
  json.settlement =
    how.settlement === "none"
      ? []
      : how.settlement === "even"
        ? [{ accountKey: "joint", month, lines: [line("u:1", "Matti", 0), line("u:2", "Elisa", 0)] }]
        : [{ accountKey: "joint", month, lines: [line("u:1", "Matti Meikalainen", 12_345), line("u:2", "Elisa Esimerkki", -12_345)] }];
  const ticks = how.ticks ?? ["ok", "diff", "unknown"];
  json.holdings.accounts = json.holdings.accounts.map((a: object, i: number) => ({ ...a, reconcile: ticks[i % ticks.length] }));
}

/** Every answer of the first page for the month gets the cockpit's parts. */
export async function stubCockpit(target: Page | BrowserContext, how: Cockpit = {}): Promise<void> {
  await target.route(/\/api\/dashboard(\?|$)/, async (route) => {
    const response = await route.fetch().catch(() => null);
    const json = await response?.json().catch(() => null);
    if (!response || !json) return;
    withCockpit(json, how);
    await route.fulfill({ response, json });
  });
}
