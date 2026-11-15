import { ABOUT } from "../about.ts";
import { t } from "../text.ts";

const outside = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * The first spans of the footer of every page: the app, its version and its author (the attribution the licence keeps),
 * the licence, the source and the guides. The author's page and the link to support the development are in
 * Asetukset > Tiedot (pages/settings/AboutApp.tsx).
 */
export function AboutFoot({ version }: { version: string }) {
  return (
    <>
      <span>
        {ABOUT.appName}, {ABOUT.authorName}
      </span>
      <span>{version}</span>
      <span>{ABOUT.licence}</span>
      <a href={ABOUT.sourceUrl} {...outside}>
        {t("foot.source")}
      </a>
      <a href={ABOUT.guidesUrl} {...outside}>
        {t("foot.guides")}
      </a>
    </>
  );
}
