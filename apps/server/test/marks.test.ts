import { seriesMarkSubject } from "@banking/core";
import { describe, expect, it } from "vitest";
import { loadDemoData } from "../src/demo.ts";
import type { Services } from "../src/services/context.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { seedCsv } from "./csv-seed.ts";
import { NOW, setupApp } from "./helpers.ts";
import { normalizeMerchant, seriesId } from "@banking/core";

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
      // a series is named by direction, account and merchant, as core reads it back
      { subject: "series:Netflix", mark: "in_use" },
      { subject: "series:", mark: "in_use" },
      { subject: "series:out::Netflix#799", mark: "in_use" },
      { subject: "series:up:acc-1:Netflix#799", mark: "in_use" },
      { subject: "series:out:acc-1:", mark: "in_use" },
      { subject: `series:out:acc-1:${"x".repeat(191)}`, mark: "in_use" },
      { subject: "series:out:acc-1:Net\u0000flix", mark: "in_use" },
      { subject: "Series:out:acc-1:Netflix", mark: "in_use" },
      // "Ei laina" names the series of the proposal the same way
      { subject: "loan-proposal:", mark: "dismissed" },
      { subject: "loan-proposal:Nordea Bank Abp", mark: "dismissed" },
      { subject: "loan-proposal:out::Nordea Bank Abp#60000", mark: "dismissed" },
      { subject: "loan-proposal:series:out:acc-1:Nordea Bank Abp#60000", mark: "dismissed" },
      { subject: "loan:out:acc-1:Nordea Bank Abp#60000", mark: "dismissed" },
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
    // and so is a series in each form its key takes: a price, none (a bill of varying size), everyday purchases
    for (const subject of ["series:out:acc-1:Netflix#799", "series:out:acc-1:Helen", "series:out:acc-1:Prisma#habit", `series:out:acc-1:${"x".repeat(190)}`]) {
      expect((await admin.call("PUT", "/api/marks", { subject, mark: "in_use" })).status, subject).toBe(200);
    }
    // "Ei laina" on a proposed loan is a mark of its own beside the one Laskut keeps for the same series
    for (const subject of ["series:out:acc-1:Nordea Bank Abp#60000", "loan-proposal:out:acc-1:Nordea Bank Abp#60000"]) {
      expect((await admin.call("PUT", "/api/marks", { subject, mark: "dismissed" })).status, subject).toBe(200);
    }
    expect((await admin.call("PUT", "/api/marks", { subject: "series:out:acc-1:Nordea Bank Abp#60000", mark: "in_use" })).status).toBe(200);
    const marks: { subject: string; mark: string }[] = (await admin.call("GET", "/api/recurring")).body.marks;
    expect(marks).toHaveLength(7);
    expect(marks.find((m) => m.subject === "loan-proposal:out:acc-1:Nordea Bank Abp#60000")?.mark).toBe("dismissed");
    await admin.call("PUT", "/api/marks", { subject: "loan-proposal:out:acc-1:Nordea Bank Abp#60000", mark: null });
    expect((await admin.call("GET", "/api/recurring")).body.marks).toHaveLength(6);
  });

  it("a series of the longest stored name can be marked, and answered Ei laina", async () => {
    const { admin } = await setupApp();
    // a derived name is cut at 40 characters (core normalizeMerchant) and no other name is stored
    const name = normalizeMerchant("KIINTEISTOHUOLTOPALVELUOSUUSKUNTAPOHJANMAANRANNIKKO", null);
    expect(name).toHaveLength(40);
    // with the longest account id (csv- and 24 hex) and the longest price a number can be
    const key = seriesId({ direction: "out", accountId: `csv-${"a".repeat(24)}`, merchant: name, product: -Number.MAX_SAFE_INTEGER });
    expect(key.length).toBeLessThan(100);
    for (const subject of [`series:${key}`, `loan-proposal:${key}`]) {
      expect((await admin.call("PUT", "/api/marks", { subject, mark: "dismissed" })).status, subject).toBe(200);
    }
  });

  it("takes a payee set aside under question:payee:<merchant>, mark dismissed only, and no other name under question", async () => {
    const { admin } = await setupApp();
    for (const subject of ["question:payee:", "question:payee", "question:Payee:Acme", `question:payee:${"x".repeat(201)}`, "question:payee:Ac\nme","question:other"]) {
      expect((await admin.call("PUT", "/api/marks", { subject, mark: "dismissed" })).status, subject).toBe(400);
    }
    for (const mark of ["in_use", "cancelled"]) expect((await admin.call("PUT", "/api/marks", { subject: "question:payee:Acme", mark })).status, mark).toBe(400);
    expect((await admin.call("GET", "/api/recurring")).body.marks).toEqual([]);

    for (const subject of ["question:payee:Acme", `question:payee:${"x".repeat(200)}`]) {
      expect((await admin.call("PUT", "/api/marks", { subject, mark: "dismissed" })).status, subject).toBe(200);
    }
    expect((await admin.call("GET", "/api/recurring")).body.marks.map((m: { subject: string }) => m.subject)).toContain("question:payee:Acme");
    // taken back like any other
    expect((await admin.call("PUT", "/api/marks", { subject: "question:payee:Acme", mark: null })).body.marks).toHaveLength(1);
  });

  it("takes the answer to the question about a home loan under its one subject, stores it as any mark, and takes no other question", async () => {
    const { admin } = await setupApp();
    const bad = ["question:other", "question:", "question", "question:Mortgage", "question:mortgage ", "question:mortgage:2", `question:${"x".repeat(201)}`, "Question:mortgage"];
    for (const subject of bad) {
      const res = await admin.call("PUT", "/api/marks", { subject, mark: "dismissed" });
      expect(res.status, subject).toBe(400);
      expect(res.body.error, subject).toBe("Virheellinen kohde.");
    }
    expect((await admin.call("GET", "/api/recurring")).body.marks).toEqual([]);

    const stored = await admin.call("PUT", "/api/marks", { subject: "question:mortgage", mark: "dismissed" });
    expect(stored).toMatchObject({ status: 200, body: { marks: [{ subject: "question:mortgage", mark: "dismissed", markedAt: NOW_LOCAL }] } });
    // it comes back with the marks of the other pages, and the subjects of before still pass beside it
    for (const subject of ["series:out:acc-1:Helen", "alert:double:abc", "merchant:Elixia", "loan-proposal:out:acc-1:Nordea Bank Abp#60000"]) {
      expect((await admin.call("PUT", "/api/marks", { subject, mark: "dismissed" })).status, subject).toBe(200);
    }
    expect((await admin.call("GET", "/api/recurring")).body.marks.map((m: { subject: string }) => m.subject)).toContain("question:mortgage");
    // and it is taken back like any other
    const cleared = await admin.call("PUT", "/api/marks", { subject: "question:mortgage", mark: null });
    expect(cleared.body.marks.map((m: { subject: string }) => m.subject)).not.toContain("question:mortgage");
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

  type Housing = { loans: unknown[]; charges: { seriesId: string }[]; ask: boolean } | null;
  const housingOf = async (client: Parameters<typeof alertsOf>[0]): Promise<Housing> => (await client.call("GET", "/api/dashboard")).body.housing;

  it("the question about a home loan is the member's own: a tenant is not asked, one with nothing of a home is until that member answers, and the other is still asked", async () => {
    const { admin, member } = await setupApp();
    await admin.call("POST", "/api/demo");
    const eero = await member("eero");
    await eero.call("POST", "/api/demo");
    // the demo household pays rent and electricity: a tenant has no home loan to add
    expect(await housingOf(admin)).toMatchObject({ ask: false, charges: [{}, {}] });
    // each member calls both of their charges cancelled: nothing of a home is left
    for (const who of [admin, eero]) {
      const { series } = (await who.call("GET", "/api/recurring")).body as { series: Parameters<typeof seriesMarkSubject>[0][] };
      for (const charge of (await housingOf(who))!.charges) {
        await who.call("PUT", "/api/marks", { subject: seriesMarkSubject(series.find((s) => s.id === charge.seriesId)!), mark: "cancelled" });
      }
      expect(await housingOf(who)).toMatchObject({ loans: [], charges: [], ask: true });
    }

    await admin.call("PUT", "/api/marks", { subject: "question:mortgage", mark: "dismissed" });
    expect(await housingOf(admin), "nothing to show and nothing to ask").toBeNull();
    expect(await housingOf(eero), "the answer is the member's own").toMatchObject({ ask: true });

    // taken back, the question returns
    await admin.call("PUT", "/api/marks", { subject: "question:mortgage", mark: null });
    expect(await housingOf(admin)).toMatchObject({ ask: true });
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

  it("moves a mark on one series the same way, with its account and its price", async () => {
    const { s, adminId, admin } = await setupApp();
    const repo = s.finance(adminId);
    await loadDemoData(repo, s.settings, s.today());
    await s.db.run("UPDATE transactions SET merchant = 'WOLT OLD NAME' WHERE user_id = ? AND merchant = 'Wolt'", [adminId]);
    await admin.call("PUT", "/api/marks", { subject: "series:out:acc-1:WOLT OLD NAME#1299", mark: "cancelled" });
    await admin.call("PUT", "/api/marks", { subject: "series:out:acc-1:WOLT OLD NAME#799", mark: "in_use" });
    await admin.call("PUT", "/api/marks", { subject: "series:out:acc-1:Wolt#799", mark: "cancelled" });
    await admin.call("PUT", "/api/marks", { subject: "series:out:acc-1:Spotify#1099", mark: "in_use" });

    await runUpgradeTasks(s, "0.7.0+rename");
    // the mark the new name already had stays, the stale one on the same series is dropped
    expect((await repo.listMarks()).map((m) => `${m.subject}=${m.mark}`).sort()).toEqual(["series:out:acc-1:Spotify#1099=in_use", "series:out:acc-1:Wolt#1299=cancelled", "series:out:acc-1:Wolt#799=cancelled"]);
  });

  it("moves an Ei laina answer and the series of a saved loan the same way, and only the user's own", async () => {
    const { s, adminId, admin, member } = await setupApp();
    const repo = s.finance(adminId);
    await loadDemoData(repo, s.settings, s.today());
    await s.db.run("UPDATE transactions SET merchant = 'WOLT OLD NAME' WHERE user_id = ? AND merchant = 'Wolt'", [adminId]);
    const eero = await member("eero");
    const OLD = "out:acc-1:WOLT OLD NAME#25000";
    const notLoan = (key: string) => ({ subject: `loan-proposal:${key}`, mark: "dismissed" });
    const loan = (name: string, seriesKey: string | null) => ({ name, kind: "consumer", balanceCents: 500_000, balanceDate: "2026-10-01", seriesKey });
    for (const user of [admin, eero]) {
      expect((await user.call("PUT", "/api/marks", notLoan(OLD))).status).toBe(200);
      for (const body of [loan("Vanha nimi", OLD), loan("Toinen saaja", "out:acc-1:Spotify#1099"), loan("Ei sarjaa", null)]) expect((await user.call("POST", "/api/loans", body)).status).toBe(200);
    }
    await admin.call("PUT", "/api/marks", notLoan("out:acc-1:Spotify#1099"));

    await runUpgradeTasks(s, "0.8.7+rename");
    const NEW = "out:acc-1:Wolt#25000";
    expect((await repo.listMarks()).map((m) => m.subject).sort()).toEqual([notLoan("out:acc-1:Spotify#1099").subject, notLoan(NEW).subject]);
    expect((await repo.listLoans()).map((l) => `${l.name}: ${l.seriesKey}`)).toEqual([`Vanha nimi: ${NEW}`, "Toinen saaja: out:acc-1:Spotify#1099", "Ei sarjaa: null"]);
    // Eero has no row of that name: his answer and his loan keep the key they were saved with
    const theirs = s.finance(eero.id);
    expect((await theirs.listMarks()).map((m) => m.subject)).toEqual([notLoan(OLD).subject]);
    expect((await theirs.listLoans()).map((l) => l.seriesKey)).toEqual([OLD, "out:acc-1:Spotify#1099", null]);
  });
});

describe("a mark belongs to one series", () => {
  type Series = Parameters<typeof seriesMarkSubject>[0] & { merchant: string; monthlyCents: number };
  type Alert = { kind: string; title: string; detail: string };
  type Call = { call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }> };

  /** A year of two subscriptions from one merchant on one account: 7,99 on the 3rd and 12,99 on the 17th. NOW is 9.10.2026. */
  const twoSeriesCsv = [
    "Kirjauspäivä;Määrä;Nimi;Otsikko",
    ...Array.from({ length: 12 }, (_, i) => {
      const month = `${i < 2 ? 2025 : 2026}/${String(((i + 10) % 12) + 1).padStart(2, "0")}`;
      return [`${month}/03;-7,99;;NETFLIX.COM`, `${i === 11 ? "2025/10" : month}/17;-12,99;;NETFLIX.COM`];
    }).flat(),
  ].join("\n");

  /** Imports the two subscriptions and returns them, the cheaper first. */
  async function twoSeries(s: Services, c: Call & { id?: string }): Promise<[Series, Series]> {
    expect((await seedCsv(s, c, { content: twoSeriesCsv, accountName: "Käyttötili", accountType: "checking" })).status).toBe(200);
    const series: Series[] = (await c.call("GET", "/api/recurring")).body.series;
    expect(series.map((x) => [x.merchant, x.typicalAmountCents])).toEqual([["Netflix", 1299], ["Netflix", 799]]);
    return [series[1]!, series[0]!];
  }
  const fixed = async (c: Call): Promise<number> => (await c.call("GET", "/api/dashboard")).body.fixedMonthlyCents;
  /** The alerts of the running month, or of September and October with `SINCE_SEPTEMBER`. */
  const alertsOf = async (c: Call, kind: string, query = ""): Promise<Alert[]> => (await c.call("GET", `/api/dashboard${query}`)).body.alerts.filter((a: Alert) => a.kind === kind);
  const SINCE_SEPTEMBER = "?from=2026-09-01&to=2026-10-09";
  const plain = (text: string) => text.replace(/\s/g, " ");

  it("two series of one merchant, one marked: the other still shows, is still asked about and still warns", async () => {
    const { admin, s, adminId } = await setupApp();
    const [small, large] = await twoSeries(s, admin);
    expect(await fixed(admin)).toBe(799 + 1299);
    expect((await alertsOf(admin, "forgotten")).map((a) => plain(a.title))).toEqual(["Netflix 12,99 €/kk, 156 € vuodessa", "Netflix 7,99 €/kk, 96 € vuodessa"]);

    const subject = seriesMarkSubject(small);
    expect(subject).toMatch(/^series:out:[^:]+:Netflix#799$/);
    const saved = await admin.call("PUT", "/api/marks", { subject, mark: "cancelled" });
    expect(saved).toMatchObject({ status: 200, body: { marks: [{ subject, mark: "cancelled" }] } });
    expect(await fixed(admin)).toBe(1299);
    expect((await alertsOf(admin, "forgotten")).map((a) => plain(a.title))).toEqual(["Netflix 12,99 €/kk, 156 € vuodessa"]);
    // marked today, so nothing was charged after it
    expect(await alertsOf(admin, "cancelled")).toEqual([]);

    // an earlier mark: the charge of 3.10. came after it, and the 12,99 of 17.9. is not its series
    await s.db.run("UPDATE user_marks SET marked_at = ? WHERE user_id = ? AND subject = ?", ["2026-09-10T08:00:00+03:00", adminId, subject]);
    expect((await alertsOf(admin, "cancelled", SINCE_SEPTEMBER)).map((a) => [plain(a.title), plain(a.detail)])).toEqual([["Netflix veloitti 3.10.2026, vaikka merkitsit sen lopetetuksi.", "7,99 €"]]);

    // taken away, both are back
    await admin.call("PUT", "/api/marks", { subject, mark: null });
    expect(await fixed(admin)).toBe(799 + 1299);
    expect(await alertsOf(admin, "forgotten")).toHaveLength(2);
    expect(seriesMarkSubject(large)).not.toBe(subject);
  });

  it("an old mark on the merchant covers both", async () => {
    const { admin, s, adminId } = await setupApp();
    await twoSeries(s, admin);
    await s.db.run("INSERT INTO user_marks (user_id, subject, mark, marked_at) VALUES (?, ?, 'cancelled', ?)", [adminId, "merchant:Netflix", "2026-09-10T08:00:00+03:00"]);
    expect(await fixed(admin)).toBe(0);
    expect(await alertsOf(admin, "forgotten")).toEqual([]);
    // every charge of the merchant after the mark, whatever its series
    expect((await alertsOf(admin, "cancelled", SINCE_SEPTEMBER)).map((a) => plain(a.detail))).toEqual(["2 veloitusta, yhteensä 20,98 €"]);
    // nothing rewrote the stored row, and it is taken away under its own subject
    expect((await admin.call("GET", "/api/recurring")).body.marks.map((m: { subject: string }) => m.subject)).toEqual(["merchant:Netflix"]);
    expect((await admin.call("PUT", "/api/marks", { subject: "merchant:Netflix", mark: null })).body.marks).toEqual([]);
    expect(await fixed(admin)).toBe(799 + 1299);
  });

  it("a mark for a series that no longer exists is ignored and can be removed", async () => {
    const { admin, s } = await setupApp();
    const [small] = await twoSeries(s, admin);
    const before = (await admin.call("GET", "/api/dashboard")).body;
    const gone = seriesMarkSubject(small).replace("#799", "#299");
    const other = seriesMarkSubject(small).replace("Netflix", "Viaplay");
    for (const subject of [gone, other]) expect((await admin.call("PUT", "/api/marks", { subject, mark: "cancelled" })).status).toBe(200);
    expect((await admin.call("GET", "/api/dashboard")).body).toEqual(before);

    const left = await admin.call("PUT", "/api/marks", { subject: gone, mark: null });
    expect(left.body.marks.map((m: { subject: string }) => m.subject)).toEqual([other]);
    expect((await admin.call("PUT", "/api/marks", { subject: other, mark: null })).body.marks).toEqual([]);
  });

  it("another user's marks are never read", async () => {
    const { admin, s, member } = await setupApp();
    const eero = await member("eero");
    const [small] = await twoSeries(s, admin);
    const [his] = await twoSeries(s, eero);
    // each has the series on an account of their own, so the subjects differ
    expect(seriesMarkSubject(his)).not.toBe(seriesMarkSubject(small));

    await eero.call("PUT", "/api/marks", { subject: seriesMarkSubject(his), mark: "cancelled" });
    // a mark that names the other user's series does nothing for either of them
    await eero.call("PUT", "/api/marks", { subject: seriesMarkSubject(small), mark: "cancelled" });
    expect(await fixed(eero)).toBe(1299);
    expect(await fixed(admin)).toBe(799 + 1299);
    expect(await alertsOf(admin, "forgotten")).toHaveLength(2);
    expect((await admin.call("GET", "/api/recurring")).body.marks).toEqual([]);
    expect((await admin.call("GET", "/api/recurring?scope=household")).body.marks).toEqual([]);
  });
});
