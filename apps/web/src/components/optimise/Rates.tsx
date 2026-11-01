/**
 * Decision: how much room the budget needs if the reference rate moves, and whether a loan's margin or rate type is
 * worth taking to the bank. One row per loan: today's rate and payment, then each move of the reference rate with the
 * payment and its change, the year's interest under it. Every figure is `LoanRates` (core `loanRatesOf`); a fixed rate
 * has no moves and says so. No forecast: the moves are fixed steps.
 */
import { type LoanRates, RATE_MOVES_BP, type RateMove } from "@banking/core";
import { logoForInstitution } from "../../banks.ts";
import { money, plainNumber, rateText } from "../../format.ts";
import { t } from "../../text.ts";
import { useMeta } from "../../hooks.ts";
import { BankLogo } from "../BankLogo.tsx";
import { Section } from "../Section.tsx";
import { DeltaChip, MarkCell } from "../table/Cells.tsx";
import { type Column, Table } from "../table/Table.tsx";

/** "Viitekorko laskee 1 prosenttiyksikön", "Viitekorko nousee 2 prosenttiyksikköä": the move as words, no abbreviation. */
export const shiftHead = (bp: number) => {
  const n = Math.abs(bp / 100);
  return t(`ow.rt_${bp < 0 ? "down" : "up"}_${n === 1 ? "one" : "many"}`, { n: plainNumber(n) });
};
const unit = (months: number | null) => (months === null || months === 1 ? t("ow.rt_unit_month") : t("ow.rt_unit_every", { months }));
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : "±"}${money(Math.abs(cents))}`;

function MoveCell({ move, months }: { move: RateMove | undefined; months: number | null }) {
  if (!move || move.paymentCents === null) return <span className="muted">–</span>;
  return (
    <>
      <span className="rate-pay">{money(move.paymentCents)}</span>
      <span className="sr-only"> {unit(months)}</span>
      {move.paymentChangeCents ? <DeltaChip delta={move.paymentChangeCents} text={signed(move.paymentChangeCents)} meaning="spend" /> : null}
      {move.interestCents !== null && <span className="sub">{t("ow.rt_interest", { amount: money(move.interestCents, false) })}</span>}
      {move.movedBp !== null && move.movedBp !== move.shiftBp && <span className="sub">{t("ow.rt_moved_only", { n: rateText(Math.abs(move.movedBp)) })}</span>}
    </>
  );
}

export function Rates({ rates }: { rates: readonly LoanRates[] }) {
  const meta = useMeta();
  if (!rates.length) return null;
  const moving = rates.find((l) => l.moves.some((m) => m.shiftBp === 100 && m.paymentChangeCents !== null));
  const up = moving?.moves.find((m) => m.shiftBp === 100);
  const logo = (lender: string | null) => (lender && meta ? logoForInstitution(lender, meta.bank.banks) : null);
  return (
    <Section
      id="korot"
      title={t("ow.rt_title")}
      sub={moving && up?.paymentChangeCents != null ? t("ow.rt_sub", { name: moving.name, amount: money(up.paymentChangeCents), unit: unit(moving.intervalMonths) }) : undefined}
    >
      <Table<LoanRates>
        caption={t("ow.rt_caption")}
        className="rates"
        rows={[...rates]}
        rowKey={(l) => l.loanId}
        columns={[
          {
            key: "loan",
            label: t("ow.rt_loan"),
            kind: "text",
            rowHead: true,
            cell: (l) => {
              const src = logo(l.lender);
              return (
                <>
                  <MarkCell name={l.name} mark={src ? <BankLogo src={src} name={l.lender ?? l.name} size="sm" /> : undefined}>
                    <span className="rt-who-text">
                      <span>{l.name}</span>
                      {l.balanceCents !== null && <span className="sub">{t("ow.rt_left", { amount: money(l.balanceCents, false) })}</span>}
                    </span>
                  </MarkCell>
                  {!l.moves.length && <span className="sub rates-fixed">{l.reference === null || l.rateBp === null ? t("ow.rt_unknown") : t("ow.rt_fixed")}</span>}
                </>
              );
            },
          },
          {
            key: "rate",
            label: t("ow.rt_rate_now"),
            kind: "count",
            cell: (l) => (
              <>
                {l.rateBp !== null ? `${rateText(l.rateBp)} %` : "–"}
                {l.reference && <span className="sub">{l.reference}</span>}
              </>
            ),
          },
          {
            key: "payment",
            label: t("ow.rt_pay_now"),
            kind: "money",
            main: true,
            cell: (l) => (
              <>
                {l.paymentCents !== null ? money(l.paymentCents) : "–"}
                {l.interestCents !== null && <span className="sub">{t("ow.rt_interest", { amount: money(l.interestCents, false) })}</span>}
              </>
            ),
          },
          ...RATE_MOVES_BP.map((s): Column<LoanRates> => ({
            key: `move${s}`,
            label: shiftHead(s),
            kind: "money",
            className: () => "rate-move",
            cell: (l) => (l.moves.length ? <MoveCell move={l.moves.find((m) => m.shiftBp === s)} months={l.intervalMonths} /> : <span className="muted">–</span>),
          })),
        ]}
      />
    </Section>
  );
}
