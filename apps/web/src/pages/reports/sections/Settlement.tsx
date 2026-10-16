// Decision: who has paid more than their share of the joint account, and what to settle
// One block per month and joint account; the route lists only accounts the user is weighted in.
import type { Settlement, SettlementLine } from "@banking/core";
import { useState } from "react";
import { Section } from "../../../components/Section.tsx";
import { date, money, monthLong, signedMoney } from "../../../format.ts";
import { useApi } from "../../../hooks.ts";
import type { Meta } from "../../../types.ts";
import { isJoint } from "../../settings/account-use.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { hasNothing, holderNameOf } from "./settlement-text.ts";

interface Answer {
  month: string;
  pools: { accountId: string; name: string; names: Record<string, string>; removed: string[]; labels: Record<string, string>; settlement: Settlement }[];
}

/** The months from the start of the shown range to `to`, newest first. */
function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  let [y = 0, m = 1] = to.slice(0, 7).split("-").map(Number);
  const first = from.slice(0, 7);
  for (let i = 0; i < 36; i++) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    if (month < first) break;
    out.push(month);
    if (--m === 0) [y, m] = [y - 1, 12];
  }
  return out;
}

/** What an unknown source is called on the page: the words of the payer's own rows where the answer has them. */
function unknownName(owner: string, labels: Record<string, string>, holder: string | null): string {
  if (owner === "u:") return holder ?? "Tilin omistaja, jolla ei ole tunnusta";
  if (owner.startsWith("g:iban:")) return "Tuntemattomalta tililtä";
  if (owner === "o") return "Alkusaldo";
  if (owner === "c") return "Maksettu luotolla";
  return labels[owner] ?? "Tuntematon maksaja";
}

/** The line of a member who paid more or less than the share; nothing when it came out even. */
const overLine = (over: number): { label: string; cents: number } | null => (over === 0 ? null : { label: over > 0 ? "Maksanut enemmän kuin osuutensa" : "Maksanut vähemmän kuin osuutensa", cents: Math.abs(over) });

function Pool({ pool, holder }: { pool: Answer["pools"][number]; holder: string | null }) {
  const s = pool.settlement;
  const late = s.lines.filter((l: SettlementLine) => l.kind === "late_change");
  const heldBack = s.unknownHolder.reduce((sum, h) => sum + h.cents, 0);
  // a block of its own after the users: money no user of the pool paid or owes reads as nobody's
  const unknown = [
    ...s.unknownPaidBy.map((e) => ({ label: `Maksanut: ${unknownName(e.owner, pool.labels, holder)}`, cents: e.cents })),
    ...s.unknownOwedBy.map((e) => ({ label: `Osuus: ${unknownName(e.owner, pool.labels, holder)}`, cents: e.cents })),
    ...(heldBack > 0 ? [{ label: "Kortin haltija", cents: heldBack }] : []),
  ].filter((u) => u.cents !== 0);
  return (
    <div className="settle-pool" role="group" aria-label={`Yhteiset menot: ${pool.name}`}>
      <h3 className="use-head">
        {pool.name}
        {!s.status.open && s.status.closedOn && <span className="badge">lukittu {date(s.status.closedOn)}</span>}
      </h3>
      {s.members.map((m) => {
        const line = overLine(m.over);
        return (
          <div key={m.owner} className="st-rows" role="group" aria-label={pool.names[m.owner] ?? (pool.removed.includes(m.owner) ? "poistettu jäsen" : m.owner)}>
            <div className="st-row">
              <strong className="st-name">{pool.names[m.owner] ?? (pool.removed.includes(m.owner) ? "poistettu jäsen" : m.owner)}</strong>
            </div>
            <div className="st-row">
              <span className="st-name">Maksanut</span>
              <span className="st-num">{money(m.paid)}</span>
            </div>
            <div className="st-row">
              <span className="st-name">Osuus</span>
              <span className="st-num">{money(m.owed)}</span>
            </div>
            {line && (
              <div className="st-row">
                <span className="st-name">{line.label}</span>
                <span className="st-num">{money(line.cents)}</span>
              </div>
            )}
          </div>
        );
      })}
      {unknown.length > 0 && (
        <div className="st-rows" role="group" aria-label="Ei tiedossa">
          <div className="st-row">
            <strong className="st-name">Ei tiedossa</strong>
          </div>
          {unknown.map((u) => (
            <div key={u.label} className="st-row">
              <span className="st-name" title={u.label}>{u.label}</span>
              <span className="st-num">{money(u.cents)}</span>
            </div>
          ))}
        </div>
      )}
      {late.length > 0 && (
        <div className="st-rows">
          {late.map((l) => (
            <div key={`${l.key}:${l.day}`} className="st-row">
              <span className="st-name">Korjaus aiempaan kuukauteen: {monthLong(l.key)}</span>
              <span className="st-num">{signedMoney(l.cents)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Month({ month, meta }: { month: string; meta: Meta }) {
  const { data: answer, error } = useApi<Answer>(`/api/settlement?month=${month}`);
  if (error) return <div className="error">{error}</div>;
  if (!answer) return <div className="empty">Ladataan…</div>;
  const pools = answer.pools.filter((p) => !hasNothing(p.settlement));
  if (!pools.length) return <div className="empty">Ei yhteisiä menoja tältä kuukaudelta.</div>;
  return (
    <>
      {pools.map((p) => (
        <Pool key={p.accountId} pool={p} holder={holderNameOf([...meta.accounts, ...meta.sharedAccounts].find((a) => a.id === p.accountId)?.use)} />
      ))}
    </>
  );
}

function Settlements({ ctx }: SectionProps) {
  // the month that is running is in the list: a correction to a closed month lands there
  const last = ctx.range.to.slice(0, 7);
  const months = monthsOf(ctx.range.from, ctx.meta.today > ctx.range.to ? ctx.meta.today : ctx.range.to);
  const [month, setMonth] = useState(months.includes(last) ? last : (months[0] ?? last));
  return (
    <Section
      id={section.id}
      title={section.title}
      actions={
        <select value={month} aria-label="Kuukausi" onChange={(e) => setMonth(e.target.value)}>
          {(months.length ? months : [month]).map((m) => (
            <option key={m} value={m}>
              {monthLong(m)}
            </option>
          ))}
        </select>
      }
    >
      <Month key={month} month={month} meta={ctx.meta} />
    </Section>
  );
}

export const section: ReportSection = {
  id: "yhteiset-menot",
  title: "Yhteiset menot",
  order: 65,
  page: "reports",
  reports: [],
  // only a user who is weighted in a joint account has a share to settle
  visible: (ctx) => ctx.meta.accounts.some((a) => a.use && isJoint(a.use) && a.use.users.some((u) => u.userId === ctx.meta.user.id && u.weight > 0)),
  Component: Settlements,
};
