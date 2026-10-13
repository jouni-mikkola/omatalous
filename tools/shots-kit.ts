/** Helpers of the tests of tools/shots.mjs (shots-a, shots-b and shots-c). */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { afterAll, expect } from "vitest";

export const ROOT = join(import.meta.dirname, "..");
export const BUILT = existsSync(join(ROOT, "apps/server/dist/node.js"));
/** Real runs need the built app and a Chromium. */
export const NO_BROWSER = !BUILT || !existsSync(process.env.E2E_CHROMIUM ?? chromium.executablePath());

/** The folder, the step module and the runner of the real runs: call it inside the describe that uses it. */
export function stateKit() {
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
  return { tmp, out, steps, seen, run };
}
