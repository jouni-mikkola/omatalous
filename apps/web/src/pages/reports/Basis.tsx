// Decision: whether the figure can be trusted, from how it is made and the data it leaves out
import type { Conclusion } from "@banking/core";
import { Section } from "../../components/Section.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { t } from "../../text.ts";
import { SETTINGS_ANCHOR, settingsCardHash } from "../../routes.ts";
import { hasQualityNotes } from "./quality.tsx";
import type { ReportContext } from "./types.ts";

/** Peruste: the method in a sentence, the accounts read, and, while the data has a note to tell, the way to the notes in Asetukset > Tiedot. */
export function Basis({ conclusion, ctx }: { conclusion: Conclusion; ctx: ReportContext }) {
  const { method, accounts } = conclusion.basis;
  return (
    <Section id="peruste" title={t("rpt.basis")}>
      <p className="q-method">{method}</p>
      {accounts.length > 0 && <p className="q-accounts">{t("rpt.accounts_read", { names: accounts.map((a) => a.name).join(", ") })}</p>}
      {hasQualityNotes(ctx) && (
        <Button variant="link" className="q-quality" href={settingsCardHash(SETTINGS_ANCHOR.quality)}>
          {t("rpt.data_quality")}
        </Button>
      )}
    </Section>
  );
}
