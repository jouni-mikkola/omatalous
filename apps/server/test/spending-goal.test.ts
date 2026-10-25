import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

describe("spending goal", () => {
  it("sets, changes and removes the goal, and the dashboard carries it", async () => {
    const { admin, db, adminId } = await setupApp();
    expect((await admin.call("GET", "/api/dashboard")).body.goal).toBeNull();

    const set = await admin.call("PUT", "/api/spending-goal", { monthlyCents: 250_000 });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ monthlyCents: 250_000 });
    expect(await db.first("SELECT user_id, monthly_cents, updated_at FROM spending_goal")).toEqual({ user_id: adminId, monthly_cents: 250_000, updated_at: "2026-10-09T10:00:00.000Z" });
    expect((await admin.call("GET", "/api/dashboard")).body.goal).toMatchObject({ cents: 250_000, leftCents: 250_000 });

    // a later goal replaces the first: one row per user
    await admin.call("PUT", "/api/spending-goal", { monthlyCents: 300_000 });
    expect(await db.first("SELECT count(*) AS n, max(monthly_cents) AS cents FROM spending_goal")).toEqual({ n: 1, cents: 300_000 });
    expect((await admin.call("GET", "/api/dashboard")).body.goal.cents).toBe(300_000);

    expect((await admin.call("DELETE", "/api/spending-goal")).body).toEqual({ ok: true });
    expect(await db.first("SELECT count(*) AS n FROM spending_goal")).toEqual({ n: 0 });
    expect((await admin.call("GET", "/api/dashboard")).body.goal).toBeNull();
    // removing what is not there is the same as removing it
    expect((await admin.call("DELETE", "/api/spending-goal")).status).toBe(200);
  });

  it("takes the smallest and the largest goal and refuses the rest", async () => {
    const { admin, db } = await setupApp();
    expect((await admin.call("PUT", "/api/spending-goal", { monthlyCents: 100 })).status).toBe(200);
    expect((await admin.call("PUT", "/api/spending-goal", { monthlyCents: 100_000_000 })).status).toBe(200);
    const bad: [string, unknown][] = [
      ["no goal", {}],
      ["null", { monthlyCents: null }],
      ["zero", { monthlyCents: 0 }],
      ["under a euro", { monthlyCents: 99 }],
      ["a negative goal", { monthlyCents: -5_000 }],
      ["a fraction of a cent", { monthlyCents: 100.5 }],
      ["a goal as text", { monthlyCents: "2500" }],
      ["over a million euros", { monthlyCents: 100_000_001 }],
      ["a number too large to be exact", { monthlyCents: 1e21 }],
      ["a field that is not part of a goal", { monthlyCents: 250_000, userId: "someone" }],
      ["a list", [250_000]],
    ];
    for (const [what, payload] of bad) {
      const r = await admin.call("PUT", "/api/spending-goal", payload);
      expect(r.status, what).toBe(400);
      expect(typeof r.body.error, what).toBe("string");
    }
    // the refusals changed nothing: the last good goal stands
    expect(await db.first("SELECT monthly_cents FROM spending_goal")).toEqual({ monthly_cents: 100_000_000 });
  });

  it("is each user's own, and goes with the user", async () => {
    const { admin, member, db } = await setupApp();
    const eero = await member("eero");
    await admin.call("PUT", "/api/spending-goal", { monthlyCents: 250_000 });
    await eero.call("PUT", "/api/spending-goal", { monthlyCents: 90_000 });
    expect((await admin.call("GET", "/api/dashboard")).body.goal.cents).toBe(250_000);
    expect((await eero.call("GET", "/api/dashboard")).body.goal.cents).toBe(90_000);
    // one member's removal leaves the other's goal
    await eero.call("DELETE", "/api/spending-goal");
    expect((await admin.call("GET", "/api/dashboard")).body.goal.cents).toBe(250_000);
    await eero.call("PUT", "/api/spending-goal", { monthlyCents: 90_000 });
    await admin.call("DELETE", `/api/users/${eero.id}`);
    expect(await db.first("SELECT count(*) AS n FROM spending_goal")).toEqual({ n: 1 });
  });

  it("needs a signed-in user and the CSRF header", async () => {
    const { app, admin } = await setupApp();
    const anonymous = await app.request("http://localhost:8080/api/spending-goal", { method: "PUT", headers: { "X-Requested-With": "fetch", "Content-Type": "application/json" }, body: JSON.stringify({ monthlyCents: 250_000 }) });
    expect(anonymous.status).toBe(401);
    const noHeader = await admin.call("PUT", "/api/spending-goal", { monthlyCents: 250_000 }, { "X-Requested-With": "" });
    expect(noHeader.status).toBeGreaterThanOrEqual(400);
    expect((await admin.call("GET", "/api/dashboard")).body.goal).toBeNull();
  });
});
