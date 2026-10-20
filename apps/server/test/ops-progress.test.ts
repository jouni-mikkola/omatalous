/**
 * `ops progress` (the helper tells the app each step while an action runs) and the STEP-AT lines of the report: the
 * step is checked by the report's own parser, written only onto a request that is running, and the report keeps it.
 */
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.ts";
import { parseSteps } from "../src/services/ops-validate.ts";
import { setupApp } from "./helpers.ts";

const PASSWORD = "aino-salasana-123";

/** Runs the ops CLI the way the helper does and returns the one JSON line it prints. */
async function cli(s: Awaited<ReturnType<typeof setupApp>>["s"], args: string[], stdin = "") {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(m));
  try {
    expect(await runCli(s, ["ops", ...args], { readStdin: async () => stdin })).toBe(0);
  } finally {
    spy.mockRestore();
  }
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!);
}
const helperOn = (s: Awaited<ReturnType<typeof setupApp>>["s"], version = "2") => cli(s, ["state", "--helper", version], "{}");

describe("ops: progress", () => {
  type S = Awaited<ReturnType<typeof setupApp>>["s"];
  /** `ops progress` with the given stdin: its exit code and the one JSON line. */
  async function progress(s: S, stdin: string) {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((m: string) => void lines.push(m));
    try {
      const code = await runCli(s, ["ops", "progress", "--helper", "5"], { readStdin: async () => stdin });
      return { code, out: lines.length ? JSON.parse(lines[0]!) : null };
    } finally {
      spy.mockRestore();
    }
  }
  const step = (id: string, n: number, m: number, text: string) => JSON.stringify({ id, step: { n, m, text } });
  async function running(action = "update") {
    const app = await setupApp();
    await helperOn(app.s, "5");
    const id = (await app.admin.call("POST", "/api/ops/request", { action, password: PASSWORD })).body.request.id as string;
    await cli(app.s, ["poll", "--helper", "5", "--done", ""]);
    return { ...app, id };
  }
  const stored = async (s: S, id: string) => JSON.parse((await s.ops.get(id))!.steps ?? "[]") as { n: number; m: number; text: string; at?: number }[];

  it("stores a step on a running request, with the seconds since it was taken, and writes nothing else", async () => {
    const { s, id } = await running();
    const before = await s.ops.get(id);
    expect(await progress(s, step(id, 2, 4, "Haetaan ja vaihdetaan versio"))).toEqual({ code: 0, out: { ok: true } });
    expect(await progress(s, step(id, 3, 4, "Tarkistetaan että sovellus vastaa"))).toEqual({ code: 0, out: { ok: true } });
    const steps = await stored(s, id);
    expect(steps.map((x) => `${x.n}/${x.m} ${x.text}`)).toEqual(["2/4 Haetaan ja vaihdetaan versio", "3/4 Tarkistetaan että sovellus vastaa"]);
    expect(steps[0]!.at).toBeGreaterThanOrEqual(0);
    const after = (await s.ops.get(id))!;
    expect({ ...after, steps: null }).toEqual({ ...before!, steps: null });
  });

  it("refuses an unknown id, a queued request and a finished one, and writes nothing", async () => {
    const { s, admin, id } = await running();
    expect(await progress(s, step("op_0123456789abcdef", 1, 2, "x"))).toMatchObject({ code: 1, out: { ok: false } });
    const queuedId = (await admin.call("POST", "/api/ops/request", { action: "check-update" })).body.request.id as string;
    expect((await s.ops.get(queuedId))!.status).toBe("queued");
    expect(await progress(s, step(queuedId, 1, 2, "x"))).toMatchObject({ code: 1, out: { ok: false } });
    expect(await stored(s, queuedId)).toEqual([]);
    await cli(s, ["report"], JSON.stringify({ id, status: "ok", exit_code: 0, summary: "Valmis.", output: "STEP: 1/2 Yksi" }));
    expect(await progress(s, step(id, 2, 2, "Kaksi"))).toMatchObject({ code: 1, out: { ok: false } });
    expect((await stored(s, id)).map((x) => x.text)).toEqual(["Yksi"]);
  });

  it("refuses malformed JSON, an empty stdin and a step of the wrong shape", async () => {
    const { s, id } = await running();
    const withStep = (stepValue: unknown, extra: object = {}) => JSON.stringify({ id, step: stepValue, ...extra });
    const bad = [
      "{not json", "", "[]", "null", JSON.stringify({ id }),
      withStep({ n: 1, m: 2 }), withStep({ n: "1", m: 2, text: "x" }), withStep({ n: 1.5, m: 2, text: "x" }),
      withStep({ n: 1, m: 2, text: "x", at: 5 }), withStep({ n: 1, m: 2, text: "a\nb" }), withStep({ n: 100, m: 2, text: "x" }),
      withStep({ n: 1, m: 2, text: "" }), withStep({ n: 1, m: 2, text: "x" }, { extra: 1 }),
      JSON.stringify({ id: "op_x", step: { n: 1, m: 2, text: "x" } }),
    ];
    for (const text of bad) expect(await progress(s, text), text).toMatchObject({ code: 1 });
    expect(await stored(s, id)).toEqual([]);
  });

  it("keeps the report's cap both ways: 100 characters stay, 101 are refused, and the report keeps the same text", async () => {
    const { s, id } = await running();
    const hundred = "ä".repeat(100);
    expect(await progress(s, step(id, 1, 3, hundred))).toMatchObject({ code: 0 });
    expect(await progress(s, step(id, 2, 3, `${hundred}x`))).toMatchObject({ code: 1 });
    // the check of `ops progress` is the report's own parser: it takes the 100 and drops the 101
    expect(parseSteps(`STEP: 1/3 ${hundred}\nSTEP: 2/3 ${hundred}x\n`).map((x) => x.text)).toEqual([hundred]);
    expect((await stored(s, id)).map((x) => x.text)).toEqual([hundred]);
    await cli(s, ["report"], JSON.stringify({ id, status: "ok", exit_code: 0, summary: "Valmis.", output: `STEP: 1/3 ${hundred}\nSTEP-AT: 1/3 7\n` }));
    expect(await stored(s, id)).toEqual([{ n: 1, m: 3, text: hundred, at: 7 }]);
  });

  it("takes 20 steps and refuses the 21st", async () => {
    const { s, id } = await running();
    for (let i = 1; i <= 20; i++) expect(await progress(s, step(id, i, 25, `Vaihe ${i}`)), String(i)).toMatchObject({ code: 0 });
    expect(await progress(s, step(id, 21, 25, "Vaihe 21"))).toMatchObject({ code: 1, out: { ok: false } });
    expect(await stored(s, id)).toHaveLength(20);
  });

  it("keeps a hostile text as plain text and the view carries the start time", async () => {
    const { s, admin, id } = await running();
    await progress(s, step(id, 1, 3, "<img src=x onerror=alert(1)>"));
    await progress(s, step(id, 2, 3, "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789"));
    const [first, second] = await stored(s, id);
    const text = first!.text;
    expect(text).toBe("<img src=x onerror=alert(1)>");
    expect(second!.text).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    const view = (await admin.call("GET", "/api/ops/state")).body.requests[0];
    expect(view.steps[0].text).toBe(text);
    expect(view.startedAt).toBeTruthy();
  });

  it("an unknown command is the usage line and exit 1 (what an older server does for `ops progress`)", async () => {
    const { s } = await running();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runCli(s, ["ops", "nothing"], { readStdin: async () => "" })).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("ops: STEP-AT lines", () => {
  it("pairs a STEP-AT line with the step before it", () => {
    expect(parseSteps("STEP: 1/2 Yksi\nSTEP-AT: 1/2 0\nnoise\nSTEP: 2/2 Kaksi\nSTEP-AT: 2/2 12\n")).toEqual([
      { n: 1, m: 2, text: "Yksi", at: 0 },
      { n: 2, m: 2, text: "Kaksi", at: 12 },
    ]);
  });
  it("leaves `at` out where the line is missing or malformed", () => {
    expect(parseSteps("STEP: 1/2 Yksi\nSTEP: 2/2 Kaksi\n")).toEqual([{ n: 1, m: 2, text: "Yksi" }, { n: 2, m: 2, text: "Kaksi" }]);
    for (const bad of ["STEP-AT: 1/2 x", "STEP-AT: 1/2", "STEP-AT: 1/2 -3", "STEP-AT: 1/2 12 13", "STEP-AT 1/2 12", "STEP-AT: 1/2 1234567"]) {
      expect(parseSteps(`STEP: 1/2 Yksi\n${bad}\n`), bad).toEqual([{ n: 1, m: 2, text: "Yksi" }]);
    }
  });
  it("ignores a STEP-AT that does not match its step, is not right after it, or comes twice", () => {
    expect(parseSteps("STEP: 1/2 Yksi\nSTEP-AT: 2/2 5\n")).toEqual([{ n: 1, m: 2, text: "Yksi" }]);
    expect(parseSteps("STEP: 1/2 Yksi\nSTEP-AT: 1/3 5\n")).toEqual([{ n: 1, m: 2, text: "Yksi" }]);
    expect(parseSteps("STEP: 1/2 Yksi\nnoise\nSTEP-AT: 1/2 5\n")).toEqual([{ n: 1, m: 2, text: "Yksi" }]);
    expect(parseSteps("STEP-AT: 1/2 5\nSTEP: 1/2 Yksi\n")).toEqual([{ n: 1, m: 2, text: "Yksi" }]);
    expect(parseSteps("STEP: 1/2 Yksi\nSTEP-AT: 1/2 5\nSTEP-AT: 1/2 9\n")).toEqual([{ n: 1, m: 2, text: "Yksi", at: 5 }]);
  });
  it("keeps the seconds out of a step's text", () => {
    expect(parseSteps("STEP: 2/4 Haetaan\nSTEP-AT: 2/4 12\n").map((x) => x.text)).toEqual(["Haetaan"]);
  });
});
