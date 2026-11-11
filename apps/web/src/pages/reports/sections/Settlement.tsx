// Decision: who owes whom on the joint account this month, and how much to pay to settle
// One block per month and joint account; the route lists only accounts the user is weighted in.
import type { Settlement, SettlementLine } from "@banking/core";
import { useState } from "react";
import { Section } from "../../../components/Section.tsx";
import { date, money, monthLong, signedMoney } from "../../../format.ts";
import { useApi } from "../../../hooks.ts";
import type { Meta } from "../../../types.ts";
import { isJoint } from "../../settings/account-use.ts";
import type { ReportSection, SectionProps } from "../types.ts";
import { SETTINGS_ANCHOR, settingsCardHash } from "../../../routes.ts";
import { transfersOf } from "@banking/core";
import { hasNothing, holderNameOf, untoldTotal } from "./settlement-text.ts";
import { Notice } from "../../../components/ui/Notice.tsx";
import { Empty } from "../../../components/ui/Empty.tsx";
import { t } from "../../../text.ts";
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
  if (owner === "u:") return holder ?? t("rpt.se_no_login");
  if (owner.startsWith("g:iban:")) return t("rpt.se_foreign");
  if (owner === "o") return t("rpt.se_opening");
  if (owner === "c") return t("rpt.se_credit");
  return labels[owner] ?? t("rpt.se_unknown_payer");
}

/** The line of a member who paid more or less than the share; nothing when it came out even. */
const overLine = (over: number): { label: string; cents: number } | null => (over === 0 ? null : { label: t(over > 0 ? "rpt.se_over_more" : "rpt.se_over_less"), cents: Math.abs(over) });

function Pool({ pool, holder }: { pool: Answer["pools"][number]; holder: string | null }) {
  const s = pool.settlement;
  const late = s.lines.filter((l: SettlementLine) => l.kind === "late_change");
  const heldBack = s.unknownHolder.reduce((sum, h) => sum + h.cents, 0);
  // a block of its own after the users: money no user of the pool paid or owes reads as nobody's
  const unknown = [
    ...s.unknownPaidBy.map((e) => ({ label: t("rpt.se_paid_by", { name: unknownName(e.owner, pool.labels, holder) }), cents: e.cents })),
    ...s.unknownOwedBy.map((e) => ({ label: t("rpt.se_share_of", { name: unknownName(e.owner, pool.labels, holder) }), cents: e.cents })),
    ...(heldBack > 0 ? [{ label: t("rpt.se_card_holder"), cents: heldBack }] : []),
  ].filter((u) => u.cents !== 0);
  const untold = untoldTotal(s);
  const nameOf = (owner: string): string => (owner === "u:" ? unknownName(owner, pool.labels, holder) : (pool.names[owner] ?? (pool.removed.includes(owner) ? t("rpt.se_removed") : owner)));
  const transfers = transfersOf(s.members);
  const owedTotal = transfers.reduce((sum, x) => sum + x.cents, 0);
  // money nobody has told the owner of leaves a part of some member's over figure with no partner to pay it
  const credits = s.members.reduce((sum, m) => sum + Math.max(m.over, 0), 0);
  const debts = s.members.reduce((sum, m) => sum + Math.max(-m.over, 0), 0);
  const open = Math.abs(credits - debts);
  // no split told: every member reads 0,00 paid and 0,00 share, so the block of the untold sum is all there is to say
  const noSplit = untold !== 0 && s.members.every((m) => m.paid === 0 && m.owed === 0);
  const even = credits === 0 && debts === 0 && unknown.length === 0 && untold === 0;
  return (
    <div className="settle-pool" role="group" aria-label={t("rpt.se_group", { name: pool.name })}>
      <h3 className="use-head">
        {pool.name}
        {!s.status.open && s.status.closedOn && <span className="badge">{` ${t("rpt.se_closed", { date: date(s.status.closedOn) })}`}</span>}
      </h3>
      {!noSplit && (
        <div className="st-rows" role="group" aria-label={t("rpt.se_who")}>
          <div className="st-row">
            <strong className="st-name">{t("rpt.se_who")}</strong>
          </div>
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
          {open > 0 && (
            <div className="st-row">
              <span className="st-name">{t("rpt.se_open")}</span>
              <span className="st-num">{money(open)}</span>
            </div>
          )}
          {transfers.length > 0 && (
            <div className="st-row st-total">
              <span className="st-name">{t("rpt.total")}</span>
              <span className="st-num">{money(owedTotal)}</span>
            </div>
          )}
        </div>
      )}
      {!noSplit &&
        s.members.map((m) => {
          const line = overLine(m.over);
          // the holder with no login is a party of its own where core knows their share (two holders, an equal split)
          const name = nameOf(m.owner);
          return (
            <div key={m.owner} className="st-rows" role="group" aria-label={name}>
              <div className="st-row">
                <strong className="st-name">{name}</strong>
              </div>
              <div className="st-row">
                <span className="st-name">{t("rpt.se_paid")}</span>
                <span className="st-num">{money(m.paid)}</span>
              </div>
              <div className="st-row">
                <span className="st-name">{t("rpt.se_share")}</span>
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
      {untold !== 0 && (
        <div className="st-rows" role="group" aria-label={t("rpt.se_untold")}>
          <div className="st-row">
            <strong className="st-name">{t("rpt.se_untold")}</strong>
          </div>
          <div className="st-row">
            <span className="st-name">{t("rpt.se_no_shares")}</span>
            <span className="st-num">{money(untold)}</span>
          </div>
          <div className="st-row">
            <a href={settingsCardHash(SETTINGS_ANCHOR.accounts)}>{t("rpt.se_tell")}</a>
          </div>
        </div>
      )}
      {unknown.length > 0 && (
        <div className="st-rows" role="group" aria-label={t("rpt.se_unknown")}>
          <div className="st-row">
            <strong className="st-name">{t("rpt.se_unknown")}</strong>
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
              <span className="st-name">{t("rpt.se_late", { month: monthLong(l.key) })}</span>
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
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!answer) return <Empty>{t("rpt.loading")}</Empty>;
  const pools = answer.pools.filter((p) => !hasNothing(p.settlement));
  if (!pools.length) return <Empty>{t("rpt.se_none")}</Empty>;
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
        <select value={month} aria-label={t("rpt.month")} onChange={(e) => setMonth(e.target.value)}>
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
