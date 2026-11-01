import type { Language } from "@banking/core";

/**
 * Finnish is in the entry for the sign-in; the rest of it, and English, are chunks of their own. English is awaited
 * before the first paint of a member who reads it (the device's memory at start, the signed-in member's choice after
 * /api/auth/state), the rest of Finnish before the first page, so no text shows in the other language. The service
 * worker keeps the chunks, so this works offline.
 * Decision: a household reaches the sign-in without the texts of the pages, and an English reader never sees Finnish first.
 */
export const ensureEnglish = async (lang: Language): Promise<void> => {
  if (lang === "en") await import("@banking/core/english");
};

/** The texts of the pages, fetched once. */
export const ensureLate = (): Promise<unknown> => import("@banking/core/late");
