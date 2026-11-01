/** Asetukset > Turvallisuus: the password, the second factor and the signed-in devices; for an admin the security log; the service tokens are rows of Omat istunnot. */
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { CardStack } from "./CardStack.tsx";
import { Password, SecurityLog, Sessions } from "./Security.tsx";
import { Passkeys } from "./Passkeys.tsx";
import { SecondFactor } from "./SecondFactor.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function SecurityPage({ meta, params, anchor }: SettingsPageProps) {
  const isAdmin = meta.user.role === "admin";
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
