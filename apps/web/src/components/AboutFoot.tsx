import { ABOUT } from "../about.ts";
import { t } from "../text.ts";

const outside = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * The first spans of the footer of every page: the app, its version and its author (the attribution the licence keeps),
 * the licence, the source, the guides and, only when its address is set, the link to support the development.
 */
export function AboutFoot({ version, supportUrl = ABOUT.supportUrl }: { version: string; supportUrl?: string }) {
  return (
    <>
      <span>
        {ABOUT.appName},{" "}
        <a href={ABOUT.authorUrl} {...outside}>
          {ABOUT.authorName}
        </a>
      </span>
      <span>{version}</span>
      <span>{ABOUT.licence}</span>
      <a href={ABOUT.sourceUrl} {...outside}>
        {t("foot.source")}
      </a>
      <a href={ABOUT.guidesUrl} {...outside}>
        {t("foot.guides")}
      </a>
      {supportUrl !== "" && (
        <a href={supportUrl} {...outside}>
          {t("foot.support")}
        </a>
      )}
    </>
  );
}
