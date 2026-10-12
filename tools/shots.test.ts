import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { afterAll, describe, expect, it, vi } from "vitest";
import { answerTable, applyLook, parseArgs, shotName, stepsFunction, USAGE } from "./shots.mjs";

const ROOT = join(import.meta.dirname, "..");

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

  it("takes --look classic or c, with a space or an =, and refuses any other look", () => {
    expect(parseArgs(["overview", "--look", "classic"]).look).toBe("classic");
    expect(parseArgs(["overview", "--look=c"]).look).toBe("c");
    expect(() => parseArgs(["overview", "--look", "night"])).toThrow(/--look takes classic or c \(got: night\)/);
    expect(() => parseArgs(["overview", "--look"])).toThrow(/--look takes classic or c/);
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
  it("puts data-look=classic on <html> for classic and takes the attribute away for c, whether or not it was there", () => {
    const attributes = new Map<string, string>();
    vi.stubGlobal("document", { documentElement: { setAttribute: (k: string, v: string) => attributes.set(k, v), removeAttribute: (k: string) => attributes.delete(k) } });
    try {
      applyLook("classic");
      expect([...attributes]).toEqual([["data-look", "classic"]]);
      applyLook("classic");
      expect([...attributes]).toEqual([["data-look", "classic"]]);
      applyLook("c");
      expect([...attributes]).toEqual([]);
      applyLook("c");
      expect([...attributes]).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("takes a function as the steps and refuses anything else", () => {
    const run = async () => {};
    expect(stepsFunction({ default: run })).toBe(run);
    expect(() => stepsFunction({ default: { run } })).toThrow(/default export is a function/);
    expect(() => stepsFunction({})).toThrow(/default export is a function/);
  });
});

const BUILT = existsSync(join(ROOT, "apps/server/dist/node.js"));

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

// real runs: the built app, a Chromium, and what a step module saw of the page before the picture
describe.skipIf(!BUILT || !existsSync(process.env.E2E_CHROMIUM ?? chromium.executablePath()))("pnpm shots shows a state", () => {
  const tmp = mkdtempSync(join(tmpdir(), "shots-test-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const probe = join(tmp, "probe.jsonl");
  const out = join(tmp, "out");
  // saves what the page knows when the step runs: its address, its width, the accounts of the household and the browser's storage
  const steps = join(tmp, "steps.mjs");
  writeFileSync(
    steps,
    `import { appendFileSync } from "node:fs";
export default async (page, route) => {
  const seen = await page.evaluate(async () => ({
    accounts: (await (await fetch("/api/meta")).json()).accounts.map((a) => ({ name: a.name, holder: a.holder, limit: a.creditLimitCents })),
    storage: Object.fromEntries(Object.entries(localStorage)),
    heading: document.querySelector("h1")?.textContent,
    look: document.documentElement.getAttribute("data-look"),
  }));
  const meta = await page.evaluate(async () => (await (await fetch("/api/meta")).json()));
  const joint = meta.accounts.find((a) => a.name === "Yhteistili");
  const loans = (await page.evaluate(async () => (await (await fetch("/api/dashboard")).json()))).holdings.loans;
  Object.assign(seen, {
    members: meta.members.map((m) => m.displayName),
    jointUse: joint?.use && { source: joint.use.source, users: joint.use.users.map((u) => [u.label, u.weight]) },
    jointPart: joint?.part,
    switchShown: await page.getByRole("button", { name: "Koko talous", exact: true }).count(),
    jointRow: await page.evaluate(() => document.body.innerText.match(/osuutesi \\d+\\s%/)?.[0].replace(/\\s/g, " ") ?? null),
    loans: loans.map((l) => [l.name, l.typedBy ?? null]),
  });
  appendFileSync(${JSON.stringify(probe)}, JSON.stringify({ route, width: page.viewportSize().width, url: page.url(), ...seen }) + "\\n");
};
`,
  );
  const seen = () => (existsSync(probe) ? readFileSync(probe, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  const run = (...args: string[]) => {
    rmSync(probe, { force: true });
    const r = spawnSync(process.execPath, ["tools/shots.mjs", ...args], { cwd: ROOT, env: { ...process.env, TMPDIR: tmp, SHOTS_DIR: out }, encoding: "utf8" });
    expect(readdirSync(tmp).filter((f) => f.startsWith("banking-e2e-")), "the server's data is gone").toEqual([]);
    return r;
  };

  it("links the fake bank: its joint account with both holders and its card with a limit are in the household", () => {
    const r = run("overview", "--fake-bank", "--widths", "390", "--steps", steps, "--name", "bank");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(existsSync(join(out, "overview-bank-390.png"))).toBe(true);
    const [one] = seen();
    expect(one.accounts.map((a: { name: string }) => a.name).sort()).toEqual(["ESIMERKKIPANKKI Luottokortti", "Käyttötili", "Säästötili", "Yhteistili"]);
    expect(one.accounts.find((a: { name: string }) => a.name === "Yhteistili").holder).toBe("MEIKALAINEN MATTI, KORHONEN ELISA");
    expect(one.accounts.find((a: { name: string }) => a.name.includes("Luottokortti")).limit).toBe(300_000);
    // one member: nobody else uses the joint account as a member does
    expect(one.members).toEqual(["Shots"]);
    expect(one.loans).toEqual([]);
  }, 120_000);

  it("--member: a second member links the bank too, so both members use the joint account, the switch of the view shows and the bank's own answer stands", () => {
    const r = run("overview", "--fake-bank", "--member", "--widths", "390", "--steps", steps, "--scope", "household", "--name", "member");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const [one] = seen();
    expect([...one.members].sort()).toEqual(["Eero", "Shots"]);
    // the bank's holders: both members hold as the one name their other accounts carry, and the second holder is no member
    expect(one.jointUse.source).toBe("bank");
    expect(one.jointUse.users.map(([label]: [string]) => label).sort()).toEqual(["Eero", "KORHONEN ELISA", "Shots"]);
    expect(new Set(one.jointUse.users.map(([, weight]: [string, number]) => weight)).size, "a share each").toBe(1);
    expect(one.switchShown).toBe(1);
    expect(one.loans).toEqual([]);
  }, 180_000);

  it("--parts: the first member says the joint account's use, so the first page says the part, and --loan saves a loan the second member typed in", () => {
    const r = run("overview", "--fake-bank", "--member", "--parts", "60:40", "--loan", "--widths", "390", "--steps", steps, "--name", "parts");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const [one] = seen();
    // the users stand in the order of their ids, which the server makes up: by name here
    expect({ ...one.jointUse, users: [...one.jointUse.users].sort(([a]: [string], [b]: [string]) => a.localeCompare(b)) }).toEqual({ source: "said", users: [["Eero", 4000], ["Shots", 6000]] });
    expect((one.jointPart.to - one.jointPart.from) / one.jointPart.of).toBe(0.6);
    expect(one.jointRow).toBe("osuutesi 60 %");
    // the loan is the second member's: the first member's view holds it, with the name of who typed it
    expect(one.loans).toEqual([["Asuntolaina", "Eero"]]);
  }, 180_000);

  it("holds the demo household alone, and with --demo the bank's accounts come on top of it", () => {
    const alone = run("overview", "--demo", "--widths", "390", "--steps", steps);
    expect(alone.status, alone.stdout + alone.stderr).toBe(0);
    const demo = seen()[0].accounts.map((a: { name: string }) => a.name);
    expect(demo).not.toContain("Yhteistili");
    const both = run("overview", "--demo", "--fake-bank", "--widths", "390", "--steps", steps, "--name", "both");
    expect(both.status, both.stdout + both.stderr).toBe(0);
    expect(seen()[0].accounts.map((a: { name: string }) => a.name)).toEqual(expect.arrayContaining([...demo, "Yhteistili"]));
  }, 180_000);

  it("shows the answer an --answers module gives and fails for a path nothing asked for", () => {
    const answers = join(tmp, "answers.mjs");
    writeFileSync(answers, `export default { "/api/meta": (meta) => ({ ...meta, accounts: meta.accounts.slice(0, 1).map((a) => ({ ...a, name: "ESIMERKKI TILI" })) }) };\n`);
    const shown = run("overview", "--demo", "--widths", "390", "--answers", answers, "--steps", steps);
    expect(shown.status, shown.stdout + shown.stderr).toBe(0);
    expect(seen()[0].accounts).toEqual([expect.objectContaining({ name: "ESIMERKKI TILI" })]);

    writeFileSync(answers, `export default { "/api/dashboard": (d) => d, "/api/not-there": (d) => d };\n`);
    const lost = run("overview", "--demo", "--widths", "390", "--answers", answers);
    expect(lost.status).toBe(1);
    expect(lost.stdout).toContain("/api/not-there");
    expect(lost.stdout).not.toMatch(/answer for .*\/api\/dashboard/);
  }, 180_000);

  it("runs the steps for every route and width after the page has loaded, and sets the scope before it loads", () => {
    const r = run("overview", "settings", "--demo", "--widths", "700,390", "--steps", steps, "--scope", "household", "--name", "s");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(seen().map((s) => [s.route, s.width])).toEqual([["overview", 700], ["overview", 390], ["settings", 700], ["settings", 390]]);
    expect(seen().every((s) => s.url.endsWith(`#/${s.route}`) && s.heading)).toBe(true);
    expect(Object.entries(seen()[0].storage).filter(([key]) => key.startsWith("scope:"))).toEqual([[expect.stringMatching(/^scope:/), "household"]]);
    expect(readdirSync(out).filter((f) => f.includes("-s-")).sort()).toEqual(["overview-s-390.png", "overview-s-700.png", "settings-s-390.png", "settings-s-700.png"]);
  }, 180_000);

  it("takes no step and no answer unless it is asked to, and leaves the plain names as they were", () => {
    const r = run("overview", "--demo", "--widths", "390");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(seen()).toEqual([]);
    expect(existsSync(join(out, "overview-390.png"))).toBe(true);
  }, 120_000);

  it("--look c takes the attribute of <html> away and --look classic puts it there, before the steps run; without it the page is as index.html serves it", () => {
    const served = /<html\b[^>]*\sdata-look="([a-z]+)"/.exec(readFileSync(join(ROOT, "apps/web/index.html"), "utf8"))?.[1] ?? null;
    const looks = (...args: string[]) => {
      const r = run("overview", "--widths", "390", "--steps", steps, "--name", "look", ...args);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      return seen().map((s) => s.look);
    };
    expect(looks("--look", "c")).toEqual([null]);
    expect(looks("--look", "classic")).toEqual(["classic"]);
    expect(looks()).toEqual([served]);
  }, 300_000);
});
