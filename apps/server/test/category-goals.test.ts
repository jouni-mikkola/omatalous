import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

describe("category goals", () => {
  it("sets, changes and removes a goal without moving the data version, and the dashboard carries it", async () => {
    const { admin, s, db, adminId } = await setupApp();
    const version = await s.settings.dataVersionOf([adminId]);
    expect((await admin.call("GET", "/api/dashboard")).body.categoryGoals).toEqual([]);

    const set = await admin.call("PUT", "/api/category-goals", { category: "groceries", monthlyCents: 60_000 });
    expect(set).toMatchObject({ status: 200, body: { category: "groceries", monthlyCents: 60_000 } });
    await admin.call("PUT", "/api/category-goals", { category: "transport", monthlyCents: 9_000 });
    expect(await db.all("SELECT user_id, category, monthly_cents FROM category_goal ORDER BY category")).toEqual([
      { user_id: adminId, category: "groceries", monthly_cents: 60_000 },
      { user_id: adminId, category: "transport", monthly_cents: 9_000 },
    ]);
    expect((await admin.call("GET", "/api/dashboard")).body.categoryGoals).toMatchObject([
      { category: "groceries", cents: 60_000, spentCents: 0, leftCents: 60_000 },
      { category: "transport", cents: 9_000 },
    ]);

    // a later goal replaces the first
    await admin.call("PUT", "/api/category-goals", { category: "groceries", monthlyCents: 65_000 });
    expect(await db.first("SELECT count(*) AS n, max(monthly_cents) AS cents FROM category_goal WHERE category = 'groceries'")).toEqual({ n: 1, cents: 65_000 });

    expect((await admin.call("DELETE", "/api/category-goals", { category: "groceries" })).body).toEqual({ ok: true });
    expect((await admin.call("DELETE", "/api/category-goals", { category: "groceries" })).status).toBe(200);
    expect(await db.first("SELECT count(*) AS n FROM category_goal")).toEqual({ n: 1 });
    expect(await s.settings.dataVersionOf([adminId])).toBe(version);
  });

  it("refuses a category that has no goal and an amount out of bounds", async () => {
    const { admin, db } = await setupApp();
    const bad: [string, unknown][] = [
      ["no category", { monthlyCents: 5_000 }],
      ["another category", { category: "rent", monthlyCents: 5_000 }],
      ["a category as a number", { category: 3, monthlyCents: 5_000 }],
      ["no amount", { category: "groceries" }],
      ["under a euro", { category: "groceries", monthlyCents: 99 }],
      ["over a million euros", { category: "groceries", monthlyCents: 100_000_001 }],
      ["a fraction of a cent", { category: "groceries", monthlyCents: 100.5 }],
      ["an amount as text", { category: "groceries", monthlyCents: "5000" }],
      ["another field", { category: "groceries", monthlyCents: 5_000, userId: "someone" }],
    ];
    for (const [what, payload] of bad) {
      const r = await admin.call("PUT", "/api/category-goals", payload);
      expect(r.status, what).toBe(400);
      expect(typeof r.body.error, what).toBe("string");
    }
    expect((await admin.call("DELETE", "/api/category-goals", { category: "rent" })).status).toBe(400);
    expect(await db.first("SELECT count(*) AS n FROM category_goal")).toEqual({ n: 0 });
  });

  it("is each user's own, and goes with the user", async () => {
    const { admin, member, db } = await setupApp();
    const eero = await member("eero");
    await admin.call("PUT", "/api/category-goals", { category: "groceries", monthlyCents: 60_000 });
    await eero.call("PUT", "/api/category-goals", { category: "groceries", monthlyCents: 30_000 });
    expect((await admin.call("GET", "/api/dashboard")).body.categoryGoals[0].cents).toBe(60_000);
    expect((await eero.call("GET", "/api/dashboard")).body.categoryGoals[0].cents).toBe(30_000);
    await eero.call("DELETE", "/api/category-goals", { category: "groceries" });
    expect((await admin.call("GET", "/api/dashboard")).body.categoryGoals[0].cents).toBe(60_000);
    await eero.call("PUT", "/api/category-goals", { category: "groceries", monthlyCents: 30_000 });
    await admin.call("DELETE", `/api/users/${eero.id}`);
    expect(await db.first("SELECT count(*) AS n FROM category_goal")).toEqual({ n: 1 });
  });

  it("needs a signed-in user", async () => {
    const { app } = await setupApp();
    const anonymous = await app.request("http://localhost:8080/api/category-goals", { method: "PUT", headers: { "X-Requested-With": "fetch", "Content-Type": "application/json" }, body: JSON.stringify({ category: "groceries", monthlyCents: 60_000 }) });
    expect(anonymous.status).toBe(401);
  });
});
