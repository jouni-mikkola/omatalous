import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMAGES, PICTURES } from "../docs-shots.mjs";
import { FILES as FILM } from "../readme-film/film.mjs";

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
    const ours = new Set([...(PICTURES as { file: string }[]).map((p) => p.file), ...Object.values(FILM)]);
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

  // The README is short: the film at the top (readme-film.test.ts) and the phone picture. Each picture it shows has a text for a reader who cannot see it.
  it("the README shows the phone picture with a text for a reader who cannot see it", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const phone = (PICTURES as { file: string; width: number }[]).filter((p) => p.width !== 1440);
    expect(phone).toHaveLength(1);
    const alt = new RegExp(`<img src="docs/images/${phone[0]!.file}" alt="[^"]{20,}"`);
    expect(readme).toMatch(alt);
  });
});
