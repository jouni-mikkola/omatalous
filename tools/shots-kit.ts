/** Helpers of the tests of tools/shots.mjs (shots-a, shots-b and shots-c). */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tempDir } from "./lib/tmp-kit.ts";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { expect } from "vitest";

export const ROOT = join(import.meta.dirname, "..");
export const BUILT = existsSync(join(ROOT, "apps/server/dist/node.js"));
/** shots.mjs imports the TypeScript helpers of e2e/ with node itself, so a node built without TypeScript support (some distribution packages) cannot run it. */
export const NO_TYPES = !process.features.typescript;
/** Real runs need the built app, a Chromium and a node that reads TypeScript. */
export const NO_BROWSER = NO_TYPES || !BUILT || !existsSync(process.env.E2E_CHROMIUM ?? chromium.executablePath());

/** The folder, the step module and the runner of the real runs: call it inside the describe that uses it. */
export function stateKit() {
  // the describe body runs even when the suite is skipped (no browser), and a skipped suite removes nothing
  const tmp = NO_BROWSER ? join(ROOT, "no-browser") : tempDir("shots-test-");
  const probe = join(tmp, "probe.jsonl");
  const out = join(tmp, "out");
  // saves what the page knows when the step runs: its address, its width, the accounts of the household and the browser's storage
  const steps = join(tmp, "steps.mjs");
  if (!NO_BROWSER) writeFileSync(
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
  return { tmp, out, steps, seen, run };
}
