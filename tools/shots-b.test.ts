import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NO_BROWSER, ROOT, stateKit } from "./shots-kit.ts";

// real runs: the built app, a Chromium, and what a step module saw of the page before the picture
describe.skipIf(NO_BROWSER)("pnpm shots shows a state", () => {
  const { out, steps, seen, run } = stateKit();

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
    expect(one.jointUse.users.map(([label]: [string]) => label).sort()).toEqual(["Eero", "Korhonen Elisa", "Shots"]);
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

  it("takes no step and no answer unless it is asked to, and leaves the plain names as they were", () => {
    const r = run("overview", "--demo", "--widths", "390");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(seen()).toEqual([]);
    expect(existsSync(join(out, "overview-390.png"))).toBe(true);
  }, 120_000);
});
