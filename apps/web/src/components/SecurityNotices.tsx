import { useApi } from "../hooks.ts";
import { t } from "../text.ts";
import { bannersOf, noticeText, type SecurityNotice } from "./notices.ts";
import { Notice } from "./ui/Notice.tsx";
import { settingsHash } from "../routes.ts";
import { StaleAnswer } from "./StaleAnswer.tsx";
/**
 * The notice of the server that stays a banner on every page (`BANNER_KINDS`: a damaged database). Every other notice is a
 * line of Asetukset > Turvallisuus (Notices.tsx). The banner has no button: it stays while the server runs on the damaged database.
 * Above it stands the line of a reload that failed (StaleAnswer), on every page too.
 */
export function SecurityNotices() {
  const { data } = useApi<{ notices: SecurityNotice[] }>("/api/security/notices");
  const banners = bannersOf(data?.notices ?? []);
  if (!banners.length) return <StaleAnswer />;
  return (
    <>
      <StaleAnswer />
      <div role="status">
        {banners.map((n) => (
          <Notice key={n.id} tone="warning">
            {noticeText(n)} <a href={settingsHash("security")}>{t("notice.security")}</a>
          </Notice>
        ))}
      </div>
    </>
  );
}
