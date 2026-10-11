// Decision: what to change first: which contract, subscription or habit to renegotiate, cancel or compare, and when
import { allFindings, MIN_MONTHS_ANY } from "@banking/core";
import { useEffect, useRef, useState } from "react";
import { query } from "../api.ts";
import { Areas } from "../components/optimise/Areas.tsx";
import { Changes } from "../components/optimise/Changes.tsx";
import { Decided } from "../components/optimise/Decided.tsx";
import { FindingCard } from "../components/optimise/FindingCard.tsx";
import { FollowUp } from "../components/optimise/FollowUp.tsx";
import { InputsCard } from "../components/optimise/Inputs.tsx";
import { type OptimiseResponse, SectionCard } from "../components/optimise/shared.tsx";
import { Situation } from "../components/optimise/Situation.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Loading } from "../components/Loading.tsx";
import { date, plural } from "../format.ts";
import { useApi } from "../hooks.ts";
import type { Scope } from "../types.ts";
import "../styles/optimise.css";
import "../styles/quality.css";

export function Optimise({ scope }: { scope: Scope }) {
  const { data: response, error, loading, reload } = useApi<OptimiseResponse>(`/api/optimise${query({ scope })}`);
  // what the last save did, said once and kept until the next one
  const [said, setSaid] = useState<{ text: string; n: number } | null>(null);
  const notice = useRef<HTMLDivElement>(null);
  // a decision removes the card the keyboard was on: focus moves to the message, so it is read and the place is not lost
  useEffect(() => {
    if (said) notice.current?.focus();
  }, [said]);
  if (error && !response) return <ErrorCard message={error} onRetry={reload} />;
  if (!response) return <Loading />;

  const { data, inputs, states, changes, followUp } = response;
  const changed = (message: string) => {
    setSaid((prev) => ({ text: message, n: (prev?.n ?? 0) + 1 }));
    reload();
  };
  const young = data.months < MIN_MONTHS_ANY;
  const above = new Set(data.soon.map((f) => f.id));
  // a change or a proposal names its finding by the title the page shows, else by its area and merchant
  const titles = new Map(allFindings(data).map((f) => [f.id, f.title]));
  const outcomes = new Map(followUp.outcomes.map((o) => [o.findingId, o.outcome]));
  // changes compare with the newest older snapshot, which the line holds just before this month's point
  const since = followUp.line.length >= 2 ? followUp.line[followUp.line.length - 2]!.month : null;

  return (
    <div className={`stack optimise ${loading ? "loading" : ""}`}>
      <p className="data-scope">
        <span>{data.dataTo ? `Tiedot ${date(data.dataTo)} asti` : "Ei tapahtumia"}</span>
        <span>historiaa {plural(data.historyMonths, "kuukausi", "kuukautta")}</span>
        <span>{plural(data.accounts, "tili", "tiliä")}</span>
        <a href="#/reports">Tietojen laatu</a>
      </p>
      {said && (
        <div className="notice good" role="status" tabIndex={-1} ref={notice}>
          {said.text}
        </div>
      )}

      {young && (
        <div className="notice" role="status">
          Optimoi tarvitsee kolme valmista kuukautta. Siihen asti näkyvät vain määräajat.
        </div>
      )}

      {data.soon.length > 0 && (
        <SectionCard id="seuraavat" title="Seuraavat 60 päivää" sub="Määräajat, jotka ehtii vielä hoitaa">
          <div className="findings">
            {data.soon.map((f) => (
              <FindingCard key={f.id} finding={f} today={data.today} scope={scope} onChanged={changed} />
            ))}
          </div>
        </SectionCard>
      )}

      {!young && <Situation data={data} />}
      <Changes changes={changes} since={since} areas={data.areas} titles={titles} />
      {/* under three months the areas hold only deadlines, and those are what the notice promises */}
      <Areas areas={data.areas} above={above} today={data.today} scope={scope} onChanged={changed} quiet={!young} />
      <FollowUp followUp={followUp} areas={data.areas} titles={titles} scope={scope} onChanged={changed} />
      <Decided data={data} states={states} outcomes={outcomes} scope={scope} onChanged={changed} />
      <InputsCard needed={data.needed} given={inputs} areas={data.areas} today={data.today} scope={scope} onChanged={changed} />
    </div>
  );
}
