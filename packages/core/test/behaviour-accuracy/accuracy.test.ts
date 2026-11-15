/**
 * The measuring stick of the behaviour detectors (BA1-behaviour-model.md §3): precision and recall of each detector
 * over made-up households with hand-labelled truth (world.ts), printed as a table, and a failure below the bar of
 * detectors.ts. `pnpm test behaviour-accuracy` prints the table.
 */
import { describe, expect, it } from "vitest";
import { ctxOf, DETECTORS, type Detector } from "./detectors.ts";
import { labelled, steadyLabelled } from "./world.ts";

/** 20 households holding every combination of the credit case (5) and the pay day case (4) once, and 20 steady ones with nothing planted. */
const WORLD = [...Array.from({ length: 20 }, (_, i) => labelled(i + 1)), ...Array.from({ length: 20 }, (_, i) => steadyLabelled(100 + i))];

interface Score {
  tp: number;
  fp: number;
  fn: number;
  misses: string[];
  false: string[];
}

function score(d: Detector): Score {
  const s: Score = { tp: 0, fp: 0, fn: 0, misses: [], false: [] };
  for (const l of WORLD) {
    const claimed = d.claimed(ctxOf(l), l);
    const truth = d.truth(l.truth, l, ctxOf(l));
    for (const u of claimed) {
      if (truth.has(u)) s.tp++;
      else s.fp++, s.false.push(`${l.household.name} ${u}`);
    }
    for (const u of truth) if (!claimed.has(u)) s.fn++, s.misses.push(`${l.household.name} ${u}`);
  }
  return s;
}

const ratio = (a: number, b: number) => (b ? a / b : 1);
const scores = new Map<string, Score>();
const scoreOf = (d: Detector) => scores.get(d.id) ?? scores.set(d.id, score(d)).get(d.id)!;

describe("behaviour accuracy", () => {
  it.each(DETECTORS.map((d) => [d.id, d] as const))("%s meets its bar", (_id, d) => {
    const s = scoreOf(d);
    const precision = ratio(s.tp, s.tp + s.fp);
    const recall = ratio(s.tp, s.tp + s.fn);
    if (d.bar) {
      expect(precision, `false: ${s.false.slice(0, 5).join("; ")}`).toBeGreaterThanOrEqual(d.bar.precision);
      expect(recall, `missed: ${s.misses.slice(0, 5).join("; ")}`).toBeGreaterThanOrEqual(d.bar.recall);
    }
  }, 20_000);

  it("prints the table", () => {
    const lines = DETECTORS.map((d) => {
      const s = scoreOf(d);
      const p = ratio(s.tp, s.tp + s.fp).toFixed(2);
      const r = ratio(s.tp, s.tp + s.fn).toFixed(2);
      const bar = d.bar ? `${d.bar.precision.toFixed(2)}/${d.bar.recall.toFixed(2)}` : "none";
      return `${d.id.padEnd(28)} ${d.unit.padEnd(13)} tp ${String(s.tp).padStart(3)} fp ${String(s.fp).padStart(3)} fn ${String(s.fn).padStart(3)}  precision ${p}  recall ${r}  bar ${bar}`;
    });
    console.log([`behaviour accuracy over ${WORLD.length} made-up households`, ...lines].join("\n"));
    expect(lines).toHaveLength(DETECTORS.length);
  });
});
