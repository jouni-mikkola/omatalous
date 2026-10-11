import { describe, expect, it } from "vitest";
import { setupApp } from "./helpers.ts";

// the test clock is 2026-10-09, so the accepted due dates run from 2026-09-08 to 2027-11-13
const good = { name: "Ajoneuvovero", amountCents: 31250, dueDate: "2026-12-01", cadence: "yearly", category: "taxes" };

describe("expected bills", () => {
  it("adds, lists and deletes a bill, and keeps it in the database", async () => {
    const { admin, db, adminId } = await setupApp();
    expect((await admin.call("GET", "/api/expected-bills")).body).toEqual({ bills: [] });

    const added = await admin.call("POST", "/api/expected-bills", good);
    expect(added.status).toBe(200);
    expect(added.body.bill).toMatchObject(good);
    expect(added.body.bill.id).toMatch(/^[0-9a-f-]{36}$/);
    const listed = await admin.call("GET", "/api/expected-bills");
    expect(listed.body.bills).toEqual([added.body.bill]);
    expect(await db.first("SELECT user_id, created_at FROM expected_bills WHERE id = ?", [added.body.bill.id])).toEqual({ user_id: adminId, created_at: "2026-10-09T10:00:00.000Z" });

    expect((await admin.call("DELETE", `/api/expected-bills/${added.body.bill.id}`)).body).toEqual({ ok: true });
    expect((await admin.call("GET", "/api/expected-bills")).body.bills).toEqual([]);
    expect((await admin.call("DELETE", `/api/expected-bills/${added.body.bill.id}`)).status).toBe(404);
  });

  it("trims the name, and the category is optional", async () => {
    const { admin } = await setupApp();
    const r = await admin.call("POST", "/api/expected-bills", { name: "  Liiton jäsenmaksu  ", amountCents: 9000, dueDate: "2026-11-15", cadence: "once" });
    expect(r.body.bill).toMatchObject({ name: "Liiton jäsenmaksu", category: null, cadence: "once" });
    const nulled = await admin.call("POST", "/api/expected-bills", { ...good, category: null });
    expect(nulled.body.bill.category).toBeNull();
  });

  it("refuses what the allowlists do not name", async () => {
    const { admin, db } = await setupApp();
    const bad: [string, Record<string, unknown>][] = [
      ["a name that is blank", { ...good, name: "   " }],
      ["a name that is not text", { ...good, name: 12 }],
      ["a name over 80 characters", { ...good, name: "x".repeat(81) }],
      ["a name with a control character", { ...good, name: "Vero\nlasku" }],
      ["no amount", { ...good, amountCents: undefined }],
      ["an amount of zero", { ...good, amountCents: 0 }],
      ["a negative amount", { ...good, amountCents: -500 }],
      ["a fraction of a cent", { ...good, amountCents: 100.5 }],
      ["an amount as text", { ...good, amountCents: "500" }],
      ["an amount over a million euros", { ...good, amountCents: 100_000_001 }],
      ["a date that does not exist", { ...good, dueDate: "2026-02-30" }],
      ["a date in another format", { ...good, dueDate: "1.12.2026" }],
      ["a date more than 31 days back", { ...good, dueDate: "2026-09-07" }],
      ["a date more than 400 days ahead", { ...good, dueDate: "2027-11-14" }],
      ["a cadence outside the list", { ...good, cadence: "monthly" }],
      ["no cadence", { ...good, cadence: undefined }],
      ["an unknown category", { ...good, category: "nope" }],
      ["an income category", { ...good, category: "salary" }],
      ["a category that is not text", { ...good, category: 3 }],
      ["a field that is not part of a bill", { ...good, userId: "someone" }],
    ];
    for (const [what, payload] of bad) {
      const r = await admin.call("POST", "/api/expected-bills", payload);
      expect(r.status, what).toBe(400);
      expect(typeof r.body.error, what).toBe("string");
    }
    expect((await admin.call("POST", "/api/expected-bills", [good])).status).toBe(400);
    expect(await db.first("SELECT count(*) AS n FROM expected_bills")).toEqual({ n: 0 });
  });

  it("takes the first and last allowed due dates", async () => {
    const { admin } = await setupApp();
    for (const dueDate of ["2026-09-08", "2027-11-13"]) {
      expect((await admin.call("POST", "/api/expected-bills", { ...good, dueDate })).status, dueDate).toBe(200);
    }
  });

  it("keeps a list of at most 100 bills", async () => {
    const { admin } = await setupApp();
    for (let i = 0; i < 100; i++) expect((await admin.call("POST", "/api/expected-bills", { ...good, name: `Lasku ${i}` })).status).toBe(200);
    const over = await admin.call("POST", "/api/expected-bills", good);
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/enintään 100/);
  });

  it("each member sees and deletes only their own bills", async () => {
    const { admin, member } = await setupApp();
    const eero = await member("eero");
    const mine = (await admin.call("POST", "/api/expected-bills", good)).body.bill;
    const theirs = (await eero.call("POST", "/api/expected-bills", { ...good, name: "Eeron vero" })).body.bill;

    expect((await admin.call("GET", "/api/expected-bills")).body.bills.map((b: { name: string }) => b.name)).toEqual(["Ajoneuvovero"]);
    expect((await eero.call("GET", "/api/expected-bills")).body.bills.map((b: { name: string }) => b.name)).toEqual(["Eeron vero"]);

    // someone else's bill answers like one that does not exist, and stays
    const stolen = await eero.call("DELETE", `/api/expected-bills/${mine.id}`);
    expect(stolen.status).toBe(404);
    expect(stolen.body).toEqual({ error: "Laskua ei löydy." });
    expect((await admin.call("GET", "/api/expected-bills")).body.bills).toHaveLength(1);
    expect((await admin.call("DELETE", `/api/expected-bills/${theirs.id}`)).status).toBe(404);
    expect((await eero.call("GET", "/api/expected-bills")).body.bills).toHaveLength(1);
  });

  it("a bill reaches the reports at once, with no data version bump, and leaves with its delete", async () => {
    const { admin, member, s, adminId } = await setupApp();
    await admin.call("POST", "/api/demo");
    const reports = async (who = admin) => (await who.call("GET", "/api/reports?from=2026-01-01&to=2026-09-30")).body.upcoming;
    const before = await reports();
    const version = await s.settings.dataVersionOf([adminId]);

    const added = (await admin.call("POST", "/api/expected-bills", good)).body.bill;
    const after = await reports();
    expect(after.yearlyCents).toBe(before.yearlyCents + 31250);
    expect(after.reserveMonthlyCents).toBeGreaterThan(before.reserveMonthlyCents);
    expect(after.items.find((i: { merchant: string }) => i.merchant === "Ajoneuvovero")).toMatchObject({ source: "manual", date: "2026-12-01", amountCents: 31250, category: "taxes", cadence: "yearly" });
    expect(after.manual).toMatchObject([{ id: added.id, name: "Ajoneuvovero", nextDate: "2026-12-01", counted: true }]);
    expect(await s.settings.dataVersionOf([adminId])).toBe(version);

    // another member's report has not got it
    const eero = await member("eero");
    expect((await reports(eero)).manual).toEqual([]);

    await admin.call("DELETE", `/api/expected-bills/${added.id}`);
    expect(await reports()).toEqual(before);
  });

  it("needs a signed-in user and the CSRF header", async () => {
    const { app, admin } = await setupApp();
    const anonymous = await app.request("http://localhost:8080/api/expected-bills", { headers: { "X-Requested-With": "fetch" } });
    expect(anonymous.status).toBe(401);
    const noHeader = await admin.call("POST", "/api/expected-bills", good, { "X-Requested-With": "" });
    expect(noHeader.status).toBeGreaterThanOrEqual(400);
    expect((await admin.call("GET", "/api/expected-bills")).body.bills).toEqual([]);
  });

  it("goes with the user: deleting the user deletes the bills", async () => {
    const { admin, member, db } = await setupApp();
    const eero = await member("eero");
    await eero.call("POST", "/api/expected-bills", good);
    expect(await db.first("SELECT count(*) AS n FROM expected_bills WHERE user_id = ?", [eero.id])).toEqual({ n: 1 });
    await admin.call("DELETE", `/api/users/${eero.id}`);
    expect(await db.first("SELECT count(*) AS n FROM expected_bills")).toEqual({ n: 0 });
  });
});
