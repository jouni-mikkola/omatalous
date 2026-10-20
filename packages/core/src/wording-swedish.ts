/** The words of Swedish-speaking banks' rows (Danske, Ålandsbanken), folded as categorize.ts folds: Ö→O, Å→A. */
/** A Swedish-speaking bank's fee for an account or a card (Danske: "AVGIFT KONTO"), as a regex alternation for the fees rule. */
export const SWEDISH_BANK_FEE_WORDS = "KONTOAVGIFT|AVGIFT KONTO|KORTAVGIFT|AVGIFT KORT";
/**
 * Pay in Swedish as a field of its own: "LÖN" or "LÖN 10/2026" (folded "LON"). Only a whole field, since LON also
 * stands for London on card rows ("UBER *TRIP LON"), whose refunds come in too. Fields are joined by " | " (categorize.ts).
 */
export const SWEDISH_SALARY_FIELD = /(?:^|\| )LON(?: [\d/.-]+)?(?= \||$)/;
