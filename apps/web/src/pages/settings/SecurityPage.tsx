/**
 * Asetukset > Turvallisuus: the member's own sign-in (the password, the second factor and the signed-in
 * devices; the service tokens are rows of Omat istunnot) and the security log, an admin's of every member, folded until
 * it is opened or an address names it. The notices of the server stand first while there are any: no other page shows them.
 * Last, the software information every member reaches (the attribution the licence keeps, the version, the source).
 */
import { NoticeList } from "../../components/Notices.tsx";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { AboutApp } from "./AboutApp.tsx";
import { CardStack } from "./CardStack.tsx";
import { SecondFactor } from "./SecondFactor.tsx";
import { Password, SecurityLog, Sessions } from "./Security.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function SecurityPage({ meta, params, anchor }: SettingsPageProps) {
  const isAdmin = meta.user.role === "admin";
  // the sessions and the log read their own data
  const { shown, partLoaded } = useCardsShown({ expected: 2 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  return (
    <CardStack shown={shown}>
      <NoticeList />
      <Password username={meta.user.username} openPassword={anchor === SETTINGS_ANCHOR.password} />
      <SecondFactor />
      <Sessions admin={isAdmin} onLoaded={partLoaded} />
      <SecurityLog open={anchor === SETTINGS_ANCHOR.securityLog} onLoaded={partLoaded} />
      <AboutApp version={meta.version.app} />
    </CardStack>
  );
}
