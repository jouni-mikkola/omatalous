/** Asetukset > Turvallisuus (every member): the software information. The app and its version, its author (the attribution the licence keeps), the licence, the source, the guides and where to support the development; no page has a footer line of its own for them. */
import { ABOUT } from "../../about.ts";
import { Button } from "../../components/ui/Button.tsx";
import { t } from "../../text.ts";

const outside = { target: "_blank", rel: "noopener noreferrer" } as const;

export function AboutApp({ version }: { version: string }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>{t("set.sv.software")}</h2>
        <div className="form-row flush">
          <span>
            {ABOUT.appName}, {ABOUT.authorName}
          </span>
          <span>{version}</span>
          <span>{ABOUT.licence}</span>
          <Button variant="link" href={ABOUT.authorUrl} {...outside}>
            {ABOUT.authorName}
          </Button>
          <Button variant="link" href={ABOUT.sourceUrl} {...outside}>
            {t("foot.source")}
          </Button>
          <Button variant="link" href={ABOUT.guidesUrl} {...outside}>
            {t("foot.guides")}
          </Button>
          {ABOUT.supportUrl !== "" && (
            <Button variant="link" href={ABOUT.supportUrl} {...outside}>
              {t("foot.support")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
