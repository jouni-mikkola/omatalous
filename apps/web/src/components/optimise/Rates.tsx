/**
 * Decision: how much room the budget needs if the reference rate moves, and whether a loan's margin or rate type is
 * worth taking to the bank. One row per loan: today's rate and payment, then each move of the reference rate with the
 * payment and its change, the year's interest under it. Every figure is `LoanRates` (core `loanRatesOf`); a fixed rate
 * has no moves and says so. No forecast: the moves are fixed steps.
 */
import { type LoanRates, RATE_MOVES_BP, type RateMove } from "@banking/core";
import { logoForInstitution } from "../../banks.ts";
import { money, rateText } from "../../format.ts";
import { useMeta } from "../../hooks.ts";
import { BankLogo } from "../BankLogo.tsx";
import { Section } from "../Section.tsx";
import { DeltaChip, MarkCell } from "../table/Cells.tsx";
import { RichTable } from "../table/RichTable.tsx";

/** "Viitekorko laskee 1 prosenttiyksikön", "Viitekorko nousee 2 prosenttiyksikköä": the move as words, no abbreviation. */
export const shiftHead = (bp: number) => {
  const n = Math.abs(bp / 100);
  return `Viitekorko ${bp < 0 ? "laskee" : "nousee"} ${n.toLocaleString("fi-FI")} ${n === 1 ? "prosenttiyksikön" : "prosenttiyksikköä"}`;
};
const unit = (months: number | null) => (months === null || months === 1 ? "kuussa" : `${months} kuukauden välein`);
const signed = (cents: number) => `${cents > 0 ? "+" : cents < 0 ? "−" : "±"}${money(Math.abs(cents))}`;

function MoveCell({ move, months }: { move: RateMove | undefined; months: number | null }) {
  if (!move || move.paymentCents === null) return <td className="num muted">–</td>;
  return (
    <td className="num rate-move" data-head={shiftHead(move.shiftBp)}>
      <span className="rate-pay">{money(move.paymentCents)}</span>
      <span className="sr-only"> {unit(months)}</span>
      {move.paymentChangeCents ? <DeltaChip delta={move.paymentChangeCents} text={signed(move.paymentChangeCents)} meaning="spend" /> : null}
      {move.interestCents !== null && <span className="tx-under">korkoa {money(move.interestCents, false)} vuodessa</span>}
      {move.movedBp !== null && move.movedBp !== move.shiftBp && <span className="tx-under">korko laskee vain {rateText(Math.abs(move.movedBp))} prosenttiyksikköä</span>}
    </td>
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
      title="Mitä koron nousu tai lasku tekisi lainoille?"
      sub={moving && up?.paymentChangeCents != null ? `${moving.name}: jos viitekorko nousee yhden prosenttiyksikön, erä kasvaa ${money(up.paymentChangeCents)} ${unit(moving.intervalMonths)}.` : undefined}
    >
      <div className="table-wrap">
        <RichTable density="comfortable" className="rates">
          <thead>
            <tr>
              <th scope="col">Laina</th>
              <th scope="col" className="num">
                Korko nyt
              </th>
              <th scope="col" className="num">
                Erä nyt
              </th>
              {RATE_MOVES_BP.map((s) => (
                <th key={s} scope="col" className="num">
                  {shiftHead(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rates.map((l) => {
              const src = logo(l.lender);
              return (
                <tr key={l.loanId}>
                  <td>
                    <MarkCell name={l.name} mark={src ? <BankLogo src={src} name={l.lender ?? l.name} size="sm" /> : undefined}>
                      <span className="rt-who-text">
                        <span>{l.name}</span>
                        {l.balanceCents !== null && <span className="tx-under">{money(l.balanceCents, false)} jäljellä</span>}
                      </span>
                    </MarkCell>
                  </td>
                  <td className="num" data-head="Korko nyt">
                    {l.rateBp !== null ? `${rateText(l.rateBp)} %` : "–"}
                    {l.reference && <span className="tx-under">{l.reference}</span>}
                  </td>
                  <td className="num" data-head="Erä nyt">
                    {l.paymentCents !== null ? money(l.paymentCents) : "–"}
                    {l.interestCents !== null && <span className="tx-under">korkoa {money(l.interestCents, false)} vuodessa</span>}
                  </td>
                  {l.moves.length ? (
                    RATE_MOVES_BP.map((s) => <MoveCell key={s} move={l.moves.find((m) => m.shiftBp === s)} months={l.intervalMonths} />)
                  ) : (
                    <td className="rates-fixed" colSpan={RATE_MOVES_BP.length}>
                      {l.reference === null || l.rateBp === null ? "Viitekorkoa tai korkoa ei ole kerrottu." : "Kiinteä korko: viitekoron muutos ei muuta erää."}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </RichTable>
      </div>
    </Section>
  );
}
