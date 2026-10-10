import { describe, expect, it } from "vitest";
import { fold } from "../src/merchant.ts";
import { enrichIsland, enrichTransactions } from "../src/pipeline.ts";
import type { Account, CategoryRule, Transaction } from "../src/types.ts";
import { randomHistory, rng } from "./gen.ts";

/** More seeds for a long local run: ISLAND_SEEDS=400 npx vitest run packages/core/test/island.test.ts */
const SEEDS = Number(process.env.ISLAND_SEEDS ?? 24);
const INDUSTRIES = new Map([["Qwerty Puoti", "shopping"], ["Aaltonen Konsultointi Oy", "home"]]);
const CATEGORIES = ["groceries", "restaurants", "shopping", "transfer", "p2p", "savings", "income", "other", "card_bill", "hobbies", "health"];

/** The rows as a database holds them after a full run: the changed rows replaced. */
function settle(txs: readonly Transaction[], accounts: Account[], rules: CategoryRule[]): Transaction[] {
  const changed = new Map(enrichTransactions(txs, accounts, rules, INDUSTRIES).map((t) => [t.id, t]));
  return txs.map((t) => changed.get(t.id) ?? t);
}

export const reasons = new Map<string, number>();
const sameState = (a: Transaction, b: Transaction) => a.category === b.category && a.categorySource === b.categorySource && a.isTransfer === b.isTransfer;

interface Scenario {
  name: string;
  /** The stored rows after the change was written (a hand-set category), and what they were before it. */
  rows: Transaction[];
  before: Map<string, Pick<Transaction, "category" | "categorySource">>;
  oldRules: CategoryRule[];
  rules: CategoryRule[];
  merchants: Set<string>;
}

/** Runs the island and the full enrichment on the same change and compares every row. */
function compare(base: Transaction[], accounts: Account[], s: Scenario): "same" | "fell back" {
  const inIsland = (t: Transaction) => s.merchants.has(t.merchant);
  const island = enrichIsland({
    rows: s.rows.filter(inIsland),
    before: s.before,
    accounts,
    rules: s.rules,
    oldRules: s.oldRules,
    industries: INDUSTRIES,
    outsideMatches: s.rows.filter((t) => !inIsland(t) && t.categorySource === "match"),
  });
  if (!island.ok) {
    reasons.set(island.reason, (reasons.get(island.reason) ?? 0) + 1);
    return "fell back";
  }
  const full = settle(s.rows, accounts, s.rules);
  const incremental = new Map(island.changed.map((t) => [t.id, t]));
  for (const [i, t] of s.rows.entries()) {
    const got = incremental.get(t.id) ?? t;
    if (!sameState(got, full[i]!)) {
      throw new Error(`${s.name}: ${t.id} (${t.merchant}) incremental ${got.category}/${got.categorySource}/${got.isTransfer} but full ${full[i]!.category}/${full[i]!.categorySource}/${full[i]!.isTransfer}`);
    }
  }
  // rows outside the island are never written
  expect(island.changed.every(inIsland)).toBe(true);
  expect(base).toBeTruthy();
  return "same";
}

describe("enrichIsland equals the full enrichment", () => {
  it("after a category set by hand, a merchant rule and its removal, on random histories", () => {
    const tally = { same: 0, "fell back": 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(1000 + seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
      const { txs, accounts, rules } = randomHistory(seed, 500);
      const stored = settle(txs, accounts, rules);
      for (let k = 0; k < 40; k++) {
        const kind = pick(["edit", "edit", "edit-null", "rule", "rule-delete"] as const);
        const target = pick(stored);
        if (kind === "edit" || kind === "edit-null") {
          const category = kind === "edit" ? pick(CATEGORIES) : null;
          const rows = stored.map((t) => (t.id === target.id ? { ...t, category: category ?? t.category, categorySource: category ? ("user" as const) : ("default" as const) } : t));
          // a hand-set category with a merchant rule too, as the web app's "all of this merchant" does
          const withRule = kind === "edit" && r() < 0.3;
          const newRules = withRule ? [...rules, { id: 99, field: "merchant_exact" as const, pattern: target.merchant, category: category!, priority: 5 }] : rules;
          const merchants = new Set(stored.filter((t) => fold(t.merchant) === fold(target.merchant)).map((t) => t.merchant));
          tally[compare(stored, accounts, { name: `seed ${seed} ${kind} ${target.id}`, rows, before: new Map([[target.id, { category: target.category, categorySource: target.categorySource }]]), oldRules: rules, rules: newRules, merchants })]++;
        } else if (kind === "rule") {
          const newRules = [...rules, { id: 99, field: "merchant_exact" as const, pattern: target.merchant, category: pick(CATEGORIES), priority: 5 }];
          const merchants = new Set(stored.filter((t) => fold(t.merchant) === fold(target.merchant)).map((t) => t.merchant));
          tally[compare(stored, accounts, { name: `seed ${seed} rule ${target.merchant}`, rows: stored, before: new Map(), oldRules: rules, rules: newRules, merchants })]++;
        } else {
          // the rule exists, was applied by a full run, and is deleted
          const withRule = [...rules, { id: 99, field: "merchant_exact" as const, pattern: target.merchant, category: pick(CATEGORIES), priority: 5 }];
          const settled = settle(txs, accounts, withRule);
          const merchants = new Set(settled.filter((t) => fold(t.merchant) === fold(target.merchant)).map((t) => t.merchant));
          tally[compare(settled, accounts, { name: `seed ${seed} unrule ${target.merchant}`, rows: settled, before: new Map(), oldRules: withRule, rules, merchants })]++;
        }
      }
    }
    if (process.env.ISLAND_DEBUG) console.log([...reasons]);
    // the check is only worth something when the island is really used
    expect(tally.same).toBeGreaterThan(SEEDS * 8);
    expect(tally.same + tally["fell back"]).toBe(SEEDS * 40);
  }, 900_000);
});

describe("enrichIsland on the changes people actually make", () => {
  it("a purchase moved to another spending category, or a rule on an ordinary shop, mostly stays in the island and equals the full run", () => {
    const shops = new Set(["K-Market Kamppi", "Lidl Tikkurila", "Prisma Itis", "Neste Vantaa", "Hesburger", "Verkkokauppa.com", "Zara", "Apteekki Keskus", "Tokmanni", "Kahvila Ilo", "Xyzzy Tuntematon", "Qwerty Puoti", "Pajula Tmi", "Zorro Kauppa", "Oma Putka", "Lumi Palvelut"]);
    const tally = { same: 0, "fell back": 0 };
    for (let seed = 30; seed < 30 + SEEDS; seed++) {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
      const { txs, accounts, rules } = randomHistory(seed, 600);
      const stored = settle(txs, accounts, rules);
      const ordinary = stored.filter((t) => shops.has(t.merchant) && t.amountCents < 0 && t.categorySource !== "user" && t.categorySource !== "transfer");
      for (let k = 0; k < 30; k++) {
        const target = pick(ordinary);
        const category = pick(["groceries", "restaurants", "shopping", "hobbies", "health", "other"]);
        const merchants = new Set(stored.filter((t) => fold(t.merchant) === fold(target.merchant)).map((t) => t.merchant));
        const asRule = r() < 0.4;
        const rows = asRule ? stored : stored.map((t) => (t.id === target.id ? { ...t, category, categorySource: "user" as const } : t));
        const newRules = asRule ? [...rules, { id: 99, field: "merchant_exact" as const, pattern: target.merchant, category, priority: 5 }] : rules;
        tally[compare(stored, accounts, { name: `seed ${seed} ${target.id}`, rows, before: asRule ? new Map() : new Map([[target.id, { category: target.category, categorySource: target.categorySource }]]), oldRules: rules, rules: newRules, merchants })]++;
      }
    }
    if (process.env.ISLAND_DEBUG) console.log("ordinary", tally, [...reasons]);
    expect(tally.same / (tally.same + tally["fell back"])).toBeGreaterThan(0.7);
  }, 900_000);
});
