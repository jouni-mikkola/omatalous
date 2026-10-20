import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_BROWSER, ROOT, stateKit } from "./shots-kit.ts";

// real runs: the built app, a Chromium, and what a step module saw of the page before the picture
describe.skipIf(NO_BROWSER)("pnpm shots shows a state", () => {
  const { tmp, out, steps, seen, run } = stateKit();

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

  it("a failed answer gives the page the server's error, and a held answer leaves it loading without waiting for it to go quiet", () => {
    const answers = join(tmp, "answers-fail.mjs");
    const text = join(tmp, "text.txt");
    const look = join(tmp, "steps-text.mjs");
    writeFileSync(look, `import { writeFileSync } from "node:fs";\nexport default async (page) => writeFileSync(${JSON.stringify(text)}, await page.locator("body").innerText());\n`);
    writeFileSync(answers, `export default { "/api/dashboard": { fail: { status: 500, body: { error: "Esimerkkivirhe." } } } };\n`);
    const failed = run("overview", "--demo", "--widths", "390", "--answers", answers, "--steps", look);
    expect(failed.status, failed.stdout + failed.stderr).toBe(0);
    expect(readFileSync(text, "utf8")).toContain("Esimerkkivirhe.");

    writeFileSync(answers, `export default { "/api/dashboard": { hold: true } };\n`);
    const held = run("overview", "--demo", "--widths", "390", "--answers", answers, "--steps", look);
    expect(held.status, held.stdout + held.stderr).toBe(0);
    expect(readFileSync(text, "utf8")).not.toMatch(/Esimerkkivirhe|epäonnistui/);
  }, 180_000);

  it("runs the steps for every route and width after the page has loaded, and sets the scope before it loads", () => {
    const r = run("overview", "settings", "--demo", "--widths", "700,390", "--steps", steps, "--scope", "household", "--name", "s");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(seen().map((s) => [s.route, s.width])).toEqual([["overview", 700], ["overview", 390], ["settings", 700], ["settings", 390]]);
    expect(seen().every((s) => s.url.endsWith(`#/${s.route}`) && s.heading)).toBe(true);
    expect(Object.entries(seen()[0].storage).filter(([key]) => key.startsWith("scope:"))).toEqual([[expect.stringMatching(/^scope:/), "household"]]);
    expect(readdirSync(out).filter((f) => f.includes("-s-")).sort()).toEqual(["overview-s-390.png", "overview-s-700.png", "settings-s-390.png", "settings-s-700.png"]);
  }, 180_000);

  it("--look light takes the attribute of <html> away and --look night puts it there, before the steps run; without it the page is as index.html serves it", () => {
    const served = /<html\b[^>]*\sdata-look="([a-z]+)"/.exec(readFileSync(join(ROOT, "apps/web/index.html"), "utf8"))?.[1] ?? null;
    const looks = (...args: string[]) => {
      const r = run("overview", "--widths", "390", "--steps", steps, "--name", "look", ...args);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      return seen().map((s) => s.look);
    };
    expect(looks("--look", "light")).toEqual([null]);
    expect(looks("--look", "night")).toEqual(["night"]);
    expect(looks()).toEqual([served]);
  }, 300_000);
});
