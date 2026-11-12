/**
 * Asetukset > Turvallisuus: the member's own sign-in (the password, the second factor, the passkeys and the signed-in
 * devices; the service tokens are rows of Omat istunnot) and, for an admin, the security log.
 */
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { CardStack } from "./CardStack.tsx";
import { Passkeys } from "./Passkeys.tsx";
import { SecondFactor } from "./SecondFactor.tsx";
import { Password, SecurityLog, Sessions } from "./Security.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function SecurityPage({ meta, params, anchor }: SettingsPageProps) {
  const isAdmin = meta.user.role === "admin";
  // the sessions and, for an admin, the log read their own data
  const { shown, partLoaded } = useCardsShown({ expected: isAdmin ? 2 : 1 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  return (
    <CardStack shown={shown}>
      <Password openPassword={anchor === SETTINGS_ANCHOR.password} />
      <SecondFactor />
      <Passkeys />
      <Sessions admin={isAdmin} onLoaded={partLoaded} />
      {isAdmin && <SecurityLog onLoaded={partLoaded} />}
    </CardStack>
  );
}
