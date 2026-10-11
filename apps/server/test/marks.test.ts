import { describe, expect, it } from "vitest";
import { loadDemoData } from "../src/demo.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { NOW, setupApp } from "./helpers.ts";

/** NOW is 10:00 UTC; the instance time zone is Helsinki (UTC+3 in October), and a mark carries the local time with its offset. */
const NOW_LOCAL = "2026-10-09T13:00:00+03:00";

describe("marks on subscriptions and alerts", () => {
  it("keeps one mark per subject, the latest replacing an earlier one, and null takes it away", async () => {
    const { admin } = await setupApp();
    const first = await admin.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: "in_use" });
    expect(first).toMatchObject({ status: 200, body: { marks: [{ subject: "merchant:Elixia", mark: "in_use", markedAt: NOW_LOCAL }] } });

    await admin.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: "cancelled" });
    const two = await admin.call("PUT", "/api/marks", { subject: "alert:double:abc", mark: "dismissed" });
    expect(two.body.marks.map((m: { subject: string; mark: string }) => [m.subject, m.mark]).sort()).toEqual([
      ["alert:double:abc", "dismissed"],
      ["merchant:Elixia", "cancelled"],
    ]);

    const cleared = await admin.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: null });
    expect(cleared.body.marks).toEqual([{ subject: "alert:double:abc", mark: "dismissed", markedAt: NOW_LOCAL }]);
    // clearing what is not there is not an error
    expect((await admin.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: null })).status).toBe(200);
  });

  it("stamps a mark with the instance's local time, so the day is the one the household was in", async () => {
    // 01:30 on 12.10. in Helsinki is 22:30 UTC on 11.10.
    const { admin } = await setupApp({}, undefined, { now: () => new Date("2026-10-11T22:30:00Z") });
    const res = await admin.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: "cancelled" });
    expect(res.body.marks[0].markedAt).toBe("2026-10-12T01:30:00+03:00");
    // the offset follows summer and winter time
    const winter = await setupApp({}, undefined, { now: () => new Date("2026-12-31T22:30:00Z") });
    const w = await winter.admin.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: "cancelled" });
    expect(w.body.marks[0].markedAt).toBe("2027-01-01T00:30:00+02:00");
    // and an instance in UTC has no offset to write
    const utc = await setupApp({ TZ: "UTC" }, undefined, { now: () => new Date("2026-10-11T22:30:00Z") });
    expect((await utc.admin.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: "cancelled" })).body.marks[0].markedAt).toBe("2026-10-11T22:30:00+00:00");
  });

  it("the recurring page gets the marks with the series", async () => {
    const { admin } = await setupApp();
    await admin.call("PUT", "/api/marks", { subject: "merchant:Spotify", mark: "in_use" });
    const { body } = await admin.call("GET", "/api/recurring");
    expect(body.series).toEqual([]);
    expect(body.marks).toEqual([{ subject: "merchant:Spotify", mark: "in_use", markedAt: NOW_LOCAL }]);
  });

  it("refuses a bad subject or mark with 400 and stores nothing", async () => {
    const { admin } = await setupApp();
    const bad: unknown[] = [
      { subject: "Elixia", mark: "in_use" },
      { subject: "merchant:", mark: "in_use" },
      { subject: "alert:", mark: "dismissed" },
      { subject: "shop:Elixia", mark: "in_use" },
      { subject: `merchant:${"x".repeat(201)}`, mark: "in_use" },
      { subject: "merchant:Eli\nxia", mark: "in_use" },
      { subject: 42, mark: "in_use" },
      { mark: "in_use" },
      { subject: "merchant:Elixia", mark: "forgotten" },
      { subject: "merchant:Elixia", mark: 1 },
      { subject: "merchant:Elixia" },
      { subject: "merchant:Elixia", mark: "in_use", userId: "someone-else" },
      [],
      "merchant:Elixia",
    ];
    for (const payload of bad) {
      const res = await admin.call("PUT", "/api/marks", payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
      expect(res.body.error).toEqual(expect.any(String));
    }
    // the longest subject is accepted
    expect((await admin.call("PUT", "/api/marks", { subject: `merchant:${"x".repeat(200)}`, mark: "in_use" })).status).toBe(200);
    expect((await admin.call("GET", "/api/recurring")).body.marks).toHaveLength(1);
  });

  it("needs a signed-in user and the CSRF header", async () => {
    const { app, admin } = await setupApp();
    const anonymous = await app.request("http://localhost:8080/api/marks", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify({ subject: "merchant:Elixia", mark: "in_use" }),
    });
    expect(anonymous.status).toBe(401);
    const noHeader = await admin.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: "in_use" }, { "X-Requested-With": "" });
    expect(noHeader.status).toBeGreaterThanOrEqual(400);
    expect((await admin.call("GET", "/api/recurring")).body.marks).toEqual([]);
  });

  it("a member never sees or changes another member's marks", async () => {
    const { admin, member, s, adminId } = await setupApp();
    const eero = await member("eero");
    await admin.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: "cancelled" });

    expect((await eero.call("GET", "/api/recurring")).body.marks).toEqual([]);
    // the same subject is a separate row for each user
    const own = await eero.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: "in_use" });
    expect(own.body.marks).toEqual([{ subject: "merchant:Elixia", mark: "in_use", markedAt: NOW_LOCAL }]);
    expect((await admin.call("GET", "/api/recurring")).body.marks[0]).toMatchObject({ mark: "cancelled" });

    // clearing it for one leaves the other's
    await eero.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: null });
    expect((await admin.call("GET", "/api/recurring")).body.marks).toHaveLength(1);

    // the household view still shows the viewer's own marks only
    expect((await eero.call("GET", "/api/recurring?scope=household")).body.marks).toEqual([]);
    expect((await admin.call("GET", "/api/recurring?scope=household")).body.marks).toHaveLength(1);

    // a deleted user takes the marks along
    await eero.call("PUT", "/api/marks", { subject: "merchant:Netflix", mark: "in_use" });
    await admin.call("DELETE", `/api/users/${eero.id}`);
    expect((await s.db.first<{ n: number }>("SELECT count(*) AS n FROM user_marks WHERE user_id = ?", [eero.id]))?.n).toBe(0);
    expect((await s.db.first<{ n: number }>("SELECT count(*) AS n FROM user_marks WHERE user_id = ?", [adminId]))?.n).toBe(1);
  });
});

describe("marks reach the dashboard", () => {
  type Alert = { id: string; kind: string; merchant?: string; title: string };
  const alertsOf = async (client: { call: (m: string, p: string) => Promise<{ body: any }> }): Promise<Alert[]> => (await client.call("GET", "/api/dashboard")).body.alerts;
  const askedAbout = async (client: Parameters<typeof alertsOf>[0]) => (await alertsOf(client)).filter((a) => a.kind === "forgotten").map((a) => a.merchant);

  it("a subscription marked in use is not asked about until the mark is cleared", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    expect(await askedAbout(admin)).toContain("Elixia");

    await admin.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: "in_use" });
    expect(await askedAbout(admin)).not.toContain("Elixia");

    await admin.call("PUT", "/api/marks", { subject: "merchant:Elixia", mark: null });
    expect(await askedAbout(admin)).toContain("Elixia");
  });

  it("a dismissed alert is gone for that user only", async () => {
    const { admin, member } = await setupApp();
    await admin.call("POST", "/api/demo");
    const eero = await member("eero");
    await eero.call("POST", "/api/demo");
    const forgotten = (await alertsOf(admin)).find((a) => a.kind === "forgotten")!;

    await admin.call("PUT", "/api/marks", { subject: `alert:${forgotten.id}`, mark: "dismissed" });
    expect((await alertsOf(admin)).map((a) => a.id)).not.toContain(forgotten.id);
    expect(await askedAbout(admin)).not.toContain(forgotten.merchant);
    // the other user's demo data has the same merchant under an id of its own, and keeps its alert
    expect(await askedAbout(eero)).toContain(forgotten.merchant);
  });

  it("a charge after the mark is a warning on the dashboard, and can be dismissed", async () => {
    const { admin, s, adminId } = await setupApp();
    await admin.call("POST", "/api/demo");
    // the API stamps a mark with the clock; an earlier one is written the way an earlier request would have left it
    await s.db.run("INSERT INTO user_marks (user_id, subject, mark, marked_at) VALUES (?, ?, 'cancelled', ?)", [adminId, "merchant:Elixia", "2026-09-15T08:00:00.000Z"]);
    const warning = (await alertsOf(admin)).find((a) => a.kind === "cancelled");
    expect(warning).toMatchObject({ merchant: "Elixia", title: "Elixia veloitti 1.10.2026, vaikka merkitsit sen lopetetuksi." });
    expect(await askedAbout(admin)).not.toContain("Elixia");

    await admin.call("PUT", "/api/marks", { subject: `alert:${warning!.id}`, mark: "dismissed" });
    expect((await alertsOf(admin)).some((a) => a.kind === "cancelled")).toBe(false);
  });
});

describe("a mark follows a merchant whose name is derived again", () => {
  it("moves merchant marks to the new name on an upgrade, and leaves alert marks alone", async () => {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    await loadDemoData(repo, s.settings, s.today());
    // rows written by an older version carried another name for Wolt
    await s.db.run("UPDATE transactions SET merchant = 'WOLT OLD NAME' WHERE user_id = ? AND merchant = 'Wolt'", [adminId]);
    await admin.call("PUT", "/api/marks", { subject: "merchant:WOLT OLD NAME", mark: "cancelled" });
    await admin.call("PUT", "/api/marks", { subject: "merchant:Spotify", mark: "in_use" });
    await admin.call("PUT", "/api/marks", { subject: "alert:forgotten:WOLT OLD NAME", mark: "dismissed" });

    expect(await runUpgradeTasks(s, "0.7.0+rename")).toMatchObject({ users: 1 });
    const subjects = (await repo.listMarks()).map((m) => `${m.subject}=${m.mark}`).sort();
    expect(subjects).toEqual(["alert:forgotten:WOLT OLD NAME=dismissed", "merchant:Spotify=in_use", "merchant:Wolt=cancelled"]);
  });

  it("keeps the mark the new name already has, and drops the stale one", async () => {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    await loadDemoData(repo, s.settings, s.today());
    await s.db.run("UPDATE transactions SET merchant = 'WOLT OLD NAME' WHERE user_id = ? AND merchant = 'Wolt'", [adminId]);
    await admin.call("PUT", "/api/marks", { subject: "merchant:WOLT OLD NAME", mark: "cancelled" });
    await admin.call("PUT", "/api/marks", { subject: "merchant:Wolt", mark: "in_use" });

    await runUpgradeTasks(s, "0.7.0+rename");
    expect((await repo.listMarks()).map((m) => `${m.subject}=${m.mark}`)).toEqual(["merchant:Wolt=in_use"]);
  });
});
