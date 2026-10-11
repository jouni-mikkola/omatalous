/** Tilanne: the euros found, what was checked, and four facts about the household against its own months. No score. */
import type { OptimiseData, SituationFact } from "@banking/core";
import { money, plural } from "../../format.ts";
import { Section } from "../Section.tsx";
import { rangeText } from "./shared.tsx";

const num = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 });

/** The line a fact is drawn against, in the fact's own unit. */
function referenceText(fact: SituationFact): string | null {
  if (fact.reference === undefined) return null;
  return fact.unit === "months" ? `${num.format(fact.reference)} kuukautta` : `${Math.round(fact.reference * 100)} %`;
}

export function Situation({ data }: { data: OptimiseData }) {
  const { headline, checked } = data;
  const range = rangeText(headline);
  return (
    <Section id="tilanne" title="Tilanne" sub={`Laskettu ${data.months} valmiin kuukauden tiedoista`}>
      <p className="lead optimise-headline">
        {headline.count > 0 ? (
          <>
            Löydetty vuosivaikutus noin <strong>{money(headline.midCents, false)}</strong>
            {range && ` (${range})`}, {plural(headline.count, "löydös", "löydöstä")}.
          </>
        ) : (
          checked.findings > 0 ? "Yhteissummaan ei kuulu yhtään löydöstä." : "Löydöksiä ei ole nyt."
        )}{" "}
        <span className="muted">
          Tarkistettiin {plural(checked.total, "asia", "asiaa")}
          {checked.unavailable > 0 && `, ${checked.unavailable} ei voitu tarkistaa`}.
        </span>
      </p>
      {checked.findings > headline.count && (
        <p className="small muted">Löydöksiä on yhteensä {checked.findings}. Yhteissummasta puuttuvat päällekkäiset, epävarmat ja yhdessä päätettävät.</p>
      )}
      <dl className="kv optimise-facts">
        {data.situation.map((fact) => {
          const reference = referenceText(fact);
          return (
            <div key={fact.id}>
              <dt className="k">{fact.label}</dt>
              <dd className="v">{fact.text || "–"}</dd>
              <dd className="small muted">{fact.basis}</dd>
              {reference && <dd className="small muted">Vertailukohta {reference}</dd>}
            </div>
          );
        })}
      </dl>
    </Section>
  );
}
