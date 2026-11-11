import { describe, expect, it } from "vitest";
import { renamedSubject } from "../src/db/finance/optimise.ts";
import { runUpgradeTasks } from "../src/services/upgrade.ts";
import { type Client, setupApp } from "./helpers.ts";

/** The test clock is 2026-10-09 10:00 UTC; the instance time zone is Helsinki, so a decision carries +03:00. */
const TODAY = "2026-10-09";
const DECIDED_AT = "2026-10-09T13:00:00+03:00";
const enc = encodeURIComponent;

/** An app with the demo history loaded for the admin. */
async function setup() {
  const app = await setupApp();
  await app.admin.call("POST", "/api/demo");
  return app;
}

type Services = Awaited<ReturnType<typeof setup>>["s"];
/** What is stored for a user, read from the tables: no route lists the inputs or the decisions. */
const inputsOf = (s: Services, userId: string) => s.finance(userId).listInputs();
const statesOf = async (s: Services, userId: string) => (await s.finance(userId).listStates()).map((st) => st.findingId);
const dismissed = (findingId: string) => ({ findingId, status: "dismissed" as const, reason: null, until: null, effectiveDate: null, midCents: 20000, baseline: null, decidedAt: DECIDED_AT });
const put = (client: Client, key: string, value: unknown, query = "") => client.call("PUT", `/api/optimise/inputs/${enc(key)}${query}`, { value });

describe("Optimoi routes", () => {
  it("needs a signed-in user and, for a change, the CSRF header", async () => {
    const { app, admin, s, adminId } = await setup();
    const anonymous = await app.request("http://localhost:8080/api/optimise/inputs/car_km", {
      method: "PUT",
      headers: { "X-Requested-With": "fetch", "Content-Type": "application/json" },
      body: JSON.stringify({ value: 12000 }),
    });
    expect(anonymous.status).toBe(401);
    const noHeader = await admin.call("PUT", "/api/optimise/inputs/car_km", { value: 12000 }, { "X-Requested-With": "" });
    expect(noHeader.status).toBeGreaterThanOrEqual(400);
    expect(await inputsOf(s, adminId)).toEqual([]);
  });

  it("serves no page of tips: the address answers 404 in both views", async () => {
    const { admin } = await setup();
    for (const path of ["/api/optimise", "/api/optimise?scope=own", "/api/optimise?scope=household"]) expect((await admin.call("GET", path)).status, path).toBe(404);
    // a household without history gets the same answer
    expect((await (await setupApp()).admin.call("GET", "/api/optimise")).status).toBe(404);
  });

  it("serves no evidence of a tip: the address answers 404 with an id, without one and with a malformed one", async () => {
    const { admin } = await setup();
    for (const path of ["/api/optimise/evidence", `/api/optimise/evidence?id=${enc("subscriptions:overlap:video")}`, "/api/optimise/evidence?id=nope", "/api/optimise/evidence?id=%E0%A4%A"]) {
      expect((await admin.call("GET", path)).status, path).toBe(404);
    }
  });

  it("takes no decision on a tip: the address answers 404 for every status and stores nothing", async () => {
    const { admin, db } = await setup();
    const path = `/api/optimise/findings/${enc("subscriptions:overlap:video")}`;
    for (const body of [{ status: "done" }, { status: "dismissed", reason: "need_it" }, { status: "snoozed", until: "2026-12-01" }, { status: null }]) {
      expect((await admin.call("PUT", path, body)).status, JSON.stringify(body)).toBe(404);
      expect((await admin.call("PUT", `${path}?scope=household`, body)).status, JSON.stringify(body)).toBe(404);
    }
    for (const table of ["optimise_states", "optimise_snapshots"]) expect((await db.first<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))?.n, table).toBe(0);
  });
});

describe("typed inputs", () => {
  it("keeps one value per key, dated today, and takes it away again", async () => {
    const { admin, db, s, adminId } = await setup();
    const saved = await put(admin, "car_km", 12000);
    expect(saved).toMatchObject({ status: 200, body: { inputs: [{ key: "car_km", value: 12000, asOf: TODAY }] } });

    await put(admin, "loan_rate", { marginBp: 80, reference: "euribor_12" });
    await put(admin, "car_km", 15000);
    expect(await inputsOf(s, adminId)).toEqual([
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
    const { admin, s, adminId } = await setup();
    const series = (await admin.call("GET", "/api/recurring")).body.series.find((r: { kind: string }) => r.kind === "subscription");
    expect((await put(admin, `insurance_quote:${series.id}`, 45000)).body.inputs).toEqual([{ key: `insurance_quote:${series.id}`, value: 45000, asOf: TODAY }]);

    const unknown = await put(admin, "insurance_quote:out:demo-nothing:Joku", 45000);
    expect(unknown).toMatchObject({ status: 400, body: { error: "Vakuutusta ei löydy tiedoistasi." } });
    // a quote over 10 000 € or under 1 € is refused whatever the series
    expect((await put(admin, `insurance_quote:${series.id}`, 1_000_001)).status).toBe(400);
    expect((await put(admin, `insurance_quote:${series.id}`, 99)).status).toBe(400);
    expect(await inputsOf(s, adminId)).toHaveLength(1);
  });

  it("a path that is not valid percent-encoding is a bad request, never a server error", async () => {
    const { admin } = await setup();
    expect((await admin.call("PUT", "/api/optimise/inputs/%E0%A4%A", { value: 1 })).status).toBe(400);
    expect((await admin.call("DELETE", "/api/optimise/inputs/%E0%A4%A")).status).toBe(400);
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

    expect(await s.settings.dataVersionOf([adminId])).toBe(before);
    expect(await s.settings.get("data_version")).toBe(globalBefore);
    // the cached context is the same object: nothing was rebuilt
    expect((await s.analysis.get(s, adminId, "own")).ctx).toBe(ctx);
  });
});

describe("one user's inputs and decisions never reach another's", () => {
  it("a member gets none of another member's inputs or decisions, and the rows stay apart", async () => {
    const { admin, member, db, s, adminId } = await setup();
    const eero = await member("eero");
    await eero.call("POST", "/api/demo");
    expect((await put(admin, "car_km", 12000)).body.inputs).toEqual([{ key: "car_km", value: 12000, asOf: TODAY }]);
    await s.finance(adminId).setState(dismissed("food:takeaway:Wolt"));
    expect(await inputsOf(s, eero.id)).toEqual([]);
    expect(await statesOf(s, eero.id)).toEqual([]);

    // the same key and a decision on the same finding are rows of his, and each save answers with the saver's own
    expect((await put(eero, "car_km", 8000)).body.inputs).toEqual([{ key: "car_km", value: 8000, asOf: TODAY }]);
    await s.finance(eero.id).setState(dismissed("food:takeaway:Wolt"));
    expect(await inputsOf(s, adminId)).toEqual([{ key: "car_km", value: 12000, asOf: TODAY }]);
    expect(await inputsOf(s, eero.id)).toEqual([{ key: "car_km", value: 8000, asOf: TODAY }]);

    // taking away his input leaves the admin's, and his decision's removal leaves the admin's
    expect((await eero.call("DELETE", "/api/optimise/inputs/car_km")).body.inputs).toEqual([]);
    await s.finance(eero.id).clearState("food:takeaway:Wolt");
    expect(await inputsOf(s, adminId)).toHaveLength(1);
    expect(await statesOf(s, eero.id)).toEqual([]);
    expect(await statesOf(s, adminId)).toEqual(["food:takeaway:Wolt"]);
    expect((await db.first<{ n: number }>("SELECT count(*) AS n FROM optimise_states WHERE user_id = ?", [adminId]))?.n).toBe(1);
  });

  it("a deleted user takes the inputs, decisions and snapshots along", async () => {
    const { admin, member, db, s } = await setup();
    const eero = await member("eero");
    await eero.call("POST", "/api/demo");
    await put(eero, "car_km", 8000);
    await s.finance(eero.id).setState(dismissed("food:takeaway:Wolt"));
    await s.finance(eero.id).putSnapshot("2026-09", { findings: 3 }, DECIDED_AT);
    await put(admin, "car_km", 12000);

    await admin.call("DELETE", `/api/users/${eero.id}`);
    for (const table of ["optimise_inputs", "optimise_states", "optimise_snapshots"]) {
      expect((await db.first<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`, [eero.id]))?.n, table).toBe(0);
    }
    expect((await db.first<{ n: number }>("SELECT count(*) AS n FROM optimise_inputs"))?.n).toBe(1);
  });

  it("the household view counts the shared accounts but takes the viewer's own inputs", async () => {
    const { admin, member, s, adminId } = await setup();
    const eero = await member("eero");
    const accounts: { id: string }[] = (await admin.call("GET", "/api/meta")).body.accounts;
    for (const a of accounts) expect((await admin.call("PUT", `/api/accounts/${a.id}/shares/${eero.id}`)).status).toBe(200);

    // eero has no accounts of his own: his own view is empty, his household view is the admin's accounts
    expect((await s.analysis.get(s, eero.id, "own")).ctx.recurring).toEqual([]);
    const series = (await s.analysis.get(s, eero.id, "household")).ctx.recurring.find((r) => r.active && r.kind === "subscription")!.id;

    // a quote for a series of a shared account belongs to eero's inputs, and only the household view knows the series
    expect((await put(eero, `insurance_quote:${series}`, 45000)).status).toBe(400);
    expect((await put(eero, `insurance_quote:${series}`, 45000, "?scope=household")).body.inputs).toHaveLength(1);
    expect(await inputsOf(s, adminId)).toEqual([]);
    expect(await inputsOf(s, eero.id)).toHaveLength(1);
  });
});

describe("decisions follow a merchant whose name is derived again", () => {
  const states = async (s: Services, userId: string) => (await statesOf(s, userId)).sort();
  const seed = (s: Services, userId: string, ids: string[]) => Promise.all(ids.map((findingId) => s.finance(userId).setState(dismissed(findingId))));

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
