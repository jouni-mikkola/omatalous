import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV } from "../../apps/web/src/nav.ts";
import { IMAGES, PICTURES } from "../docs-shots.mjs";
import { FILES as VIDEO, MAX_BYTES as VIDEO_MAX, SCENES } from "../readme-video.mjs";

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
    const ours = new Set([...(PICTURES as { file: string }[]).map((p) => p.file), ...Object.values(VIDEO)]);
    expect(readdirSync(IMAGES).filter((f) => !ours.has(f))).toEqual([]);
    expect(named(ROOT).filter((f) => !ours.has(f))).toEqual([]);
  });

  it("the README starts with the video and a still for reduced motion, both made by readme:video, under the cap", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const picture = /<picture>[\s\S]*?<\/picture>/.exec(readme)?.[0] ?? "";
    expect(readme.indexOf("<picture>")).toBeLessThan(readme.indexOf("![Nyt"));
    expect(picture).toContain(`media="(prefers-reduced-motion: reduce)" srcset="docs/images/${VIDEO.still}"`);
    expect(picture).toMatch(new RegExp(`<img src="docs/images/${VIDEO.video}" alt="[^"]{20,}"`));
    expect(statSync(join(IMAGES, VIDEO.video)).size).toBeLessThan(VIDEO_MAX);
  });

  // The README shows the app a visitor installs today: a page the tabs no longer have is a stale picture.
  it("the README names every tab and shows a picture of it at 1440 px", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const pictures = PICTURES as { file: string; route: string; width: number }[];
    for (const tab of NAV) {
      expect(readme, tab.label).toContain(`- ${tab.label} (`);
      const shown = pictures.filter((p) => p.route === tab.id && p.width === 1440).map((p) => p.file);
      expect(shown.some((f) => readme.includes(`docs/images/${f}`)), tab.id).toBe(true);
    }
  });

  it("every scene of the README video is a tab or the rows list, and every tab has a scene", () => {
    const routes = (SCENES as { route: string }[]).map((s) => s.route);
    for (const r of routes) expect([...NAV.map((n) => n.id), "transactions"]).toContain(r);
    for (const tab of NAV) expect(routes, tab.id).toContain(tab.id);
  });
});
