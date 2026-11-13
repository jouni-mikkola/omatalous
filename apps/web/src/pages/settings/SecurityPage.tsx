/**
 * Asetukset > Turvallisuus: the member's own sign-in (the password, the second factor, the passkeys and the signed-in
 * devices; the service tokens are rows of Omat istunnot) and the security log, an admin's of every member. The notices
 * of the server stand first while there are any: no other page shows them.
 */
import { NoticeList } from "../../components/Notices.tsx";
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { CardStack } from "./CardStack.tsx";
import { Passkeys } from "./Passkeys.tsx";
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
      <Password openPassword={anchor === SETTINGS_ANCHOR.password} />
      <SecondFactor />
      <Passkeys />
      <Sessions admin={isAdmin} onLoaded={partLoaded} />
      <SecurityLog onLoaded={partLoaded} />
    </CardStack>
  );
}
