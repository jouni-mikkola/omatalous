import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemesTable } from "../src/components/overview/ThemesTable.tsx";
import { OPEN_AT_FIRST, toggled } from "../src/components/overview/themes-table.ts";
import { parseEuros } from "../src/format.ts";
import type { DashboardData } from "../src/types.ts";

type Themes = NonNullable<DashboardData["themes"]>;
type ThemeSum = Themes["themes"][number];

/** A theme as a test writes it: its lines are [id, heading, cents a month, change]; the theme sums them. */
interface Spec {
  id: ThemeSum["id"];
  heading: string;
  lines: [id: string, heading: string, monthly: number, pct?: number][];
  pct?: number;
}
const spec = (id: Spec["id"], heading: string, lines: Spec["lines"], pct?: number): Spec => ({ id, heading, lines, ...(pct === undefined ? {} : { pct }) });

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** The answer of core for `months` months ending in September 2026, the themes as the specs say, largest first. */
function report(specs: Spec[], { months = 12, large = { cents: 0, count: 0, rows: [] } }: { months?: number; large?: Themes["large"] } = {}): Themes {
  const year = (monthly: number) => (months === 12 ? monthly * 12 : null);
  const themes = specs.map((s): ThemeSum => {
    const monthly = sum(s.lines.map((l) => l[2]));
    return {
      id: s.id,
      heading: s.heading,
      monthlyCents: monthly,
      yearCents: year(monthly),
      changePct: s.pct ?? null,
      lines: s.lines.map(([id, heading, cents, pct]) => ({ id, heading, monthlyCents: cents, yearCents: year(cents), changePct: pct ?? null })),
    };
  });
  const monthly = sum(themes.map((t) => t.monthlyCents));
  return {
    window: { first: months === 12 ? "2025-10" : `2026-${String(10 - months).padStart(2, "0")}`, last: "2026-09", months },
    themes,
    totalCents: monthly * months,
    totalMonthlyCents: monthly,
    totalYearCents: year(monthly),
    large,
    spendingCents: monthly * months + large.cents,
  };
}

const housing = spec("housing", "Asuminen", [["housing", "Vuokra ja vastike", 105_000], ["utilities", "Sähkö, vesi ja lämpö", 5_700]]);
const food = spec("food", "Ruoka", [["groceries", "Ruokakauppa", 59_000], ["restaurants", "Ravintolat ja kahvilat", 14_600], ["food_delivery", "Ruoan kotiinkuljetus", 21_700]]);
const car = spec("car", "Auto", [["fuel", "Polttoaine", 12_300], ["insurance", "Liikenne- ja autovakuutus", 9_900]]);
const transport = spec("transport", "Liikkuminen", [["transport", "Joukkoliikenne ja taksit", 7_400]]);
const insurance = spec("insurance", "Vakuutukset", [["insurance", "Vakuutukset", 4_700]]);
const typical = [housing, food, car, transport, insurance];

/** Nine themes of one line each, the largest first: 900 €, 800 € ... 100 € a month. */
const NINE = (["housing", "food", "car", "transport", "kids", "pets", "health", "media", "shopping"] as const).map((id, i) => spec(id, `Teema ${i + 1}`, [[`rivi-${i + 1}`, `Rivi ${i + 1}`, (9 - i) * 10_000]]));

/** The page's text as a reader sees it: plain spaces, plain minus. */
const plain = (s: string) => s.replace(/\s/g, " ").replace(/−/g, "-").trim();

const draw = (r: Themes, open: ReadonlySet<string> = OPEN_AT_FIRST) => renderToStaticMarkup(createElement(ThemesTable, { report: r, open, onToggle: () => {} }));

/** The rows of the table as they read: the class of the row, the text of each cell and whether it holds a bar. */
function rowsOf(html: string) {
  return [...html.matchAll(/<tr(?: class="([^"]*)")?>(.*?)<\/tr>/g)].map(([, cls = "", inner = ""]) => ({
    cls,
    html: inner,
    cells: [...inner.matchAll(/<(t[hd])([^>]*)>(.*?)<\/\1>/g)].map(([, , , cell = ""]) => plain(cell.replace(/<[^>]*>/g, ""))),
    bar: /<span style="width:([\d.]+)%">/.exec(inner)?.[1] ?? null,
  }));
}
const themeRows = (html: string) => rowsOf(html).filter((r) => r.cls === "themes-row");
const linesOf = (html: string) => rowsOf(html).filter((r) => r.cls === "themes-line");
const totalOf = (html: string) => rowsOf(html).find((r) => r.cls === "themes-total")!;
const centsOf = (cell: string | undefined) => parseEuros(cell ?? "")!;
/** The text of some markup: the tags gone, one space between words. */
const text = (html: string) => plain(html.replace(/<[^>]*>/g, " ")).replace(/ +/g, " ").trim();

describe("Menot kategorioittain: the table of themes", () => {
  it("has the heading with the window's months and years at its right", () => {
    const html = draw(report(typical));
    expect(text(html)).toMatch(/^Menot kategorioittain 10\/2025–9\/2026 /);
    expect(html).toContain('aria-labelledby="themes-h"');
    // a short window starts in a month of one digit
    expect(text(draw(report(typical, { months: 7 })))).toMatch(/^Menot kategorioittain 3\/2026–9\/2026 /);
  });

  it("twelve months draw the label, a bar and three figure columns, and each column adds up to Yhteensä as printed", () => {
    const withChange = report([{ ...housing, pct: 4 }, food, car, transport, insurance]);
    const html = draw(withChange);
    expect(rowsOf(html)[0]!.cells).toEqual(["", "", "Kuukaudessa", "Vuodessa", "Muutos"]);
    const themes = themeRows(html);
    expect(themes.map((r) => r.cells[0])).toEqual(["Asuminen", "Ruoka", "Auto", "Liikkuminen", "Vakuutukset"]);
    expect(themes[0]!.cells).toEqual(["Asuminen", "", "1 107,00 €", "13 284,00 €", "+4 %"]);
    const total = totalOf(html);
    expect(total.cells).toEqual(["Yhteensä", "", "2 403,00 €", "28 836,00 €", ""]);
    expect(sum(themes.map((r) => centsOf(r.cells[2])))).toBe(centsOf(total.cells[2]));
    expect(sum(themes.map((r) => centsOf(r.cells[3])))).toBe(centsOf(total.cells[3]));
    // the open theme's lines add up to its row
    const lines = linesOf(html);
    expect(lines.map((r) => r.cells[0])).toEqual(["Ruokakauppa", "Ravintolat ja kahvilat", "Ruoan kotiinkuljetus"]);
    expect(sum(lines.map((r) => centsOf(r.cells[2])))).toBe(centsOf(themes[1]!.cells[2]));
    expect(sum(lines.map((r) => centsOf(r.cells[3])))).toBe(centsOf(themes[1]!.cells[3]));
  });

  it("seven months draw no Vuodessa: no head, no cell, no dash", () => {
    const html = draw(report(typical, { months: 7 }));
    expect(html).not.toContain("Vuodessa");
    expect(rowsOf(html)[0]!.cells).toEqual(["", "", "Kuukaudessa"]);
    for (const row of rowsOf(html).slice(1)) expect(row.cells, row.cls).toHaveLength(3);
    expect(html).not.toContain("–</td>");
    expect(totalOf(html).cells).toEqual(["Yhteensä", "", "2 403,00 €"]);
    // the near miss: twelve months draw it
    expect(draw(report(typical))).toContain("Vuodessa");
  });

  it("draws Muutos only when some row has a change, a row without one has an empty cell, and a change of nothing is none", () => {
    expect(draw(report(typical))).not.toContain("Muutos");
    // a change on a line alone makes the column; the theme's own cell stays empty
    const onLine = draw(report([housing, spec("food", "Ruoka", [["groceries", "Ruokakauppa", 59_000, 7], ["restaurants", "Ravintolat ja kahvilat", 14_600]])]));
    expect(rowsOf(onLine)[0]!.cells.at(-1)).toBe("Muutos");
    expect(themeRows(onLine).map((r) => r.cells.at(-1))).toEqual(["", ""]);
    expect(linesOf(onLine).map((r) => r.cells.at(-1))).toEqual(["+7 %", ""]);
    // the sign is the answer's: a fall has a minus, a rise a plus
    const both = draw(report([{ ...housing, pct: -3 }, { ...food, pct: 12 }]));
    expect(themeRows(both).map((r) => r.cells.at(-1))).toEqual(["-3 %", "+12 %"]);
    // 0 is no change to print (core gives none), so it draws no column and no "0 %"; 1 % does
    const zero = draw(report([{ ...housing, pct: 0 }, food]));
    expect(zero).not.toContain("Muutos");
    expect(zero).not.toContain("0 %");
    expect(draw(report([{ ...housing, pct: 1 }, food]))).toContain("+1 %");
    // the total has no change to tell
    expect(totalOf(draw(report([{ ...housing, pct: 4 }, food]))).cells.at(-1)).toBe("");
  });

  it("names the seven largest themes and puts the rest in one row, Muut (n), whose figures are the sums of theirs", () => {
    const html = draw(report(NINE));
    const rows = themeRows(html);
    expect(rows.map((r) => r.cells[0])).toEqual(["Teema 1", "Teema 2", "Teema 3", "Teema 4", "Teema 5", "Teema 6", "Teema 7", "Muut (2)"]);
    // the eighth and ninth: 20 € and 10 € a month
    expect(rows[7]!.cells).toEqual(["Muut (2)", "", "300,00 €", "3 600,00 €"]);
    expect(rows[7]!.bar).toBeNull();
    expect(totalOf(html).cells.slice(2)).toEqual(["4 500,00 €", "54 000,00 €"]);
    expect(sum(rows.map((r) => centsOf(r.cells[2])))).toBe(centsOf(totalOf(html).cells[2]));
    // it opens to its themes, each with its own figures and none further
    const open = draw(report(NINE), new Set(["rest"]));
    expect(linesOf(open).map((r) => r.cells)).toEqual([
      ["Teema 8", "", "200,00 €", "2 400,00 €"],
      ["Teema 9", "", "100,00 €", "1 200,00 €"],
    ]);
    expect(open).toContain('aria-expanded="true"');
    // seven themes need no such row; eight have one that holds one
    expect(themeRows(draw(report(NINE.slice(0, 7)))).map((r) => r.cells[0])).not.toContain("Muut (2)");
    expect(themeRows(draw(report(NINE.slice(0, 7)))).every((r) => !r.cells[0]!.startsWith("Muut"))).toBe(true);
    expect(themeRows(draw(report(NINE.slice(0, 8)))).at(-1)!.cells[0]).toBe("Muut (1)");
  });

  it("the rest row carries a theme below zero with its minus, and the columns still add up", () => {
    const back = spec("education", "Koulutus", [["education", "Koulutus", -4_400]]);
    const eight = [...NINE.slice(0, 7), back];
    const html = draw(report(eight), new Set(["rest"]));
    const rows = themeRows(html);
    expect(rows.at(-1)!.cells).toEqual(["Muut (1)", "", "-44,00 €", "-528,00 €"]);
    expect(rows.at(-1)!.bar).toBeNull();
    expect(sum(rows.map((r) => centsOf(r.cells[2])))).toBe(centsOf(totalOf(html).cells[2]));
    expect(sum(rows.map((r) => centsOf(r.cells[3])))).toBe(centsOf(totalOf(html).cells[3]));
    // the money out of the rest and the money back in it are one sum: 20 € spent, 44 € back
    const mixed = themeRows(draw(report([...NINE.slice(0, 7), spec("leisure", "Vapaa-aika", [["travel", "Matkat", 2_000]]), back])));
    expect(mixed.at(-1)!.cells.slice(2)).toEqual(["-24,00 €", "-288,00 €"]);
  });

  it("opens Ruoka when the page opens and closes it on a click; the others are closed and open one at a time", () => {
    const html = draw(report(typical));
    const buttons = [...html.matchAll(/<button[^>]*aria-expanded="(true|false)"[^>]*><span class="themes-label">([^<]*)</g)].map(([, state, label]) => [label, state]);
    // Vakuutukset has one line of its own name: no button
    expect(buttons).toEqual([["Asuminen", "false"], ["Ruoka", "true"], ["Auto", "false"], ["Liikkuminen", "false"]]);
    expect(linesOf(html).map((r) => r.cells[0])).toEqual(["Ruokakauppa", "Ravintolat ja kahvilat", "Ruoan kotiinkuljetus"]);
    // the click: the set without Ruoka draws no line, and the set the page opened with is not changed by it
    const closed = toggled(OPEN_AT_FIRST, "food");
    expect(linesOf(draw(report(typical), closed))).toHaveLength(0);
    expect(draw(report(typical), closed)).not.toContain('aria-expanded="true"');
    expect([...OPEN_AT_FIRST]).toEqual(["food"]);
    // a second click opens it again, a click on Auto opens Auto beside it
    expect(linesOf(draw(report(typical), toggled(closed, "food")))).toHaveLength(3);
    expect(linesOf(draw(report(typical), toggled(OPEN_AT_FIRST, "car"))).map((r) => r.cells[0])).toEqual(["Ruokakauppa", "Ravintolat ja kahvilat", "Ruoan kotiinkuljetus", "Polttoaine", "Liikenne- ja autovakuutus"]);
  });

  it("a theme of one line that carries its own name has no button, and a one-line theme with another name has one", () => {
    const html = draw(report([transport, insurance, spec("kids", "Lapset", [["kids", "Lapset", 3_000]])]));
    const kids = themeRows(html).find((r) => r.cells[0] === "Lapset")!;
    expect(kids.html).not.toContain("<button");
    expect(kids.html).toContain('<a href="#/transactions?category=kids&amp;from=2025-10-01&amp;to=2026-09-30">Lapset</a>');
    // Liikkuminen's one line is named otherwise: it opens to it
    expect(themeRows(html)[0]!.html).toContain("<button");
    expect(linesOf(draw(report([transport, insurance]), new Set(["transport"]))).map((r) => r.cells[0])).toEqual(["Joukkoliikenne ja taksit"]);
    // a closed theme draws none of its lines
    expect(linesOf(draw(report([transport, insurance]), new Set()))).toHaveLength(0);
  });

  it("draws a bar on the theme rows only, as long as the theme is against the largest, and none for a theme below zero", () => {
    const back = spec("kids", "Lapset", [["kids", "Lapset", -4_400]]);
    const html = draw(report([housing, food, car, back]));
    // 1 107 €, 953 € and 222 € against the first
    expect(themeRows(html).map((r) => r.bar)).toEqual(["100", "86", "20", null]);
    expect(themeRows(html).at(-1)!.cells.slice(2)).toEqual(["-44,00 €", "-528,00 €"]);
    // a line has no bar, nor has the total
    expect(linesOf(html).every((r) => r.bar === null)).toBe(true);
    expect(totalOf(html).bar).toBeNull();
    // a theme with a few cents has a bar still: it is a sum, and the bar's rule gives it its two pixels
    expect(themeRows(draw(report([housing, spec("pets", "Lemmikit", [["pets", "Lemmikit", 40]])]))).map((r) => r.bar)).toEqual(["100", "1"]);
  });

  it("a category line is a link to Tapahtumat with that category and the window's days, and the lines of Auto are no links", () => {
    const html = draw(report([food, car, insurance, housing], { months: 12 }), new Set(["food", "car", "housing"]));
    const link = (name: string) => linesOf(html).find((r) => r.cells[0] === name)!.html;
    expect(link("Ruokakauppa")).toContain('href="#/transactions?category=groceries&amp;from=2025-10-01&amp;to=2026-09-30"');
    expect(link("Sähkö, vesi ja lämpö")).toContain('category=utilities&amp;from=2025-10-01&amp;to=2026-09-30');
    // Auto's "insurance" is the car's, not the category of that id: no link; the theme Vakuutukset' own line is one (no button, the name links)
    expect(link("Liikenne- ja autovakuutus")).not.toContain("<a ");
    expect(link("Polttoaine")).not.toContain("<a ");
    expect(themeRows(html).find((r) => r.cells[0] === "Vakuutukset")!.html).toContain("category=insurance&amp;from=2025-10-01&amp;to=2026-09-30");
    // the window's last day is the month's last: February of a short window has 28 days
    const feb = report([food], { months: 7 });
    feb.window = { first: "2025-08", last: "2026-02", months: 7 };
    expect(draw(feb)).toContain("category=groceries&amp;from=2025-08-01&amp;to=2026-02-28");
  });

  it("cuts a label that does not fit and has the whole text in title", () => {
    const long = "Ravintolat, kahvilat, pikaruoka ja muut ulkona syömiseen menevät kulut";
    const html = draw(report([spec("food", "Ruoka", [["restaurants", long, 14_600], ["groceries", "Ruokakauppa", 59_000]])]));
    const line = linesOf(html)[0]!;
    expect(line.html).toContain(`<th scope="row" class="st-cut" title="${long}"`);
    expect(themeRows(html)[0]!.html).toContain('title="Ruoka"');
    const css = readFileSync(new URL("../src/styles/themes-table.css", import.meta.url), "utf8");
    expect(css).toContain(".themes-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }");
  });
});

describe("Menot kategorioittain: Suuret hankinnat", () => {
  const row = (id: string, date: string, payee: string, cents: number) => ({ id, date, payee, cents });
  const large = (rows: ReturnType<typeof row>[], count: number): Themes["large"] => ({ cents: sum(rows.map((r) => r.cents)), count, rows });

  it("is a row of its own under the table with the count in brackets and the window's sum, which opens to its rows", () => {
    const rows = [row("a", "2026-03-14", "ESIMERKKI OY", 149_900), row("b", "2026-01-05", "Esimerkkikone Oy", 60_000)];
    const html = draw(report(typical, { large: large(rows, 2) }));
    const after = html.slice(html.indexOf("</table>"));
    expect(text(after)).toBe("Suuret hankinnat (2) 2 099,00 €");
    expect(after).toContain('aria-expanded="false"');
    // not a row of the table, and not in a month's column
    expect(rowsOf(html).some((r) => r.cells[0]?.startsWith("Suuret hankinnat"))).toBe(false);
    // open: the date, the payee and the sum of each row
    const open = draw(report(typical, { large: large(rows, 2) }), new Set(["large"]));
    const list = [...open.matchAll(/<li class="st-row">(.*?)<\/li>/g)].map(([, inner = ""]) => text(inner));
    expect(list).toEqual(["14.3.2026 ESIMERKKI OY 1 499,00 €", "5.1.2026 Esimerkkikone Oy 600,00 €"]);
    expect(open).toContain('aria-expanded="true"');
  });

  it("money back alone is the row without a number in brackets, with its sum below zero", () => {
    const back = [row("c", "2025-11-05", "Esimerkkikone Oy", -25_000)];
    const html = draw(report(typical, { large: large(back, 0) }), new Set(["large"]));
    const after = text(html.slice(html.indexOf("</table>")));
    expect(after).toBe("Suuret hankinnat -250,00 € 5.11.2025 Esimerkkikone Oy -250,00 €");
    expect(after).not.toContain("(");
  });

  it("purchases and money back in one sum: the count is the purchases, the sum is both", () => {
    const rows = [row("a", "2026-03-14", "ESIMERKKI OY", 100_000), row("c", "2025-11-05", "Esimerkkikone Oy", -25_000)];
    const after = text(draw(report(typical, { large: large(rows, 1) })));
    expect(after).toContain("Suuret hankinnat (1) 750,00 €");
  });

  it("is not drawn when there are no rows, also when the answer holds a sum of nothing", () => {
    expect(draw(report(typical))).not.toContain("Suuret hankinnat");
    expect(draw(report(typical, { months: 7 }))).not.toContain("Suuret hankinnat");
    // the near miss: one row draws it
    expect(draw(report(typical, { months: 7, large: large([row("a", "2026-05-02", "ESIMERKKI OY", 80_000)], 1) }))).toContain("Suuret hankinnat (1)");
  });
});

describe("Menot kategorioittain: a narrow screen", () => {
  const css = readFileSync(new URL("../src/styles/themes-table.css", import.meta.url), "utf8");
  const narrow = css.slice(css.indexOf("@media (max-width: 600px)"));

  it("keeps the label and the two sums: the bar and the change are the cells the rule for a phone hides", () => {
    expect(narrow).toContain(".themes-table .themes-bar, .themes-table .themes-change { display: none; }");
    const html = draw(report([{ ...housing, pct: 4 }, food]));
    // every row of the table has its bar cell and its change cell under those classes, and its sums under the others
    for (const row of rowsOf(html)) {
      const classes = [...row.html.matchAll(/<t[hd]([^>]*)>/g)].map(([, attrs = ""]) => (/class="([^"]*)"/.exec(attrs)?.[1] ?? "").split(" ").filter((c) => c.startsWith("themes-")).join(" "));
      expect(classes.slice(1), row.cls).toEqual(["themes-bar", "themes-month", "themes-year", "themes-change"]);
    }
  });
});
