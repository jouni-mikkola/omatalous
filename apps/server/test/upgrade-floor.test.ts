/**
 * The start-up data steps and their floors: a step declares the lowest release it may run from, a build below it
 * leaves the step alone, and the steps the app has today run from the first release on. Made-up data.
 */
import { describe, expect, it } from "vitest";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { setupApp } from "./helpers.ts";

type DataStep = NonNullable<Parameters<typeof runUpgradeTasks>[2]>[number];

/** A step that only counts how often it ran. */
const counting = (name: string, floor: string, ran: string[]): DataStep => ({
  name,
  floor,
  run: async () => {
    ran.push(name);
    return 1;
  },
});

describe("data step floors", () => {
  it("runs a step at its floor and above it, and leaves it alone below", async () => {
    const { s } = await setupApp();
    const ran: string[] = [];
    const steps = [counting("early", "0.44.0", ran), counting("at", "0.45.0", ran), counting("later", "0.46.0", ran)];
    const result = await runUpgradeTasks(s, "0.45.0+abc", steps);
    expect(ran).toEqual(["early", "at"]);
    expect(result).toMatchObject({ users: 1, steps: { early: 1, at: 1 }, skipped: ["later"] });
  });

  it("runs the step once the build reaches the floor, though an earlier build skipped it", async () => {
    const { s } = await setupApp();
    const ran: string[] = [];
    const steps = [counting("later", "0.46.0", ran)];
    expect(await runUpgradeTasks(s, "0.45.9+abc", steps)).toMatchObject({ skipped: ["later"], steps: {} });
    expect(ran).toEqual([]);
    expect(await runUpgradeTasks(s, "0.46.0+def", steps)).toMatchObject({ skipped: [], steps: { later: 1 } });
    expect(ran).toEqual(["later"]);
  });

  it("reads the release of a build id, with or without the part after the plus", async () => {
    const { s } = await setupApp();
    const ran: string[] = [];
    await runUpgradeTasks(s, "0.46.0", [counting("bare", "0.46.0", ran)]);
    await runUpgradeTasks(s, "0.46.1+dev-1700000000000", [counting("dev", "0.46.0", ran)]);
    await runUpgradeTasks(s, "0.45.9+0.46.0", [counting("suffix", "0.46.0", ran)]);
    expect(ran).toEqual(["bare", "dev"]);
  });

  it("skips a step whose floor is no release, rather than running it from anywhere", async () => {
    const { s } = await setupApp();
    const ran: string[] = [];
    const result = await runUpgradeTasks(s, "0.50.0+abc", [counting("odd", "soon", ran)]);
    expect(ran).toEqual([]);
    expect(result?.skipped).toEqual(["odd"]);
  });

  it("clears what hangs on a real account nobody holds once per build, from the release of the tables, keeps every row keyed by a real account", async () => {
    const { s, db, adminId } = await setupApp();
    await s.finance(adminId).upsertAccount({ id: "held", connectionId: null, provider: "enablebanking", externalId: "x", identity: "idn-held", name: "Yhteinen tili", iban: null, currency: "EUR", type: "checking" });
    const put = async () => {
      for (const key of ["idn-held", "idn-gone"]) {
        await db.run("INSERT OR IGNORE INTO account_balances (account_key, day, type, cents, fetched_at, source) VALUES (?, '2026-10-20', 'CLBD', 1, '2026-10-20T08:00:00.000Z', 'bank')", [key]);
        await db.run("INSERT OR IGNORE INTO foreign_rows (account_key, raw_key, booking_date, amount_minor, scale, currency, seen_at) VALUES (?, 'r', '2026-10-20', 1, 2, 'USD', '2026-10-20T08:00:00.000Z')", [key]);
      }
      await db.run("INSERT OR IGNORE INTO account_history (account_id, asked_from, source, recorded_at) VALUES ('held', '2026-10-01', 'default', '2026-10-20T08:00:00.000Z'), ('gone', '2026-10-01', 'default', '2026-10-20T08:00:00.000Z')");
    };
    await put();
    expect(await runUpgradeTasks(s, "0.45.9+a")).toMatchObject({ unheldKeysSwept: 0 });
    expect(await db.all("SELECT 1 FROM account_balances")).toHaveLength(2);
    expect(await runUpgradeTasks(s, "0.46.0+b")).toMatchObject({ unheldKeysSwept: 1 });
    // balances and foreign rows of a key no account holds survive a restart: they cannot be fetched again and the account may come back
    expect(await db.all("SELECT account_key FROM account_balances ORDER BY account_key")).toEqual([{ account_key: "idn-gone" }, { account_key: "idn-held" }]);
    expect(await db.all("SELECT account_key FROM foreign_rows ORDER BY account_key")).toEqual([{ account_key: "idn-gone" }, { account_key: "idn-held" }]);
    expect(await db.all("SELECT account_id FROM account_history")).toEqual([{ account_id: "held" }]);
    // the same build does not run it again: what a rollback build left after this start waits for the next build
    await put();
    expect(await runUpgradeTasks(s, "0.46.0+b")).toBeNull();
    expect(await db.all("SELECT 1 FROM account_balances")).toHaveLength(2);
  });

  it("runs every step the app has today at the release of the newest one, and keeps their counts in the result", async () => {
    const { s, adminId } = await setupApp();
    await s.finance(adminId).upsertAccount({ id: "loan", connectionId: null, provider: "enablebanking", externalId: "loan", identity: null, name: "Laina", iban: null, currency: "EUR", type: "loan" });
    await s.finance(adminId).setAccountBalance("loan", 8_000_000, "2026-10-01T08:00:00.000Z");
    const result = await runUpgradeTasks(s, "0.46.0+steps");
    expect(result).toMatchObject({ loanBalances: 1, bankCodes: 0, skipped: [], steps: { loanBalances: 1, bankCodes: 0 } });
  });
});
