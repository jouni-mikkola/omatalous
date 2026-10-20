import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles/motion.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const REDUCE = "@media (prefers-reduced-motion: reduce)";
const at = css.indexOf(REDUCE);
const outside = css.slice(0, at);
const inside = css.slice(at + REDUCE.length);

/** Top-level `selector { body }` pairs of a flat stylesheet; a nested block is kept in its body. */
function rules(text: string): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  let depth = 0;
  let head = "";
  let body = "";
  for (const ch of text) {
    if (ch === "{") {
      if (depth++ === 0) continue;
    } else if (ch === "}") {
      if (--depth === 0) {
        out.push({ sel: head.trim(), body });
        head = body = "";
        continue;
      }
    }
    if (depth === 0) head += ch;
    else body += ch;
  }
  return out;
}

const motionRules = (text: string, prop: string) =>
  rules(text).flatMap((r) => (r.sel.startsWith("@") && !r.sel.startsWith("@starting-style") ? [] : r.sel.startsWith("@starting-style") ? rules(r.body) : [r]))
    .filter((r) => new RegExp(`(^|[;\\s])${prop}\\s*:`).test(r.body));

describe("motion.css", () => {
  it("ends with one reduced-motion block", () => {
    expect(css.split(REDUCE)).toHaveLength(2);
    expect(css.slice(at + REDUCE.length).trim().startsWith("{")).toBe(true);
    expect(css.trimEnd().endsWith("}")).toBe(true);
  });

  it("turns off every animation and transition it declares", () => {
    const off = rules(inside.trim().slice(1, -1));
    for (const prop of ["animation", "transition"]) {
      const declared = motionRules(outside, prop).filter((r) => !r.body.includes(`${prop}-delay`) || r.body.includes(`${prop}:`));
      expect(declared.length).toBeGreaterThan(0);
      for (const r of declared) {
        for (const s of r.sel.split(",").map((x) => x.trim())) {
          const hit = off.some((o) => o.sel.split(",").map((x) => x.trim()).includes(s) && new RegExp(`${prop}\\s*:\\s*none`).test(o.body));
          expect(hit, `${s} (${prop})`).toBe(true);
        }
      }
    }
  });

  it("keeps every duration and delay under 0.4 s and moves only opacity", () => {
    const tokens = readFileSync(new URL("../src/styles/scale.css", import.meta.url), "utf8");
    const ms = (v: string, u: string) => (u === "ms" ? Number(v) : Number(v) * 1000);
    const times: number[] = [];
    for (const m of outside.matchAll(/(?<![\w-])(\d*\.?\d+)(ms|s)\b/g)) times.push(ms(m[1]!, m[2]!));
    for (const m of outside.matchAll(/var\((--t-[a-z]+)\)/g)) {
      const t = new RegExp(`${m[1]}:\\s*(\\d+)(ms|s)`).exec(tokens);
      expect(t, m[1]).not.toBeNull();
      times.push(ms(t![1]!, t![2]!));
    }
    expect(times.length).toBeGreaterThan(0);
    for (const t of times) expect(t).toBeLessThan(400);

    expect(outside).not.toMatch(/\b(width|height|top|left|margin|visibility|display)\s*:/);
    expect(outside).not.toMatch(/infinite|scroll\(|animation-timeline/);
    expect(outside).not.toMatch(/transform|translate|scale/);
  });
});
