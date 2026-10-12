import { type Area, baselineOf, type FindingDraft, measureSums, type FindingState, yearWindow } from "@banking/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinanceRepo } from "../src/db/finance-repo.ts";
import { renamedSubject } from "../src/db/finance/optimise.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { type Client, setupApp } from "./helpers.ts";

/**
 * The core areas are written beside this server frame and are not what these tests are about. While `mode.testArea` is
 * on, the frame runs with one area of its own that makes a finding of each of four active subscriptions in the demo
 * history, so the routes have findings to decide on. Switched off, `buildOptimise` runs the real areas.
 */
const mode = vi.hoisted(() => ({ testArea: true }));
vi.mock("@banking/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@banking/core")>();
  const testArea: Area = {
    id: "subscriptions",
    label: "Tilaukset",
    assess: (a) => ({
      checks: [],
      findings: a.ctx.recurring
        .filter((r) => r.active && r.kind === "subscription")
        .slice(0, 4)
        .map(
          (series): FindingDraft => ({
            id: core.findingId("subscriptions", "test", series.id),
            area: "subscriptions",
            kind: "test",
            subject: series.id,
            title: `${series.merchant}: 360 € vuodessa.`,
            action: `Irtisano ${series.merchant}.`,
            euros: { lowCents: 30000, midCents: 36000, highCents: 42000 },
            decideBy: null,
            weaknesses: [],
            shared: false,
            calc: [{ label: "Vuodessa", value: "360 €" }],
            rows: series.transactionIds,
            struck: series.transactionIds.slice(0, 1),
            claims: [`series:${series.id}`],
            measure: { kind: "series", keys: [series.id], perYear: 12 },
            facts: [],
          }),
        ),
    }),
  };
  return { ...core, buildOptimise: (input: Parameters<typeof core.buildOptimise>[0]) => core.buildOptimise(mode.testArea ? { areas: [testArea], ...input } : input) };
});
afterEach(() => {
  mode.testArea = true;
});

/** The test clock is 2026-10-09 10:00 UTC; the instance time zone is Helsinki, so a decision carries +03:00. */
const TODAY = "2026-10-09";
const DECIDED_AT = "2026-10-09T13:00:00+03:00";
const enc = encodeURIComponent;

/** An app with the module on and the demo history loaded for the admin. */
async function setup() {
  const app = await setupApp();
  expect((await app.admin.call("PUT", "/api/admin/features", { optimise: true })).status).toBe(200);
  await app.admin.call("POST", "/api/demo");
  return app;
}

interface Shown {
  id: string;
  subject: string;
  rows: string[];
}
const page = async (client: Client, query = "") => (await client.call("GET", `/api/optimise${query}`)).body;
const shown = async (client: Client, query = ""): Promise<Shown[]> => (await page(client, query)).data.areas.flatMap((a: { findings: Shown[] }) => a.findings);
const decide = (client: Client, id: string, body: unknown, query = "") => client.call("PUT", `/api/optimise/findings/${enc(id)}${query}`, body);
const put = (client: Client, key: string, value: unknown, query = "") => client.call("PUT", `/api/optimise/inputs/${enc(key)}${query}`, { value });

describe("Optimoi behind its flag", () => {
  it("answers 404 on every route while the flag is off, and the rest of the API is not affected", async () => {
    const { admin } = await setupApp();
    await admin.call("POST", "/api/demo");
    // the flag ships on, so an admin switches it off first
    await admin.call("PUT", "/api/admin/features", { optimise: false });
    const calls: [string, string, unknown?][] = [
      ["GET", "/api/optimise"],
      ["GET", "/api/optimise/evidence?id=subscriptions:test:x"],
      ["PUT", "/api/optimise/inputs/car_km", { value: 12000 }],
      ["DELETE", "/api/optimise/inputs/car_km"],
      ["PUT", `/api/optimise/findings/${enc("subscriptions:test:x")}`, { status: "dismissed" }],
      ["GET", "/api/optimise/nothing"],
    ];
    for (const [method, path, payload] of calls) {
      const res = await admin.call(method, path, payload);
      expect(res, `${method} ${path}`).toMatchObject({ status: 404, body: { error: "Ei löydy." } });
    }
    expect((await admin.call("GET", "/api/merchants")).status).toBe(200);
    expect((await admin.call("GET", "/api/dashboard")).status).toBe(200);

    // switching it on opens them, switching it off closes them again
    await admin.call("PUT", "/api/admin/features", { optimise: true });
    expect((await admin.call("GET", "/api/optimise")).status).toBe(200);
    await admin.call("PUT", "/api/admin/features", { optimise: false });
    expect((await admin.call("GET", "/api/optimise")).status).toBe(404);
  });

  it("needs a signed-in user and, for a change, the CSRF header", async () => {
    const { app, admin } = await setup();
    const anonymous = await app.request("http://localhost:8080/api/optimise", { headers: { "X-Requested-With": "fetch" } });
    expect(anonymous.status).toBe(401);
    const noHeader = await admin.call("PUT", "/api/optimise/inputs/car_km", { value: 12000 }, { "X-Requested-With": "" });
    expect(noHeader.status).toBeGreaterThanOrEqual(400);
    expect((await page(admin)).inputs).toEqual([]);
  });

  it("gives the page, the viewer's inputs and decisions, and runs the real areas when the test area is off", async () => {
    mode.testArea = false;
    const { admin } = await setup();
    const body = await page(admin);
    expect(Object.keys(body).sort()).toEqual(["changes", "data", "followUp", "inputs", "states"]);
    expect(body.inputs).toEqual([]);
    expect(body.states).toEqual([]);
    expect(body.data).toMatchObject({ today: TODAY, end: "2026-09-30", months: 12 });
    expect(body.data.areas.map((a: { id: string }) => a.id).sort()).toEqual(
      ["bank", "car", "electricity", "food", "habits", "housing", "insurance", "kids", "loans", "savings", "seasons", "subscriptions", "tax"].sort(),
    );
    expect(body.data.situation.map((f: { id: string }) => f.id)).toEqual(["savings_rate", "fixed_share", "buffer", "debt_share"]);
  });

  it("works for an account without history", async () => {
    mode.testArea = false;
    const { admin } = await setupApp();
    await admin.call("PUT", "/api/admin/features", { optimise: true });
    const { data } = await page(admin);
    expect(data).toMatchObject({ months: 0, accounts: 0, dataTo: null, headline: { count: 0, midCents: 0 }, soon: [], done: [], dismissed: [] });
  });
});

describe("typed inputs", () => {
  it("keeps one value per key, dated today, and takes it away again", async () => {
    const { admin, db, adminId } = await setup();
    const saved = await put(admin, "car_km", 12000);
    expect(saved).toMatchObject({ status: 200, body: { inputs: [{ key: "car_km", value: 12000, asOf: TODAY }] } });

    await put(admin, "loan_rate", { marginBp: 80, reference: "euribor_12" });
    await put(admin, "car_km", 15000);
    const listed = (await page(admin)).inputs;
    expect(listed).toEqual([
      { key: "car_km", value: 15000, asOf: TODAY },
      { key: "loan_rate", value: { marginBp: 80, reference: "euribor_12" }, asOf: TODAY },
    ]);
    expect(await db.first("SELECT value, as_of FROM optimise_inputs WHERE user_id = ? AND key = 'loan_rate'", [adminId])).toEqual({ value: '{"marginBp":80,"reference":"euribor_12"}', as_of: TODAY });

    const removed = await admin.call("DELETE", "/api/optimise/inputs/car_km");
    expect(removed.body.inputs.map((i: { key: string }) => i.key)).toEqual(["loan_rate"]);
    // taking away what is not there is not an error
    expect((await admin.call("DELETE", "/api/optimise/inputs/car_km")).status).toBe(200);
  });

  it("accepts the value of every definition at its bounds", async () => {
    const { admin } = await setup();
    const good: [string, unknown][] = [
      ["loan_rate", { marginBp: 0, reference: "fixed" }],
      ["loan_rate", { marginBp: 500, reference: "euribor_3" }],
      ["electricity_kwh", 500],
      ["electricity_kwh", 60000],
      ["electricity_contract_end", TODAY],
      ["electricity_contract_end", "2029-10-09"],
      ["housing_type", "asumisoikeus"],
      ["moved_on", "2023-10-09"],
      ["moved_on", TODAY],
      ["parking_permit_price", 100],
      ["parking_permit_price", 200000],
      ["car_km", 1000],
      ["car_km", 100000],
    ];
    for (const [key, value] of good) expect((await put(admin, key, value)).status, `${key} ${JSON.stringify(value)}`).toBe(200);
  });

  it("refuses a key or value the definitions do not allow, and stores nothing", async () => {
    const { admin, db } = await setup();
    const bad: [string, string, unknown][] = [
      ["an unknown key", "nope", 1],
      ["a prototype key", "__proto__", 1],
      ["a subject on a key that has none", "car_km:x", 12000],
      ["a quote without a subject", "insurance_quote", 20000],
      ["a quote with an empty subject", "insurance_quote:", 20000],
      ["a subject over 200 characters", `insurance_quote:${"x".repeat(201)}`, 20000],
      ["a subject with a control character", "insurance_quote:out:a\nb", 20000],
      ["a km figure under the range", "car_km", 999],
      ["a km figure over the range", "car_km", 100001],
      ["a km figure with decimals", "car_km", 12000.5],
      ["a km figure as text", "car_km", "12000"],
      ["no value", "car_km", null],
      ["electricity under the range", "electricity_kwh", 499],
      ["a permit price over the range", "parking_permit_price", 200001],
      ["a margin over 5 %", "loan_rate", { marginBp: 501, reference: "euribor_12" }],
      ["a margin with decimals", "loan_rate", { marginBp: 80.5, reference: "euribor_12" }],
      ["a reference rate outside the list", "loan_rate", { marginBp: 80, reference: "libor" }],
      ["a loan rate with a missing field", "loan_rate", { marginBp: 80 }],
      ["a loan rate with an extra field", "loan_rate", { marginBp: 80, reference: "fixed", note: "x" }],
      ["a loan rate as a number", "loan_rate", 80],
      ["a contract end in the past", "electricity_contract_end", "2026-10-08"],
      ["a contract end beyond three years", "electricity_contract_end", "2029-10-10"],
      ["a date that does not exist", "electricity_contract_end", "2027-02-30"],
      ["a date in another format", "electricity_contract_end", "15.1.2027"],
      ["a moving day in the future", "moved_on", "2026-10-10"],
      ["a moving day over three years back", "moved_on", "2023-10-08"],
      ["a housing type outside the list", "housing_type", "linna"],
    ];
    for (const [what, key, value] of bad) {
      const r = await put(admin, key, value);
      expect(r.status, what).toBe(400);
      expect(typeof r.body.error, what).toBe("string");
    }
    // a field next to the value, a missing value, and bodies that are not an object
    expect((await admin.call("PUT", "/api/optimise/inputs/car_km", { value: 12000, asOf: "2020-01-01" })).status).toBe(400);
    expect((await admin.call("PUT", "/api/optimise/inputs/car_km", {})).status).toBe(400);
    expect((await admin.call("PUT", "/api/optimise/inputs/car_km", [12000])).status).toBe(400);
    expect((await admin.call("PUT", "/api/optimise/inputs/car_km", 12000)).status).toBe(400);
    expect((await admin.call("DELETE", "/api/optimise/inputs/nope")).status).toBe(400);
    expect((await db.first<{ n: number }>("SELECT count(*) AS n FROM optimise_inputs"))?.n).toBe(0);
  });

  it("takes an insurance quote only for a series in the user's history", async () => {
    const { admin } = await setup();
    const series = (await admin.call("GET", "/api/recurring")).body.series.find((r: { kind: string }) => r.kind === "subscription");
    expect((await put(admin, `insurance_quote:${series.id}`, 45000)).body.inputs).toEqual([{ key: `insurance_quote:${series.id}`, value: 45000, asOf: TODAY }]);

    const unknown = await put(admin, "insurance_quote:out:demo-nothing:Joku", 45000);
    expect(unknown).toMatchObject({ status: 400, body: { error: "Vakuutusta ei löydy tiedoistasi." } });
    // a quote over 10 000 € or under 1 € is refused whatever the series
    expect((await put(admin, `insurance_quote:${series.id}`, 1_000_001)).status).toBe(400);
    expect((await put(admin, `insurance_quote:${series.id}`, 99)).status).toBe(400);
    expect((await page(admin)).inputs).toHaveLength(1);
  });

  it("holds at most 50 inputs, and a saved one can still be replaced", async () => {
    const { admin, s, adminId } = await setup();
    const repo = s.finance(adminId);
    await put(admin, "car_km", 12000);
    for (let i = 1; i < 50; i++) await repo.setInput(`insurance_quote:s${i}`, 20000, TODAY);
    expect((await repo.listInputs()).length).toBe(50);

    expect(await put(admin, "housing_type", "kerrostalo")).toMatchObject({ status: 400, body: { error: expect.stringContaining("50") } });
    expect((await put(admin, "car_km", 13000)).status).toBe(200);
    await admin.call("DELETE", `/api/optimise/inputs/${enc("insurance_quote:s1")}`);
    expect((await put(admin, "housing_type", "kerrostalo")).status).toBe(200);
  });

  it("an input save moves no data version and leaves the analysis alone", async () => {
    const { admin, s, adminId } = await setup();
    const before = await s.settings.dataVersionOf([adminId]);
    const globalBefore = await s.settings.get("data_version");
    const { ctx } = await s.analysis.get(s, adminId, "own");

    await put(admin, "car_km", 12000);
    await admin.call("DELETE", "/api/optimise/inputs/car_km");
    const [first] = await shown(admin);
    await decide(admin, first!.id, { status: "dismissed", reason: "need_it" });
    await decide(admin, first!.id, { status: null });

    expect(await s.settings.dataVersionOf([adminId])).toBe(before);
    expect(await s.settings.get("data_version")).toBe(globalBefore);
    // the cached context is the same object: nothing was rebuilt
    expect((await s.analysis.get(s, adminId, "own")).ctx).toBe(ctx);
  });
});

describe("decisions on findings", () => {
  it("done stores the mid and the baseline the server computed, and the finding moves to Jo hoidossa", async () => {
    const { admin, s, adminId, db } = await setup();
    const before = await page(admin);
    const [finding] = await shown(admin);
    const res = await decide(admin, finding!.id, { status: "done" });
    expect(res.status).toBe(200);

    const { ctx } = await s.analysis.get(s, adminId, "own");
    const full = before.data.areas[0].findings[0];
    const [state] = res.body.states as FindingState[];
    expect(state).toEqual({
      findingId: finding!.id,
      status: "done",
      reason: null,
      until: null,
      effectiveDate: TODAY,
      midCents: 36000,
      baseline: baselineOf(ctx, full, TODAY),
      decidedAt: DECIDED_AT,
    });
    expect(state!.baseline!.map((b) => b.month)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(state!.baseline!.every((b) => Number.isInteger(b.cents) && b.cents >= 0)).toBe(true);
    expect(state!.baseline!.some((b) => b.cents > 0)).toBe(true);
    // the row is the user's own
    expect(await db.first("SELECT user_id, status, mid_cents FROM optimise_states WHERE finding_id = ?", [finding!.id])).toEqual({ user_id: adminId, status: "done", mid_cents: 36000 });

    const after = await page(admin);
    expect(after.data.done.map((d: { state: { findingId: string } }) => d.state.findingId)).toEqual([finding!.id]);
    expect(after.data.done[0].finding.id).toBe(finding!.id);
    expect((await shown(admin)).map((f) => f.id)).not.toContain(finding!.id);
    // the fourth finding of the area takes the place it left
    expect((await shown(admin)).length).toBe(3);
    expect(before.data.areas[0].more).toBe(1);
    expect(after.data.areas[0].more).toBe(0);
    expect(after.states).toEqual(res.body.states);
  });

  it("done takes the baseline from the day the change took effect", async () => {
    const { admin, s, adminId } = await setup();
    const [finding] = await shown(admin);
    const { ctx } = await s.analysis.get(s, adminId, "own");
    const full = (await page(admin)).data.areas[0].findings[0];

    const past = await decide(admin, finding!.id, { status: "done", effectiveDate: "2026-08-15" });
    expect(past.body.states[0]).toMatchObject({ effectiveDate: "2026-08-15", baseline: baselineOf(ctx, full, "2026-08-15") });
    expect(past.body.states[0].baseline.map((b: { month: string }) => b.month)).toEqual(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);

    // a change that takes effect later is allowed, within a year either way
    expect((await decide(admin, finding!.id, { status: "done", effectiveDate: "2027-10-09" })).status).toBe(200);
    expect((await decide(admin, finding!.id, { status: "done", effectiveDate: "2025-10-09" })).status).toBe(200);
    for (const effectiveDate of ["2027-10-10", "2025-10-08", "2026-02-30", "15.8.2026", 20260815, true]) {
      expect((await decide(admin, finding!.id, { status: "done", effectiveDate })).status, JSON.stringify(effectiveDate)).toBe(400);
    }
  });

  it("dismisses with a reason from the list, and the finding moves to Ei koske meitä", async () => {
    const { admin } = await setup();
    const [finding] = await shown(admin);
    const res = await decide(admin, finding!.id, { status: "dismissed", reason: "compared" });
    expect(res.body.states[0]).toEqual({
      findingId: finding!.id,
      status: "dismissed",
      reason: "compared",
      until: null,
      effectiveDate: null,
      midCents: 36000,
      baseline: null,
      decidedAt: DECIDED_AT,
    });
    const after = await page(admin);
    expect(after.data.dismissed.map((d: { finding: Shown }) => d.finding.id)).toEqual([finding!.id]);
    expect((await shown(admin)).map((f) => f.id)).not.toContain(finding!.id);

    // the reason is optional, and a later choice replaces the earlier one
    const bare = await decide(admin, finding!.id, { status: "dismissed" });
    expect(bare.body.states).toHaveLength(1);
    expect(bare.body.states[0]).toMatchObject({ status: "dismissed", reason: null });
    for (const reason of ["nope", "", 1, true, ["need_it"]]) {
      expect((await decide(admin, finding!.id, { status: "dismissed", reason })).status, JSON.stringify(reason)).toBe(400);
    }
  });

  it("snoozes until a day after today and within a year, and hides the finding meanwhile", async () => {
    const { admin } = await setup();
    const [finding] = await shown(admin);
    const res = await decide(admin, finding!.id, { status: "snoozed", until: "2026-10-10" });
    expect(res.body.states[0]).toMatchObject({ status: "snoozed", until: "2026-10-10", reason: null, effectiveDate: null, baseline: null, midCents: 36000 });
    const after = await page(admin);
    expect((await shown(admin)).map((f) => f.id)).not.toContain(finding!.id);
    expect([...after.data.done, ...after.data.dismissed]).toEqual([]);

    // a snoozed finding can be changed again though it is hidden
    expect((await decide(admin, finding!.id, { status: "snoozed", until: "2027-10-09" })).status).toBe(200);
    expect((await decide(admin, finding!.id, { status: "dismissed", reason: "cannot" })).body.states[0]).toMatchObject({ status: "dismissed", until: null });
    await decide(admin, finding!.id, { status: "snoozed", until: "2026-12-01" });
    expect((await decide(admin, finding!.id, { status: null })).body.states).toEqual([]);
    expect((await shown(admin)).map((f) => f.id)).toContain(finding!.id);

    for (const until of [TODAY, "2026-10-08", "2027-10-10", "2026-02-30", "1.12.2026", 20261201, null, undefined]) {
      expect((await decide(admin, finding!.id, { status: "snoozed", until })).status, JSON.stringify(until)).toBe(400);
    }
  });

  it("null takes a decision back, and the finding shows again", async () => {
    const { admin } = await setup();
    const [finding] = await shown(admin);
    await decide(admin, finding!.id, { status: "dismissed", reason: "wrong" });
    expect((await shown(admin)).map((f) => f.id)).not.toContain(finding!.id);

    expect((await decide(admin, finding!.id, { status: null })).body).toEqual({ states: [] });
    expect((await shown(admin)).map((f) => f.id)).toContain(finding!.id);
    // the finding is there and has no decision: nothing to take back, and no error
    expect((await decide(admin, finding!.id, { status: null })).body).toEqual({ states: [] });
  });

  it("refuses a request that names a field its status does not use, or one the server fills in", async () => {
    const { admin, db } = await setup();
    const [finding] = await shown(admin);
    const bad: [string, unknown][] = [
      ["a mid from the client", { status: "done", midCents: 99999999 }],
      ["a baseline from the client", { status: "done", baseline: [] }],
      ["a time from the client", { status: "done", decidedAt: "2020-01-01T00:00:00Z" }],
      ["another finding id", { status: "done", findingId: "loans:margin" }],
      ["a reason on done", { status: "done", reason: "need_it" }],
      ["an until on dismissed", { status: "dismissed", until: "2026-12-01" }],
      ["an effective date on snoozed", { status: "snoozed", until: "2026-12-01", effectiveDate: TODAY }],
      ["a reason on a snooze", { status: "snoozed", until: "2026-12-01", reason: "need_it" }],
      ["a field next to null", { status: null, reason: "need_it" }],
      ["no status", {}],
      ["a status outside the list", { status: "finished" }],
      ["a status that is not text", { status: 1 }],
      ["an empty status", { status: "" }],
      ["a list", [{ status: "done" }]],
      ["a text", "done"],
    ];
    for (const [what, payload] of bad) {
      const r = await decide(admin, finding!.id, payload);
      expect(r.status, what).toBe(400);
      expect(typeof r.body.error, what).toBe("string");
    }
    expect((await db.first<{ n: number }>("SELECT count(*) AS n FROM optimise_states"))?.n).toBe(0);
    // fields of another status that are null count as absent
    expect((await decide(admin, finding!.id, { status: "done", reason: null, until: null })).status).toBe(200);
  });

  it("refuses an id no area could have made, and an id that is not a finding of the user", async () => {
    const { admin, db } = await setup();
    const malformed = ["nope", "loans", "bogus:test:x", "subscriptions:Bad Kind:x", "subscriptions::x", `subscriptions:test:${"x".repeat(201)}`, "subscriptions:test:a\nb", ":test:x"];
    for (const id of malformed) {
      expect((await decide(admin, id, { status: "dismissed" })).status, id).toBe(400);
      expect((await admin.call("GET", `/api/optimise/evidence?id=${enc(id)}`)).status, id).toBe(400);
    }
    // a path that is not valid percent-encoding is a bad request too, never a server error
    expect((await admin.call("PUT", "/api/optimise/findings/%E0%A4%A", { status: "dismissed" })).status).toBe(400);
    expect((await admin.call("PUT", "/api/optimise/inputs/%E0%A4%A", { value: 1 })).status).toBe(400);
    expect((await admin.call("DELETE", "/api/optimise/inputs/%E0%A4%A")).status).toBe(400);
    expect((await admin.call("GET", "/api/optimise/evidence?id=%E0%A4%A")).status).toBe(400);
    // well formed, but nothing of this user's history makes it, for any status and for null
    for (const body of [{ status: "dismissed" }, { status: "done" }, { status: "snoozed", until: "2026-12-01" }, { status: null }]) {
      expect(await decide(admin, "subscriptions:test:out:demo-nothing:Joku", body)).toMatchObject({ status: 404, body: { error: "Vinkkiä ei löydy." } });
    }
    expect((await db.first<{ n: number }>("SELECT count(*) AS n FROM optimise_states"))?.n).toBe(0);
  });

  it("holds at most 500 decisions, and a stored one can still be changed or taken back", async () => {
    const { admin, s, adminId } = await setup();
    const repo = s.finance(adminId);
    const [one, two] = await shown(admin);
    await decide(admin, one!.id, { status: "dismissed" });
    for (let i = 1; i < 500; i++) {
      await repo.setState({ findingId: `loans:test:${i}`, status: "dismissed", reason: null, until: null, effectiveDate: null, midCents: null, baseline: null, decidedAt: DECIDED_AT });
    }
    expect((await repo.listStates()).length).toBe(500);

    expect(await decide(admin, two!.id, { status: "dismissed" })).toMatchObject({ status: 400, body: { error: expect.stringContaining("liikaa") } });
    expect((await decide(admin, one!.id, { status: "done" })).status).toBe(200);
    expect((await decide(admin, one!.id, { status: null })).status).toBe(200);
    expect((await decide(admin, two!.id, { status: "dismissed" })).status).toBe(200);
  });

  it("a finding past the three an area shows has no card to decide on until one of them goes", async () => {
    const { admin } = await setup();
    const active = (await admin.call("GET", "/api/recurring")).body.series.filter((r: { active: boolean; kind: string }) => r.active && r.kind === "subscription");
    const ids = (await shown(admin)).map((f) => f.id);
    expect(ids).toHaveLength(3);
    // the test area makes four findings and the frame shows the best three
    const fourth = active.slice(0, 4).map((r: { id: string }) => `subscriptions:test:${r.id}`).find((id: string) => !ids.includes(id));
    expect(fourth).toBeDefined();
    expect(await decide(admin, fourth!, { status: "dismissed" })).toMatchObject({ status: 404 });

    await decide(admin, ids[0]!, { status: "dismissed" });
    expect((await shown(admin)).map((f) => f.id)).toContain(fourth);
    expect((await decide(admin, fourth!, { status: "dismissed" })).status).toBe(200);
  });
});

describe("the evidence of a finding", () => {
  it("gives the calc, the rows with their account and struck flag, and the monthly sums of its measure", async () => {
    const { admin, s, adminId } = await setup();
    const [finding] = await shown(admin);
    const res = await admin.call("GET", `/api/optimise/evidence?id=${enc(finding!.id)}`);
    expect(res.status).toBe(200);
    const { ctx } = await s.analysis.get(s, adminId, "own");
    const full = (await page(admin)).data.areas[0].findings[0];
    const accounts = (await admin.call("GET", "/api/meta")).body.accounts;

    expect(res.body.id).toBe(finding!.id);
    expect(res.body.calc).toEqual([{ label: "Vuodessa", value: "360 €" }]);
    expect(res.body.rows).toHaveLength(finding!.rows.length);
    expect(res.body.rows.length).toBeLessThanOrEqual(60);
    expect(res.body.rows[0]).toEqual({
      id: finding!.rows[0],
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      merchant: expect.any(String),
      amountCents: expect.any(Number),
      accountId: expect.stringMatching(/^demo-/),
      account: accounts.find((a: { id: string }) => a.id === res.body.rows[0].accountId).name,
      struck: true,
    });
    expect(res.body.rows.filter((r: { struck: boolean }) => r.struck)).toHaveLength(1);
    expect(res.body.rows.every((r: { account: string }) => r.account !== "")).toBe(true);
    expect(res.body.sums).toEqual(measureSums(ctx, full.measure, yearWindow(ctx, "2026-09-30").months));
    expect(res.body.sums).toHaveLength(12);
    expect(res.body.sums[0].month).toBe("2025-10");
    expect(res.body.sums[11].month).toBe("2026-09");
    // nothing that belongs to the bank payload
    expect(Object.keys(res.body.rows[0]).sort()).toEqual(["account", "accountId", "amountCents", "date", "id", "merchant", "struck"]);
  });

  it("answers for a done or dismissed finding that still shows in the data, and 404 for one that is hidden or unknown", async () => {
    const { admin } = await setup();
    const [a, b, c] = await shown(admin);
    const evidence = (id: string) => admin.call("GET", `/api/optimise/evidence?id=${enc(id)}`);
    await decide(admin, a!.id, { status: "done" });
    await decide(admin, b!.id, { status: "dismissed" });
    await decide(admin, c!.id, { status: "snoozed", until: "2026-12-01" });
    expect((await evidence(a!.id)).status).toBe(200);
    expect((await evidence(b!.id)).status).toBe(200);
    expect(await evidence(c!.id)).toMatchObject({ status: 404, body: { error: "Vinkkiä ei löydy." } });
    expect((await evidence("subscriptions:test:out:demo-nothing:Joku")).status).toBe(404);
    expect((await admin.call("GET", "/api/optimise/evidence")).status).toBe(400);
  });
});

describe("one user's inputs and decisions never reach another's", () => {
  it("a member sees none of another member's inputs or decisions, and the rows stay apart", async () => {
    const { admin, member, db, adminId } = await setup();
    const eero = await member("eero");
    await eero.call("POST", "/api/demo");
    await put(admin, "car_km", 12000);
    const [first] = await shown(admin);
    await decide(admin, first!.id, { status: "dismissed", reason: "need_it" });

    expect(await page(eero)).toMatchObject({ inputs: [], states: [], data: { dismissed: [], done: [] } });
    // eero's demo history has the same merchant under an id of its own: that finding is still his to see
    expect((await shown(eero)).map((f) => f.subject).filter((id) => id === first!.subject)).toEqual([]);
    const own = (await shown(eero))[0]!;
    expect(own.id).not.toBe(first!.id);

    // the same key and a decision on his own finding are rows of his
    await put(eero, "car_km", 8000);
    await decide(eero, own.id, { status: "done" });
    expect((await page(admin)).inputs).toEqual([{ key: "car_km", value: 12000, asOf: TODAY }]);
    expect((await page(eero)).inputs).toEqual([{ key: "car_km", value: 8000, asOf: TODAY }]);
    expect((await page(admin)).states.map((s: FindingState) => s.findingId)).toEqual([first!.id]);
    expect((await page(eero)).states.map((s: FindingState) => s.findingId)).toEqual([own.id]);

    // his finding is not an id of the admin's, nor the admin's one his
    expect((await decide(eero, first!.id, { status: "dismissed" })).status).toBe(404);
    expect((await eero.call("GET", `/api/optimise/evidence?id=${enc(first!.id)}`)).status).toBe(404);
    expect((await decide(admin, own.id, { status: "dismissed" })).status).toBe(404);

    // taking away his input leaves the admin's, and his decision's removal leaves the admin's
    await eero.call("DELETE", "/api/optimise/inputs/car_km");
    await decide(eero, own.id, { status: null });
    expect((await page(admin)).inputs).toHaveLength(1);
    expect((await page(admin)).states).toHaveLength(1);
    expect((await db.first<{ n: number }>("SELECT count(*) AS n FROM optimise_states WHERE user_id = ?", [adminId]))?.n).toBe(1);
  });

  it("a deleted user takes the inputs, decisions and snapshots along", async () => {
    const { admin, member, db, s } = await setup();
    const eero = await member("eero");
    await eero.call("POST", "/api/demo");
    await put(eero, "car_km", 8000);
    const [own] = await shown(eero);
    await decide(eero, own!.id, { status: "dismissed" });
    await s.finance(eero.id).putSnapshot("2026-09", { findings: 3 }, DECIDED_AT);
    await put(admin, "car_km", 12000);

    await admin.call("DELETE", `/api/users/${eero.id}`);
    for (const table of ["optimise_inputs", "optimise_states", "optimise_snapshots"]) {
      expect((await db.first<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`, [eero.id]))?.n, table).toBe(0);
    }
    expect((await db.first<{ n: number }>("SELECT count(*) AS n FROM optimise_inputs"))?.n).toBe(1);
  });

  it("the household view counts the shared accounts but takes the viewer's own inputs and decisions", async () => {
    const { admin, member } = await setup();
    const eero = await member("eero");
    const accounts: { id: string }[] = (await admin.call("GET", "/api/meta")).body.accounts;
    for (const a of accounts) expect((await admin.call("PUT", `/api/accounts/${a.id}/shares/${eero.id}`)).status).toBe(200);

    // eero has no accounts of his own: his own view is empty, his household view is the admin's accounts
    expect(await shown(eero)).toEqual([]);
    const seen = await shown(eero, "?scope=household");
    const adminSees = await shown(admin);
    expect(seen.map((f) => f.id)).toEqual(adminSees.map((f) => f.id));

    // a decision of the admin's does not hide anything for eero, and eero's does not for the admin
    await decide(admin, adminSees[0]!.id, { status: "dismissed" });
    expect((await shown(eero, "?scope=household")).map((f) => f.id)).toContain(adminSees[0]!.id);
    expect((await page(eero, "?scope=household")).states).toEqual([]);
    await decide(eero, seen[1]!.id, { status: "dismissed", reason: "wrong" }, "?scope=household");
    expect((await shown(eero, "?scope=household")).map((f) => f.id)).not.toContain(seen[1]!.id);
    expect((await shown(admin)).map((f) => f.id)).toContain(seen[1]!.id);
    expect((await page(eero, "?scope=household")).states.map((s: FindingState) => s.findingId)).toEqual([seen[1]!.id]);
    expect((await page(admin)).states.map((s: FindingState) => s.findingId)).toEqual([adminSees[0]!.id]);

    // eero's own scope has no such finding to decide on
    expect((await decide(eero, seen[2]!.id, { status: "dismissed" })).status).toBe(404);

    // a quote for a series of a shared account belongs to eero's inputs, and only the household view knows the series
    const series = seen[2]!.subject;
    expect((await put(eero, `insurance_quote:${series}`, 45000)).status).toBe(400);
    expect((await put(eero, `insurance_quote:${series}`, 45000, "?scope=household")).body.inputs).toHaveLength(1);
    expect((await page(admin)).inputs).toEqual([]);
    expect((await page(eero, "?scope=household")).inputs).toHaveLength(1);
  });
});

describe("decisions follow a merchant whose name is derived again", () => {
  const states = async (s: Awaited<ReturnType<typeof setup>>["s"], userId: string) => (await s.finance(userId).listStates()).map((st) => st.findingId).sort();
  const seed = (s: Awaited<ReturnType<typeof setup>>["s"], userId: string, ids: string[]) =>
    Promise.all(ids.map((findingId) => s.finance(userId).setState({ findingId, status: "dismissed", reason: null, until: null, effectiveDate: null, midCents: 20000, baseline: null, decidedAt: DECIDED_AT })));

  it("renames the subject of a decision and of a quote on an upgrade, for a merchant and for its series", async () => {
    const { s, adminId, member } = await setup();
    const repo = s.finance(adminId);
    await s.db.run("UPDATE transactions SET merchant = 'WOLT OLD NAME' WHERE user_id = ? AND merchant = 'Wolt'", [adminId]);
    const acc = "demo-abc";
    await seed(s, adminId, [
      "food:takeaway:WOLT OLD NAME",
      `subscriptions:price_rise:out:${acc}:WOLT OLD NAME`,
      `subscriptions:price_rise:out:${acc}:WOLT OLD NAME#habit`,
      `subscriptions:price_rise:out:${acc}:WOLT OLD NAME#1290`,
      "subscriptions:overlap:Spotify",
      "loans:margin",
      "food:takeaway:WOLT OLD NAME EXTRA",
    ]);
    await repo.setInput(`insurance_quote:out:${acc}:WOLT OLD NAME`, 30000, TODAY);
    await repo.setInput("car_km", 12000, TODAY);
    // another member's decision on the same old name is a row of theirs and stays
    const eero = await member("eero");
    await seed(s, eero.id, ["food:takeaway:WOLT OLD NAME"]);

    expect(await runUpgradeTasks(s, "0.8.0+rename")).toMatchObject({ users: 2 });
    expect(await states(s, adminId)).toEqual(
      [
        "food:takeaway:Wolt",
        `subscriptions:price_rise:out:${acc}:Wolt`,
        `subscriptions:price_rise:out:${acc}:Wolt#habit`,
        `subscriptions:price_rise:out:${acc}:Wolt#1290`,
        "subscriptions:overlap:Spotify",
        "loans:margin",
        "food:takeaway:WOLT OLD NAME EXTRA",
      ].sort(),
    );
    expect((await repo.listInputs()).map((i) => i.key)).toEqual(["car_km", `insurance_quote:out:${acc}:Wolt`]);
    expect(await states(s, eero.id)).toEqual(["food:takeaway:WOLT OLD NAME"]);
    // the renamed decision keeps what it held
    expect((await repo.listStates()).find((st) => st.findingId === "food:takeaway:Wolt")).toMatchObject({ status: "dismissed", midCents: 20000, decidedAt: DECIDED_AT });
  });

  it("keeps the decision the new name already has, and drops the stale one", async () => {
    const { s, adminId } = await setup();
    await s.db.run("UPDATE transactions SET merchant = 'WOLT OLD NAME' WHERE user_id = ? AND merchant = 'Wolt'", [adminId]);
    await s.finance(adminId).setState({ findingId: "food:takeaway:WOLT OLD NAME", status: "done", reason: null, until: null, effectiveDate: TODAY, midCents: 1, baseline: [], decidedAt: DECIDED_AT });
    await s.finance(adminId).setState({ findingId: "food:takeaway:Wolt", status: "dismissed", reason: "wrong", until: null, effectiveDate: null, midCents: 2, baseline: null, decidedAt: DECIDED_AT });
    await runUpgradeTasks(s, "0.8.0+rename");
    expect(await s.finance(adminId).listStates()).toEqual([expect.objectContaining({ findingId: "food:takeaway:Wolt", status: "dismissed", midCents: 2 })]);
  });

  it("renamedSubject reads a merchant, a series id and a series with a suffix, and nothing else", () => {
    const renames = new Map([
      ["OLD", "New"],
      ["Foo #2", "Foo 2"],
    ]);
    expect(renamedSubject("OLD", renames)).toBe("New");
    expect(renamedSubject("out:acc:OLD", renames)).toBe("out:acc:New");
    expect(renamedSubject("in:acc:OLD#habit", renames)).toBe("in:acc:New#habit");
    expect(renamedSubject("out:acc:OLD#1290", renames)).toBe("out:acc:New#1290");
    // a name that ends like a product suffix carries one more "#" (core's seriesId)
    expect(renamedSubject("out:acc:Foo #2#", renames)).toBe("out:acc:Foo 2");
    expect(renamedSubject("out:acc:Foo #2#habit", renames)).toBe("out:acc:Foo 2#habit");
    expect(renamedSubject("out:acc:OLD EXTRA", renames)).toBeNull();
    // only a suffix recurring.ts writes is cut: a merchant named "OLD#bar" is another merchant
    expect(renamedSubject("out:acc:OLD#bar", renames)).toBeNull();
    expect(renamedSubject("out:acc:OLD#habit#habit", renames)).toBeNull();
    expect(renamedSubject("out:acc:Other", renames)).toBeNull();
    expect(renamedSubject("both:acc:OLD", renames)).toBeNull();
    expect(renamedSubject("Other", renames)).toBeNull();
  });
});

describe("snapshots", () => {
  it("keeps one snapshot per user and month, and replaces it when written again", async () => {
    const { s, adminId, member } = await setup();
    const repo = s.finance(adminId);
    expect(await repo.getSnapshot("2026-09")).toBeNull();
    await repo.putSnapshot("2026-09", { findings: ["a"] }, DECIDED_AT);
    await repo.putSnapshot("2026-09", { findings: ["a", "b"] }, "2026-10-10T08:00:00+03:00");
    expect(await repo.getSnapshot("2026-09")).toEqual({ month: "2026-09", data: { findings: ["a", "b"] }, createdAt: "2026-10-10T08:00:00+03:00" });
    const eero = await member("eero");
    expect(await s.finance(eero.id).getSnapshot("2026-09")).toBeNull();
  });
});

describe("the schema", () => {
  it("has the three tables, and a status outside the list is refused by the database", async () => {
    const { db, adminId } = await setup();
    for (const table of ["optimise_inputs", "optimise_states", "optimise_snapshots"]) {
      expect(await db.first("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table])).toEqual({ name: table });
    }
    await expect(
      db.run("INSERT INTO optimise_states (user_id, finding_id, status, decided_at) VALUES (?, 'loans:margin', 'maybe', ?)", [adminId, DECIDED_AT]),
    ).rejects.toThrow();
    // a key the definitions do not know is not for the database to refuse: a new input needs no migration
    await db.run("INSERT INTO optimise_inputs (user_id, key, value, as_of) VALUES (?, 'future_input', '1', ?)", [adminId, TODAY]);
  });
});

describe("the follow-up: snapshots, changes and outcomes", () => {
  const snapshotRows = (db: Awaited<ReturnType<typeof setup>>["db"], userId: string) =>
    db.all<{ month: string; data: string; created_at: string }>("SELECT month, data, created_at FROM optimise_snapshots WHERE user_id = ? ORDER BY month", [userId]);

  it("the first visit of a month writes one snapshot of id, area, mid, certainty and status, and a later visit leaves it", async () => {
    const { admin, db, adminId } = await setup();
    const first = await page(admin);
    expect(first.changes).toEqual([]);
    expect(first.followUp).toEqual({ outcomes: [], proposals: [], line: [{ month: "2026-10", foundCents: 3 * 36000, confirmedCents: 0 }] });
    const rows = await snapshotRows(db, adminId);
    expect(rows.map((r) => [r.month, r.created_at])).toEqual([["2026-10", DECIDED_AT]]);
    const entries = JSON.parse(rows[0]!.data);
    expect(entries).toHaveLength(3);
    type Card = { id: string; area: string; euros: { midCents: number }; certainty: { level: string } };
    expect(entries).toEqual(first.data.areas[0].findings.map((f: Card) => ({ id: f.id, area: f.area, midCents: f.euros.midCents, certainty: f.certainty.level, status: "active" })));
    for (const e of entries) expect(Object.keys(e).sort()).toEqual(["area", "certainty", "id", "midCents", "status"]);

    // a decision later in the month changes the page, not the month's snapshot
    await decide(admin, entries[0].id, { status: "done" });
    await page(admin);
    expect(await snapshotRows(db, adminId)).toEqual(rows);
  });

  it("lists what changed against the last snapshot before this month", async () => {
    const { admin, s, adminId } = await setup();
    const [done, ...rest] = await shown(admin);
    await decide(admin, done!.id, { status: "done" });
    const now = await shown(admin);
    expect(now).toHaveLength(3);
    const entry = (id: string, midCents: number) => ({ id, area: "subscriptions", midCents, certainty: "korkea", status: "active" });
    // an older snapshot is passed over for the latest one before this month
    await s.finance(adminId).putSnapshot("2026-07", [entry(now[0]!.id, 10000)], DECIDED_AT);
    await s.finance(adminId).putSnapshot("2026-09", [entry(now[0]!.id, 28000), entry(now[1]!.id, 50000), entry("subscriptions:test:gone", 20000)], DECIDED_AT);

    const body = await page(admin);
    expect(body.changes).toEqual([
      { id: now[0]!.id, area: "subscriptions", change: "grown", midCents: 36000, previousCents: 28000 },
      { id: now[1]!.id, area: "subscriptions", change: "shrunk", midCents: 36000, previousCents: 50000 },
      { id: "subscriptions:test:gone", area: "subscriptions", change: "resolved", midCents: null, previousCents: 20000 },
    ]);
    // the fourth finding was behind the cap of three last time; the area showed three then, so it is not called new
    expect(rest.map((f) => f.id)).not.toContain(now[2]!.id);
    expect(body.changes.map((c: { id: string }) => c.id)).not.toContain(now[2]!.id);
    expect(body.followUp.line.map((p: { month: string }) => p.month)).toEqual(["2026-07", "2026-09", "2026-10"]);
  });

  it("answers when the snapshot cannot be written, and writes it on the next visit", async () => {
    const { admin, db, adminId } = await setup();
    const spy = vi.spyOn(FinanceRepo.prototype, "putSnapshot").mockRejectedValueOnce(new Error("disk full"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await admin.call("GET", "/api/optimise");
      expect(res.status).toBe(200);
      expect(res.body.data.areas[0].findings).toHaveLength(3);
      expect(await snapshotRows(db, adminId)).toEqual([]);
      await page(admin);
      expect((await snapshotRows(db, adminId)).map((r) => r.month)).toEqual(["2026-10"]);
    } finally {
      spy.mockRestore();
      quiet.mockRestore();
    }
  });

  it("the household view writes no snapshot and lists no changes", async () => {
    const { admin, db, adminId } = await setup();
    const body = await page(admin, "?scope=household");
    expect(body.changes).toEqual([]);
    expect(body.followUp.line).toEqual([]);
    expect(await snapshotRows(db, adminId)).toEqual([]);
  });

  it("a done finding gets its outcome, and the visit moves no data version and leaves the analysis alone", async () => {
    const { admin, s, adminId } = await setup();
    const [finding] = await shown(admin);
    // the demo subscription keeps billing after the day the change was marked: no saving shows
    await decide(admin, finding!.id, { status: "done", effectiveDate: "2026-07-15" });
    const before = await s.settings.dataVersionOf([adminId]);
    const globalBefore = await s.settings.get("data_version");
    const { ctx } = await s.analysis.get(s, adminId, "own");

    const body = await page(admin);
    expect(body.followUp.outcomes).toHaveLength(1);
    const [{ findingId, outcome }] = body.followUp.outcomes;
    expect(findingId).toBe(finding!.id);
    expect(["epäselvä", "huonompi"]).toContain(outcome.verdict);
    expect(outcome.reason).toContain("maksuja tulee yhä");
    expect(body.followUp.line.at(-1)).toMatchObject({ month: "2026-10", confirmedCents: 0 });
    // the follow-up never decides: the states are what the user stored
    expect(body.states.map((st: FindingState) => [st.findingId, st.status])).toEqual([[finding!.id, "done"]]);

    expect(await s.settings.dataVersionOf([adminId])).toBe(before);
    expect(await s.settings.get("data_version")).toBe(globalBefore);
    expect((await s.analysis.get(s, adminId, "own")).ctx).toBe(ctx);
  });

  it("one user's snapshot is never read for another", async () => {
    const { admin, member, db, s, adminId } = await setup();
    await s.finance(adminId).putSnapshot("2026-09", [{ id: "subscriptions:test:gone", area: "subscriptions", midCents: 20000, certainty: "korkea", status: "active" }], DECIDED_AT);
    const eero = await member("eero");
    await eero.call("POST", "/api/demo");
    expect((await page(eero)).changes).toEqual([]);
    expect((await snapshotRows(db, eero.id)).map((r) => r.month)).toEqual(["2026-10"]);
    // with one decided, the admin's area hides nothing, and the admin's own snapshot reads as resolved; the area showed
    // one finding then, so the three shown now are new
    const [one] = await shown(admin);
    await decide(admin, one!.id, { status: "done" });
    const changes: { id: string; change: string }[] = (await page(admin)).changes;
    expect(changes.map((c) => c.change)).toEqual(["new", "new", "new", "resolved"]);
    expect(changes.at(-1)).toEqual({ id: "subscriptions:test:gone", area: "subscriptions", change: "resolved", midCents: null, previousCents: 20000 });
  });
});
