/** Asetukset > Tiedot: who made the app and where to support it. The links of an author and of a donation page are not in the foot of every page. */
import { ABOUT } from "../../about.ts";
import { Button } from "../../components/ui/Button.tsx";
import { t } from "../../text.ts";

const outside = { target: "_blank", rel: "noopener noreferrer" } as const;

export function AboutApp() {
  return (
    <div className="card">
      <div className="card-head">
        <h2>{t("set.dpage.about")}</h2>
        <div className="form-row flush">
          <Button variant="link" href={ABOUT.authorUrl} {...outside}>
            {ABOUT.authorName}
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
