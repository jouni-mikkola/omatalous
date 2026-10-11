/**
 * Alueet: up to three findings per area. The areas with none fold into one line with what was checked behind it
 * (`quiet`, off while the history is short).
 */
import type { AreaView, Check, IsoDate } from "@banking/core";
import { plural } from "../../format.ts";
import type { Scope } from "../../types.ts";
import { FindingCard } from "./FindingCard.tsx";
import type { Changed } from "./shared.tsx";

const goToInputs = () => document.getElementById("tiedot")?.scrollIntoView({ behavior: "smooth" });

/**
 * What a check says in words: found something, looked and found nothing, waits for a number, or had too little data.
 * `shown` is whether a finding of this check is on the page; a check that found one the household has decided on says so.
 */
function CheckStatus({ check, shown }: { check: Check; shown: boolean }) {
  switch (check.status) {
    case "finding":
      return shown ? <span className="check-status found">löydös</span> : <span className="check-status">päätetty</span>;
    case "clear":
      return <span className="check-status">ei löydöstä</span>;
    case "needs_input":
      return (
        <span className="check-status wait">
          {check.hint ?? "tieto puuttuu"}{" "}
          {check.input && (
            <button className="link-btn small" type="button" onClick={goToInputs}>
              Anna tieto
            </button>
          )}
        </span>
      );
    case "no_data":
      return <span className="check-status wait">{check.hint ?? "tietoja ei vielä riitä"}</span>;
  }
}

/** `shownKinds` are the kinds of the findings on the page; `more` findings past the cap may be of any kind, so they count as shown. */
function Checks({ checks, shownKinds, more }: { checks: readonly Check[]; shownKinds: ReadonlySet<string>; more: number }) {
  return (
    <ul className="checks">
      {checks.map((c) => (
        <li key={c.id}>
          <span className="check-label">{c.label}</span> <CheckStatus check={c} shown={more > 0 || shownKinds.has(c.id.slice(c.id.indexOf(":") + 1))} />
        </li>
      ))}
    </ul>
  );
}

const kindsOf = (area: AreaView): Set<string> => new Set(area.findings.map((f) => f.kind));

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

/** An area with findings: a card per finding, "ja N muuta" for the ones past three, and the checks behind a fold. */
function AreaCard({ area, above, today, scope, onChanged }: { area: AreaView; above: ReadonlySet<string>; today: IsoDate; scope: Scope; onChanged: Changed }) {
  const here = area.findings.filter((f) => !above.has(f.id));
  const up = area.findings.length - here.length;
  return (
    <section className="card area" id={`alue-${area.id}`} aria-labelledby={`alue-${area.id}-h`}>
      <div className="card-head">
        <div>
          <h3 id={`alue-${area.id}-h`}>{area.label}</h3>
          <div className="card-sub">{plural(area.findings.length + area.more, "löydös", "löydöstä")}</div>
        </div>
      </div>
      <div className="findings">
        {here.map((f) => (
          <FindingCard key={f.id} finding={f} today={today} scope={scope} onChanged={onChanged} />
        ))}
      </div>
      {up > 0 && <p className="small muted">{plural(up, "löydös", "löydöstä")} näkyy yllä kohdassa Seuraavat 60 päivää.</p>}
      {area.more > 0 && <p className="small muted">Lisäksi {plural(area.more, "löydös", "löydöstä")}, jotka näkyvät, kun yllä olevat on käsitelty.</p>}
      <Summary area={area} />
      {area.checks.length > 0 && (
        <details className="area-checks">
          <summary>Tarkistetut asiat ({area.checks.length})</summary>
          <Checks checks={area.checks} shownKinds={kindsOf(area)} more={area.more} />
        </details>
      )}
    </section>
  );
}

/**
 * `above` holds the ids of findings already shown under Seuraavat 60 päivää, so none appears twice. `checked` is the
 * count Tilanne says, so the fold line and Tilanne name one figure.
 */
export function Areas({ areas, above, today, scope, onChanged, quiet: listQuiet, checked }: { areas: readonly AreaView[]; above: ReadonlySet<string>; today: IsoDate; scope: Scope; onChanged: Changed; quiet: boolean; checked: number }) {
  const withFindings = areas.filter((a) => a.findings.length > 0);
  const quiet = listQuiet ? areas.filter((a) => a.findings.length === 0 && (a.checks.length > 0 || a.summary)) : [];
  if (!withFindings.length && !quiet.length) return null;
  return (
    <>
      <h2 className="optimise-group">Alueet</h2>
      {withFindings.map((a) => (
        <AreaCard key={a.id} area={a} above={above} today={today} scope={scope} onChanged={onChanged} />
      ))}
      {quiet.length > 0 && (
        <details className="card quiet-fold" id="alueet-hiljaa">
          <summary>
            Tarkistettu {plural(checked, "asia", "asiaa")}, {plural(quiet.length, "alue", "aluetta")} ilman löydöksiä
          </summary>
          <div className="quiet-areas">
            {quiet.map((a) => (
              <section key={a.id} className="quiet-area" aria-labelledby={`hiljaa-${a.id}-h`}>
                <h3 id={`hiljaa-${a.id}-h`}>{a.label}</h3>
                <Checks checks={a.checks} shownKinds={kindsOf(a)} more={a.more} />
                <Summary area={a} />
              </section>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
