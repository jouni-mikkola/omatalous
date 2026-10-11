/** Types the Optimoi page reads from the server, the Finnish words it shows for a core code, and the card around a section. */
import type { CalcLine, DismissReason, Effort, EuroRange, FindingChange, FindingState, FollowUp, InputValue, IsoDate, OptimiseData } from "@banking/core";
import type { ReactNode } from "react";
import { money } from "../../format.ts";

/** An input as the server stores it: its value and the day it was typed in. */
export interface InputRow {
  key: string;
  value: InputValue;
  asOf: IsoDate;
}

/** `GET /api/optimise`: the page, the viewer's own inputs and decisions, the changes since last month and the follow-up. */
export interface OptimiseResponse {
  data: OptimiseData;
  inputs: InputRow[];
  states: FindingState[];
  changes: FindingChange[];
  followUp: FollowUp;
}

export interface EvidenceRow {
  id: string;
  date: IsoDate;
  merchant: string;
  amountCents: number;
  accountId: string;
  account: string;
  struck: boolean;
}

/** `GET /api/optimise/evidence`: the finding recomputed, with the rows it stands on. */
export interface EvidenceResponse {
  id: string;
  calc: CalcLine[];
  rows: EvidenceRow[];
  sums: { month: string; cents: number }[];
}

/** Called after something was saved; the page fetches again and says what happened. */
export type Changed = (message: string) => void;

export const EFFORT_TEXT: Record<Effort, string> = { minuutteja: "Kestää minuutteja", tunti: "Kestää tunnin", ilta: "Vie illan" };

/** The four answers to Ei koske meitä, as the household reads them. */
export const REASON_TEXT: Record<DismissReason, string> = {
  need_it: "Tarvitsen tämän",
  compared: "Olen jo kilpailuttanut",
  wrong: "Arvio on väärä",
  cannot: "En voi vaikuttaa",
};

/** "2 100–3 600 €", or null when the range is one figure at the precision the page shows. */
export function rangeText(e: Pick<EuroRange, "lowCents" | "highCents">): string | null {
  const low = money(e.lowCents, false);
  const high = money(e.highCents, false);
  return low === high ? null : `${low.replace(/\s€$/, "")}–${high}`;
}

/** The merchant of a recurring series id (`out:<account>:<merchant>#habit`); any other subject is returned as it is. */
export function subjectName(subject: string): string {
  return /^(?:in|out):[^:]*:(.+?)(?:#(?:habit|-?\d+))?$/su.exec(subject)?.[1] ?? subject;
}

/** The card around one section of the page, a named region for screen readers. */
export function SectionCard({ id, title, sub, children }: { id: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card" id={id} aria-labelledby={`${id}-h`}>
      <div className="card-head">
        <div>
          <h2 id={`${id}-h`}>{title}</h2>
          {sub && <div className="card-sub">{sub}</div>}
        </div>
      </div>
      {children}
    </section>
  );
}
