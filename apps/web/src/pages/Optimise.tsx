// Decision: what to change first: which contract, subscription or habit to renegotiate, cancel or compare, and when.
// Every finding and insight is answered here, with one set of words, and the answers are listed under Päätetyt.
import { allFindings, MIN_MONTHS_ANY, type OptimiseResponse } from "@banking/core";
import { useEffect, useRef, useState } from "react";
import { query } from "../api.ts";
import { Areas } from "../components/optimise/Areas.tsx";
import { Changes } from "../components/optimise/Changes.tsx";
import { Checked } from "../components/optimise/Checked.tsx";
import { Decided } from "../components/optimise/Decided.tsx";
import { FindingCard } from "../components/optimise/FindingCard.tsx";
import { FollowUp } from "../components/optimise/FollowUp.tsx";
import { InputsCard } from "../components/optimise/Inputs.tsx";
import { Others } from "../components/optimise/Others.tsx";
import { Section } from "../components/Section.tsx";
import { Situation } from "../components/optimise/Situation.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Loading } from "../components/Loading.tsx";
import { completeMonths } from "../format.ts";
import { useApi } from "../hooks.ts";
import type { Scope } from "../types.ts";
import "../styles/optimise.css";

/**
 * Which panels of findings are half-width on a wide screen: the panels of the areas, then Muut havainnot, in pairs, so
 * none is left alone on a row (the last of an odd count stays whole).
 */
export function halfPanels(areas: number, hasOthers: boolean): { areas: number; others: boolean } {
  const total = areas + (hasOthers ? 1 : 0);
  const paired = total - (total % 2);
  return { areas: Math.min(areas, paired), others: hasOthers && total % 2 === 0 && total > 0 };
}

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

  const halves = halfPanels(data.areas.filter((a) => a.findings.length > 0).length, data.others.length > 0);

  return (
    <div className={`stack optimise ${loading ? "loading" : ""}`}>
      {said && (
        <div className="notice good" role="status" tabIndex={-1} ref={notice}>
          {said.text}
        </div>
      )}

      {young && (
        <div className="notice" role="status">
          Säästövinkit tarvitsevat {completeMonths(MIN_MONTHS_ANY)}.
        </div>
      )}

      {data.soon.length > 0 && (
        <Section id="seuraavat" title="Seuraavat 60 päivää">
          <div className="findings">
            {data.soon.map((f) => (
              <FindingCard key={f.id} finding={f} today={data.today} scope={scope} onChanged={changed} />
            ))}
          </div>
        </Section>
      )}

      {!young && <Situation data={data} />}
      <Changes changes={changes} since={since} areas={data.areas} titles={titles} />
      <Areas areas={data.areas} above={above} today={data.today} scope={scope} onChanged={changed} halves={halves.areas} />
      {/* the insights the overview and Raportit told while this page was off: answered here like the findings */}
      <Others others={data.others} onChanged={changed} half={halves.others} />
      <Checked areas={data.areas} young={young} />
      <FollowUp followUp={followUp} areas={data.areas} titles={titles} scope={scope} onChanged={changed} />
      <Decided data={data} states={states} outcomes={outcomes} scope={scope} onChanged={changed} />
      <InputsCard needed={data.needed} given={inputs} today={data.today} scope={scope} onChanged={changed} />
    </div>
  );
}
