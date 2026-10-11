/**
 * Electricity, housing and insurance (O5): each finding with its exact euros, the near misses that stay quiet and what
 * the checks say when the data cannot tell.
 */
import { describe, expect, it } from "vitest";
import { addMonths, monthRange } from "../../src/dates.ts";
import { billKind, electricity } from "../../src/optimise/areas/electricity.ts";
import { housing } from "../../src/optimise/areas/housing.ts";
import { insurance } from "../../src/optimise/areas/insurance.ts";
import { allFindings, buildOptimise, type Check, type Finding, type InputValues, type OptimiseData } from "../../src/optimise/index.ts";
import { FRAME, type Frame, householdInput, joinHousehold, type PartHousehold } from "./household.ts";
import * as el from "./parts/electricity.ts";
import * as hs from "./parts/housing.ts";
import * as ins from "./parts/insurance.ts";

const AREAS = [electricity, housing, insurance];

function run(parts: PartHousehold[], frame: Frame = FRAME): OptimiseData {
  return buildOptimise({ ...householdInput(joinHousehold(parts, frame)), areas: AREAS });
}

const byId = (data: OptimiseData, id: string): Finding | undefined => allFindings(data).find((f) => f.id === id);
const checkOf = (data: OptimiseData, id: string): Check => data.areas.flatMap((a) => a.checks).find((c) => c.id === id)!;
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const calcOf = (f: Finding) => Object.fromEntries(f.calc.map((c) => [plain(c.label), plain(c.value)]));

/** The frame moved to another judging day: 24 complete months before it. */
function frameAt(today: string): Frame {
  const last = addMonths(today.slice(0, 7), -1);
  const months = monthRange(addMonths(last, -23), last);
  return { ...FRAME, today, start: `${months[0]}-01`, end: `${last}-${String(new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5)), 0)).getUTCDate())}`, months };
}

describe("electricity price per kWh", () => {
  it("compares the year's bills per typed kWh with the band and takes a connection fee out", () => {
    const h = el.hit(FRAME);
    const data = run([h]);
    const f = byId(data, "electricity:price")!;
    expect(plain(f.title)).toBe("Sähkö 22,9 c/kWh, kokoluokan keskihinta 18,3 c/kWh. Laskut 2 290 € ja kulutus 10 000 kWh 12 kuukaudessa.");
    expect(f.euros).toMatchObject({ lowCents: 18000, midCents: 46000, highCents: 60000 });
    expect(f.certainty).toEqual({ level: "keskitaso", reason: "Vertailuhinta on saman kokoluokan kotitalouksien keskiarvo." });
    expect(f.action).toBe("Kilpailuta sähkösopimus Energiaviraston hintavertailussa sahkonhinta.fi.");
    const calc = calcOf(f);
    expect(calc["Sähkönmyyjän laskut 12 kuukaudessa"]).toBe("1 450 €");
    expect(calc["Verkkoyhtiön laskut 12 kuukaudessa"]).toBe("840 €");
    expect(calc["Caruna 5.5.2026, kertaluonteinen"]).toBe("450,00 €");
    expect(calc["Ero 4,6 c/kWh × 10 000 kWh"]).toBe("460 €");
    const fee = h.txs.find((t) => t.bookingDate === "2026-05-05")!;
    expect(f.struck).toEqual([fee.id]);
    // 12 seller bills, 12 network bills and the fee, all inside the window
    expect(f.rows).toHaveLength(25);
    expect(f.facts).toEqual(["electricity_price:D", "electricity_price:C", "electricity_price:E"]);
    expect(f.claims).toEqual(["merchant:Caruna", "merchant:Oomi Energia"]);
    expect(f.shared).toBe(false);
  });

  it("compares only bills that cover exactly one year, and never annualises fewer than 12 months", () => {
    const uncovered = { status: "no_data", hint: "12 kuukauden laskut eivät kata täsmälleen yhtä vuotta." };
    // a bill paid in two parts: 24 seller payments in 12 months
    const halves = el.bills(FRAME, { seller: [7500, 5000] });
    const second = halves
      .filter((t) => t.merchant === "Oomi Energia" && `${t.bookingDate.slice(0, 8)}25` <= FRAME.today)
      .map((t, i) => ({ ...t, id: `el2-${i}`, bookingDate: `${t.bookingDate.slice(0, 8)}25` }));
    const parts = run([{ txs: [...halves, ...second], values: el.KWH }]);
    expect(allFindings(parts).filter((f) => f.kind === "price")).toEqual([]);
    expect(checkOf(parts, "electricity:price")).toMatchObject(uncovered);
    // a thirteenth network payment in the window, a late bill paid beside the next one
    const thirteen = run([{ txs: el.bills(FRAME, { extra: (row) => [row("2026-03-27", 7000, "Caruna")] }), values: el.KWH }]);
    expect(allFindings(thirteen).filter((f) => f.kind === "price")).toEqual([]);
    expect(checkOf(thirteen, "electricity:price")).toMatchObject(uncovered);
    // quarterly network bills: four cover the year
    const quarterly = el.bills(FRAME, { network: null, extra: (row) => FRAME.months.filter((m) => ["01", "04", "07", "10"].includes(m.slice(5))).map((m) => row(`${m}-20`, 21000, "Caruna")) });
    expect(byId(run([{ txs: quarterly, values: el.KWH }]), "electricity:price")!.euros!.midCents).toBe(46000);
    // eight months, from February: a winter-heavy part of a year is no year
    const short: Frame = { ...FRAME, start: "2026-02-01", months: monthRange("2026-02", "2026-09") };
    const data = run([{ txs: el.bills(short), values: el.KWH }], short);
    expect(allFindings(data).filter((f) => f.kind === "price")).toEqual([]);
    expect(checkOf(data, "electricity:price")).toMatchObject({ status: "no_data", hint: "Vertailuun tarvitaan 12 täyttä kuukautta." });
  });

  it("nets money in from the same payees against the bills", () => {
    // 20,7 c/kWh is under the band's edge; a 300 € credit the refund matching missed must lower it, never raise it
    const hit = el.hit(FRAME);
    const credit = (cents: number) => ({ ...hit.txs[0]!, id: "el-credit", bookingDate: "2026-06-25", amountCents: cents, merchant: "Caruna", counterparty: "CARUNA", description: "HYVITYS" });
    const clear = run([{ txs: [...el.bills(FRAME, { seller: [12000, 9000] }), credit(30000)], values: el.KWH }]);
    expect(allFindings(clear).filter((f) => f.kind === "price")).toEqual([]);
    expect(checkOf(clear, "electricity:price").status).toBe("clear");
    // on the hit the credit takes 300 € off: 19,9 c/kWh, under the gate
    expect(byId(run([{ ...hit, txs: [...hit.txs, credit(30000)] }]), "electricity:price")).toBeUndefined();
    // a smaller credit stays in the calc and the rows
    const small = run([{ ...hit, txs: [...hit.txs, credit(5000)] }]);
    const f = byId(small, "electricity:price")!;
    expect(calcOf(f)["Hyvitykset samoilta yhtiöiltä"]).toBe("−50 €");
    expect(f.euros!.midCents).toBe((224 - 183) * 1000);
    expect(f.rows).toContain("el-credit");
  });

  it("counts a cooperative's bill as both the energy and the network", () => {
    const data = run([{ txs: el.bills(FRAME, { networkName: "Sähköosuuskunta Esimerkki", seller: null, network: 19000 }), values: el.KWH }]);
    const f = byId(data, "electricity:price")!;
    expect(calcOf(f)["Myynnin ja siirron yhteislaskut 12 kuukaudessa"]).toBe("2 280 €");
    expect(f.euros!.midCents).toBe((228 - 183) * 1000);
  });

  it("stays quiet on the near misses, and the check says why", () => {
    const [sellerOnly, under, moved] = el.nearMiss(FRAME);
    const a = run([sellerOnly!]);
    expect(allFindings(a).filter((f) => f.kind === "price")).toEqual([]);
    expect(checkOf(a, "electricity:price")).toMatchObject({ status: "no_data", hint: "Verkkoyhtiön laskuja ei löytynyt 12 kuukauden ajalta." });
    const b = run([under!]);
    expect(allFindings(b)).toEqual([]);
    expect(checkOf(b, "electricity:price").status).toBe("clear");
    const c = run([moved!]);
    expect(allFindings(c)).toEqual([]);
    expect(checkOf(c, "electricity:price")).toMatchObject({ status: "no_data", hint: "Muuton jälkeen on alle 12 täyttä kuukautta." });
  });

  it("asks for the kWh only when both bills are there", () => {
    const data = run([{ txs: el.bills(FRAME) }]);
    expect(checkOf(data, "electricity:price")).toMatchObject({ status: "needs_input", input: "electricity_kwh" });
    expect(data.needed.map((n) => n.key)).toContain("electricity_kwh");
    const none = run([]);
    expect(checkOf(none, "electricity:price")).toMatchObject({ status: "no_data", hint: "Sähkölaskuja ei löytynyt 12 kuukauden ajalta." });
    expect(none.needed).toEqual([]);
  });

  it("does not compare two network companies' year, a price over twice the band or an expired band", () => {
    const two = el.bills(FRAME, { extra: (row) => ["2026-06-20", "2026-07-20", "2026-08-20", "2026-09-20"].map((d) => row(d, 7000, "Elenia")) });
    expect(checkOf(run([{ txs: two, values: el.KWH }]), "electricity:price")).toMatchObject({ status: "no_data", hint: "Verkkolaskuja on kahdelta yhtiöltä 12 kuukauden ajalta." });
    const dear = run([{ txs: el.bills(FRAME, { seller: [30000, 30000] }), values: el.KWH }]);
    expect(allFindings(dear)).toEqual([]);
    expect(checkOf(dear, "electricity:price").hint).toBe("Hinta on yli kaksi kertaa kokoluokan keskihinta: tarkista vuosikulutus.");
    // the band means age six months after June 2026
    const later = frameAt("2027-01-15");
    const old = run([{ txs: el.bills(later), values: { electricity_kwh: { value: 10_000, asOf: "2027-01-02" } } }], later);
    expect(checkOf(old, "electricity:price")).toMatchObject({ status: "no_data", hint: "Vertailutieto on vanhentunut." });
  });

  it("knows a bill by its industry code before its name", () => {
    const t = (merchant: string, extra: Partial<{ description: string; category: string }> = {}) => ({ merchant, counterparty: null, description: null, category: "utilities", ...extra });
    const industry = new Map([
      ["Paikallinen Voima", "35140"],
      ["Paikallinen Verkko", "35130"],
      ["Helen", "35300"],
    ]);
    expect(billKind(t("Paikallinen Voima"), industry)).toBe("seller");
    expect(billKind(t("Paikallinen Verkko"), industry)).toBe("network");
    // district heat by its register entry, whatever the name says
    expect(billKind(t("Helen"), industry)).toBeNull();
    expect(billKind(t("Helen"), new Map())).toBe("seller");
    expect(billKind(t("Helen Sähköverkko"), new Map())).toBe("network");
    expect(billKind(t("Turku Energia Sähköverkot"), new Map())).toBe("network");
    expect(billKind(t("Helen", { description: "KAUKOLÄMPÖ" }), new Map())).toBeNull();
    expect(billKind(t("Caruna", { category: "housing" }), new Map())).toBeNull();
    expect(billKind(t("HSY Vesihuolto"), new Map())).toBeNull();
  });
});

describe("electricity contract end", () => {
  it("is a deadline two weeks before the typed end", () => {
    const f = byId(run([el.hit(FRAME)]), "electricity:contract_end")!;
    expect(f).toMatchObject({ title: "Sähkösopimus päättyy 31.12.2026.", action: "Kilpailuta sopimus ennen 17.12.", decideBy: "2026-12-17", euros: null });
    expect(f.certainty.level).toBe("korkea");
  });

  it("keeps the end itself when two weeks no longer fit, and goes once the date has passed", () => {
    const soon = run([{ txs: [], values: { electricity_contract_end: { value: "2026-10-20", asOf: "2026-10-01" } } }]);
    expect(byId(soon, "electricity:contract_end")).toMatchObject({ decideBy: "2026-10-20", action: "Kilpailuta sopimus ennen 20.10." });
    expect(soon.soon.map((f) => f.id)).toEqual(["electricity:contract_end"]);
    const past = run([{ txs: [], values: { electricity_contract_end: { value: "2026-10-01", asOf: "2026-09-01" } } }]);
    expect(allFindings(past)).toEqual([]);
  });
});

describe("housing charge rise", () => {
  it("compares an apartment block's vastike rise with the survey, shared and at matala", () => {
    const data = run([hs.hit(FRAME)]);
    const f = byId(data, "housing:rise:out:h-chk:As Oy Kotikallio")!;
    expect(plain(f.title)).toBe("As Oy Kotikallio: 312,00 € → 332,00 € 5.1.2026 alkaen, nousua 6,4 %. Kerrostalojen hoitovastikkeet nousivat vuonna 2026 keskimäärin 1,5 %.");
    // (6,4 − 1,5) % of 3 744 €; the range against the terraced houses' 2,8 %
    expect(f.euros).toMatchObject({ lowCents: 13478, midCents: 18346, highCents: 18346 });
    expect(f.shared).toBe(true);
    expect(f.certainty).toEqual({ level: "matala", reason: "Rahoitusvastike tai korjaus voi selittää nousun." });
    expect(f.action).toBe("Tarkista vastikkeen nousu: pyydä isännöitsijältä erittely nousun syystä.");
    expect(f.facts).toEqual(["hoitovastike_rise:kerrostalo:2026", "hoitovastike_rise:rivitalo:2026"]);
    expect(data.headline.count).toBe(0);
  });

  it("compares a rent rise with the rent index of its quarter, the tenant's own decision", () => {
    const data = run([{ txs: hs.charges(FRAME, { merchant: "Sato", description: "VUOKRA", from: 80000, to: 84800, changeMonth: "2026-02" }), values: hs.housingType("vuokra") }]);
    const f = byId(data, "housing:rise:out:h-chk:Sato")!;
    // 6,0 % against 0,7 % of 9 600 €, the range against state-subsidised 2,2 % and free-financed 0,1 %
    expect(f.euros).toMatchObject({ lowCents: 36480, midCents: 50880, highCents: 56640 });
    expect(f.shared).toBe(false);
    expect(f.certainty.level).toBe("keskitaso");
    expect(plain(f.title)).toContain("Vuokraindeksin vuosimuutos oli samalla neljänneksellä 0,7 %.");
    expect(f.action).toBe("Tarkista korotuksen peruste vuokrasopimuksesta.");
    expect(data.headline.midCents).toBe(50880);
  });

  it("asks for the kind of home only when a charge rose, and has no benchmark for a detached house", () => {
    const rose = hs.charges(FRAME);
    expect(checkOf(run([{ txs: rose }]), "housing:rise")).toMatchObject({ status: "needs_input", input: "housing_type" });
    expect(checkOf(run([{ txs: hs.charges(FRAME, { to: 31200 }) }]), "housing:rise").status).toBe("clear");
    const house = run([{ txs: rose, values: hs.housingType("omakotitalo") }]);
    expect(allFindings(house)).toEqual([]);
    expect(checkOf(house, "housing:rise")).toMatchObject({ status: "no_data", hint: "Asumismuodolle ei ole vertailutietoa." });
  });

  it("leaves out one step over 10 %: a move to another flat of the same landlord, and asks for the move date", () => {
    const sato = hs.charges(FRAME, { merchant: "Sato", description: "VUOKRA", from: 80000, to: 95000 });
    const data = run([{ txs: sato, values: hs.housingType("vuokra") }]);
    expect(allFindings(data)).toEqual([]);
    expect(data.headline.count).toBe(0);
    expect(checkOf(data, "housing:rise")).toMatchObject({ status: "needs_input", input: "moved_on", hint: "Jos muutitte, lisää muuttopäivä." });
    // with a move date before the series the step is still no rise to act on
    const known = run([{ txs: sato, values: { ...hs.housingType("vuokra"), moved_on: { value: "2024-01-15", asOf: "2026-10-01" } } }]);
    expect(allFindings(known)).toEqual([]);
    expect(checkOf(known, "housing:rise")).toMatchObject({ status: "no_data", hint: "Nousu on yli 10 % kerralla, joten sitä ei verrata." });
    // 10,0 % is still a rise
    expect(byId(run([{ txs: hs.charges(FRAME, { merchant: "Sato", description: "VUOKRA", from: 80000, to: 88000 }), values: hs.housingType("vuokra") }]), "housing:rise:out:h-chk:Sato")).toBeDefined();
  });

  it("stays quiet on the near misses, a new housing payee near the rise and a rise the index has not reached", () => {
    for (const miss of hs.nearMiss(FRAME)) expect(allFindings(run([miss]))).toEqual([]);
    const parking = hs.charges(FRAME, { merchant: "Autopaikka Oy", description: "AUTOPAIKKA", firstMonth: "2025-08", from: 4000, to: 4000 }, "hp");
    expect(allFindings(run([{ ...hs.hit(FRAME), txs: [...hs.hit(FRAME).txs, ...parking] }]))).toEqual([]);
    const q3 = run([{ txs: hs.charges(FRAME, { merchant: "Sato", description: "VUOKRA", from: 80000, to: 84800, changeMonth: "2026-07" }), values: hs.housingType("vuokra") }]);
    expect(allFindings(q3)).toEqual([]);
    expect(checkOf(q3, "housing:rise")).toMatchObject({ status: "no_data", hint: "Vertailutietoa ei ole nousun ajalta." });
  });
});

describe("insurance", () => {
  it("prices the rise over CPI of the same months and the offer at the coming renewal", () => {
    const data = run([ins.hit(FRAME)]);
    const rise = byId(data, `insurance:rise:${ins.SERIES}`)!;
    expect(plain(rise.title)).toBe("LähiTapiola: 100,00 € → 115,00 € 3.12.2025 alkaen, nousua 15,0 %. Kuluttajahintojen muutos samana aikana oli 0,2 %.");
    // (15,0 − 0,2) % of 1 200 €
    expect(rise.euros).toMatchObject({ lowCents: 17760, midCents: 17760, highCents: 17760 });
    expect(rise.certainty.level).toBe("keskitaso");
    expect(rise.facts).toEqual(["cpi_yoy:2025-12"]);
    const renewal = byId(data, `insurance:renewal:${ins.SERIES}`)!;
    expect(plain(renewal.title)).toBe("LähiTapiola: uusiutuu arviolta 3.12.2026, hinta 1 380 € vuodessa ja tarjous 1 150 € vuodessa.");
    expect(renewal).toMatchObject({ decideBy: "2026-11-19", action: "Kilpailuta vakuutus ennen 19.11." });
    expect(renewal.euros).toMatchObject({ midCents: 23000 });
    expect(renewal.certainty.level).toBe("korkea");
    expect(data.soon.map((f) => f.id)).toEqual([`insurance:renewal:${ins.SERIES}`]);
    // both claim the same series: the headline counts the larger
    expect(data.headline).toMatchObject({ midCents: 23000, count: 1 });
  });

  it("without an offer the renewal is a deadline that asks for one; an offer under the gate keeps it a deadline", () => {
    const bare = byId(run([{ txs: ins.premiums(FRAME) }]), `insurance:renewal:${ins.SERIES}`)!;
    expect(bare).toMatchObject({ euros: null, decideBy: "2026-11-19", needs: [`insurance_quote:${ins.SERIES}`] });
    expect(plain(bare.title)).toBe("LähiTapiola: uusiutuu arviolta 3.12.2026. Edellinen uusiutuminen nosti maksua 15,0 %, kuluttajahintojen muutos oli 0,2 %.");
    expect(bare.certainty.level).toBe("keskitaso");
    const close = byId(run([{ txs: ins.premiums(FRAME), values: ins.quote(130_000) }]), `insurance:renewal:${ins.SERIES}`)!;
    expect(close.euros).toBeNull();
    expect(close.needs).toBeUndefined();
  });

  it("stays quiet at CPI + 4 and waits for CPI of a month not yet published", () => {
    for (const miss of ins.nearMiss(FRAME)) expect(allFindings(run([miss]))).toEqual([]);
    const september = run([{ txs: ins.premiums(FRAME, { to: 12000, changeMonth: "2026-09" }) }]);
    expect(allFindings(september)).toEqual([]);
    expect(checkOf(september, "insurance:rise")).toMatchObject({ status: "no_data", hint: "Kuluttajahintojen muutosta ei ole vielä julkaistu nousukuukaudelta." });
    expect(checkOf(run([]), "insurance:rise")).toMatchObject({ status: "no_data", hint: "Vakuutusmaksuja ei löytynyt 12 kuukauden ajalta." });
  });
});

describe("the three areas together", () => {
  it("each hit holds with the others' rows, and the neutral inputs alone make nothing", () => {
    const data = run([el.hit(FRAME), hs.hit(FRAME), ins.hit(FRAME)]);
    expect(allFindings(data).map((f) => f.id).sort()).toEqual([
      "electricity:contract_end",
      "electricity:price",
      `housing:rise:out:h-chk:As Oy Kotikallio`,
      `insurance:renewal:${ins.SERIES}`,
      `insurance:rise:${ins.SERIES}`,
    ]);
    const neutral: InputValues = { ...el.neutralValues, ...hs.neutralValues, ...ins.neutralValues };
    expect(allFindings(run([{ txs: [], values: neutral }]))).toEqual([]);
  });
});
