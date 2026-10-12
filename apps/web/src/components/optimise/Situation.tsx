/** Tilanne: the euros the tips could save in a year with their range, and four facts about the household against its own months. No score. */
import type { OptimiseData } from "@banking/core";
import { money } from "../../format.ts";
import { Section } from "../Section.tsx";
import { rangeText } from "./shared.tsx";

export function Situation({ data }: { data: OptimiseData }) {
  const { headline, checked } = data;
  const range = rangeText(headline);
  return (
    <Section id="tilanne" title="Tilanne">
      {headline.count === 0 && checked.findings === 0 && <p className="optimise-none">Ei vinkkejä.</p>}
      <dl className="kv optimise-facts">
        {headline.count > 0 && (
          <div>
            <dt className="k">Säästömahdollisuus vuodessa (arvio)</dt>
            <dd className="v">{money(headline.midCents, false)}</dd>
          </div>
        )}
        {headline.count > 0 && range && (
          <div>
            <dt className="k">Vaihteluväli</dt>
            <dd className="v">{range}</dd>
          </div>
        )}
        {data.situation.map((fact) => (
          <div key={fact.id}>
            <dt className="k">{fact.label}</dt>
            <dd className="v">{fact.text || "–"}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
