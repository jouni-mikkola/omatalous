/**
 * The language of the screens before a sign-in (sign-in, first set-up), kept on this device. A signed-in member's
 * language is chosen under Asetukset > Turvallisuus and kept on the server.
 * Decision: a reader who cannot read the sign-in screen can still find their language there.
 */
import { isLanguage, LANGUAGES, type Language } from "@banking/core";
import { language, rememberLanguage } from "../../format.ts";

/** Each language under its own name, so a reader who cannot read the current one still finds theirs. */
export const LANGUAGE_NAME: Record<Language, string> = { fi: "Suomi", en: "English" };

export function DeviceLanguage() {
  const choose = (next: string) => {
    if (!isLanguage(next)) return;
    rememberLanguage(next);
    // every text and figure is made again in the new language
    window.location.reload();
  };
  return (
    <label className="field field-inline auth-language">
      <select value={language()} onChange={(e) => choose(e.target.value)} aria-label="Kieli / Language">
        {LANGUAGES.map((l) => (
          <option key={l} value={l} lang={l}>
            {LANGUAGE_NAME[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
