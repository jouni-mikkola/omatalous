import { useState } from "react";
import { api } from "../api.ts";
import { useApi } from "../hooks.ts";
import { t } from "../text.ts";
import { bannersOf, noticeText, type SecurityNotice } from "./notices.ts";
import { Button } from "./ui/Button.tsx";
import { Notice } from "./ui/Notice.tsx";
import { settingsHash } from "../routes.ts";
import { StaleAnswer } from "./StaleAnswer.tsx";
/**
 * The notice of the server that stays a banner on every page (`BANNER_KINDS`: a damaged database). Every other notice is a
 * row of Ilmoitukset on Yhteenveto. Above it stands the line of a reload that failed (StaleAnswer), on every page too.
 */
export function SecurityNotices() {
  const { data, reload } = useApi<{ notices: SecurityNotice[] }>("/api/security/notices");
  const [error, setError] = useState<string | null>(null);
  const banners = bannersOf(data?.notices ?? []);
  if (!banners.length) return <StaleAnswer />;
  return (
    <>
      <StaleAnswer />
      <div role="status">
        {banners.map((n) => (
          <Notice key={n.id} tone="warning">
            {noticeText(n)} <a href={settingsHash("household")}>{t("notice.security")}</a>
          </Notice>
        ))}
        <div className="form-row pull">
          <Button
          
            onClick={() => {
              api("/api/security/notices/seen", { method: "POST" })
                .then(reload)
                .catch((e: Error) => setError(e.message));
            }}
          >
            {t("notice.read")}
          </Button>
          {error && <span className="field-error">{error}</span>}
        </div>
      </div>
    </>
  );
}
