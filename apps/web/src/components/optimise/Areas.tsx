/** The areas that have findings: a card each, with up to three findings and the area's own figures. A quiet area has no card. */
import type { AreaView, IsoDate } from "@banking/core";
import type { Scope } from "../../types.ts";
import { Section } from "../Section.tsx";
import { FindingCard } from "./FindingCard.tsx";
import type { Changed } from "./shared.tsx";

function Summary({ area }: { area: AreaView }) {
  if (!area.summary) return null;
  return (
    <div className="area-summary">
      <h4>{area.summary.title}</h4>
      <dl className="calc">
        {area.summary.lines.map((line, i) => (
          <div key={i}>
            <dt>{line.label}</dt>
            <dd>{line.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** An area with findings: a card per finding that is not already under Seuraavat 60 päivää, then the area's figures. */
function AreaCard({ area, above, today, scope, onChanged, half }: { area: AreaView; above: ReadonlySet<string>; today: IsoDate; scope: Scope; onChanged: Changed; half: boolean }) {
  const here = area.findings.filter((f) => !above.has(f.id));
  if (!here.length && !area.summary) return null;
  return (
    <Section id={`alue-${area.id}`} title={area.label} half={half}>
      <div className="findings">
        {here.map((f) => (
          <FindingCard key={f.id} finding={f} today={today} scope={scope} onChanged={onChanged} />
        ))}
      </div>
      <Summary area={area} />
    </Section>
  );
}

/** `above` holds the ids of findings already shown under Seuraavat 60 päivää, so none appears twice. */
/** `halves` is how many of the first panels are half-width on a wide screen: an even number, so none is left alone on a row. */
export function Areas({ areas, above, today, scope, onChanged, halves = 0 }: { areas: readonly AreaView[]; above: ReadonlySet<string>; today: IsoDate; scope: Scope; onChanged: Changed; halves?: number }) {
  return (
    <>
      {areas
        .filter((a) => a.findings.length > 0)
        .map((a, i) => (
          <AreaCard key={a.id} area={a} above={above} today={today} scope={scope} onChanged={onChanged} half={i < halves} />
        ))}
    </>
  );
}
