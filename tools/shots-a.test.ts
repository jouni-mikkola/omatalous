import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tempDir } from "./lib/tmp-kit.ts";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allRoutes, answerTable, onlySlug, partName, pictureOptions, parseArgs, shotName, stepsFunction, USAGE } from "./shots.mjs";
import { BUILT, NO_TYPES, ROOT } from "./shots-kit.ts";
import { QUESTIONS } from "../packages/core/src/reports/index.ts";
import { NAV } from "../apps/web/src/nav.ts";
import { SETTINGS_TARGETS } from "../apps/web/src/routes.ts";

describe("pnpm shots arguments", () => {
  it("takes a route, widths and --demo, and without more asks for the four widths of a phone to a desktop", () => {
    expect(parseArgs(["overview"])).toEqual({ help: false, routes: ["overview"], widths: [1280, 1000, 700, 390], demo: false, demoYears: false, fakeBank: false, answers: null, steps: null, scope: null, name: null, member: false, parts: null, loan: false, only: null });
    expect(parseArgs(["#/reports?q=tulot", "--widths", "320,768", "--demo"])).toMatchObject({ routes: ["reports?q=tulot"], widths: [320, 768], demo: true });
    expect(parseArgs(["optimise", "--widths=500"]).widths).toEqual([500]);
    expect(parseArgs(["reports", "--demo", "--demo-years"])).toMatchObject({ demo: true, demoYears: true });
  });

  it("takes several routes for one run and a route named twice once", () => {
    expect(parseArgs(["overview", "reports?q=tulot", "#/overview", "bills"]).routes).toEqual(["overview", "reports?q=tulot", "bills"]);
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

  it("takes --all for every page, each question of Raportit and each target of Asetukset, beside the routes named and none twice", async () => {
    // the lists are the app's own, so a page added to one of them is expected here without a change to this test
    const all = await allRoutes();
    for (const entry of NAV) if (entry.id !== "reports") expect(all).toContain(entry.id);
    for (const q of QUESTIONS) expect(all).toContain(`reports?q=${q}`);
    for (const target of SETTINGS_TARGETS) expect(all).toContain(`settings/${target.id}`);
    expect(all).not.toContain("reports");
    expect(all).toHaveLength(NAV.length - 1 + QUESTIONS.length + SETTINGS_TARGETS.length);
    expect(new Set(all).size).toBe(all.length);
    expect(parseArgs(["--all"], all).routes).toEqual(all);
    const mixed = parseArgs(["bills", "optimise", "--all", "bills", "loans"], all).routes;
    expect(mixed).toEqual(["bills", "optimise", ...all.filter((r) => r !== "bills"), "loans"]);
    // every page of --all is a route the tool takes by name too
    expect(parseArgs(all).routes).toEqual(all);
  });

  it.skipIf(NO_TYPES)("reads the page list of --all with node itself, as pnpm shots runs", async () => {
    // pnpm shots is plain node: the app's sources must load there too, not only under vitest
    const r = spawnSync(process.execPath, ["-e", 'import("./tools/shots.mjs").then(async (m) => console.log(JSON.stringify(await m.allRoutes())))'], { cwd: ROOT, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual(await allRoutes());
  });

  it("takes a target of Asetukset as a route and refuses any other /", () => {
    expect(parseArgs(["settings/server", "#/settings/banks?add=1"]).routes).toEqual(["settings/server", "settings/banks?add=1"]);
    for (const route of ["settings/../x", "settings/", "settings/banks/x", "reports/tulot", "overview?a=/b"]) expect(() => parseArgs([route]), route).toThrow(/page id/);
  });

  it("lists every option in --help, which needs no route", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(USAGE.split("\n").filter((line) => line.includes("--all"))).toHaveLength(1);
    for (const option of ["--all", "--widths", "--demo", "--demo-years", "--fake-bank", "--answers", "--steps", "--scope", "--member", "--parts", "--loan", "--name", "--only"]) expect(USAGE).toContain(option);
    expect(USAGE.split("\n").length).toBeLessThanOrEqual(26);
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
  it("names a part picture after --name, else after a slug of --only", () => {
    expect(parseArgs(["overview", "--only", "Säännöt"]).only).toBe("Säännöt");
    expect(() => parseArgs(["overview", "--only"])).toThrow(/--only takes/);
    expect(onlySlug("Säännöt")).toBe("säännöt");
    expect(onlySlug("#saannot > .card")).toBe("saannot-card");
    expect(shotName("transactions", onlySlug("Säännöt"), 1000)).toBe("transactions-säännöt-1000.png");
  });

  it("leaves the whole page and the part of --only under two names, with or without --name", () => {
    expect(shotName("overview", "menu", 390)).toBe("overview-menu-390.png");
    expect(partName("overview", "menu", ".user-menu", 390)).toBe("overview-menu-user-menu-390.png");
    expect(partName("transactions", null, "Säännöt", 1000)).toBe("transactions-säännöt-1000.png");
    expect(partName("overview", "menu", "menu", 390)).not.toBe(shotName("overview", "menu", 390));
  });

  it("keeps the route and the width for the plain case and puts the label of --name between them", () => {
    expect(shotName("overview", null, 390)).toBe("overview-390.png");
    expect(shotName("reports?q=tulot", null, 1280)).toBe("reports-q-tulot-1280.png");
    expect(shotName("overview", "joint", 390)).toBe("overview-joint-390.png");
    expect(shotName("reports?q=tulot", "bank", 700)).toBe("reports-q-tulot-bank-700.png");
    expect(shotName("settings/server", null, 390)).toBe("settings-server-390.png");
  });

  it("has no / in a file name and a file of its own for every page of --all", async () => {
    const names = (await allRoutes()).map((route) => shotName(route, null, 390));
    for (const name of names) expect(name).not.toContain("/");
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives two routes, two widths and two states each a file of their own", () => {
    const shots: [string, string | null][] = [["overview", null], ["overview", "bank"], ["overview?period=year", null], ["settings", null]];
    const names = shots.flatMap(([route, name]) => [390, 700].map((w) => shotName(route, name, w)));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("pnpm shots picture", () => {
  it("is taken with finite animations run to their end, so a fade is not caught half way", () => {
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
describe.skipIf(!BUILT || NO_TYPES)("pnpm shots cleans up", () => {
  const tmp = tempDir("shots-test-");
  const env = (chrome: string) => ({ ...process.env, TMPDIR: tmp, SHOTS_DIR: join(tmp, "out"), E2E_CHROMIUM: chrome });
  const left = () => readdirSync(tmp).filter((f) => f.startsWith("banking-e2e-"));

  it("removes the server's data when the browser does not start", () => {
    const r = spawnSync(process.execPath, ["tools/shots.mjs", "overview"], { cwd: ROOT, env: env("/nonexistent/chrome"), encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(left()).toEqual([]);
  }, 60_000);

  it("removes it and exits on SIGTERM while the browser is still starting", async () => {
    // The stub browser marks that it runs. The signal goes only then: the server's handler is in place before the
    // browser starts, while a signal sent as soon as the data folder shows can come before it on a loaded machine
    // (the default action then ends the process with no exit code).
    const hang = join(tmp, "hang");
    const started = join(tmp, "browser-started");
    writeFileSync(hang, `#!/bin/sh\n: >'${started}'\nexec sleep 20\n`);
    chmodSync(hang, 0o755);
    const child = spawn(process.execPath, ["tools/shots.mjs", "overview"], { cwd: ROOT, env: env(hang), stdio: "ignore" });
    let ended = false;
    const exit = new Promise<number | null>((ok) => child.on("exit", (code) => ((ended = true), ok(code))));
    while (!ended && !existsSync(started)) await new Promise((r) => setTimeout(r, 50));
    expect(ended, "shots ended before the browser started").toBe(false);
    expect(left().length, "the server started").toBe(1);
    child.kill("SIGTERM");
    expect(await exit).toBe(143);
    expect(left()).toEqual([]);
  }, 60_000);
});
