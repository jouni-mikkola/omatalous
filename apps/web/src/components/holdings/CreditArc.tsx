/**
 * Decision: how much of its limit a card has used, at a glance. An arc of three quarters of a circle, filled from the
 * lower left as far as the share used, with the share in its middle. It is drawn only from the two figures the rows
 * under it show, used and limit: a card with no limit, or with no used figure, has no arc. Over its limit the arc is
 * full and in the colour of what is wrong. The words for a screen reader are the two figures with their labels.
 */
import { useId } from "react";
import { money, percent } from "../../format.ts";

/** The arc of a circle of radius 30 that three quarters of it make. */
const THREE_QUARTERS = 141.37;
const SPECTRUM = ["--spectrum-4", "--spectrum-3", "--spectrum-2", "--spectrum-1"] as const;

export function CreditArc({ usedCents, limitCents }: { usedCents: number | null; limitCents: number | null }) {
  const gradient = `arc-${useId().replace(/\W/g, "")}`;
  if (usedCents === null || limitCents === null || limitCents <= 0) return null;
  const share = Math.max(0, usedCents) / limitCents;
  const length = THREE_QUARTERS * Math.min(share, 1);
  const rotate = "rotate(135 36 36)";
  return (
    <svg className={share > 1 ? "credit-arc credit-arc-over" : "credit-arc"} viewBox="0 0 72 72" role="img" aria-label={`Käytetty luotto ${money(usedCents)}, luottoraja ${money(limitCents)}`}>
      <defs>
        <linearGradient id={gradient} x1="1" y1="0" x2="0" y2="0">
          {SPECTRUM.map((token, i) => <stop key={token} offset={i / (SPECTRUM.length - 1)} style={{ stopColor: `var(${token})` }} />)}
        </linearGradient>
      </defs>
      <circle className="credit-arc-track" cx="36" cy="36" r="30" strokeDasharray={`${THREE_QUARTERS} 999`} transform={rotate} />
      {length > 0 && <circle className="credit-arc-fill" cx="36" cy="36" r="30" stroke={`url(#${gradient})`} strokeDasharray={`${length.toFixed(2)} 999`} transform={rotate} />}
      <text x="36" y="41" textAnchor="middle">{percent(share)}</text>
    </svg>
  );
}
