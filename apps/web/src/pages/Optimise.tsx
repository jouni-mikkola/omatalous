// Decision: what to change first: which contract, subscription or habit to renegotiate, cancel or compare, and when.
// Every finding and insight is answered here, with one set of words, and the answers are listed under Päätetyt.
import { allFindings, type Finding, MIN_MONTHS_ANY, type OptimiseResponse, parseSeriesId } from "@banking/core";
import { useEffect, useRef, useState } from "react";
import { query } from "../api.ts";
import { Changes } from "../components/optimise/Changes.tsx";
import { Checked } from "../components/optimise/Checked.tsx";
import { Decided } from "../components/optimise/Decided.tsx";
import { FollowUp } from "../components/optimise/FollowUp.tsx";
import { InputsCard } from "../components/optimise/Inputs.tsx";
import { Lead, titleOf } from "../components/optimise/Lead.tsx";
import { Others } from "../components/optimise/Others.tsx";
import { Outcomes } from "../components/optimise/Outcomes.tsx";
import { Rates } from "../components/optimise/Rates.tsx";
import { Reach } from "../components/optimise/Reach.tsx";
import { Soon, Tips } from "../components/optimise/Tips.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Loading } from "../components/Loading.tsx";
import { completeMonths, money } from "../format.ts";
import { useApi } from "../hooks.ts";
import type { Scope } from "../types.ts";
import "../styles/optimise.css";

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
  // the lead strip is the key figure tile of Yhteenveto, so its outline is the same
  if (!response) return <Loading shape="overview" />;

  const { data, inputs, states, changes, followUp, rates } = response;
  const changed = (message: string) => {
    setSaid((prev) => ({ text: message, n: (prev?.n ?? 0) + 1 }));
    reload();
  };
  const young = data.months < MIN_MONTHS_ANY;
  const above = new Set(data.soon.map((f) => f.id));
  // a change or a proposal names its finding by the title the page shows, else by its area and merchant
  const titles = new Map(allFindings(data).map((f) => [f.id, f.title]));
  const outcomes = new Map(followUp.outcomes.map((o) => [o.findingId, o.outcome]));
  const confirmed = followUp.outcomes.filter((o) => o.outcome.verdict === "vahvistui").length;
  const last = followUp.line.at(-1) ?? null;
  // changes compare with the newest older snapshot, which the line holds just before this month's point
  const since = followUp.line.length >= 2 ? followUp.line[followUp.line.length - 2]!.month : null;
  // a pin on the 60-day line names its merchant, else its area
  const short = (f: Finding) => (f.subject ? (parseSeriesId(f.subject)?.merchant ?? null) : null) ?? data.areas.find((a) => a.id === f.area)?.label ?? f.area;

  return (
    <div className={`stack optimise ${loading ? "loading" : ""}`}>
      {said && (
        <div className="notice good" role="status" tabIndex={-1} ref={notice}>
          {said.text}
        </div>
      )}

      {young && (
        <div className="notice" role="status">
          Säästövinkkejä varten tarvitaan {completeMonths(MIN_MONTHS_ANY)}.
        </div>
      )}

      {!young && <Lead data={data} followUp={followUp} confirmedCount={confirmed} title={titleOf(titles, data)} />}
      <Changes changes={changes} since={since} areas={data.areas} titles={titles} />
      <Soon soon={data.soon} today={data.today} scope={scope} onChanged={changed} short={short} />
      <Reach reach={data.reach} areas={data.areas} />
      <Tips areas={data.areas} above={above} today={data.today} scope={scope} onChanged={changed} />
      {/* the insights the overview and Raportit told while this page was off: answered here like the findings */}
      <Others others={data.others} onChanged={changed} />
      <FollowUp
        followUp={followUp}
        areas={data.areas}
        titles={titles}
        scope={scope}
        onChanged={changed}
        head={{ title: "Tuottivatko muutokset säästöä?", sub: last && confirmed ? `${confirmed} muutosta vahvistui: ${money(last.confirmedCents, false)} vuodessa.` : undefined }}
      >
        {data.done.length > 0 ? <Outcomes data={data} outcomes={outcomes} /> : null}
      </FollowUp>
      <Rates rates={rates} />
      <Checked areas={data.areas} young={young} />
      <Decided data={data} states={states} scope={scope} onChanged={changed} />
      <InputsCard given={inputs} today={data.today} scope={scope} onChanged={changed} />
    </div>
  );
}
