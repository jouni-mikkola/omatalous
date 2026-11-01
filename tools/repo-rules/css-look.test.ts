import { describe, expect, it } from "vitest";
import { counts, cssHits, definedProperties, sharedClasses, tsHits } from "./css-look.ts";
import { compare, measure, parseBaseline } from "./css-tokens.ts";

const TOKENS = new Set(["--page", "--pad", "--fs-body"]);
const css = (file: string, text: string) => cssHits(file, text, TOKENS);

describe("css-look: a stylesheet", () => {
  it("finds a px value, a hex colour, a colour function and a font-size literal, with their lines", () => {
    const hits = css("apps/web/src/styles/x.css", ".a {\n  padding: 12px;\n  color: #fff;\n  background: oklch(0.5 0 0);\n  font-size: 15px;\n}");
    expect(hits.map((h) => [h.line, h.metric])).toEqual([[2, "px"], [3, "color"], [4, "color"], [5, "px"], [5, "fontSize"]]);
  });

  it("passes 0, a 1px hairline, tokens, a font-size from the scale, comments, url() and a media query's breakpoint", () => {
    const text = "/* a 12px #fff gap */\n@media (max-width: 600px) { .a { margin: 0 var(--sp-8); border: 1px solid var(--border); font-size: var(--fs-body); background: url(#grad); } }\n.b { font-size: inherit; width: calc(100% - var(--pad)); }";
    expect(css("apps/web/src/styles/x.css", text)).toEqual([]);
  });

  it("finds a literal time in a transition or an animation and passes 0 and tokens", () => {
    const hits = css("apps/web/src/styles/x.css", ".a { transition: opacity 150ms; animation: f 0.15s; animation-delay: var(--d, 0s); transition-duration: var(--t-state); }");
    expect(hits.map((h) => h.metric)).toEqual(["duration", "duration"]);
  });

  it("finds a token set again outside tokens.css", () => {
    expect(css("apps/web/src/styles/x.css", ".a { --pad: 8px; --mine: 1; }").map((h) => h.metric)).toEqual(["redefined", "px"]);
    expect(css("apps/web/src/styles/tokens.css", ":root { --pad: 1; }")).toEqual([]);
  });

  it("leaves the named exception, the drawn card face, and nothing else of holdings.css", () => {
    const text = ".card-face-gold { background: #c8a24a; }\n.holding { margin: 7px; }";
    expect(css("apps/web/src/styles/holdings.css", text).map((h) => h.text)).toEqual(["margin: 7px"]);
    expect(css("apps/web/src/styles/other.css", text)).toHaveLength(2);
  });

  it("reads the properties a sheet defines", () => {
    expect([...definedProperties(":root { --a: 1; } .b { --c-d: 2; color: red; } /* --e: 3 */")]).toEqual(["--a", "--c-d"]);
  });
});

describe("css-look: a script", () => {
  it("finds a colour in a string, a look value in an inline style and setProperty", () => {
    const src = `const a = "#a1b2c3"; const b = "rgb(1 2 3)"; const c = "#/transactions"; const x = <i style={{ background: "red", width: "10%" }} />; el.style.setProperty("--x", "1");`;
    expect(tsHits(src).map((h) => h.metric)).toEqual(["tsColor", "tsColor", "inlineLook", "setProperty"]);
  });
});

describe("css-tokens: the baseline", () => {
  const files = ["apps/web/src/styles/a.css", "apps/web/src/styles/b.css"];
  const read = (f: string) => (f.endsWith("a.css") ? ".a { padding: 12px; margin: 6px; }" : ".b { margin: 4px; }");

  it("fails on a deliberate px value in a file that has none on its line, naming the file and the line", () => {
    const found = compare(measure(files, read, TOKENS), { "apps/web/src/styles/a.css": { px: 2 } }, files);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: "apps/web/src/styles/b.css", line: 1 });
    expect(found[0]!.why).toContain("px: margin: 4px");
  });

  it("fails on a value over its line, and on a line above the file's count, so the list only shrinks", () => {
    const base = { "apps/web/src/styles/a.css": { px: 1 }, "apps/web/src/styles/b.css": { px: 1 } };
    expect(compare(measure(files, read, TOKENS), base, files).map((f) => f.why.split(":")[0])).toEqual(["px"]);
    const wide = { "apps/web/src/styles/a.css": { px: 3 }, "apps/web/src/styles/b.css": { px: 1 } };
    expect(compare(measure(files, read, TOKENS), wide, files)[0]!.why).toContain("lower it to 2");
  });

  it("asks for the line of a file that is gone to be deleted", () => {
    expect(compare(new Map(), { "apps/web/src/styles/gone.css": { px: 1 } }, files)[0]!.why).toContain("is gone");
  });

  it("counts per metric", () => {
    expect(counts(css("apps/web/src/styles/a.css", ".a { margin: 6px; color: #fff; }"))).toEqual({ px: 1, color: 1 });
  });

  it("reads a baseline of one line per file", () => {
    expect(parseBaseline("a.css  px=3 color=1\n\nb.tsx  inlineLook=2\n")).toEqual({ "a.css": { px: 3, color: 1 }, "b.tsx": { inlineLook: 2 } });
  });
});

describe("css-look: a class styled in two stylesheets", () => {
  it("finds a lone class selector in two sheets, in a list or a media query, and not a compound one or a comment", () => {
    const sheets = new Map([
      ["a.css", ".verdict { display: grid; }\n.x .y { top: 0; }\n/* .note { } */"],
      ["b.css", "@media (max-width: 600px) { .p, .verdict { gap: 0; } }\n.x .z { top: 0; }\n.y { top: 0; }\n.note { top: 0; }"],
    ]);
    expect([...sharedClasses(sheets)]).toEqual([["verdict", ["a.css", "b.css"]]]);
  });
});
