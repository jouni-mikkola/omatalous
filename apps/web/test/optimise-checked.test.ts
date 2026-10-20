import type { AreaView, Check } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checked } from "../src/components/optimise/Checked.tsx";

const check = (id: string, label: string, status: Check["status"], more: Partial<Check> = {}): Check => ({ id, label, status, ...more });
const area = (id: AreaView["id"], checks: Check[]): AreaView => ({ id, label: id, findings: [], checks, weightCents: 0 });

// the page orders areas by weight; the rows follow the order of the areas themselves (loans, savings, subscriptions ...)
const AREAS: AreaView[] = [
  area("subscriptions", [check("subscriptions:quiet", "Unohtuneet tilaukset", "clear"), check("subscriptions:rise", "Hinnannousut", "finding")]),
  area("car", [check("car:fuel", "Polttoaine", "no_rows")]),
  area("loans", [check("loans:margin", "Asuntolainan marginaali", "needs_input", { input: "loan_rate" }), check("loans:card", "Luottokortin korko", "no_data")]),
];

const html = (areas: AreaView[], young = false) => renderToStaticMarkup(createElement(Checked, { areas, young }));
const labels = (markup: string) => [...markup.matchAll(/<span class="checked-label">([^<]*)</g)].map((m) => m[1]);
/** The labels of one group, by its heading. */
const group = (markup: string, title: string) => labels(markup.split(`</span>${title} <span`)[1]?.split("</ul>")[0] ?? "");

describe("Tarkistettu", () => {
  it("puts a check with nothing to check under Ei tarkistettavaa, apart from those in order", () => {
    const out = html([area("loans", [check("loans:margin", "Asuntolainan marginaali", "no_subject"), check("loans:prepay", "Lainan lyhentäminen säästöillä", "clear")])]);
    expect(group(out, "Ei tarkistettavaa")).toEqual(["Asuntolainan marginaali"]);
    expect(group(out, "Kunnossa")).toEqual(["Lainan lyhentäminen säästöillä"]);
  });

  it("lists every check that is not a finding in the order of the areas, in its group, and leaves a finding out", () => {
    const out = html(AREAS);
    expect(labels(out)).toEqual(["Unohtuneet tilaukset", "Asuntolainan marginaali", "Luottokortin korko", "Polttoaine"]);
    expect(group(out, "Tietoja puuttuu")).toEqual(["Asuntolainan marginaali", "Luottokortin korko"]);
    expect(out).toContain("Tapahtumia liian lyhyeltä ajalta");
    expect(out).not.toContain("Hinnannousut");
    // the total is the lead strip's figure, said once there; every segment of the bar carries its count and word under it
    expect(out).not.toContain("card-datum");
    expect([...out.matchAll(/<li><span class="check-swatch[^"]*" aria-hidden="true"><\/span>([^<]*)<\/li>/g)].map((m) => m[1])).toEqual(["1 vinkki", "1 kunnossa", "2 vailla tietoja", "1 ei tarkistettavaa"]);
  });

  it("offers Täydennä to the input only where information is missing", () => {
    const out = html(AREAS);
    expect(out.match(/<a href="#\/review">Täydennä<\/a>/g)).toHaveLength(1);
    expect(html([area("loans", [check("loans:margin", "Asuntolainan marginaali", "no_data")])])).not.toContain("Täydennä");
  });

  it("prints a check's figures only when the check fills them", () => {
    expect(html(AREAS)).not.toContain("checked-cents");
    const filled = html([area("loans", [check("loans:card", "Luottokortin korko", "clear", { cents: 4180, count: { n: 2, noun: "liittymää" } })])]);
    expect(filled).toContain("41,80");
    expect(filled).toContain("2 liittymää");
  });

  it("prints nothing for a young household, and nothing when every check is a finding", () => {
    expect(html(AREAS, true)).toBe("");
    expect(html([area("subscriptions", [check("subscriptions:rise", "Hinnannousut", "finding")])])).toBe("");
  });
});
