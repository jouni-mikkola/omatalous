/**
 * Finnish bank and company wording that more than one module matches on. It lives here so a new form or a new
 * payment name is added once. Texts are matched folded (see `fold` in merchant.ts), so everything is upper case
 * and has no Ä, Å, Ö or Ü.
 */
import { homeKindOf, isHeatWaterOrWaste } from "./payees.ts";

export { isHeatWaterOrWaste };

/**
 * The texts that mark a MobilePay, Pivo or Vipps payment, as a regex alternation. Callers add what they need around
 * it ("SIIRTO HENKILOLLE" for money out, "SIIRTO HENKILOLTA" for money in) and the word boundaries that suit them.
 * Vipps and MobilePay are one app since 2022, and a row of the new brand may say only Vipps.
 */
export const MOBILEPAY_WORDS = "MOBILEPAY|MOBILE PAY|PIVO|VIPPS MOBILEPAY|VIPPS";

/**
 * What MobilePay puts before a name when the bank books the payment as a card purchase ("MOB.PAY*STORYTEL OY 7Q2K9X
 * HELSINKI"). merchant.ts strips it like a card processor's prefix, so a service is one merchant however it was paid.
 * The name behind it is a company's or a person's (PERSON_PAYMENT_PREFIX). The prefix stays out of MOBILEPAY_WORDS, so
 * the category rules do not read such a row as money to a person.
 */
export const MOBILEPAY_SHOP_PREFIX = String.raw`MOB\.? ?PAY`;

/**
 * The prefixes of processors that also carry money to people, as a regex alternation: MobilePay's and PayPal's
 * ("PAYPAL *MATTIMEIKALAINEN" is a private recipient, written as one word). The name behind one is a business's only
 * when the name says so itself (industry.ts). A card terminal's prefix (SUMUP, ZETTLE) stands before a seller.
 */
export const PERSON_PAYMENT_PREFIX = String.raw`${MOBILEPAY_SHOP_PREFIX}|PAYPAL|PP`;
/** A bank's own words for a payment between people, sent by phone number, as a regex alternation. They name nobody: the payee beside them does (categorize-people.ts). */
export const PERSON_PAYMENT_WORDS = "MOBIILIMAKSU|SIIRTO-MAKSU";
/** The words of an invoice in a message, as a regex alternation: with the endings a sole trader writes (LASKUTUS, LASKUNRO, FAKTURA), "E-LASKU" and "E-INVOICE" after the hyphen, and INV by itself. */
export const INVOICE_WORDS = "LASKU[A-Z]*|INVOICE[A-Z]*|FAKTURA[A-Z]*|INV";

const BUSINESS_PAYMENT =
  /(?<![\p{L}\p{N}])(?:KORTTIOSTO|KORTTIMAKSU|CARD PURCHASE|OSTOPVM|E-LASKU|E-INVOICE|SUORAMAKSU|VERKKOMAKSU)(?![\p{L}\p{N}])|X{2,}\d{2,4}|\*{2,}\d{2,4}/u;
/** Whether a folded text has what banks put on card purchases and e-invoices, never on a transfer to a person. */
export const isBusinessPaymentText = (folded: string) => BUSINESS_PAYMENT.test(folded);

/**
 * The names of ways to pay, as a regex alternation. A bank prints one where a payee's name would stand, and the
 * cleaning makes it the merchant ("Siirto", "Viitemaksu"). Such a name is nobody's, so it is never looked up.
 */
const PAYMENT_METHOD_WORDS = `SIIRTO|PIKASIIRTO|TILISIIRTO|OMA SIIRTO|MAKSU|VIITEMAKSU|VERKKOMAKSU|SUORAMAKSU|KORTTIMAKSU|KORTTIOSTO|VERKKOPANKKI|MOBIILIPANKKI|LASKU|E-LASKU|${MOBILEPAY_WORDS}`;
const PAYMENT_METHOD_NAME = new RegExp(`^(?:${PAYMENT_METHOD_WORDS})(?:[ -]+(?:${PAYMENT_METHOD_WORDS}))*$`);
/** A folded name made only of the names of ways to pay: "SIIRTO", "MAKSU SIIRTO". */
export const isPaymentMethodName = (folded: string) => PAYMENT_METHOD_NAME.test(folded.trim());

/** Landlords that rent homes, as a regex alternation: the housing rule of categorize.ts and `isRent` read it. */
export const LANDLORD_WORDS =
  "SATO|KOJAMO|LUMO|HEKA|TA-YHTYMA|AVARA|M2-KODIT|Y-SAATIO|ASUNTOSAATIO|HOAS|TOAS|PSOAS|TYS|KOAS|JOENSUUN ELLI|SIVAKKA|LAHDEN TALOT|ESPOON ASUNNOT|VANTAAN ASUNNOT";
const RENT = new RegExp(`(?<![A-Z])(?:VUOKRA[A-Z]*|${LANDLORD_WORDS})(?![A-Z])`);
const CAR_PLACE_WORDS = "AUTOPAIK[A-Z]*|AUTOTALLI[A-Z]*|AUTOKATOS[A-Z]*";
/** A housing company's vastike, a parking place (`CAR_PLACE_WORDS`, a row of its own in Asuminen) or a storage unit: no home's rent, even when the text says VUOKRA. */
const NOT_RENT = new RegExp(String.raw`(?<![A-Z])(?:[A-Z]*VASTIKE|AS OY|AS\. OY|ASOY|ASUNTO OY|ASUNTO-OSAKEYHTIO|${CAR_PLACE_WORDS}|PARKKI[A-Z]*|PYSAKOINTI[A-Z]*|[A-Z]*VARASTO[A-Z]*|[A-Z]*STORAGE|SHURGARD)(?![A-Z])`);
const BESIDE_RENT = new RegExp(String.raw`(?<![A-Z])(?:(?:${CAR_PLACE_WORDS}) ?(?:JA|\+|&)|(?:JA|\+|&) ?(?:${CAR_PLACE_WORDS}))(?![A-Z])`);
/** A home's rent in a folded payee or payment text: a landlord or the word for rent. A car place joined to it ("Vuokra ja autopaikka") is on the rent's bill. */
export const isRent = (folded: string): boolean => RENT.test(folded) && !NOT_RENT.test(folded.replace(BESIDE_RENT, " "));

/**
 * What a company form is used for. The lists differ on purpose: a short form such as AS or SR is also a word of a
 * person's name, so a payee is not a business only because of it.
 *   strip:  dropped from a trade register name to get the bare company name
 *   payee:  a payee that starts or ends with it is a business, so its name may go to the register
 */
export type FormUse = "strip" | "payee";

const ALL: readonly FormUse[] = ["strip", "payee"];

const FORMS: Readonly<Record<string, readonly FormUse[]>> = {
  OY: ALL,
  OYJ: ALL,
  AB: ALL,
  ABP: ALL,
  KY: ALL,
  AY: ALL,
  RY: ALL,
  TMI: ALL,
  OSK: ALL,
  KOY: ALL,
  LTD: ALL,
  RF: ["strip"],
  AOY: ["strip"],
  AS: ["strip"],
  SR: ["strip"],
  LIMITED: ["payee"],
  INC: ["payee"],
  GMBH: ["payee"],
  LLC: ["payee"],
  PLC: ["payee"],
  BV: ["payee"],
};

/** The company forms one use trusts. */
export function companyForms(use: FormUse): ReadonlySet<string> {
  return new Set(Object.keys(FORMS).filter((form) => FORMS[form]!.includes(use)));
}

// ── a person's name: industry.ts never sends one to the trade register, and to categorize.ts it is no shop's ──

/**
 * The forms that make a payee a business. SA, SE and AS are left out: they are too often part of a person's name.
 * So is ASA, which the first name Åsa folds to.
 */
const PAYEE_FORMS = companyForms("payee");
/** Company forms that a first name or a surname also begins with (Kyllikki, Ryhänen, Abel, Ayla, Oskari). */
const FORMS_A_NAME_BEGINS_WITH = new Set(["KY", "RY", "AB", "AY", "OSK"]);

/**
 * A text without the characters nobody sees: a soft hyphen or a zero-width space of a copied page, a direction mark,
 * a control character, a loose accent, the blank of braille. Left in, one splits a word, and "HEN" + soft hyphen +
 * "RY" would end in a company form. Every reader of a name's words below drops them first, and industry.ts does
 * before it cleans a bank's text. A tab and a line break stay: they stand between words.
 */
export const dropUnseen = (text: string): string => text.replace(/(?![\t\n\r])[\p{C}\p{M}\u2800]/gu, "");

/**
 * A company form as the first or last word of a folded name. Words are runs of letters of any script, so "AY" is not
 * a word in "AYŞE" nor "SA" in "SAŠA". A name the bank may have cut at its field length ends anywhere: from `cutFrom`
 * words on, a last word that a person's name can begin with does not count ("VIRTANEN LIISA KY" from Kyllikki).
 * The default takes the name as whole.
 */
export function hasPayeeForm(folded: string, cutFrom = Number.POSITIVE_INFINITY): boolean {
  return formAtAnEnd(dropUnseen(folded), cutFrom, false);
}

/**
 * `nameInFront` reads a first word that a name begins with as a name: "OSK. MEIKALAINEN" is Oskari, "AB MEIKALAINEN"
 * two initials, and Ky and Ay are first names. The register lookup asks so (isPersonShaped). The category rules do
 * not: there a form in front is a company's.
 */
function formAtAnEnd(folded: string, cutFrom: number, nameInFront: boolean): boolean {
  const parts = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!parts.length) return false;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const cutName = parts.length >= cutFrom && FORMS_A_NAME_BEGINS_WITH.has(last);
  const inFront = PAYEE_FORMS.has(first) && !(nameInFront && FORMS_A_NAME_BEGINS_WITH.has(first));
  return inFront || (PAYEE_FORMS.has(last) && !cutName);
}

/**
 * Words that say a name is a business or an organisation, alone or as the end of a compound (AUTOLIIKE, KUKKAKAUPPA).
 * None of them is a first name or a surname. The trades the category rules know (KAHVILA, APTEEKKI) are not repeated
 * here: a name with one has a category, and only names without a category are looked up.
 */
const BUSINESS_NAME = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:\p{L}*(?:KAUPPA|PUOTI|MYYMALA|LIIKE|TUKKU|PALVELU|PALVELUT|HUOLTO|TOIMISTO|KESKUS|KERHO|YHDISTYS|SAATIO|SEURAKUNTA|OSUUSKUNTA|KONSULTOINTI|URAKOINTI|KULJETUS|RAKENNUS|TEKNIIKKA|TARVIKE|VUOKRAUS|GRILLI)|SHOP|BUTIK|STUDIO|CLUB|GROUP|CONSULTING|SOLUTIONS|FINLAND|NORDIC|INTERNATIONAL)(?![\p{L}\p{N}])`,
  "u",
);
/** A folded name that says it is a business: "AUTOLIIKE ESIMERKKI", "ZORRO KAUPPA". */
export const hasBusinessWord = (folded: string) => BUSINESS_NAME.test(folded);

/**
 * One word of a person's name: letters, with hyphens and apostrophes ("ANNA-LIISA", "O'BRIEN"), an initial or an
 * abbreviation with its full stop ("J.", "OSK."). A word the bank cut may end anywhere ("MEIKAL", "ANNA-"). A digit
 * glued to the letters is a slip of the hand ("MEIKALAINEN2"), so the word still counts: a shop named "KIOSKI24
 * ESIMERKKI" is the cost. A number alone is no word (spacedParts).
 */
const NAME_WORD = /^[\p{L}\p{N}][\p{L}\p{N}'-]*\.?$/u;
/** A web address is one word: "ESIMERKKI.FI" is no first name and surname. */
const WEB_ADDRESS = /^\p{L}[\p{L}\p{N}-]{2,}\.(?:FI|COM|NET|ORG|EU|IO)$/u;

/** The parts of a folded name between spaces. A part without a letter is no word of a name: a number, "&". */
const spacedParts = (folded: string): string[] => folded.split(/[\s,;/]+/).filter((part) => /\p{L}/u.test(part));
/** The words of a name. A full stop between letters parts two words: "M.MEIKALAINEN", "MATTI.MEIKALAINEN", "J.R.R.". */
const nameWords = (parts: readonly string[]): string[] => parts.flatMap((part) => (WEB_ADDRESS.test(part) ? [part] : part.split(/(?<=\p{L}\.)(?=\p{L})/u)));

/**
 * Whether a folded name has the shape of a person's name: two to four words of letters with no company form and no
 * business word. Surname first or last looks the same, and so does a name the bank cut at its field length
 * ("MATTI JUHANI MEIKAL"; `cutFrom` says where it may have done so, see hasPayeeForm). A company form in front that
 * a name begins with is a word of the name ("OSK. MEIKALAINEN"). The shape cannot tell a person from a shop named
 * like one ("Pikku Ilona"), and a sole trader's own name is a person's: such names are not looked up either.
 */
export function isPersonShaped(folded: string, cutFrom = Number.POSITIVE_INFINITY): boolean {
  const name = dropUnseen(folded);
  const parts = spacedParts(name);
  const words = nameWords(parts);
  // initials are words of their own, so the lower limit counts words and the upper one the parts between spaces
  return words.length >= 2 && parts.length <= 4 && words.every((word) => NAME_WORD.test(word)) && !formAtAnEnd(name, cutFrom, true) && !hasBusinessWord(name);
}

/**
 * Whether a folded name says it is a business and names no person beside that: it has a company form or a business
 * word, and fewer than two name words stand on either side of every such word. Two name words together may be a
 * person: a club's invoice names the child ("ESIMERKIN TANSSIKERHO VILLE MEIKALAINEN"), a sole trader's the owner
 * ("MATTI MEIKALAINEN KULJETUS"). One name word on each side is a business's: a town and an owner stand so
 * ("ESIMERKIN AUTOHUOLTO KALLIO"), and nobody writes a person's two names around a business word.
 */
export function namesBusiness(folded: string): boolean {
  const marks = nameWords(spacedParts(dropUnseen(folded))).map((word) => PAYEE_FORMS.has(word.replace(/\.$/, "")) || hasBusinessWord(word));
  const first = marks.indexOf(true);
  if (first < 0) return false;
  const nameWordsIn = (from: number, to: number) => marks.slice(from, to).filter((mark) => !mark).length;
  return nameWordsIn(0, marks.lastIndexOf(true)) < 2 && nameWordsIn(first + 1, marks.length) < 2;
}

// ── lists the analysis and Optimoi read, each behind a named predicate (ADR 0008) ──
// A predicate keeps the matching its reader had (whole words, a substring, a whole name). Where a rule of
// categorize.ts reads the same list, it interpolates the same constant.

/** Whole words of a list, also next to "+", "'" and ".". `numbered`: a bank glues a document's number on ("MATKALASKU123456"), so only a letter ends the word. */
export const words = (list: string, numbered = false) => new RegExp(String.raw`(?<![A-Z0-9])(?:${list})(?![A-Z${numbered ? "" : "0-9"}])`);

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

/** A card in a fee's folded text. */
export const isCardText = (folded: string) => /KORTTI|CARD|DEBIT|CREDIT|GOLD|PLATINUM/.test(folded);
/**
 * An account of Nordea's. An IBAN says so itself: Nordea's bank codes start with 1 or 2. A card account has no IBAN,
 * and there the connection's bank decides (`bank`, the name the connection was made under). An account with neither
 * came from a file or the demo, and those are Nordea's.
 */
export const isNordeaAccount = (a: { iban: string | null; bank?: string | null }) =>
  a.iban !== null ? /^FI\d{2}[12]/.test(a.iban.replace(/\s/g, "")) : !a.bank || /(?<![A-Z])NORDEA(?![A-Z])/.test(a.bank.toUpperCase());

// ── the bank's own transaction codes (ISO 20022 BankTransactionCode, domain PMNT) ──
// Family and sub-family as the external code list names them (version 8.0, November 2025). A row carries its code as
// "PMNT-CCRD-POSD", or as "CCRD-POSD" when the bank leaves the domain out. A code on none of the lists decides
// nothing: a code that could not be confirmed from the list is not here.

const bankTxnCodes =
  (...codes: string[]) =>
  (code: string | null | undefined): boolean =>
    !!code && codes.includes(code.replace(/^PMNT-/, ""));
// A card purchase's codes (CCRD-POSD, POSC, XBCP, SMRT) are on no list, because they decide nothing: the merchant names
// the category. They cannot rule a row out as a leg of a transfer either. At least one bank's table books a card's
// monthly settlement as POSC, and money loaded with a card to an own account at another bank comes as a purchase.
/** Cash taken out: from an ATM with the card (CCRD), abroad too, or over a counter (CNTR), a branch's too. */
export const isCashWithdrawalCode = bankTxnCodes("CCRD-CWDL", "CCRD-XBCW", "CNTR-CWDL", "CNTR-BCWD");
/** Anything booked with a card (the CCRD family): such a row is no transfer to a person, whatever its payee is named. */
export const isCardCode = (code: string | null | undefined): boolean => /(?:^|-)CCRD-/.test(code ?? "");
/** Pay received, as a credit transfer (RCDT) or an instant one (RRCT): payroll, also from abroad. */
export const isSalaryCode = bankTxnCodes("RCDT-SALA", "RCDT-XBSA", "RRCT-SALA", "RRCT-XBSA");
/**
 * Money moved between the holder's own accounts, sent (ICCN) or received (RCCN). BOOK is any transfer inside one
 * bank, to another person too, so it is not on the list.
 */
export const isOwnTransferCode = bankTxnCodes("ICCN-COAT", "RCCN-COAT");

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

/**
 * Payment services a purchase is paid through, at once or in parts, as a regex alternation: the instalment and
 * shopping rules of categorize.ts and `isLenderName` read it. Klarna Bank's every name holds KLARNA, and AfterPay is Riverty's old name.
 */
export const INSTALMENT_SERVICE_WORDS = "KLARNA|WALLEY|RIVERTY|AFTERPAY|ANYDAY";
/**
 * Resurs is an issuer by its whole name only: RESURS alone is also in an employer's name (Resurs Bemanning). It also
 * lends, so its fixed instalments stay loans (pipeline.ts).
 */
export const RESURS_WORDS = "RESURS BANK";
const LENDERS = new RegExp(`${INSTALMENT_SERVICE_WORDS}|${RESURS_WORDS}`);
/** Payment services that sell instalment plans, in a folded name. */
export const isLenderName = (folded: string) => LENDERS.test(folded);

/**
 * Card issuers whose bills come as plain e-invoices, as regex alternations. Their names stand here once: the card
 * bill, credit_draw and loans rules of categorize.ts and `isCardIssuerText` (pipeline.ts) all read these.
 * The banks among them also lend and take deposits, so a text of theirs that names a loan or a savings account is no
 * card bill. Komplett Bank has been Morrow Bank since 2023.
 * SEB Kort issues Eurocard and the co-branded cards.
 */
export const CARD_ISSUER_BANK_WORDS = "BANK NORWEGIAN|KOMPLETT BANK|MORROW BANK|SEB KORT";
/** Names that stand for a card and nothing else. */
export const CARD_BRAND_WORDS = "ENTERCARD|RE:?MEMBER";
/** Nordea's finance company lends for cars and issues the bank's cards: its name with a card word is a card bill, alone a loan. */
export const NORDEA_FINANCE_WORDS = "NORDEA RAHOITUS|NORDEA FINANCE";
/** Nordea's cards by name. They name a card and no issuer, so `isCardIssuerText` does not read them. */
export const NORDEA_CARD_WORDS = "NORDEA GOLD|NORDEA PLATINUM|NORDEA CREDIT";
export const CARD_ISSUER_WORDS = `${NORDEA_FINANCE_WORDS}|${CARD_ISSUER_BANK_WORDS}|${CARD_BRAND_WORDS}|${RESURS_WORDS}`;
const CARD_ISSUER = words(CARD_ISSUER_WORDS);

export const isCardIssuerText = (folded: string) => CARD_ISSUER.test(folded);
const SAVINGS_ACCOUNT = words(String.raw`SAASTOTILI[A-Z]*|SAASTO(?:ON|T)?|[A-Z]*TALLETUS[A-Z]*|SAVINGS(?: ACCOUNT)?`);
/** A savings account or a deposit in a folded text. At an issuer that is a bank such a row is saving, in either direction. */
export const isSavingsAccountText = (folded: string) => SAVINGS_ACCOUNT.test(folded);
/** Words that name a loan, as a regex alternation: the loans rule of categorize.ts and `isLoanText` read it. */
export const LOAN_WORDS = String.raw`OSAMAKSU[A-Z]*|LAINA[A-Z]*|LYHENNYS|LAINANHOITO|RAHOITUSSOPIMUS|KULUTUSLUOTTO`;
// SOPIMUS alone is a loan's only at an issuer, where isLoanText is asked: to the category rules it is any contract
const LOAN_TEXT = words(`${LOAN_WORDS}|SOPIMUS`);
/** Texts that name a loan: such a payment stays a loan whatever its amount. */
export const isLoanText = (folded: string) => LOAN_TEXT.test(folded) || isCreditText(folded);

/** Refund words, as a regex alternation: `REIMBURSEMENT_WORDS` and `isRefundText` read it. */
export const REFUND_WORDS = "HYVITYS|PALAUTUS|REFUND|CHARGEBACK|OIKAISU|LIIKASUORITUS|YLISUORITUS";
const REFUND_TEXT = new RegExp(`(?<![A-Z0-9])(?:${REFUND_WORDS})[A-Z]*(?![A-Z0-9])`);
export const isRefundText = (folded: string) => REFUND_TEXT.test(folded);
/** Money back for a cost the household paid. The reimbursements rule of categorize.ts reads the words, and its salary code steps aside for them: an employer pays a travel claim in the payroll batch. */
export const REIMBURSEMENT_WORDS = `VAKUUTUSKORVAUS|KORVAUS|KULUKORVAUS|MATKALASKU|${REFUND_WORDS}`;
const REIMBURSEMENT_TEXT = words(REIMBURSEMENT_WORDS, true);
export const isReimbursementText = (folded: string) => REIMBURSEMENT_TEXT.test(folded);

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

/**
 * The finance companies of car makers, as a regex alternation. One list for both readers (ADR 0008): the loans rule of
 * categorize.ts through `FINANCE_LENDER_WORDS`, and `isCarFinanceText` for Optimoi and for the kind of a proposed loan.
 */
export const CAR_FINANCIER_WORDS = String.raw`TOYOTA (?:FINANCE|FINANCIAL|RAHOITUS)[A-Z]*|VOLKSWAGEN (?:FINANCE|FINANCIAL|FINANS|RAHOITUS)[A-Z]*`;

// what a car row was for: street parking is the apps the permit comparison counts; finance is a financier or a loan that names the car
const PARKING_WORDS = words(String.raw`EASYPARK|PARKMAN|MOOVY|AIMO|AIMO PARK|APCOA|EUROPARK|Q-PARK|P-HUB|SCANDINAVIAN PARKING|PYSAKOINTI|PARKKI[A-Z]*`);
const STREET_PARKING_WORDS = words(String.raw`EASYPARK|PARKMAN|MOOVY|AIMO|AIMO PARK`);
const CHARGING_WORDS = words(String.raw`K-LATAUS|VIRTA|PLUGIT|RECHARGE|IONITY|SUPERCHARGER|[A-Z]*LATAUS`);
const INSPECTION_WORDS = words(String.raw`[A-Z-]*KATSASTUS[A-Z]*`);
const SERVICE_WORDS = words(String.raw`RENGAS[A-Z]*|RENKAAT|AUTOHUOLTO|AUTOKORJAAMO|KORJAAMO|AUTOMAALAAMO|AUTOPALVELU|MEKONOMEN|EUROMASTER|VIANOR`);
const FUEL_WORDS = words(String.raw`NESTE|ST1|ABC|SHELL|TEBOIL|SEO|GULF`);
const CAR_INSURANCE_WORDS = words(String.raw`LIIKENNEVAKUUTUS|AUTOVAKUUTUS|AJONEUVOVAKUUTUS|KASKO[A-Z]*`);
const VEHICLE_TAX_WORDS = words(String.raw`AJONEUVOVERO|TRAFICOM`);
const CAR_FINANCE_WORDS = words(String.raw`AUTO|AUTON|AUTOLAINA|AUTORAHOITUS|AUTO-OSAMAKSU|AUTOSOPIMUS|SANTANDER|${CAR_FINANCIER_WORDS}`);
export const isParkingText = (folded: string) => PARKING_WORDS.test(folded);
export const isStreetParkingText = (folded: string) => STREET_PARKING_WORDS.test(folded);
export const isChargingText = (folded: string) => CHARGING_WORDS.test(folded);
export const isInspectionText = (folded: string) => INSPECTION_WORDS.test(folded);
export const isCarServiceText = (folded: string) => SERVICE_WORDS.test(folded);
export const isFuelText = (folded: string) => FUEL_WORDS.test(folded);
export const isCarInsuranceText = (folded: string) => CAR_INSURANCE_WORDS.test(folded);
export const isVehicleTaxText = (folded: string) => VEHICLE_TAX_WORDS.test(folded);
export const isCarFinanceText = (folded: string) => CAR_FINANCE_WORDS.test(folded);

// ── lenders and the words for credit (the loan and credit rules of categorize.ts interpolate each list) ──

/**
 * Consumer lenders and loan brokers whose every payment is a loan's, as a regex alternation: the loans rule of
 * categorize.ts has read these names since before the lists below. A bank that takes anyone's deposits is left out: a
 * row of Bigbank is debt only when its text has a credit word, since a deposit there names nothing but the bank.
 */
export const CONSUMER_LENDER_WORDS = "SANTANDER|SVEA BANK|SVEA EKONOMI|COLLECTOR BANK|INSTABANK|TF BANK|IKANO|NORDAX|NOBA|AVIDA|NORTHMILL|FERRATUM|MONEYGO|EUROLOAN|AXO FINANS|SAMBLA|LENDO|ZMARTA";

/**
 * The finance companies of banks and car makers, as a regex alternation. OP's car finance is OP Yrityspankki and
 * Pohjola Rahoitus; Pohjola Vakuutus is the insurer. Such a company also leases cars and sells bonds, so the rule that
 * reads this list asks `isNoCreditText` first.
 */
export const FINANCE_LENDER_WORDS = String.raw`OP[- ]?RAHOITUS|OP[- ]?AUTORAHOITUS|OP YRITYSPANKKI|POHJOLA RAHOITUS|${CAR_FINANCIER_WORDS}`;

// The loans a household takes, by what the word says the loan is for. A closed list: any word that ends in LAINA
// would also be a bond (JOUKKOLAINA), a housing company's loan (YHTIOLAINA), a library's KAUKOLAINA and the name Elaina.
const HOUSEHOLD_LOANS = "ASUNTO|AUTO|KULUTUS|PANKKI|REMONTTI|VENE|YHDISTELY|PIKA|JOUSTO|KERTA|LIMIITTI|MOKKI|MOOTTORIPYORA|VELKAKIRJA";
/**
 * Credit named by a compound, as a regex alternation. The loans rule reads LUOTTO, LAINA and LYHENNYS as whole words
 * and from the start of a word, which misses JOUSTOLUOTTO, AUTOLAINAN and LUOTONLYHENNYS. A word that only begins with
 * one of them (LUOTTOKORTTI, LAINAAMO) is no credit, and a card's credit is its bill.
 */
export const CREDIT_WORDS = String.raw`(?!KORTTI)[A-Z]+LUOTTO|(?:${HOUSEHOLD_LOANS})LAINAN?|LUOTONLYHENNYS|VELANLYHENNYS|AUTORAHOITUS|PIKAVIPPI`;
const CREDIT = words(CREDIT_WORDS);
/** A folded text that names credit by one of `CREDIT_WORDS`. */
export const isCreditText = (folded: string) => CREDIT.test(folded);

const LEASE = /LEASING/;
/** A lease in a folded text (YKSITYISLEASING, HUOLTOLEASING): rent for a car, with no loan to pay off. */
export const isLeaseText = (folded: string) => LEASE.test(folded);
// a bond or a capital loan: there the household is the lender
const BOND = /INDEKSILAINA|DEBENTUUR|PAAOMALAINA|JOUKKOLAINA|JOUKKOVELKAKIRJA|VAIHTOVELKAKIRJA|VALTIONLAINA|OBLIGAATIO/;
/** A folded text that the words and lenders above do not make a loan: a lease, a bond or a capital loan. */
export const isNoCreditText = (folded: string) => LEASE.test(folded) || BOND.test(folded);

const HOUSING_COMPANY = words(String.raw`AS OY|AS\. OY|ASOY|ASUNTO OY|ASUNTO-OSAKEYHTIO|KIINTEISTO OY|KOY|BOSTADS AB|BOSTADSAKTIEBOLAG(?:ET)?|FASTIGHETS AB`);
/**
 * A housing company, in a payee's folded name. A household borrows nothing from one: a charge with RAHOITUSVASTIKE,
 * YHTIOLAINA or LAINAOSUUS pays the company's own loan. The credit compounds leave its rows the category they had,
 * and its series is never a loan to propose (docs/MONEY_FLOWS.md).
 */
export const isHousingCompanyName = (foldedPayee: string) => HOUSING_COMPANY.test(foldedPayee);

// ── what a home's payment is called (Asuminen on the first page, `housing.ts`) ──

/** A word of the list in a payment's payee or text, with the endings the list gives. A bank glues a number on ("HOITOVASTIKE10"). */
const says = (list: string) => {
  const re = words(list, true);
  return (all: string) => re.test(all);
};
const VASTIKE = "VASTIKK?E[A-Z]*";
/** Water as a word of its own, or in a utility's name and bill: VESIKATTO is a roof. */
const WATER = says("VESI(?:(?:HUOLTO|LAITOS|OSUUSKUNTA|LASKU|ENNAKKO)[A-Z]*)?");
const WATER_CHARGE = says("[A-Z]*VESIMAKSU[A-Z]*");
const ANY_VASTIKE = says(`[A-Z]*${VASTIKE}`);
/** As the electricity area reads a bill (`billKind`): in its own category only, none that names heat, water or waste, a network before a seller. */
const power = (all: string, payee: string, utility: boolean): "grid" | "seller" | null =>
  !utility || isHeatWaterOrWaste(all) ? null : isElectricityCooperative(payee) ? "seller" : isNetworkCompany(payee) ? "grid" : isElectricitySeller(payee) ? "seller" : null;
/** The names a housing company, a landlord and a utility give a home's payments: the id, the Finnish and what tells it. The first that holds wins. */
const HOME_CHARGES = [
  ["financing", "Rahoitusvastike", says(`RAHOITUS${VASTIKE}|LAINAOSUU[A-Z]*|YHTIOLAINA[A-Z]*`)],
  ["capital", "Pääomavastike", says(`PAAOMA${VASTIKE}`)],
  ["maintenance", "Hoitovastike", says(`HOITO${VASTIKE}`)],
  ["occupancy", "Käyttövastike", says(`KAYTTO${VASTIKE}|ASUMISOIKEU[A-Z]*`)],
  // water billed by the house is a charge of living there, whatever word the payment has for it; it and the car place give way to a bill of rent or vastike
  ["water_charge", "Vesimaksu", (all, payee) => WATER_CHARGE(all) || (WATER(all) && (isHousingCompanyName(payee) || isRent(payee)))],
  ["parking", "Autopaikka", says(CAR_PLACE_WORDS)],
  ["rent", "Vuokra", isRent],
  ["charge", "Vastike", (all, payee) => ANY_VASTIKE(all) || isHousingCompanyName(payee)],
  // the payee list (payees.ts) names heat and waste before the sellers: Fortum's waste company sells no electricity
  ["waste", "Jätehuolto", (all, payee) => homeKindOf(all, payee) === "waste"],
  ["grid", "Sähkönsiirto", (...row) => power(...row) === "grid"],
  ["electricity", "Sähkö", (all, payee, utility) => power(all, payee, utility) === "seller" || (utility && homeKindOf(all, payee) === "electricity")],
  ["district_heat", "Kaukolämpö", (all, payee) => homeKindOf(all, payee) === "district_heat"],
  ["water", "Vesi", (all, payee) => WATER(all) || homeKindOf(all, payee) === "water"],
] as const satisfies readonly (readonly [string, string, (all: string, payee: string, utility: boolean) => boolean])[];

/**
 * What a payment for a home is, from its folded payee and its folded text: the id and the Finnish name, or null when
 * the words name nothing and the payee stands alone. `utility`: the payment is in the category of electricity, water
 * and heat, where a payee's name tells a seller from a network.
 */
export function housingCharge(foldedPayee: string, foldedText: string, utility: boolean): { kind: (typeof HOME_CHARGES)[number][0]; label: string } | null {
  const billed = ANY_VASTIKE(foldedText) || isRent(foldedText);
  const found = HOME_CHARGES.find(([kind, , holds]) => !(billed && (kind === "water_charge" || kind === "parking")) && holds(`${foldedPayee} ${foldedText}`, foldedPayee, utility));
  return found ? { kind: found[0], label: found[1] } : null;
}

const NAMED_LAINA = /(?<![A-Z])LAINA(?![A-Z])/;
/** A payee whose folded name has Laina as a word of its own. It is a first name too, so the name tells of no loan. */
export const isNamedLaina = (foldedPayee: string) => NAMED_LAINA.test(foldedPayee);

// OSISSA and ERASSA: "maksa osissa", "kolmessa erässä". Anyday sells nothing but a purchase split in four.
const INSTALMENT_PLAN = words(String.raw`OSAMAKSU[A-Z]*|ERAMAKSU[A-Z]*|MAKSUERA[A-Z]*|KUUKAUSIERA[A-Z]*|OSISSA|ERASSA|ERA \d+ ?/ ?\d+|RAHOITUS|FINANCING|DELBETALNING|PART PAYMENT|ANYDAY`);
/**
 * A row of a payment service (`INSTALMENT_SERVICE_WORDS`) that pays a purchase in parts, in a folded text. A row
 * without such a word is a purchase paid at once, as far as its text tells.
 */
export const isInstalmentPlanText = (folded: string) => INSTALMENT_PLAN.test(folded);

/**
 * Services where a household lends to people or companies, as a regex alternation: the investments rules of
 * categorize.ts read it. Money back from one is the loan given coming home, with its interest in the same payment.
 * Bondora and Fixura are left out: they also lend to households here, and a row without a text does not say which.
 * Tessin is named in full, since a hotel carries the short name.
 */
export const PEER_LENDING_WORDS = "FELLOW FINANCE|ESTATEGURU|INVESDOR|MINTOS|TWINO|PEERBERRY|ROBOCASH|LENDERMARKET|ESKETIT|SWAPER|IUVO|VIAINVEST|REINVEST24|TESSIN NORDIC|VAURAUS SUOMI";
const LOAN_OR_CREDIT = /LAINA|LUOTTO|LUOTON/;
/**
 * A loan or a credit named in any form (LAINAN, LUOTON, JOUSTOLUOTTO), in a folded text. Fellow Finance lent to
 * households too, so money in with such a word is left to the loan rules and stays borrowed.
 */
export const namesLoanOrCredit = (folded: string) => LOAN_OR_CREDIT.test(folded);

/**
 * Insurance by its word or by an insurer's name, as a regex source: the insurance rule of categorize.ts builds its
 * regex from it. Finnish compounds (KOTIVAKUUTUS, VAHINKOVAKUUTUS) need a plain substring match.
 */
export const INSURER_WORDS = String.raw`VAKUUTUS|LAHITAPIOLA|FENNIA|\bIF P&C\b|\bTURVA\b|POHJOLA VAKUUTUS|\bMANDATUM\b|\bPOHJANTAHTI\b|\bFOLKSAM\b|\bALANDIA\b|\bEUROP ASSISTANCE\b`;
const INSURANCE = new RegExp(`${INSURER_WORDS}|LAINATURVA`);
/**
 * An insurance or an insurer in a folded text. An insurer lends nothing, whatever word its instalments carry, and a
 * loan's payment protection (LAINATURVA) is a premium: it pays no loan off.
 */
export const isInsuranceText = (folded: string) => INSURANCE.test(folded);
