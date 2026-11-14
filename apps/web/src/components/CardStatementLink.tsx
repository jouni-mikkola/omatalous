import { SETTINGS_ANCHOR, settingsCardHash } from "../routes.ts";
import { t } from "../text.ts";

/**
 * Where a missing card average can be mended: the statement import of Asetukset, with the one limit of ADR 0025 (a file's
 * rows go only to a card made from a statement). Sits at the end of a sentence that says the average is missing.
 */
export function CardStatementLink() {
  return (
    <>
      <a href={settingsCardHash(SETTINGS_ANCHOR.statement)}>{t("card_file.gap_link")}</a>. {t("card_file.gap_note")}
    </>
  );
}
