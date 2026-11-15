import { describe, expect, it } from "vitest";
import { categorize, compileRules } from "../src/categorize.ts";
import { fold } from "../src/merchant.ts";
import { PAYEES, payeeFor } from "../src/payees.ts";
import { housingCharge } from "../src/wording.ts";

const rules = compileRules([]);
const row = (counterparty: string, amountCents: number, description = "4411223") => ({ merchant: counterparty, counterparty, description, mcc: null, amountCents });
const categoryOf = (counterparty: string, amountCents = -45_900, description?: string) => categorize(row(counterparty, amountCents, description), rules).category;

/** Per entry: a name it names, and a false friend it must leave alone. */
const SAMPLES: Record<string, readonly [string, string]> = {
  arval: ["Arval Service Lease Finland Oy", "Arvalo Oy"],
  ayvens: ["Ayvens Finland Oy", "Ayvensi Oy"],
  ald: ["ALD Automotive Oy", "ALD Automation Oy"],
  leaseplan: ["LeasePlan Finland Oy", "Please Plan Oy"],
  sixt_leasing: ["Sixt Leasing Suomi Oy", "Sixt Rent a Car"],
  carlease: ["Carlease Finland Oy", "Carleton Oy"],
  op_leasing: ["OP Autoleasing Oy", "Top Leasing Oy"],
  lease_word: ["Yksityisleasing kuukausimaksu", "Auto Lease Oy"],
  alva: ["Alva Oy", "Alva Kahvila"],
  tampereen_sahkolaitos: ["Tampereen Sähkölaitos Oy", "Turun Sähkölaitos Oy"],
  vantaan_energia: ["Vantaan Energia Oy", "Vantaan Energiatoimisto"],
  turku_energia: ["Turku Energia Oy", "Turku Energiatoimisto"],
  kuopion_energia: ["Kuopion Energia Oy", "Kuopion Energiakoulu"],
  oulun_energia: ["Oulun Energia Oy", "Oulun Energiakoulu"],
  lahti_energia: ["Lahti Energia Oy", "Lahti Energiapuisto"],
  water: ["Kuopion Vesi", "Kuopion Vesipuisto"],
  mustankorkea: ["Mustankorkea Oy", "Mustakorkea Oy"],
  kiertokapula: ["Kiertokapula Oy", "Kiertokapulassa Oy"],
  lassila_tikanoja: ["Lassila & Tikanoja Oyj", "Lassila Oy"],
  remeo: ["Remeo Oy", "Remeontti Oy"],
  rosk_n_roll: ["Rosk'n Roll Oy", "Roska Oy"],
  jatekukko: ["Jätekukko Oy", "Kukko Oy"],
  kiertokaari: ["Kiertokaari Oy", "Kiertokaarinen Oy"],
  hsy: ["HSY", "Ohsy Oy"],
  ekokem: ["Ekokem Oy", "Ekokemi Oy"],
  urbaser: ["Urbaser Oy", "Urbaseria Oy"],
  jate_word: ["Pirkanmaan Jätehuolto Oy", "Jatkuva Palvelu Oy"],
};

/** The banks: a name alone names no payee, the lease word anywhere in the row makes the entry (tested under leasing). */
const BANKS = ["handelsbanken_leasing", "nordea_leasing", "santander_leasing"];

describe("payee list", () => {
  it("has a name and a false friend for every entry, and none for a missing one", () => {
    expect([...Object.keys(SAMPLES), ...BANKS].sort()).toEqual(PAYEES.map((p) => p.id).sort());
  });

  it.each(Object.entries(SAMPLES))("%s names its payee and not the false friend", (id, [name, friend]) => {
    expect(payeeFor(fold(name))?.id).toBe(id);
    expect(payeeFor(fold(friend))?.id).not.toBe(id);
  });

  it("names the waste company of Fortum and not its electricity seller", () => {
    expect(payeeFor(fold("Fortum Waste Solutions Oy"))?.id).toBe("ekokem");
    expect(payeeFor(fold("Fortum Markets Oy"))).toBeNull();
  });
});

describe("leasing", () => {
  it("files equal payments and a larger first one under Autoleasing", () => {
    expect(categoryOf("Arval Service Lease Finland Oy", -45_900)).toBe("leasing");
    expect(categoryOf("Arval Service Lease Finland Oy", -120_000)).toBe("leasing");
  });

  it("files a refund from a lessor under Autoleasing, and leaves pay and a car sold to the income rules", () => {
    expect(categoryOf("Arval Service Lease Finland Oy", 5_000)).toBe("leasing");
    expect(categoryOf("Arval Service Lease Finland Oy", 5_000, "HYVITYS")).toBe("leasing");
    expect(categoryOf("Arval Service Lease Finland Oy", 320_000, "PALKKA 10/2026")).toBe("salary");
    expect(categoryOf("Ayvens Finland Oy", 90_000, "AUTON KAUPPAHINTA")).not.toBe("leasing");
    expect(categoryOf("Ayvens Finland Oy", 1_500_000)).not.toBe("leasing");
  });

  it("files a refund from a utility, waste or water payee under Utilities, as before the list", () => {
    for (const name of ["Kiertokapula Oy", "Mustankorkea Oy", "Pirkanmaan Jätehuolto Oy", "HSY", "Kuopion Vesi", "Vantaan Energia Oy", "Alva Oy"]) expect(categoryOf(name, 2_400)).toBe("utilities");
  });

  it.each([
    ["Nordea Rahoitus Suomi Oy", "LEASING 12345"],
    ["Nordea Rahoitus Suomi Oy", "LEASINGVUOKRA 10/2026"],
    ["Nordea Finance Finland Ltd", "LEASINGMAKSU"],
    ["Handelsbanken Rahoitus Oyj", "LEASINGSOPIMUS 123"],
    ["Santander Consumer Bank AS", "AUTON LEASINGMAKSU"],
  ])("%s with %s in the text is Autoleasing, and without the word it is not", (name, text) => {
    expect(categoryOf(name, -45_900, text)).toBe("leasing");
    expect(categoryOf(name, -45_900, "LASKU 12345")).not.toBe("leasing");
  });

  it.each([
    "Ayvens Finland Oy",
    "ALD Automotive Oy",
    "LeasePlan Finland Oy",
    "Sixt Leasing Suomi Oy",
    "Carlease Finland Oy",
    "OP Autoleasing Oy",
    "Handelsbanken Rahoitus Leasing",
    "Nordea Rahoitus Leasing Oy",
    "Santander Consumer Leasing",
  ])("%s is Autoleasing", (name) => {
    expect(categoryOf(name)).toBe("leasing");
  });

  it("leaves the same banks' loans and a car rental as they were", () => {
    expect(categoryOf("Nordea Rahoitus Suomi Oy")).toBe("loans");
    expect(categoryOf("Handelsbanken Rahoitus Oyj")).toBe("loans");
    expect(categoryOf("Sixt Rent a Car")).toBe("travel");
  });

  it("still asks about an equal payment to a company the list does not know", () => {
    expect(categorize(row("Esimerkki Palvelut Oy", -45_900), rules)).toMatchObject({ category: "other", source: "default" });
  });
});

describe("Asuminen kind of a payee", () => {
  const kind = (payee: string, text = "", utility = true) => housingCharge(fold(payee), fold(text), utility)?.label ?? null;

  it.each([
    ["Kiertokapula Oy", "", "Jätehuolto"],
    ["Pirkanmaan Jätehuolto Oy", "", "Jätehuolto"],
    ["Fortum Waste Solutions Oy", "", "Jätehuolto"],
    ["Mustankorkea Oy", "", "Jätehuolto"],
    ["HSY", "", "Vesi"],
    ["HSY", "jätemaksu", "Jätehuolto"],
    ["Lahti Energia Oy", "kaukolämpö", "Kaukolämpö"],
    ["Vantaan Energia Oy", "lämpö", "Kaukolämpö"],
    ["Vantaan Energia Oy", "sähkö", "Sähkö"],
    ["Alva Oy", "", "Sähkö"],
    ["Tampereen Sähkölaitos Oy", "", "Sähkö"],
    ["Helen Oy", "", "Sähkö"],
    ["Caruna Oy", "", "Sähkönsiirto"],
    ["Kuopion Vesi", "", "Vesi"],
    ["Esimerkin Vesihuolto Oy", "", "Vesi"],
    ["AS OY Esimerkki", "", "Vastike"],
    ["AS OY Esimerkki", "hoitovastike", "Hoitovastike"],
    ["Esimerkki Kiinteistöt Oy", "vuokra", "Vuokra"],
  ])("%s %s is %s", (payee, text, expected) => {
    expect(kind(payee, text)).toBe(expected);
  });

  it("gives an unknown utility, and an energy company that sells both and says nothing, no kind", () => {
    expect(kind("Esimerkki Palvelut Oy")).toBeNull();
    expect(kind("Vantaan Energia Oy")).toBeNull();
  });

  it("reads JATE in a payee name only, never in a purchase text", () => {
    expect(categorize({ merchant: "Tokmanni", counterparty: "TOKMANNI", description: "JATEPUSSIT", mcc: null, amountCents: -120 }, rules).category).toBe("shopping");
    expect(categoryOf("Esimerkki Oy", -2_400, "JATETTY TILAUS")).not.toBe("utilities");
    expect(categoryOf("Pirkanmaan Jätehuolto Oy", -2_400)).toBe("utilities");
  });
});

describe("housing and utility rows by name", () => {
  it.each([
    ["AS OY Esimerkki", "housing"],
    ["Asunto Oy Esimerkki", "housing"],
    ["Asunto-osakeyhtiö Esimerkki", "housing"],
    ["Kiinteistö Oy Esimerkki", "housing"],
    ["Isännöinti Esimerkki Oy", "housing"],
    ["Kiertokapula Oy", "utilities"],
    ["Pirkanmaan Jätehuolto Oy", "utilities"],
    ["Loimi-Hämeen Jätehuolto", "utilities"],
    ["Mustankorkea Oy", "utilities"],
    ["Ekokem Oy", "utilities"],
    ["Vantaan Energia Oy", "utilities"],
    ["Alva Oy", "utilities"],
    ["Esimerkin Vesihuolto Oy", "utilities"],
  ])("%s is %s", (name, expected) => {
    expect(categoryOf(name)).toBe(expected);
  });
});
