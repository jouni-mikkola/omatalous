import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { answerTable, applyLook, pictureOptions, parseArgs, shotName, stepsFunction, USAGE } from "./shots.mjs";
import { BUILT, ROOT } from "./shots-kit.ts";

describe("pnpm shots arguments", () => {
  it("takes a route, widths and --demo, and without more asks for the four widths of a phone to a desktop", () => {
    expect(parseArgs(["overview"])).toEqual({ help: false, routes: ["overview"], widths: [1280, 1000, 700, 390], demo: false, fakeBank: false, answers: null, steps: null, scope: null, name: null, member: false, parts: null, loan: false, look: null });
    expect(parseArgs(["#/reports?tab=income", "--widths", "320,768", "--demo"])).toMatchObject({ routes: ["reports?tab=income"], widths: [320, 768], demo: true });
    expect(parseArgs(["optimise", "--widths=500"]).widths).toEqual([500]);
  });

  it("takes several routes for one run and a route named twice once", () => {
    expect(parseArgs(["overview", "reports?tab=income", "#/overview", "bills"]).routes).toEqual(["overview", "reports?tab=income", "bills"]);
  });

  it("takes --fake-bank, --answers, --steps, --scope and --name, with a space or an =", () => {
    expect(parseArgs(["overview", "--fake-bank", "--answers", "a.mjs", "--steps=s.mjs", "--scope", "household", "--name=joint"])).toMatchObject({
      fakeBank: true,
      answers: "a.mjs",
      steps: "s.mjs",
      scope: "household",
      name: "joint",
    });
    expect(parseArgs(["overview", "--scope=own"]).scope).toBe("own");
  });

  it("takes --member with --fake-bank, the parts of --parts as two whole numbers, and --loan", () => {
    expect(parseArgs(["overview", "--fake-bank", "--member"])).toMatchObject({ member: true, parts: null, loan: false });
    expect(parseArgs(["overview", "--fake-bank", "--member", "--parts", "60:40", "--loan"])).toMatchObject({ member: true, parts: [60, 40], loan: true });
    expect(parseArgs(["overview", "--fake-bank", "--member", "--parts=0:1"]).parts).toEqual([0, 1]);
    expect(parseArgs(["--help", "--member"]).help).toBe(true);
  });

  it("takes --look night or light, with a space or an =, and refuses any other look", () => {
    expect(parseArgs(["overview", "--look", "night"]).look).toBe("night");
    expect(parseArgs(["overview", "--look=light"]).look).toBe("light");
    expect(() => parseArgs(["overview", "--look", "classic"])).toThrow(/--look takes night or light \(got: classic\)/);
    expect(() => parseArgs(["overview", "--look"])).toThrow(/--look takes night or light/);
  });

  it("lists every option in --help, which needs no route", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    for (const option of ["--widths", "--demo", "--fake-bank", "--answers", "--steps", "--scope", "--member", "--parts", "--loan", "--name", "--look"]) expect(USAGE).toContain(option);
    expect(USAGE.split("\n").length).toBeLessThanOrEqual(24);
  });

  it("refuses what is no route, a bad width, an unknown option, a missing route and a bad value", () => {
    expect(() => parseArgs(["../etc/passwd"])).toThrow(/page id/);
    expect(() => parseArgs(["overview", "--widths", "wide"])).toThrow(/pixel widths/);
    expect(() => parseArgs(["overview", "--full"])).toThrow(/unknown option/);
    expect(() => parseArgs(["overview", "--demo=yes"])).toThrow(/unknown option/);
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(["--demo"])).toThrow(/usage/);
    expect(() => parseArgs(["overview", "--scope", "everyone"])).toThrow(/own or household/);
    expect(() => parseArgs(["overview", "--name", "a/b"])).toThrow(/--name takes/);
    expect(() => parseArgs(["overview", "--answers"])).toThrow(/takes the path/);
    expect(() => parseArgs(["overview", "--steps", "--demo"])).toThrow(/takes the path/);
  });

  it("refuses --member without the fake bank, --parts and --loan without a member, and parts that are no parts", () => {
    expect(() => parseArgs(["overview", "--member"])).toThrow(/--member needs --fake-bank/);
    expect(() => parseArgs(["overview", "--demo", "--member"])).toThrow(/--member needs --fake-bank/);
    expect(() => parseArgs(["overview", "--fake-bank", "--parts", "60:40"])).toThrow(/--parts needs --member/);
    expect(() => parseArgs(["overview", "--fake-bank", "--loan"])).toThrow(/--loan needs --member/);
    for (const parts of ["60", "60:", "a:b", "0:0", "60:40:1", "-1:5", "6.5:3", "100000001:1", ""]) {
      expect(() => parseArgs(["overview", "--fake-bank", "--member", "--parts", parts]), `parts ${parts}`).toThrow(/--parts takes two whole numbers/);
    }
  });
});

describe("pnpm shots file names", () => {
  it("keeps the route and the width for the plain case and puts the label of --name between them", () => {
    expect(shotName("overview", null, 390)).toBe("overview-390.png");
    expect(shotName("reports?tab=income", null, 1280)).toBe("reports-tab-income-1280.png");
    expect(shotName("overview", "joint", 390)).toBe("overview-joint-390.png");
    expect(shotName("reports?tab=income", "bank", 700)).toBe("reports-tab-income-bank-700.png");
  });

  it("gives two routes, two widths and two states each a file of their own", () => {
    const shots: [string, string | null][] = [["overview", null], ["overview", "bank"], ["overview?period=year", null], ["settings", null]];
    const names = shots.flatMap(([route, name]) => [390, 700].map((w) => shotName(route, name, w)));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("pnpm shots look", () => {
  it("puts data-look=night on <html> for night and takes the attribute away for light, whether or not it was there", () => {
    const attributes = new Map<string, string>();
    vi.stubGlobal("document", { documentElement: { setAttribute: (k: string, v: string) => attributes.set(k, v), removeAttribute: (k: string) => attributes.delete(k) } });
    try {
      applyLook("night");
      expect([...attributes]).toEqual([["data-look", "night"]]);
      applyLook("night");
      expect([...attributes]).toEqual([["data-look", "night"]]);
      applyLook("light");
      expect([...attributes]).toEqual([]);
      applyLook("light");
      expect([...attributes]).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("pnpm shots picture", () => {
  it("is taken with finite animations run to their end, so a change of look is not caught half way", () => {
    expect(pictureOptions("/x/a.png")).toEqual({ path: "/x/a.png", fullPage: true, animations: "disabled" });
  });
});

describe("pnpm shots modules", () => {
  it("takes the answers of an object of functions on paths of the API and says which part is wrong", () => {
    const change = () => ({});
    expect(answerTable({ default: { "/api/dashboard": change } })).toEqual({ "/api/dashboard": change });
    expect(() => answerTable({})).toThrow(/default export is an object/);
    expect(() => answerTable({ default: [change] })).toThrow(/default export is an object/);
    expect(() => answerTable({ default: { dashboard: change } }, "a.mjs")).toThrow(/a\.mjs: "dashboard" is no path/);
    expect(() => answerTable({ default: { "/api/dashboard?from=2026-01-01": change } })).toThrow(/is no path/);
    expect(() => answerTable({ default: { "/api/dashboard": { totals: 1 } } })).toThrow(/function from the answer/);
  });

  it("takes a failed answer with a status and the server's error body, and a held answer", () => {
    const failed = { fail: { status: 503, body: { error: "Palvelin ei vastaa." } } };
    expect(answerTable({ default: { "/api/dashboard": failed, "/api/meta": { hold: true } } })).toEqual({ "/api/dashboard": failed, "/api/meta": { hold: true } });
    // near misses: a status that is no error, no body, a body that is no object, a hold that is not true
    expect(() => answerTable({ default: { "/api/dashboard": { fail: { status: 200, body: {} } } } })).toThrow(/status from 400 to 599/);
    expect(() => answerTable({ default: { "/api/dashboard": { fail: { status: 600, body: {} } } } })).toThrow(/status from 400 to 599/);
    expect(() => answerTable({ default: { "/api/dashboard": { fail: { status: 500 } } } })).toThrow(/takes the body/);
    expect(() => answerTable({ default: { "/api/dashboard": { fail: { status: 500, body: "x" } } } })).toThrow(/takes the body/);
    expect(() => answerTable({ default: { "/api/dashboard": { hold: false } } })).toThrow(/hold: true/);
    expect(USAGE).toMatch(/fail: \{ status/);
    expect(USAGE).toMatch(/hold: true/);
  });

  it("takes a function as the steps and refuses anything else", () => {
    const run = async () => {};
    expect(stepsFunction({ default: run })).toBe(run);
    expect(() => stepsFunction({ default: { run } })).toThrow(/default export is a function/);
    expect(() => stepsFunction({})).toThrow(/default export is a function/);
  });
});

// needs the build that pnpm shots otherwise makes, so it is skipped on a fresh clone
describe.skipIf(!BUILT)("pnpm shots cleans up", () => {
  const tmp = mkdtempSync(join(tmpdir(), "shots-test-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const env = (chrome: string) => ({ ...process.env, TMPDIR: tmp, SHOTS_DIR: join(tmp, "out"), E2E_CHROMIUM: chrome });
  const left = () => readdirSync(tmp).filter((f) => f.startsWith("banking-e2e-"));

  it("removes the server's data when the browser does not start", () => {
    const r = spawnSync(process.execPath, ["tools/shots.mjs", "overview"], { cwd: ROOT, env: env("/nonexistent/chrome"), encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(left()).toEqual([]);
  }, 60_000);

  it("removes it and exits on SIGTERM while the browser is still starting", async () => {
    const hang = join(tmp, "hang");
    writeFileSync(hang, "#!/bin/sh\nexec sleep 20\n");
    chmodSync(hang, 0o755);
    const child = spawn(process.execPath, ["tools/shots.mjs", "overview"], { cwd: ROOT, env: env(hang), stdio: "ignore" });
    const exit = new Promise<number | null>((ok) => child.on("exit", (code) => ok(code)));
    for (let i = 0; i < 100 && left().length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    expect(left().length, "the server started").toBe(1);
    child.kill("SIGTERM");
    expect(await exit).toBe(143);
    expect(left()).toEqual([]);
  }, 60_000);
});
