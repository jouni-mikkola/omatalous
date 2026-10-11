/** Tilanne: the euros the tips could save, what was checked, and four facts about the household against its own months. No score. */
import type { OptimiseData, SituationFact } from "@banking/core";
import { money, plural } from "../../format.ts";
import { Section } from "../Section.tsx";
import { rangeText } from "./shared.tsx";

const num = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 });

/**
 * The line a fact is drawn against, in the fact's own unit, and what that line is. The debt line is the app's own (core
 * `DEBT_SHARE`): no authority sets one for debt service as paid, so it is said so and not called a reference.
 */
function referenceText(fact: SituationFact): string | null {
  if (fact.reference === undefined) return null;
  const line = fact.unit === "months" ? `${num.format(fact.reference)} kuukautta` : `${Math.round(fact.reference * 100)} %`;
  return fact.id === "debt_share" ? `Huomautus, jos yli ${line}. Raja on sovelluksen oma, ei viranomaisen suositus.` : `Vertailukohta ${line}`;
}

export function Situation({ data }: { data: OptimiseData }) {
  const { headline, checked } = data;
  const range = rangeText(headline);
  return (
    <Section id="tilanne" title="Tilanne" sub={`Laskettu ${data.months} valmiin kuukauden tiedoista`}>
      <p className="lead optimise-headline">
        {headline.count > 0 ? (
          <>
            Säästömahdollisuus noin <strong>{money(headline.midCents, false)}</strong> vuodessa
            {range && ` (${range})`}, {plural(headline.count, "vinkki", "vinkkiä")}.
          </>
        ) : checked.findings > 0 ? (
          "Yhteissummaan ei kuulu yhtään vinkkiä."
        ) : (
          "Vinkkejä ei ole nyt."
        )}{" "}
        <span className="muted">
          Tarkistettiin {plural(checked.total - checked.unavailable, "asia", "asiaa")}
          {checked.unavailable > 0 && `, ${checked.unavailable} odottaa tietoja tai pidempää historiaa`}.
        </span>
      </p>
      {checked.findings > headline.count && (
        <p className="small muted">Vinkkejä on yhteensä {checked.findings}. Yhteissummasta puuttuvat päällekkäiset, epävarmat ja yhdessä päätettävät.</p>
      )}
      <dl className="kv optimise-facts">
        {data.situation.map((fact) => {
          const reference = referenceText(fact);
          return (
            <div key={fact.id}>
              <dt className="k">{fact.label}</dt>
              <dd className="v">{fact.text || "–"}</dd>
              <dd className="small muted">{fact.basis}</dd>
              {reference && <dd className="small muted">{reference}</dd>}
            </div>
          );
        })}
      </dl>
    </Section>
  );
}
