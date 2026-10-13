import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMAGES, PICTURES } from "../docs-shots.mjs";

const ROOT = join(import.meta.dirname, "../..");
/** Photographs of an outside site: nobody here makes them. */
const NOT_OURS = ["eb-4-choose-account.png", "eb-5-linked.png"];

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

  it("every picture a document names is made by the script or is on the list of two that are not ours", () => {
    const ours = new Set([...(PICTURES as { file: string }[]).map((p) => p.file), ...NOT_OURS]);
    expect(named(ROOT).filter((f) => !ours.has(f))).toEqual([]);
  });
});
