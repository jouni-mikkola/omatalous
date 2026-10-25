// Decision: which days and weekdays the money goes on, and whether a big day was a one-off
import { Table } from "../../../components/table/Table.tsx";
import { CalendarHeat } from "../../../charts/CalendarHeat.tsx";
import { QuestionChart, ReportPanel } from "../../../charts/forms/parts.tsx";
import { dayHeading, money } from "../../../format.ts";
import type { ReportSection, SectionProps } from "../types.ts";

const WEEKDAYS = ["Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai", "Sunnuntai"];
const ON_WEEKDAY = ["maanantaisin", "tiistaisin", "keskiviikkoisin", "torstaisin", "perjantaisin", "lauantaisin", "sunnuntaisin"];
const QUESTION = "Minä päivinä rahaa menee?";

/** Whole weeks the calendar needs before it says no weekday stands out: core judges a lead from eight on. */
const LEAD_WEEKS = 8;

/**
 * The answer: the weekday core found standing out of the weeks (`weekdayLead`), or that none does, the days after pay
 * when core tells them, and what the days leave out. The page names no day of its own: one of seven means is always
 * the highest.
 */
function answer(r: SectionProps["ctx"]["data"]["days"]): string {
  const lead = r.weekdayLead;
  const habit = lead
    ? `Rahaa menee eniten ${ON_WEEKDAY[lead.weekday]}, keskimäärin ${money(lead.cents, false)} päivässä, muina päivinä ${money(lead.restCents, false)}. `
    : r.days.length >= LEAD_WEEKS * 7
      ? "Viikonpäivien välillä ei ole selvää eroa. "
      : "";
  const pay = r.payday
    ? `Palkkapäivänä ja kolmena seuraavana päivänä rahaa menee ${r.payday.ratio.toFixed(1).replace(".", ",")} kertaa nopeammin kuin palkkaa edeltävällä viikolla, ${money(r.payday.extraCents, false)} palkkajaksossa enemmän. `
    : "";
  const left = r.recurringCents > 0 ? ` Toistuvat laskut (${money(r.recurringCents, false)}) eivät ole mukana: niiden päivän päättää laskuttaja.` : "";
  const usual = r.usualDayCents === null ? "" : `Tavallinen ostospäivä on ${money(r.usualDayCents, false)}.`;
  return `${habit}${pay}${usual}${left}`;
}

/** The window of the calendar for the panel's head (critic round 3: the page's period is longer): "26 viikon". */
const span = (days: number) => (days % 7 === 0 ? `${days / 7} viikon` : `${days} päivän`);

function DaysTable({ r, today }: { r: SectionProps["ctx"]["data"]["days"]; today: string }) {
  return (
    <>
      <Table
        caption="Menot viikonpäivittäin, keskimäärin"
        rows={WEEKDAYS.map((w, i) => ({ day: w, cents: r.weekdayAvgCents[i] ?? null }))}
        rowKey={(x) => x.day}
        columns={[
          { key: "day", label: "Viikonpäivä", kind: "text", rowHead: true, cell: (x) => x.day },
          { key: "avg", label: "Keskimäärin", kind: "money", main: true, cell: (x) => (x.cents === null ? "" : money(x.cents, false)) },
        ]}
      />
      <Table
        caption="Menot päivittäin"
        page={31}
        rows={r.days.filter((d) => d.count > 0).reverse()}
        rowKey={(d) => d.date}
        columns={[
          { key: "date", label: "Päivä", kind: "text", rowHead: true, cell: (d) => dayHeading(d.date, today) },
          { key: "count", label: "Ostoksia", kind: "count", cell: (d) => d.count },
          { key: "spend", label: "Menot", kind: "money", main: true, cents: (d) => d.cents },
        ]}
      />
    </>
  );
}

function Days({ ctx }: SectionProps) {
  const r = ctx.data.days;
  const today = ctx.meta.today;
  return (
    <ReportPanel id={section.id} title={section.title} datum={`${span(r.days.length)} menot ${money(r.totalCents, false)}`}>
      <QuestionChart id="paivat-kalenteri" question={QUESTION} answer={answer(r)} table={<DaysTable r={r} today={today} />}>
        <CalendarHeat
          question={QUESTION}
          days={r.days}
          weeks={r.weeks}
          top={r.top}
          weekdayAvgCents={r.weekdayAvgCents}
          usualCents={r.usualDayCents}
          today={today}
          topNote={(d) => (
            <>
              {dayHeading(d.date, today)} <b>{money(d.cents, false)}</b>
              <span className="muted">
                suurin {d.merchant} {money(d.merchantCents, false)}
              </span>
            </>
          )}
        />
      </QuestionChart>
    </ReportPanel>
  );
}

export const section: ReportSection = {
  id: "paivat",
  title: "Menot päivittäin",
  order: 35,
  page: "reports",
  tab: "menot",
  reports: ["days"],
  visible: (ctx) => ctx.data.days.days.length > 0,
  Component: Days,
};
