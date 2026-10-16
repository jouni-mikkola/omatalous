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
const labels = (markup: string) => [...markup.matchAll(/<th scope="row"[^>]*>([^<]*)</g)].map((m) => m[1]);

describe("Tarkistettu", () => {
  it("says a check with nothing to check has nothing to check, not that it found nothing", () => {
    const out = html([area("loans", [check("loans:margin", "Asuntolainan marginaali", "no_subject"), check("loans:prepay", "Lainan lyhentäminen säästöillä", "clear")])]);
    expect(out).toContain("Ei tarkistettavaa");
    expect(out.match(/Ei huomautettavaa/g)).toHaveLength(1);
  });

  it("prints a row a check in the order of the areas, with its word, and leaves a finding out", () => {
    const out = html(AREAS);
    expect(labels(out)).toEqual(["Asuntolainan marginaali", "Luottokortin korko", "Unohtuneet tilaukset", "Polttoaine"]);
    expect(out).toContain("Ei huomautettavaa");
    expect(out).toContain("Tapahtumia liian lyhyeltä ajalta");
    expect(out).toContain("Ei tapahtumia");
    expect(out).not.toContain("Hinnannousut");
  });

  it("offers Täydennä to the input only where information is missing", () => {
    const out = html(AREAS);
    expect(out.match(/Tietoja puuttuu/g)).toHaveLength(1);
    expect(out.match(/<a href="#\/optimise#tiedot">Täydennä<\/a>/g)).toHaveLength(1);
    expect(html([area("loans", [check("loans:margin", "Asuntolainan marginaali", "no_data")])])).not.toContain("Täydennä");
  });

  it("keeps the two figure columns empty until a check fills them", () => {
    const empty = html(AREAS);
    expect(empty).not.toContain("Kuukaudessa");
    expect(empty.match(/<td class="num checked-cents"><\/td>/g)).toHaveLength(4);
    expect(empty.match(/<td class="checked-count"><\/td>/g)).toHaveLength(4);
    const filled = html([area("loans", [check("loans:card", "Luottokortin korko", "clear", { cents: 4180, count: { n: 2, noun: "liittymää" } })])]);
    expect(filled).toContain("Kuukaudessa");
    expect(filled).toContain("41,80");
    expect(filled).toContain("2 liittymää");
  });

  it("prints nothing for a young household, and nothing when every check is a finding", () => {
    expect(html(AREAS, true)).toBe("");
    expect(html([area("subscriptions", [check("subscriptions:rise", "Hinnannousut", "finding")])])).toBe("");
  });
});
