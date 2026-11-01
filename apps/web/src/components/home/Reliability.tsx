import { CONNECT_BANK_HASH, SETTINGS_ANCHOR, settingsCardHash } from "../../routes.ts";
import type { DashboardData } from "../../types.ts";
import { reliabilityText } from "./texts.ts";
import { t } from "../../text.ts";

/** Where a card or an account is connected: Pankkiyhteydet opens its bank list. */

/**
 * What the figures of the page lack, in one line under the answer: the card purchases that are missing and why, the
 * warning of the data-quality report, and the card or account whose connecting would mend it. Nothing is drawn when the data is whole.
 */
export function Reliability({ home, dataNotice, connectNotice }: { home: DashboardData["home"]; dataNotice: DashboardData["dataNotice"]; connectNotice: DashboardData["connectNotice"] }) {
  const cards = reliabilityText(home.reliability);
  if (!cards && !dataNotice && !connectNotice) return null;
  return (
    <p className="home-reliability">
      {cards}
      {cards && (dataNotice || connectNotice) ? " " : null}
      {connectNotice && (
        <>
          {connectNotice.title}. <a href={CONNECT_BANK_HASH}>{t("home.connect_link")}</a>
        </>
      )}
      {connectNotice && dataNotice ? " " : null}
      {dataNotice && (
        <>
          {dataNotice.title}. <a href={settingsCardHash(SETTINGS_ANCHOR.quality)}>{t("home.quality_link")}</a>
        </>
      )}
    </p>
  );
}
