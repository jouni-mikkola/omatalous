// A month from shelf value to net cost, read from top to bottom. The levels (shelf value, what was paid, the net cost) are
// bars from zero on one scale; the changes between them (discounts, deposits, bonuses) are a few euros against hundreds,
// so they stand on a scale of their own, from zero, each with its share of the shelf value. Each step is labelled with
// the figure and share its answer gave. An estimate wears "≈" and is shown in whole euros.
import { money, percent } from "../format.ts";
import { approxText } from "../components/Why.tsx";
import "../styles/charts.css";
import "../styles/step-charts.css";

export interface WaterfallStep {
  key: string;
  label: string;
  /** A level's value, or a change: negative takes off. */
  cents: number;
  /** level: a bar from zero; total: the last level, the answer; saved, earned, added: a change. */
  kind: "level" | "total" | "saved" | "earned" | "added";
  estimated: boolean;
  /** A change: its share of the first level, in basis points, from the answer. */
  shareBp?: number;
}

const shareText = (bp: number) => percent(bp / 10_000, 1);

/** A step's figure as text, without its estimate mark: a change has its sign, an estimate whole euros. */
function figure(s: WaterfallStep, level: boolean): string {
  const amount = money(Math.abs(s.cents), !s.estimated);
  return level ? amount : `${s.cents < 0 ? "−" : "+"}${amount}`;
}

export function Waterfall({ steps, label, picked = null, onPick }: { steps: readonly WaterfallStep[]; label: string; picked?: string | null; onPick?: (key: string) => void }) {
  const isLevel = (s: WaterfallStep) => s.kind === "level" || s.kind === "total";
  const levelTop = Math.max(1, ...steps.filter(isLevel).map((s) => s.cents));
  const changeTop = Math.max(1, ...steps.filter((s) => !isLevel(s)).map((s) => Math.abs(s.cents)));
  return (
    <div className="step-fall" role="list" aria-label={label}>
      {steps.map((s, i) => {
        const level = isLevel(s);
        const width = level ? (Math.max(0, s.cents) / levelTop) * 100 : (Math.abs(s.cents) / changeTop) * 100;
        const plain = figure(s, level);
        const text = approxText(plain, s.estimated);
        const share = !level && s.shareBp !== undefined ? shareText(s.shareBp) : null;
        // the changes stand on their own scale: a rule above the first one says so
        const firstChange = !level && (i === 0 || isLevel(steps[i - 1]!));
        const body = (
          <>
            <span className="sw-label">{s.label}</span>
            <span className={`sw-track${level ? "" : " sw-track-change"}`} aria-hidden="true">
              <i className={`sw-bar sw-${s.kind}`} style={{ width: `${width}%` }} />
            </span>
            <span className="sw-value">
              {text}
              {share && <span className="sw-share">{share}</span>}
            </span>
          </>
        );
        return (
          <div key={s.key} role="listitem" className={`sw-row${level ? " sw-row-level" : " sw-row-change"}${firstChange ? " sw-row-first" : ""}${s.kind === "total" ? " sw-row-total" : ""}${picked === s.key ? " picked" : ""}`}>
            {onPick ? (
              <button type="button" className="sw-step" aria-label={`${s.label}: ${s.estimated ? "arvio " : ""}${plain}${share ? `, ${share} hyllyhinnoista` : ""}`} aria-pressed={picked === s.key} onClick={() => onPick(s.key)}>
                {body}
              </button>
            ) : (
              <div className="sw-step">{body}</div>
            )}
          </div>
        );
      })}
      <p className="sw-axis">Hinnat ja maksettu summa alkavat nollasta. Alennukset ja edut on piirretty omalla asteikollaan, ja prosentti on osuus hyllyhinnoista.</p>
    </div>
  );
}
