import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "../../apps/web/src/nav.ts";
import { IMAGES, PICTURES } from "../docs-shots.mjs";

const ROOT = join(import.meta.dirname, "../..");

/** Every picture of docs/images/ that README.md or a docs/*.md names. `root` is where the documents are. */
function named(root: string): string[] {
  const docs = ["README.md", ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)];
  const out = new Set<string>();
  for (const d of docs) {
    if (!existsSync(join(root, d))) continue;
    for (const m of readFileSync(join(root, d), "utf8").matchAll(/images\/([A-Za-z0-9._-]+\.png)/g)) out.add(m[1]!);
  }
  return [...out];
}

describe("docs:shots", () => {
  it("every picture the script lists is in docs/images/", () => {
    for (const p of PICTURES as { file: string }[]) expect(existsSync(join(IMAGES, p.file)), p.file).toBe(true);
  });

  // A photograph of a bank's page or of a real account has no place here, redacted or not: every picture is made from example data.
  it("every picture in docs/images/ and every picture a document names is made by the scripts", () => {
    const ours = new Set((PICTURES as { file: string }[]).map((p) => p.file));
    expect(readdirSync(IMAGES).filter((f) => !ours.has(f))).toEqual([]);
    expect(named(ROOT).filter((f) => !ours.has(f))).toEqual([]);
  });

  // One set: the same household and one window size, with one phone picture beside it.
  it("the pictures are one set: the example household at 1440 x 900, and one phone picture", () => {
    const pictures = PICTURES as { household: string; width: number; height: number }[];
    expect(pictures.every((p) => p.household === "demo")).toBe(true);
    expect(pictures.filter((p) => p.width !== 1440).map((p) => `${p.width}x${p.height}`)).toEqual(["390x844"]);
    expect(pictures.filter((p) => p.width === 1440).every((p) => p.height === 900)).toBe(true);
  });

  it("the README shows every picture of the set, each with a text for a reader who cannot see it", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    for (const p of PICTURES as { file: string }[]) {
      const alt = new RegExp(`!\\[([^\\]]{20,})\\]\\(docs/images/${p.file}\\)|<img src="docs/images/${p.file}" alt="[^"]{20,}"`);
      expect(readme, p.file).toMatch(alt);
    }
  });

  // The README shows the app a visitor installs today: a page the tabs no longer have is a stale picture.
  it("the README names every tab and shows a picture of it at 1440 px", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const pictures = PICTURES as { file: string; route: string; width: number }[];
    for (const tab of NAV) {
      expect(readme, tab.label).toContain(tab.label);
      const shown = pictures.filter((p) => p.route === tab.id && p.width === 1440).map((p) => p.file);
      expect(shown.some((f) => readme.includes(`docs/images/${f}`)), tab.id).toBe(true);
    }
  });
});
