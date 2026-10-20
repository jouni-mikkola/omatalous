/**
 * The visual regression check (tools/shots-diff.mjs): its options, the pixel rule, the verdict, and a real run on
 * pictures Chromium takes of two small pages.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { DEFAULTS, diffPixels, parseDiffArgs, verdict } from "./shots-diff.mjs";
import { tempDir } from "./lib/tmp-kit.ts";

const ROOT = join(import.meta.dirname, "..");
const NO_CHROMIUM = !existsSync(process.env.E2E_CHROMIUM ?? chromium.executablePath());

describe("pnpm shots:diff options", () => {
  it("takes two folders and the defaults", () => {
    expect(parseDiffArgs(["a", "b"])).toEqual({ help: false, before: "a", after: "b", threshold: DEFAULTS.threshold, tolerance: DEFAULTS.tolerance, out: null });
    expect(parseDiffArgs(["a", "b", "--threshold", "0.01", "--tolerance", "0", "--out", "d"])).toMatchObject({ threshold: 0.01, tolerance: 0, out: "d" });
  });

  it("refuses a share outside 0 to 1, an unknown option and one folder", () => {
    expect(() => parseDiffArgs(["a", "b", "--threshold", "2"])).toThrow(/0 to 1/);
    expect(() => parseDiffArgs(["a", "b", "--fast"])).toThrow(/unknown option/);
    expect(() => parseDiffArgs(["a"])).toThrow(/two folders/);
    expect(parseDiffArgs(["--help"]).help).toBe(true);
  });
});

describe("the pixel rule", () => {
  const px = (...rgba: number[]) => Uint8ClampedArray.from(rgba);

  it("lets a shade of antialiasing pass and counts a moved channel", () => {
    expect(diffPixels(px(100, 100, 100, 255), px(120, 100, 100, 255), 0.1).changed).toBe(0);
    expect(diffPixels(px(100, 100, 100, 255), px(140, 100, 100, 255), 0.1).changed).toBe(1);
    expect(diffPixels(px(0, 0, 0, 255, 0, 0, 0, 255), px(0, 0, 0, 255, 0, 0, 0, 0), 0.1)).toMatchObject({ changed: 1, total: 2 });
    expect([...diffPixels(px(0, 0, 0, 0, 9, 9, 9, 9), px(255, 0, 0, 0, 9, 9, 9, 9), 0).mask]).toEqual([1, 0]);
  });

  it("fails over the threshold, on a new size and on a missing picture, and lists a new one", () => {
    expect(verdict([{ file: "a.png", kind: "same" }, { file: "b.png", kind: "changed", share: 0.001 }], 0.002).ok).toBe(true);
    const v = verdict(
      [
        { file: "a.png", kind: "changed", share: 0.05 },
        { file: "b.png", kind: "size", size: "1x1 before, 1x2 after" },
        { file: "c.png", kind: "missing" },
        { file: "d.png", kind: "new" },
      ],
      0.002,
    );
    expect(v.ok).toBe(false);
    expect(v.lines).toEqual(["CHANGED a.png: 5.00 % of the pixels", "SIZE b.png: 1x1 before, 1x2 after", "MISSING c.png: no picture of that name after", "new d.png: no picture of that name before", "shots:diff: 0 of 3 pictures within 0.20 %"]);
  });
});

describe.skipIf(NO_CHROMIUM)("a real run", () => {
  it("passes the same pictures and fails a moved box with a diff picture", async () => {
    const tmp = tempDir("shots-diff-test-");
    const dirs = ["before", "after", "moved"].map((d) => join(tmp, d));
    for (const d of dirs) mkdirSync(d);
    const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
    try {
      const page = await browser.newPage({ viewport: { width: 200, height: 100 } });
      const box = (left: number) => `<body style="margin:0;background:#eee"><div style="position:absolute;left:${left}px;top:20px;width:40px;height:40px;background:#2f6db5"></div></body>`;
      for (const [d, left] of [[dirs[0]!, 20], [dirs[1]!, 20], [dirs[2]!, 60]] as const) {
        await page.setContent(box(left));
        await page.screenshot({ path: join(d, "page-200.png") });
      }
    } finally {
      await browser.close();
    }
    const run = (after: string) => spawnSync("node", [join(ROOT, "tools/shots-diff.mjs"), dirs[0]!, after, "--out", join(tmp, "diff")], { encoding: "utf8" });
    const same = run(dirs[1]!);
    expect(same.status, same.stdout + same.stderr).toBe(0);
    expect(same.stdout).toContain("1 of 1 pictures within");
    const moved = run(dirs[2]!);
    expect(moved.status, moved.stdout + moved.stderr).toBe(1);
    expect(moved.stdout).toMatch(/CHANGED page-200\.png: \d+\.\d\d %/);
    expect(existsSync(join(tmp, "diff", "page-200.png"))).toBe(true);
  }, 30_000);
});
