import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMAGES, PICTURES } from "../docs-shots.mjs";
import { FILES as VIDEO, MAX_BYTES as VIDEO_MAX } from "../readme-video.mjs";

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
    const ours = new Set([...(PICTURES as { file: string }[]).map((p) => p.file), ...NOT_OURS, ...Object.values(VIDEO)]);
    expect(named(ROOT).filter((f) => !ours.has(f))).toEqual([]);
  });

  it("the README starts with the video and a still for reduced motion, both made by readme:video, under the cap", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const picture = /<picture>[\s\S]*?<\/picture>/.exec(readme)?.[0] ?? "";
    expect(readme.indexOf("<picture>")).toBeLessThan(readme.indexOf("![Yhteenveto"));
    expect(picture).toContain(`media="(prefers-reduced-motion: reduce)" srcset="docs/images/${VIDEO.still}"`);
    expect(picture).toMatch(new RegExp(`<img src="docs/images/${VIDEO.video}" alt="[^"]{20,}"`));
    expect(statSync(join(IMAGES, VIDEO.video)).size).toBeLessThan(VIDEO_MAX);
  });
});
