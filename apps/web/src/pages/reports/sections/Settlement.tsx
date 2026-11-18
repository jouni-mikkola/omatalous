// Decision: who owes whom on the joint account this month, and how much to pay to settle
// One block per month and joint account; the route lists only accounts the user is weighted in.
import type { Settlement, SettlementLine } from "@banking/core";
import { useState } from "react";
import { MemberBars } from "../../../charts/forms/MemberBars.tsx";
import { Section } from "../../../components/Section.tsx";
import { date, money, monthLong } from "../../../format.ts";
import { useApi } from "../../../hooks.ts";
import type { Meta } from "../../../types.ts";
import { isJoint } from "../../settings/account-use.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { addMonths, isSharedCredit, monthRange, NETTED_SOURCE, settlementSums } from "@banking/core";
import { hasNothing, holderNameOf } from "./settlement-text.ts";
import { Notice } from "../../../components/ui/Notice.tsx";
import { Empty } from "../../../components/ui/Empty.tsx";
import { t } from "../../../text.ts";
interface Answer {
  month: string;
  pools: { accountId: string; name: string; firstMonth: string | null; names: Record<string, string>; removed: string[]; labels: Record<string, string>; settlement: Settlement }[];
}

/** The running month back to the oldest first month of the pools, newest first: the page has its own month menu and takes nothing from the period. */
function settlementMonths(today: string, pools: Answer["pools"]): string[] {
  const running = today.slice(0, 7);
  const first = pools.reduce<string>((oldest, p) => (p.firstMonth !== null && p.firstMonth < oldest ? p.firstMonth : oldest), running);
  return monthRange(first, running).reverse();
}

/** What an unknown source is called on the page: the words of the payer's own rows where the answer has them. */
function unknownName(owner: string, labels: Record<string, string>, holder: string | null): string {
  if (owner === "u:") return holder ?? t("rpt.se_no_login");
  if (owner.startsWith("g:iban:")) return t("rpt.se_foreign");
  if (owner === "o") return t("rpt.se_opening");
  if (owner === NETTED_SOURCE) return t("rpt.se_unknown_payer");
  if (owner === "c" || isSharedCredit(owner)) return t("rpt.se_credit");
  return labels[owner] ?? t("rpt.se_unknown_payer");
}

/** The line of a member who paid more or less than the share; nothing when it came out even. */
const overLine = (over: number): { label: string; cents: number } | null => (over === 0 ? null : { label: t(over > 0 ? "rpt.se_over_more" : "rpt.se_over_less"), cents: Math.abs(over) });

/** A correction older than this many months is folded: it changed a month the household settled long ago. */
const LATE_SHOWN_MONTHS = 12;

function LateRows({ lines }: { lines: SettlementLine[] }) {
  return (
    <>
      {lines.map((l) => (
        <div key={`${l.key}:${l.day}`} className="st-row">
          <span className="st-name">{t("rpt.se_late", { month: monthLong(l.key) })}</span>
          {/* to the cent, as every other row of the block: a sum under a euro is no ±0 */}
          <span className="st-num">
            {l.cents > 0 ? "+" : "−"}
            {money(Math.abs(l.cents))}
          </span>
        </div>
      ))}
    </>
  );
}

function Pool({ pool, month, holder }: { pool: Answer["pools"][number]; month: string; holder: string | null }) {
  const s = pool.settlement;
  // a correction that moved who paid and left the sum at 0,00 has no figure to show: the members' rows hold what it changed
  const corrections = s.lines.filter((l: SettlementLine) => l.kind === "late_change" && l.cents !== 0);
  const cutoff = addMonths(month, -LATE_SHOWN_MONTHS);
  const late = corrections.filter((l) => l.key >= cutoff);
  const older = corrections.filter((l) => l.key < cutoff);
  // what the page shows is core's sums: it adds up nothing of its own
  const { transfers, owedCents: owedTotal, untoldCents: untold, heldBackCents: heldBack, creditCents: credits, debtCents: debts, openCents: open } = settlementSums(s);
  // a block of its own after the users: money no user of the pool paid or owes reads as nobody's
  const unknown = [
    ...s.unknownPaidBy.map((e) => ({ label: t("rpt.se_paid_by", { name: unknownName(e.owner, pool.labels, holder) }), cents: e.cents })),
    ...s.unknownOwedBy.map((e) => ({ label: t("rpt.se_share_of", { name: unknownName(e.owner, pool.labels, holder) }), cents: e.cents })),
    ...(heldBack > 0 ? [{ label: t("rpt.se_card_holder"), cents: heldBack }] : []),
  ].filter((u) => u.cents !== 0);
  const nameOf = (owner: string): string => (owner === "u:" ? unknownName(owner, pool.labels, holder) : (pool.names[owner] ?? (pool.removed.includes(owner) ? t("rpt.se_removed") : owner)));
  // no split told: every member reads 0,00 paid and 0,00 share, so the block of the untold sum is all there is to say
  const noSplit = untold !== 0 && s.members.every((m) => m.paid === 0 && m.owed === 0);
  const even = credits === 0 && debts === 0 && unknown.length === 0 && untold === 0;
  const owes = even || transfers.length > 0;
  return (
    <div className="settle-pool" role="group" aria-label={t("rpt.se_group", { name: pool.name })}>
      <h3 className="use-head">
        {pool.name}
        {!s.status.open && s.status.closedOn && <span className="badge">{` ${t("rpt.se_closed", { date: date(s.status.closedOn) })}`}</span>}
      </h3>
      {!noSplit && owes && (
        <div className="st-rows" role="group" aria-label={t("rpt.se_who")}>
          {even && (
            <div className="st-row">
              <span className="st-name">{t("rpt.se_even")}</span>
            </div>
          )}
          {transfers.map((x) => (
            <div key={`${x.from}>${x.to}`} className="st-row">
              <span className="st-name">{`${nameOf(x.from)} → ${nameOf(x.to)}`}</span>
              <span className="st-num">{money(x.cents)}</span>
            </div>
          ))}
          {transfers.length > 0 && (
            <div className="st-row st-total">
              <span className="st-name">{t("rpt.total")}</span>
              <span className="st-num">{money(owedTotal)}</span>
            </div>
          )}
        </div>
      )}
      {/* the holder with no login is a party of its own where core knows their share (two holders, an equal split) */}
      {!noSplit && s.members.length > 0 && <MemberBars members={s.members.map((m) => ({ key: m.owner, name: nameOf(m.owner), paidCents: m.paid, shareCents: m.owed, over: overLine(m.over) }))} paidLabel={t("rpt.se_paid")} shareLabel={t("rpt.se_share")} />}
      {untold !== 0 && (
        <div className="st-rows" role="group" aria-label={t("rpt.se_untold")}>
          <div className="st-row">
            <strong className="st-name">{t("rpt.se_untold")}</strong>
          </div>
          <div className="st-row">
            <span className="st-name">{t("rpt.se_no_shares")}</span>
            <span className="st-num">{money(untold)}</span>
          </div>
        </div>
      )}
      {/* one row for what no user paid or owes: its sum is the difference the transfers leave, and its sources open under it */}
      {(unknown.length > 0 || open > 0) && (
        <details className="st-rows">
          <summary className="st-row">
            <span className="st-name">{t("rpt.se_unknown")}</span>
            {open > 0 && <span className="st-num">{money(open)}</span>}
          </summary>
          {unknown.map((u) => (
            <div key={u.label} className="st-row">
              <span className="st-name" title={u.label}>{u.label}</span>
              <span className="st-num">{money(u.cents)}</span>
            </div>
          ))}
        </details>
      )}
      {late.length > 0 && (
        <div className="st-rows">
          <LateRows lines={late} />
        </div>
      )}
      {older.length > 0 && (
        <details className="st-rows">
          <summary className="st-row">
            <span className="st-name">{t("rpt.se_late_older", { months: LATE_SHOWN_MONTHS })}</span>
          </summary>
          <LateRows lines={older} />
        </details>
      )}
    </div>
  );
}

function Month({ month, meta }: { month: string; meta: Meta }) {
  const { data: answer, error } = useApi<Answer>(`/api/settlement?month=${month}`);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!answer) return <Empty>{t("rpt.loading")}</Empty>;
  const pools = answer.pools.filter((p) => !hasNothing(p.settlement));
  if (!pools.length) return <Empty>{t("rpt.se_none")}</Empty>;
  return (
    <>
      {pools.map((p) => (
        <Pool key={p.accountId} pool={p} month={answer.month} holder={holderNameOf([...meta.accounts, ...meta.sharedAccounts].find((a) => a.id === p.accountId)?.use)} />
      ))}
    </>
  );
}

function Settlements({ ctx }: SectionProps) {
  // the month that is running is in the list and opens first: a correction to a closed month lands there
  const running = ctx.meta.today.slice(0, 7);
  const { data: now } = useApi<Answer>(`/api/settlement?month=${running}`);
  const months = settlementMonths(ctx.meta.today, now?.pools ?? []);
  const [month, setMonth] = useState(running);
  return (
    <Section
      id={section.id}
      title={section.title}
      actions={
        <select value={month} aria-label={t("rpt.month")} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
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
  get title() {
    return t("rpt.sec_settlement");
  },
  order: 65,
  page: "reports",
  reports: [],
  // only a user who is weighted in a joint account has a share to settle
  visible: (ctx) => ctx.meta.accounts.some((a) => a.use && isJoint(a.use) && a.use.users.some((u) => u.userId === ctx.meta.user.id && u.weight > 0)),
  Component: Settlements,
};
