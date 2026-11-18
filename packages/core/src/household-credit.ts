/**
 * Which trade-register industries sell work the household credit (kotitalousvähennys) may cover, so the tax-year sheet
 * can list a payee's rows whatever category they were filed in. A class says what the company does, not that the
 * invoice qualifies: the work share and the place are on the invoice, so the app lists payments and never an amount
 * to deduct.
 *
 * Source of the class list: the tax authority's page "Mistä töistä saa vähennyksen" (vero.fi, Henkilöasiakkaat >
 * Vähennykset > Kotitalousvähennys, last updated 27.10.2026), read against the TOL classes below. These classes keep their
 * numbers in TOL 2008 and TOL 2025, so one list serves both code sets. Work the page refuses is left out when a class
 * tells it apart: hairdressers, removals, security services, new building, demolition and groundwork, child day care,
 * VAT-exempt health care and repair of communication equipment (a phone repair counter, where the work is not done at
 * home). Chimney sweeping, which the page refuses, shares class 81.22 with the window and building cleaning it accepts,
 * and roofing (43.91) serves new building as well as repair, so such rows are listed too and the household checks the
 * invoice.
 */
import { isLookupName, type RegisterAnswer } from "./industry.ts";

/** TOL prefixes: what each covers on the tax authority's page is in the comment. */
const COVERED_PREFIXES = [
  "8121", // general building cleaning: cleaning, moving-out cleaning
  "8122", // other building and industrial cleaning: window cleaning, mould cleaning
  "8129", // other cleaning: pest control
  "813", // landscape services: garden and yard care, tree felling, lawn mowing
  "432", // electrical, plumbing and heating, other building installation
  "433", // building completion: painting, wallpapering, floors, glazing, plastering
  "4391", // roofing: roof repair and renovation of a house, outer cladding
  "9511", // repair of computers and peripherals: computer installation, software and maintenance at home
  "8810", // home care of the elderly and disabled, without accommodation
] as const;

/** Whether a TOL code is a class whose work the household credit may cover. */
const isHouseholdCreditIndustry = (code: string | null): boolean => !!code && /^\d{4,5}$/.test(code) && COVERED_PREFIXES.some((p) => code.startsWith(p));

/**
 * Whether a merchant's register answer puts its rows on the household-credit list. The answer exists only for a name
 * the register lookup was allowed to ask about, and the name is checked here again: a name shaped like a person's never
 * counts, whatever answer is on file for it. No answer is no row.
 */
export const paysHouseholdCreditWork = (merchant: string, answer: RegisterAnswer | undefined): boolean => isLookupName(merchant) && isHouseholdCreditIndustry(answer?.code ?? null);
