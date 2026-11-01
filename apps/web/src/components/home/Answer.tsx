// Decision: do the money in the accounts last to the next payday, and how much is left after the bills
import { useId, useState } from "react";
import { money } from "../../format.ts";
import { t } from "../../text.ts";
import { Figure } from "../Figure.tsx";
import { type Ahead, payments } from "../next-days.ts";
import { type Column, Table } from "../table/Table.tsx";
import { Button } from "../ui/Button.tsx";
import { answerText, type RunwayData, questionText } from "./texts.ts";

type Line = ReturnType<typeof payments>[number];

/** The payments of the window one by one: the same rows the sum row adds up, opened by Näytä maksut. */
function PaymentList({ ahead }: { ahead: Ahead }) {
  const rows = payments(ahead);
  const columns: Column<Line>[] = [
    { key: "day", label: t("home.col_due"), kind: "text", cell: (l) => l.day },
    { key: "payee", label: t("home.col_payee"), kind: "text", rowHead: true, cell: (l) => l.name },
    { key: "sum", label: t("home.col_sum"), kind: "money", main: true, precision: "cents", cents: (l) => l.cents },
  ];
  return <Table<Line> caption={t("home.payments_before_payday")} rows={rows} rowKey={(l) => `${l.day}${l.name}${l.cents}`} columns={columns} />;
}

/**
 * The first block of Yhteenveto: the question, its answer in one sentence ending on the sum left after the payments, what
 * that is a day and on the payday, and the sum row that shows how it is made (balance less payments is what is left, to the cent; the sentence rounds it to whole euros).
 * Every figure is a field of `home.runway`; nothing is added up here. Näytä maksut opens the payments the row adds up.
 */
export function Answer({ runway, ahead, line }: { runway: RunwayData; ahead: Ahead | null; line: string }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const text = answerText(runway);
  const { sum } = runway;
  return (
    <section className="home-answer" aria-labelledby="home-question">
      <div className="home-answer-main">
        <p className="home-eyebrow">{line}</p>
        <h2 id="home-question" className="home-question">
          {questionText(runway)}
        </h2>
        <p className={`home-answer-line home-${runway.verdict}`} role="status">
          {text.lead}
          {text.cents !== null && (
            <>
              {" "}
              <Figure text={money(text.cents, false)} size="l" />
            </>
          )}
        </p>
        {text.detail.map((sentence) => (
          <p key={sentence} className="home-detail">
            {sentence}
          </p>
        ))}
      </div>
      {sum && (
        <div className="home-sum">
          <dl className="home-sum-row">
            <div>
              <dt>{t("home.accounts_balance")}</dt>
              <dd className="num">{money(sum.balanceCents)}</dd>
            </div>
            <div>
              <dt>{t("home.payments_before_payday")}</dt>
              <dd className="num">−{money(sum.paymentsCents)}</dd>
            </div>
            <div className="home-sum-left">
              <dt>{t("home.left")}</dt>
              <dd className="num">{money(sum.freeCents)}</dd>
            </div>
          </dl>
          {ahead && payments(ahead).length > 0 && (
            <>
              <Button variant="link" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={listId}>
                {open ? t("home.hide_payments") : t("home.show_payments")}
              </Button>
              <div id={listId} hidden={!open}>
                {open && <PaymentList ahead={ahead} />}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

