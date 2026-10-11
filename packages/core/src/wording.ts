/**
 * Finnish bank and company wording that more than one module matches on. It lives here so a new form or a new
 * payment name is added once. Texts are matched folded (see `fold` in merchant.ts), so everything is upper case
 * and has no Ä, Å, Ö or Ü.
 */

/**
 * The texts that mark a MobilePay, Pivo or Vipps payment, as a regex alternation. Callers add what they need around
 * it ("SIIRTO HENKILOLLE" for money out, "SIIRTO HENKILOLTA" for money in) and the word boundaries that suit them.
 * Vipps and MobilePay are one app since 2022, and a row of the new brand may say only Vipps.
 */
export const MOBILEPAY_WORDS = "MOBILEPAY|MOBILE PAY|PIVO|VIPPS MOBILEPAY|VIPPS";

/**
 * What MobilePay puts before a company's name when a shop or a service is paid ("MOB.PAY*STORYTEL OY 7Q2K9X HELSINKI").
 * merchant.ts strips it like a card processor's prefix, so a service is one merchant however it was paid. Such a
 * row pays a company, never a person, so the prefix stays out of MOBILEPAY_WORDS.
 */
export const MOBILEPAY_SHOP_PREFIX = String.raw`MOB\.? ?PAY`;

/** Landlords that rent homes, as a regex alternation: the housing rule of categorize.ts and `isRent` read it. */
export const LANDLORD_WORDS =
  "SATO|KOJAMO|LUMO|HEKA|TA-YHTYMA|AVARA|M2-KODIT|Y-SAATIO|ASUNTOSAATIO|HOAS|TOAS|PSOAS|TYS|KOAS|JOENSUUN ELLI|SIVAKKA|LAHDEN TALOT|ESPOON ASUNNOT|VANTAAN ASUNNOT";
const RENT = new RegExp(`(?<![A-Z])(?:VUOKRA[A-Z]*|${LANDLORD_WORDS})(?![A-Z])`);
/** A housing company's vastike, a parking place or a storage unit: no home's rent, even when the text says VUOKRA. */
const NOT_RENT = /(?<![A-Z])(?:[A-Z]*VASTIKE|AS OY|AS\. OY|ASOY|ASUNTO OY|ASUNTO-OSAKEYHTIO|AUTOPAIK[A-Z]*|AUTOTALLI[A-Z]*|AUTOKATOS[A-Z]*|PARKKI[A-Z]*|PYSAKOINTI[A-Z]*|[A-Z]*VARASTO[A-Z]*|[A-Z]*STORAGE|SHURGARD)(?![A-Z])/;

/** A home's rent in a folded payee or payment text: a landlord or the word for rent. */
export const isRent = (folded: string): boolean => RENT.test(folded) && !NOT_RENT.test(folded);

/**
 * What a company form is used for. The lists differ on purpose: a short form such as SA, SE or AS is also a
 * person's name, so a payee is not a business only because of it, but a name that contains one is still not a
 * person when it is paid by MobilePay.
 *   strip:  dropped from a trade register name to get the bare company name
 *   payee:  a payee that starts or ends with it is a business, so its name may go to the register
 *   person: a MobilePay payee whose name contains it is a company, not a person
 */
export type FormUse = "strip" | "payee" | "person";

const ALL: readonly FormUse[] = ["strip", "payee", "person"];

const FORMS: Readonly<Record<string, readonly FormUse[]>> = {
  OY: ALL,
  OYJ: ALL,
  AB: ALL,
  KY: ALL,
  AY: ALL,
  RY: ALL,
  TMI: ALL,
  OSK: ALL,
  KOY: ALL,
  LTD: ALL,
  ABP: ["strip", "payee"],
  RF: ["strip"],
  AOY: ["strip"],
  AS: ["strip", "person"],
  SR: ["strip", "person"],
  LIMITED: ["payee", "person"],
  INC: ["payee", "person"],
  GMBH: ["payee", "person"],
  LLC: ["payee", "person"],
  PLC: ["payee", "person"],
  BV: ["payee", "person"],
  ASA: ["payee", "person"],
  SA: ["person"],
  SE: ["person"],
  NV: ["person"],
  OU: ["person"],
};

/** The company forms one use trusts. */
export function companyForms(use: FormUse): ReadonlySet<string> {
  return new Set(Object.keys(FORMS).filter((form) => FORMS[form]!.includes(use)));
}

// ── lists the analysis and Optimoi read, each behind a named predicate (ADR 0008) ──
// A predicate keeps the matching its reader had (whole words, a substring, a whole name). Where a rule of
// categorize.ts reads the same list, it interpolates the same constant.

const words = (list: string) => new RegExp(String.raw`(?<![A-Z0-9])(?:${list})(?![A-Z0-9])`);

/** Electricity sellers, as a regex alternation: the utilities rule of categorize.ts and `isElectricitySeller` read it. */
export const ELECTRICITY_SELLER_WORDS = String.raw`FORTUM|VATTENFALL|OOMI|\bVARE\b|HELEN|LUMME|NORDIC GREEN|LOISTE|HERRFORS`;
/** Electricity network companies (DSOs), read the same way. */
export const ELECTRICITY_NETWORK_WORDS = "CARUNA|ELENIA|JARVI-SUOMEN ENERGIA|ROVAKAIRA";
const ELECTRICITY_SELLER = new RegExp(`${ELECTRICITY_SELLER_WORDS}|SAHKO`);
const NETWORK_COMPANY = new RegExp(`SAHKOVERKKO|VERKKO|VERKOT|SIIRTO|${ELECTRICITY_NETWORK_WORDS}`);
/** A folded payee name that sells electricity: a seller or the word for electricity. */
export const isElectricitySeller = (name: string) => ELECTRICITY_SELLER.test(name);
/** A folded payee name that bills the network only. Read before the sellers, so "Helen Sähköverkko" is a network. */
export const isNetworkCompany = (name: string) => NETWORK_COMPANY.test(name);
/** A cooperative distributes and sells to its members on one bill. */
export const isElectricityCooperative = (name: string) => /SAHKOOSUUSKUNTA/.test(name);
/** Heat, water and waste come from the same companies and are no electricity. */
export const isHeatWaterOrWaste = (folded: string) => /LAMPO|VESI|JATE/.test(folded);

/** A card in a fee's folded text. */
export const isCardText = (folded: string) => /KORTTI|CARD|DEBIT|CREDIT|GOLD|PLATINUM/.test(folded);
/** Nordea's bank codes start with 1 or 2; a card account from the Nordea connection has no IBAN. */
export const isNordeaAccount = (a: { iban: string | null }) => a.iban === null || /^FI\d{2}[12]/.test(a.iban.replace(/\s/g, ""));

/** Day care, as a regex alternation: the kids rule of categorize.ts and `isDaycareText` read it. */
export const DAYCARE_WORDS = "[A-Z]*PAIVAKOTI[A-Z]*|[A-Z]*PAIVAHOITO[A-Z]*|VARHAISKASVATUS[A-Z]*";
const DAYCARE = new RegExp(`(?<![A-Z])(?:${DAYCARE_WORDS})(?![A-Z])`);
export const isDaycareText = (folded: string) => DAYCARE.test(folded);

const MUNICIPALITY = /(?<![A-Z])(?:KAUPUNKI|KUNTA|STAD|KOMMUN)(?![A-Z])/;
/** A city or municipality as the payee, in a name or text folded with `fold`. */
export const isMunicipality = (folded: string) => MUNICIPALITY.test(folded);

/** A reminder fee, late interest or a collection cost, as a regex alternation (analysis/fees.ts). */
export const LATE_FEE_WORDS = "MUISTUTUSMAKSU|VIIVASTYSKORKO|PERINTAKULU|KARHUMAKSU|MAKSUMUISTUTUS";

const PURCHASE_INTEREST = /KORKO/i;
const NOT_PURCHASE_INTEREST = /VIIV[AÄ]STYS|PALKKIO|LUOTTOKULU|LUOTTOKUSTANNU|MAKSU/i;
/** Interest on card purchases in a row's text: KORKO, and no late interest, fee or credit cost. */
export const isPurchaseInterestText = (text: string) => PURCHASE_INTEREST.test(text) && !NOT_PURCHASE_INTEREST.test(text);

const LENDERS = /KLARNA|WALLEY|RIVERTY|AFTERPAY|RESURS|ANYDAY/;
/** Payment services that sell instalment plans, in a folded name. */
export const isLenderName = (folded: string) => LENDERS.test(folded);

/** Card issuers whose bills come as plain e-invoices, as a regex alternation: credit_draw in categorize.ts reads it too. */
export const CARD_ISSUER_WORDS = "NORDEA RAHOITUS|NORDEA FINANCE|BANK NORWEGIAN|ENTERCARD|RE:?MEMBER|KOMPLETT BANK";
const CARD_ISSUER = words(CARD_ISSUER_WORDS);
export const isCardIssuerText = (folded: string) => CARD_ISSUER.test(folded);
const LOAN_TEXT = words(String.raw`OSAMAKSU[A-Z]*|LAINA[A-Z]*|LYHENNYS|LAINANHOITO|RAHOITUSSOPIMUS|SOPIMUS|KULUTUSLUOTTO`);
/** Texts that name a loan: such a payment stays a loan whatever its amount. */
export const isLoanText = (folded: string) => LOAN_TEXT.test(folded);

/** Refund words, as a regex alternation: the reimbursements rule of categorize.ts and `isRefundText` read it. */
export const REFUND_WORDS = "HYVITYS|PALAUTUS|REFUND|CHARGEBACK|OIKAISU";
const REFUND_TEXT = new RegExp(`(?<![A-Z0-9])(?:${REFUND_WORDS})[A-Z]*(?![A-Z0-9])`);
export const isRefundText = (folded: string) => REFUND_TEXT.test(folded);

/** Residual tax and the other taxes paid to the same office, as regex alternations: taxes in categorize.ts reads both. */
export const RESIDUAL_TAX_WORDS = "JAANNOSVERO|OMAVERO";
export const OTHER_TAX_WORDS = "KIINTEISTOVERO|AUTOVERO|AJONEUVOVERO|ENNAKKOVERO|PERINTOVERO|LAHJAVERO|VARAINSIIRTOVERO";
const RESIDUAL_TAX = new RegExp(`(?<![A-Z])(?:${RESIDUAL_TAX_WORDS})(?![A-Z])`);
const OTHER_TAX = new RegExp(`(?<![A-Z])(?:${OTHER_TAX_WORDS})(?![A-Z])`);
export const isResidualTaxText = (folded: string) => RESIDUAL_TAX.test(folded);
/** Property tax, car tax and prepayments go to the same payee and are not residual tax. */
export const isOtherTaxText = (folded: string) => OTHER_TAX.test(folded);

/** Earnings pension companies, as a regex alternation: the benefits rule of categorize.ts reads it as words. */
export const PENSION_PAYER_WORDS = "ILMARINEN|VARMA|KEVA|VERITAS|ELAKETURVAKESKUS|PENSIONSSKYDDSCENTRALEN|ELO KESKINAINEN";
const PENSION_PAYER = new RegExp(`^(?:${PENSION_PAYER_WORDS})$`);
/** A payer's whole folded name: Elo and Ilmarinen are also surnames, and elo is a month. */
export const isPensionPayerName = (name: string) => PENSION_PAYER.test(name);

const ESSENTIAL_SERVICES = /ICLOUD|GOOGLE ?ONE|ONEDRIVE|MICROSOFT|OFFICE ?365|DROPBOX|F-?SECURE|NORTON|MCAFEE|1PASSWORD|BITWARDEN|LASTPASS/;
/** Storage and security keep the phone and the files working, in a folded name. */
export const isEssentialService = (folded: string) => ESSENTIAL_SERVICES.test(folded);

// cleaning and yard work are almost all labour; renovation and repair invoices carry materials too
const CLEANING_WORK = words(String.raw`SIIVOUS|SIIVOUSPALVELU[A-Z]*|SIIVOUSLIIKE|KOTISIIVOUS|SIIVOOJA|IKKUNANPESU[A-Z]*|PIHATYO[A-Z]*|PIHAPALVELU[A-Z]*|PIHANHOITO|LUMITYO[A-Z]*|LUMENAURAUS|PUUNKAATO`);
const BUILDING_WORK = words(String.raw`[A-Z]*REMONTTI(?:PALVELU[A-Z]*|TYO[A-Z]*|URAKOINTI)?|REMONTOINTI|MAALAUSPALVELU[A-Z]*|MAALAUSLIIKE|MAALARI[A-Z]*|SAHKO(?:ASENN|ASENT|TYO|URAKOINTI)[A-Z]*|LVI|PUTKI(?:ASENNUS|TYO|LIIKE)[A-Z]*|KOTITALKKARI|HUOLTOMIES`);
export const isCleaningWorkText = (folded: string) => CLEANING_WORK.test(folded);
export const isBuildingWorkText = (folded: string) => BUILDING_WORK.test(folded);

// what a car row was for: street parking is the apps the permit comparison counts; finance is a financier or a loan that names the car
const PARKING_WORDS = words(String.raw`EASYPARK|PARKMAN|MOOVY|AIMO|AIMO PARK|APCOA|EUROPARK|Q-PARK|P-HUB|SCANDINAVIAN PARKING|PYSAKOINTI|PARKKI[A-Z]*`);
const STREET_PARKING_WORDS = words(String.raw`EASYPARK|PARKMAN|MOOVY|AIMO|AIMO PARK`);
const CHARGING_WORDS = words(String.raw`K-LATAUS|VIRTA|PLUGIT|RECHARGE|IONITY|SUPERCHARGER|[A-Z]*LATAUS`);
const INSPECTION_WORDS = words(String.raw`[A-Z-]*KATSASTUS[A-Z]*`);
const SERVICE_WORDS = words(String.raw`RENGAS[A-Z]*|RENKAAT|AUTOHUOLTO|AUTOKORJAAMO|KORJAAMO|AUTOMAALAAMO|AUTOPALVELU|MEKONOMEN|EUROMASTER|VIANOR`);
const FUEL_WORDS = words(String.raw`NESTE|ST1|ABC|SHELL|TEBOIL|SEO|GULF`);
const CAR_INSURANCE_WORDS = words(String.raw`LIIKENNEVAKUUTUS|AUTOVAKUUTUS|AJONEUVOVAKUUTUS|KASKO[A-Z]*`);
const VEHICLE_TAX_WORDS = words(String.raw`AJONEUVOVERO|TRAFICOM`);
const CAR_FINANCE_WORDS = words(String.raw`AUTO|AUTON|AUTOLAINA|AUTORAHOITUS|AUTO-OSAMAKSU|AUTOSOPIMUS|SANTANDER|TOYOTA FINANCIAL|VOLKSWAGEN FINANCIAL`);
export const isParkingText = (folded: string) => PARKING_WORDS.test(folded);
export const isStreetParkingText = (folded: string) => STREET_PARKING_WORDS.test(folded);
export const isChargingText = (folded: string) => CHARGING_WORDS.test(folded);
export const isInspectionText = (folded: string) => INSPECTION_WORDS.test(folded);
export const isCarServiceText = (folded: string) => SERVICE_WORDS.test(folded);
export const isFuelText = (folded: string) => FUEL_WORDS.test(folded);
export const isCarInsuranceText = (folded: string) => CAR_INSURANCE_WORDS.test(folded);
export const isVehicleTaxText = (folded: string) => VEHICLE_TAX_WORDS.test(folded);
export const isCarFinanceText = (folded: string) => CAR_FINANCE_WORDS.test(folded);
