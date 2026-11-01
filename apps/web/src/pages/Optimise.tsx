// Decision: what to change first: which contract, subscription or habit to renegotiate, cancel or compare, and when.
// Every finding and insight is answered here, with one set of words, and the answers are listed under Päätetyt.
import { type AreaId, allFindings, type Finding, MIN_MONTHS_ANY, type OptimiseResponse } from "@banking/core";
import { useEffect, useRef, useState } from "react";
import { query } from "../api.ts";
import { Changes } from "../components/optimise/Changes.tsx";
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
import { completeMonths, money, seriesName } from "../format.ts";
import { t } from "../text.ts";
import { useApi } from "../hooks.ts";
import type { Scope } from "../types.ts";
import "../styles/optimise.css";
import { Notice } from "../components/ui/Notice.tsx";
export function Optimise({ scope }: { scope: Scope }) {
  const { data: response, error, loading, reload } = useApi<OptimiseResponse>(`/api/optimise${query({ scope })}`);
  // what the last save did, said once and kept until the next one
  const [said, setSaid] = useState<{ text: string; n: number } | null>(null);
  const notice = useRef<HTMLDivElement>(null);
  // the area Suurimmat säästökohteet narrowed the tips to
  const [area, setArea] = useState<AreaId | null>(null);
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
  // a click on an area narrows the tips and takes the reader up to them
  const pick = (id: AreaId) => {
    setArea(id);
    requestAnimationFrame(() => document.getElementById("vinkit")?.scrollIntoView({ block: "start" }));
  };
  const young = data.months < MIN_MONTHS_ANY;
  // a change or a proposal names its finding by the title the page shows, else by its area and merchant
  const titles = new Map(allFindings(data).map((f) => [f.id, f.title]));
  const outcomes = new Map(followUp.outcomes.map((o) => [o.findingId, o.outcome]));
  const confirmed = followUp.outcomes.filter((o) => o.outcome.verdict === "vahvistui").length;
  const last = followUp.line.at(-1) ?? null;
  // changes compare with the newest older snapshot, which the line holds just before this month's point
  const since = followUp.line.length >= 2 ? followUp.line[followUp.line.length - 2]!.month : null;
  // a pin on the 60-day line names its merchant, else its area
  const short = (f: Finding) => (f.subject ? seriesName(f.subject) : null) ?? data.areas.find((a) => a.id === f.area)?.label ?? f.area;

  return (
    <div className={`stack optimise ${loading ? "loading" : ""}`}>
      {said && (
        <Notice tone="good" role="status" tabIndex={-1} ref={notice}>
          {said.text}
        </Notice>
      )}

      {young && (
        <Notice role="status">
          {t("ow.op_young", { months: completeMonths(MIN_MONTHS_ANY) })}
        </Notice>
      )}

      {!young && <Lead data={data} followUp={followUp} confirmedCount={confirmed} title={titleOf(titles, data)} />}
      {/* the tips worth most a year come first, then the ones with a day, then what changed and where the money is */}
      <Tips areas={data.areas} today={data.today} scope={scope} onChanged={changed} area={area} onArea={setArea} />
      <Soon soon={data.soon} today={data.today} short={short} />
      <Changes changes={changes} since={since} areas={data.areas} titles={titles} />
      <Reach reach={data.reach} areas={data.areas} onPick={pick} />
      {/* the insights no finding covers: answered here like the findings */}
      <Others others={data.others} onChanged={changed} />
      <FollowUp
        followUp={followUp}
        areas={data.areas}
        titles={titles}
        scope={scope}
        onChanged={changed}
        head={{ title: t("ow.op_head"), sub: last && confirmed ? t("ow.op_confirmed", { count: confirmed, amount: money(last.confirmedCents, false) }) : undefined }}
      >
        {data.done.length > 0 ? <Outcomes data={data} outcomes={outcomes} /> : null}
      </FollowUp>
      <Rates rates={rates} />
      <Decided data={data} states={states} scope={scope} onChanged={changed} />
      <InputsCard given={inputs} today={data.today} scope={scope} onChanged={changed} />
    </div>
  );
}
