import { OVERVIEW_INSIGHTS } from "@banking/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Notices } from "../src/components/Notices.tsx";
import { bannersOf, MAX_ROWS, type Notice, noticesOf, type SecurityNotice } from "../src/components/notices.ts";
import type { DashboardData } from "../src/types.ts";

type Data = Pick<DashboardData, "dataNotice" | "connectNotice" | "alerts" | "insights">;
type Noted = Parameters<typeof noticesOf>[1] extends { accounts?: readonly (infer A)[] } ? A : never;
type Alert = Data["alerts"][number];
type Insight = Data["insights"][number];

const RANGE = { from: "2026-10-01", to: "2026-10-31" };
const NONE: ReadonlySet<string> = new Set();

const alert = (id: string, over: Partial<Alert> = {}): Alert => ({ id, kind: "spike", tone: "info", title: `Hälytys ${id}`, detail: `Selitys ${id}`, ...over });
const insight = (id: string, over: Partial<Insight> = {}): Insight => ({ id, tone: "info", title: `Havainto ${id}`, detail: `Selitys ${id}`, yearlyCents: 12_000, ...over });
const quality = { id: "stale", tone: "warning", title: "Tilin tiedot ovat vanhoja", detail: "Esimerkkitili on haettu viimeksi viikko sitten." } satisfies NonNullable<Data["dataNotice"]>;
const signIn = (over: Partial<SecurityNotice> = {}): SecurityNotice => ({ id: "e7", kind: "new_device", at: "2026-10-12T12:30:00.000Z", text: "Tunnuksellasi kirjauduttiin uudelta laitteelta.", detail: "Chrome, Windows", ...over });
const data = (over: Partial<Data> = {}): Data => ({ dataNotice: null, connectNotice: null, alerts: [], insights: [], ...over });

type Options = { answered?: ReadonlySet<string>; insights?: boolean; security?: SecurityNotice[] };
const listed = (d: Data, over: Options = {}) => noticesOf(d, { range: RANGE, answered: over.answered ?? NONE, insights: over.insights ?? true, security: over.security ?? [] });
const rows = (d: Data, over: Options = {}): Notice[] => listed(d, over).rows;
const ids = (list: Notice[]) => list.map((n) => `${n.kind}:${n.id}`);

describe("the card to connect", () => {
  const connectNotice = { title: "Korttilaskuja 4 321 € viimeiseltä 12 kuukaudelta, mutta kortin ostot puuttuvat", detail: "Yhdistämättömät kortit: Nordea.", cents: 432_100 };

  it("is one row after the data-quality warning that links to Pankkiyhteydet and cannot be set aside", () => {
    const list = rows(data({ dataNotice: quality, connectNotice, alerts: [alert("a")] }));
    expect(ids(list)).toEqual(["quality:stale", "connect:connect", "alert:a"]);
    const row = list[1]!;
    expect(row).toMatchObject({ title: connectNotice.title, detail: connectNotice.detail, href: "#/settings?add=1", link: "Yhdistä", warning: true, answers: [] });
  });

  it("is no row when every card is connected", () => {
    expect(rows(data())).toEqual([]);
  });
});

describe("the order of the rows", () => {
  it("is the new sign-in, the data-quality warning, the alerts in core's order, then the insights", () => {
    const list = rows(data({ dataNotice: quality, alerts: [alert("b"), alert("a")], insights: [insight("y")] }), { security: [signIn()] });
    expect(ids(list)).toEqual(["security:e7", "quality:stale", "alert:b", "alert:a"]);
    expect(ids(rows(data({ alerts: [alert("b")], insights: [insight("y"), insight("x")] })))).toEqual(["alert:b", "insight:y", "insight:x"]);
  });

  it("is the same without the warning, and nothing is drawn when there is no row", () => {
    expect(ids(rows(data({ alerts: [alert("a")], insights: [insight("x")] })))).toEqual(["alert:a", "insight:x"]);
    expect(rows(data())).toEqual([]);
  });
});

describe("the cut", () => {
  const many = (n: number, make: (id: string) => Alert | Insight) => Array.from({ length: n }, (_, i) => make(`n${i}`));

  it("shows four rows at most, the first ones, and counts all of them for the link", () => {
    expect(MAX_ROWS).toBe(4);
    const list = listed(data({ dataNotice: quality, alerts: many(8, alert) as Alert[], insights: many(5, insight) as Insight[] }));
    expect(ids(list.rows)).toEqual(["quality:stale", "alert:n0", "alert:n1", "alert:n2"]);
    // the warning, six alerts and three insights are what there is
    expect(list.total).toBe(1 + 6 + OVERVIEW_INSIGHTS);
  });

  it("lets four rows through whole, and counts them", () => {
    const list = listed(data({ alerts: many(MAX_ROWS, alert) as Alert[] }));
    expect(list.rows).toHaveLength(MAX_ROWS);
    expect(list.total).toBe(MAX_ROWS);
  });

  it("leaves out an answered row before it cuts, so the next one takes its place", () => {
    const alerts = many(6, alert) as Alert[];
    const list = listed(data({ alerts }), { answered: new Set(["n0"]) });
    expect(ids(list.rows)).toEqual(["alert:n1", "alert:n2", "alert:n3", "alert:n4"]);
    expect(list.total).toBe(5);
  });

  it("puts the sign-in before the rest, so a cut takes the last rows and not it", () => {
    const list = listed(data({ dataNotice: quality, alerts: many(6, alert) as Alert[] }), { security: [signIn()] });
    expect(ids(list.rows)).toEqual(["security:e7", "quality:stale", "alert:n0", "alert:n1"]);
  });
});

describe("the insights", () => {
  it("are left out while Säästövinkit is on, and the rest stays", () => {
    const d = data({ dataNotice: quality, alerts: [alert("a")], insights: [insight("x")] });
    expect(ids(rows(d, { insights: false }))).toEqual(["quality:stale", "alert:a"]);
    expect(ids(rows(d, { insights: true }))).toEqual(["quality:stale", "alert:a", "insight:x"]);
  });

  it("with the page on and nothing else to say draw no card", () => {
    expect(rows(data({ insights: [insight("x")] }), { insights: false })).toEqual([]);
  });

  it("leave out one that only tells good news, and keep a warning and a note", () => {
    const list = rows(data({ insights: [insight("g", { tone: "good" }), insight("w", { tone: "warning" }), insight("i", { tone: "info" })] }));
    expect(ids(list)).toEqual(["insight:w", "insight:i"]);
    expect(rows(data({ insights: [insight("g", { tone: "good" })] }))).toEqual([]);
  });
});

describe("a sign-in from a new device", () => {
  it("is one row with the time and the device, leading to the sign-in card of Asetukset, and Kuittaa reads the notices", () => {
    const [n] = rows(data(), { security: [signIn()] });
    expect(n!.title).toBe("Uusi kirjautuminen 12.10. klo 15.30 (Chrome, Windows)");
    expect(n!.href).toBe("#/settings#kirjautuminen");
    expect(n!.warning).toBe(true);
    expect(n!.answers).toEqual([{ label: "Kuittaa", name: `Kuittaa: ${n!.title}`, send: "seen" }]);
  });

  it("is the server's own sentence when it gave no device or no time", () => {
    const [noDevice, noTime] = rows(data(), { security: [signIn({ id: "a", detail: undefined }), signIn({ id: "b", at: null })] });
    expect(noDevice!.title).toBe("Tunnuksellasi kirjauduttiin uudelta laitteelta.");
    expect(noTime!.title).toBe("Tunnuksellasi kirjauduttiin uudelta laitteelta.");
  });

  it("leaves the notice that must stop the user to the banner, and sends every other to where the banner sent it", () => {
    const list = rows(
      data(),
      {
        security: [
          signIn({ id: "d", kind: "db_damaged", text: "Tietokanta on vaurioitunut." }),
          signIn({ id: "r", kind: "password_reset_by_admin", text: "Ylläpitäjä nollasi salasanasi." }),
          signIn({ id: "i", kind: "industry_lookup_off", text: "Toimialahaku on pois päältä." }),
          signIn({ id: "m", kind: "disk_low", text: "Levyllä on vähän tilaa." }),
        ],
      },
    );
    // the banner of the shell draws what the list leaves, and nothing else
    const all = [signIn({ id: "d", kind: "db_damaged" }), signIn({ id: "r", kind: "password_reset_by_admin" }), signIn()];
    expect(bannersOf(all).map((n) => n.id)).toEqual(["d"]);
    expect(bannersOf([signIn(), signIn({ id: "r", kind: "disk_low" })])).toEqual([]);
    expect(list.map((n) => [n.id, n.title, n.href])).toEqual([
      ["r", "Ylläpitäjä nollasi salasanasi.", "#/settings#kirjautuminen"],
      ["i", "Toimialahaku on pois päältä.", "#/settings?section=server"],
      ["m", "Levyllä on vähän tilaa.", "#/settings?section=maintenance"],
    ]);
  });
});

describe("what a row sends", () => {
  it("is Kuittaa on the alert's own subject, and the data-quality row has no answer", () => {
    const [warn, other] = rows(data({ dataNotice: quality, alerts: [alert("double:7")] }));
    expect(warn!.answers).toEqual([]);
    expect(other!.answers).toEqual([{ label: "Kuittaa", name: "Kuittaa: Hälytys double:7", send: { subject: "alert:double:7", mark: "dismissed" } }]);
  });

  it("asks the forgotten service on its series, before Kuittaa", () => {
    const forgotten = alert("f", { kind: "forgotten", tone: "info", merchant: "ESIMERKKI OY", markSubject: "series:out:acc:ESIMERKKI OY#1299" });
    const [n] = rows(data({ alerts: [forgotten] }));
    expect(n!.answers.map((a) => [a.label, a.name, a.send])).toEqual([
      ["Käytössä", "Käytössä: ESIMERKKI OY", { subject: "series:out:acc:ESIMERKKI OY#1299", mark: "in_use" }],
      ["Lopetettu", "Lopetettu: ESIMERKKI OY", { subject: "series:out:acc:ESIMERKKI OY#1299", mark: "cancelled" }],
      ["Kuittaa", "Kuittaa: Hälytys f", { subject: "alert:f", mark: "dismissed" }],
    ]);
  });

  it("asks nothing when the alert is not a question, or the question has no series or no merchant to name", () => {
    const base = { tone: "info" as const, merchant: "ESIMERKKI OY" };
    const notAsked = alert("s", { ...base, kind: "spike", markSubject: "series:out:acc:ESIMERKKI OY#1299" });
    const noSeries = alert("n", { ...base, kind: "forgotten" });
    const noMerchant = alert("m", { kind: "forgotten", markSubject: "series:out:acc:X#100" });
    for (const n of rows(data({ alerts: [notAsked, noSeries, noMerchant] }))) expect(n.answers.map((a) => a.label)).toEqual(["Kuittaa"]);
  });

  it("is the insight's dismissal, which core says when a changed figure brings back", () => {
    const [n] = rows(data({ insights: [insight("price:1", { yearlyCents: 24_000 })] }));
    expect(n!.answers).toHaveLength(1);
    expect(n!.answers[0]).toMatchObject({ label: "Kuittaa", name: "Kuittaa: Havainto price:1", send: { mark: "dismissed" } });
    expect((n!.answers[0]!.send as { subject: string }).subject).toMatch(/price:1/);
  });
});

describe("where a row leads", () => {
  it("is Tietojen laatu for the warning, the merchant's rows for a merchant, the month's rows for a category", () => {
    const list = rows(
      data({
        dataNotice: quality,
        alerts: [alert("m", { merchant: "ESIMERKKI OY" }), alert("c", { category: "food" }), alert("none")],
        insights: [insight("i", { merchant: "ESIMERKKI OY" }), insight("j")],
      }),
      { insights: false },
    );
    expect(list.map((n) => n.href)).toEqual(["#/settings#laatu", "#/transactions?merchant=ESIMERKKI+OY", "#/transactions?category=food&from=2026-10-01&to=2026-10-31", null]);
  });

  it("prefers the merchant when an alert has both", () => {
    const [n] = rows(data({ alerts: [alert("b", { merchant: "ESIMERKKI OY", category: "food" })] }));
    expect(n!.href).toBe("#/transactions?merchant=ESIMERKKI+OY");
  });

  it("leads an alert about one row to that row: the payee on its day, with the words of the link", () => {
    const large = alert("u", { kind: "uncategorised", title: "Luokittelematon maksu", detail: "Esimerkki Oy 12.10. 1 250,00 €", row: { merchant: "Esimerkki Oy", date: "2026-10-12" } });
    const [n, plain] = rows(data({ alerts: [large, alert("b", { merchant: "ESIMERKKI OY" })] }));
    expect(n!.href).toBe("#/transactions?merchant=Esimerkki+Oy&from=2026-10-12&to=2026-10-12");
    expect(n!.link).toBe("Luokittele");
    // two such rows have one title, so Kuittaa is named with the detail
    expect(n!.answers.map((a) => a.name)).toEqual(["Kuittaa: Luokittelematon maksu Esimerkki Oy 12.10. 1 250,00 €"]);
    expect(plain!.link).toBeUndefined();
  });
});

describe("the card", () => {
  const draw = (d: Data, over: Partial<Parameters<typeof Notices>[0]> = {}) =>
    renderToStaticMarkup(createElement(Notices, { data: d, range: RANGE, answered: NONE, insights: true, onAnswer: () => {}, busy: false, error: null, ...over }));
  const many = (n: number) => Array.from({ length: n }, (_, i) => alert(`n${i}`));

  it("is not drawn without a row", () => {
    expect(draw(data())).toBe("");
    expect(draw(data({ insights: [insight("x")] }), { insights: false })).toBe("");
  });

  it("has one heading and one list, the warning read as Huomio and the rest as Tiedoksi, and only the warning ruled", () => {
    const html = draw(data({ dataNotice: quality, alerts: [alert("a")] }));
    expect(html.match(/<h2/g)).toHaveLength(1);
    expect(html).toContain(">Ilmoitukset</h2>");
    expect(html.match(/<ul/g)).toHaveLength(1);
    expect(html).toContain('<span class="sr-only">Huomio: </span>');
    expect(html).toContain('<span class="sr-only">Tiedoksi: </span>');
    expect(html.match(/notice-item warn/g)).toHaveLength(1);
    expect(html.match(/notice-item/g)).toHaveLength(2);
  });

  it("is a row of one line: the title, then the detail in a span of its own, and the whole text in the title attribute", () => {
    const html = draw(data({ alerts: [alert("a", { merchant: "ESIMERKKI OY" })] }));
    expect(html).toContain('title="Hälytys a. Selitys a"');
    expect(html).toContain('<span class="notice-title">Hälytys a.</span><span class="notice-detail"> Selitys a</span>');
    // no second line under the title: the 12 px line of the statement look is not used
    expect(html).not.toContain("st-sub");
  });

  it("gives a row that names what to do its words as the one link, beside Kuittaa, and leaves the text plain", () => {
    const large = alert("u", { kind: "uncategorised", title: "Luokittelematon maksu", detail: "Esimerkki Oy 12.10. 1 250,00 €", row: { merchant: "Esimerkki Oy", date: "2026-10-12" } });
    const html = draw(data({ alerts: [large] }));
    expect(html).toContain('<span class="st-name notice-text" title="Luokittelematon maksu. Esimerkki Oy 12.10. 1 250,00 €">');
    expect(html).toContain('<a href="#/transactions?merchant=Esimerkki+Oy&amp;from=2026-10-12&amp;to=2026-10-12" aria-label="Luokittele: Esimerkki Oy 12.10. 1 250,00 €">Luokittele</a>');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html.indexOf(">Luokittele</a>")).toBeLessThan(html.indexOf(">Kuittaa</button>"));
    // a row whose text is its link has no second one
    expect(draw(data({ alerts: [alert("a", { merchant: "ESIMERKKI OY" })] })).match(/<a /g)).toHaveLength(1);
  });

  it("shows four rows at most, and a link with the count to Säästövinkit when there are more", () => {
    const html = draw(data({ alerts: many(6) }), { insights: false });
    expect(html.match(/<li /g)).toHaveLength(4);
    expect(html).toContain('<a href="#/optimise">Kaikki (6)</a>');
    expect(draw(data({ alerts: many(4) }), { insights: false })).not.toContain("Kaikki");
    // while Säästövinkit is off there is nowhere to lead
    expect(draw(data({ alerts: many(6) }), { insights: true })).not.toContain("Kaikki");
  });

  it("makes Kuittaa a button and Käytössä and Lopetettu text buttons, all named for what they are about", () => {
    const forgotten = alert("f", { kind: "forgotten", merchant: "ESIMERKKI OY", markSubject: "series:out:acc:ESIMERKKI OY#1299" });
    const html = draw(data({ alerts: [forgotten] }));
    expect(html).toContain('<button class="link-btn" type="button" aria-label="Käytössä: ESIMERKKI OY">Käytössä</button>');
    expect(html).toContain('<button class="link-btn" type="button" aria-label="Lopetettu: ESIMERKKI OY">Lopetettu</button>');
    expect(html).toContain('<button class="btn btn-small" type="button" aria-label="Kuittaa: Hälytys f">Kuittaa</button>');
  });

  it("disables the buttons while an answer is on its way", () => {
    const d = data({ alerts: [alert("a")] });
    expect(draw(d)).not.toContain("disabled");
    expect(draw(d, { busy: true })).toContain("disabled");
  });

  it("shows the server's sentence under the list and keeps the row", () => {
    const html = draw(data({ alerts: [alert("a")] }), { error: "Tallennus ei onnistunut." });
    expect(html).toContain("Hälytys a");
    expect(html.indexOf("</ul>")).toBeLessThan(html.indexOf("Tallennus ei onnistunut."));
    expect(draw(data({ alerts: [alert("a")] }))).not.toContain('role="alert"');
  });
});

describe("the notices about an account's split", () => {
  const SET = { by: "app", at: "2026-10-01T08:00:00.000Z" } as const;
  const OFFER = [{ userId: "u1", percent: 96 }, { userId: null, percent: 4 }];
  const account = (over: Partial<Noted> = {}): Noted => ({ id: "a1", name: "Yhteistili", ...over });
  const split = (accounts: Noted[], marked: ReadonlySet<string> = NONE, answered: ReadonlySet<string> = NONE) => noticesOf(data(), { range: RANGE, answered, insights: true, accounts, marked }).rows;

  it("each appears on its condition and not without it", () => {
    expect(split([account()])).toEqual([]);
    expect(split([account({ split: SET })]).map((n) => n.title)).toEqual(["Tilin Yhteistili jako muuttui"]);
    expect(split([account({ offer: OFFER })]).map((n) => n.title)).toEqual(["Tilin Yhteistili jako ei vastaa maksuja"]);
    // near miss: a split a member chose tells nothing; an open question is asked in Tarkistettavat, never as a notice
    expect(split([account({ split: { by: "user", at: SET.at } })])).toEqual([]);
  });

  it("is one row with the link Katso to the account on Tilit, closed by Kuittaa on its subject", () => {
    const [n] = split([account({ split: SET })]);
    expect(n).toMatchObject({ kind: "account", link: "Katso", href: "#/settings#tili-a1", warning: false });
    expect(n!.answers).toEqual([{ label: "Kuittaa", name: `Kuittaa: ${n!.title}`, send: { subject: `alert:split:a1:${SET.at}`, mark: "dismissed" } }]);
  });

  it("stays closed by a mark, and comes back with another day or other percents", () => {
    const open = account({ split: SET, offer: OFFER });
    const closed = new Set(split([open]).map((n) => n.id));
    expect(closed.size).toBe(2);
    expect(split([open], closed)).toEqual([]);
    expect(split([open], NONE, closed)).toEqual([]);
    expect(split([account({ ...open, split: { by: "app", at: "2026-10-02T08:00:00.000Z" } })], closed).map((n) => n.title)).toEqual(["Tilin Yhteistili jako muuttui"]);
    expect(split([account({ ...open, offer: [{ userId: "u1", percent: 90 }, { userId: null, percent: 10 }] })], closed).map((n) => n.title)).toEqual(["Tilin Yhteistili jako ei vastaa maksuja"]);
  });

  it("comes before the alerts, and the four-row cut counts it", () => {
    const list = noticesOf(data({ alerts: [alert("a")] }), { range: RANGE, answered: NONE, insights: true, accounts: [account({ split: SET })] });
    expect(ids(list.rows)).toEqual([`account:alert:split:a1:${SET.at}`, "alert:a"]);
    expect(list.total).toBe(2);
  });
});
