/**
 * What the rules of categorize-bank-rows.ts read: a lender told by the shape of its name, a cash machine's row and the
 * word of interest at the end of a word. The part of the bank dialect (ADR 0008) for the rows no word list names; the
 * words of the other bank rows are in wording.ts. Last, the words of a school or an association, which the rules about
 * people read (categorize-people.ts).
 */
import { isHousingCompanyName, isInsuranceText, words } from "./wording.ts";

/**
 * Words of lending in a company's name that tell it a lender whether it is paid or pays: finance and credit in Finnish,
 * Swedish and English, and the English loan. RAHOITUS, FINANS and KREDIT may end a compound (ESIMERKKIRAHOITUS), the
 * others stand as words. LAINA and LUOTTO are loan words in any text already (`LOAN_WORDS`, `CREDIT_WORDS`), and the
 * Swedish LÅN folds to LAN, which is a network.
 */
const LENDING_NAME = words(String.raw`[A-Z]*(?:RAHOITUS|FINANS|KREDIT)|FINANCE|CREDIT|LOANS?`);
/**
 * A bank is a word of its own, or a kind of bank in front of it (SAASTOPANKKI, OSUUSPANKKI, SPAREBANK, HANDELSBANKEN).
 * A free compound is none: KUVAPANKKI, VARAOSAPANKKI, POWERBANK and DATABANK are shops and a name a bank has a word in.
 */
const BANK_NAME = words(String.raw`(?:SAASTO|OSUUS|HYPO|ASUNTO|SPARE|HANDELS)?(?:PANKKI|BANK|BANKEN)`);
/** Payment firms carry FINANCIAL (Esimerkki Financial Services Ltd) and pay out as a business: a lender when paid, none when it pays. */
const FINANCIAL_NAME = words("FINANCIAL");
/** The forms of a limited company here and next door. AS is left out: it is a word of a person's name, and a bank that only takes deposits carries it. */
const LENDER_FORM = words("OY|OYJ|AB|ABP|A/S|LTD|LIMITED|PLC|GMBH|BV");
const ASA_FORM = words("ASA");
/** ASA is a form behind a name only: Bank Åsa folds to BANK ASA, and that is a person with a bank's word for a surname. */
const hasLenderForm = (foldedPayee: string) => LENDER_FORM.test(foldedPayee) || (ASA_FORM.test(foldedPayee) && foldedPayee.trim().split(/\s+/).length >= 3);

/**
 * A folded payee named like a credit institution: a limited company with a word of lending in its name. The form may
 * stand anywhere, since a branch is named after it ("ESIMERKKI BANK AB (PUBL), SUOMEN SIVULIIKE"). An insurer and a
 * housing company lend nothing to a household, whatever they are called. Money in asks for more: a bank pays bonuses
 * and pay, so its name alone does not make its payout credit, and nor does a payment firm's.
 */
export function isLenderShapedName(foldedPayee: string, moneyIn = false): boolean {
  const lending = LENDING_NAME.test(foldedPayee) || (!moneyIn && (BANK_NAME.test(foldedPayee) || FINANCIAL_NAME.test(foldedPayee)));
  return lending && hasLenderForm(foldedPayee) && !isInsuranceText(foldedPayee) && !isHousingCompanyName(foldedPayee);
}

const STREET_ADDRESS = /^(?:\d{4,6} )?[A-Z-]*(?:KATU|TIE|KUJA|POLKU|KAARI|TORI|AUKIO|RAITTI|VAYLA|GATAN|VAGEN) \d+(?: ?[A-Z])?(?: \d{5})?(?: [A-Z-]+){1,2}$/;
/** A folded text that is one street address and nothing else ("40100 ASEMAKATU 1 ESIMERKKILA"): what a cash machine's row says where a payee would stand. */
export const isStreetAddressText = (folded: string) => STREET_ADDRESS.test(folded.trim());

const INTEREST_WORD = words(String.raw`[A-Z]*(?:KORKO(?:A|N|T|JA|NA)?|KOR(?:ON|OT))`);
/** The word for interest alone, in a compound (VELKAKORKO) or with a case ending, KORON and KOROT among them: a name that begins with it (KORKONEN, KORKOKENKA) is none. */
export const hasInterestWord = (folded: string) => INTEREST_WORD.test(folded);

const ORGANISATION_NAME = words(String.raw`[A-Z]*KOULU|[A-Z]*LUKIO|[A-Z]*OPISTO|[A-Z]*SEURA|VPK|FBK|[A-Z]*SKOLAN?|[A-Z]*FORENING(?:EN)?`);
/** A folded payee with a word of a school or an association ("ESIMERKIN KOULU", "ESIMERKIN VPK"): two words of letters, and no person. None of the words is a first name or a surname. */
export const isOrganisationName = (foldedPayee: string) => ORGANISATION_NAME.test(foldedPayee);

const FINANCING_TEXT = words(String.raw`[A-Z]*(?:RAHOITUS|FINANCE|FINANCIAL|FINANSIERING|LEASING|CREDIT|LUOTTO)[A-Z]*`);
/** A brand's financing company in a folded text, with no legal form to go by (BMW FINANCIAL SERVICES, VOLVO CAR RAHOITUS): a lender's, not the brand's shop. */
export const isFinancingText = (folded: string) => FINANCING_TEXT.test(folded);

const STREET_OR_PLACE_END = /(?:KATU|TIE|KUJA|POLKU|TORI|AUKIO|RANTA|VAYLA|PUISTO|GATAN|VAGEN)$/;
/** Whether a folded word ends as the name of a street or a place does ("YLIOPISTONKATU"): what stands before such an end is no trade. */
export const endsAsStreetOrPlace = (foldedWord: string) => STREET_OR_PLACE_END.test(foldedWord);
