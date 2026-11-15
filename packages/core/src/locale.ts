/**
 * The one place that names the languages of the app. Every number, date, collator and case change reads its locale from
 * here (repo rule 43), so a language is a change of this file and of the catalogue, not a hunt through the code.
 * The language is a member's choice and travels as a parameter: core never reads it from the environment.
 */
export const LANGUAGES = ["fi", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

/** The language of a member who has not chosen one, and of every text not yet in the catalogue. */
export const DEFAULT_LANGUAGE: Language = "fi";

/** The BCP 47 locale of each language. English is British: day first, a comma between thousands, the euro in front. */
const LOCALES: Record<Language, string> = { fi: "fi-FI", en: "en-GB" };

/** The locale Finnish text is formatted in, the one the sentences not yet in the catalogue use. */
export const LOCALE = LOCALES[DEFAULT_LANGUAGE];

/** The locale of a language. */
export const localeOf = (lang: Language): string => LOCALES[lang];

/** Whether a value read from outside (a request, a stored row) names a language this build has. */
export const isLanguage = (value: unknown): value is Language => typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
