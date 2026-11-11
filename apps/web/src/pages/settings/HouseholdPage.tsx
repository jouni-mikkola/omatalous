/**
 * Asetukset > Kotitalous: the household's loans and category rules, for an admin its members, and the member's own
 * sign-in: the password, the second factor, the passkeys and the signed-in devices (the service tokens are rows of
 * Omat istunnot).
 */
import { SETTINGS_ANCHOR } from "../../routes.ts";
import { CardStack } from "./CardStack.tsx";
import { Loans } from "./Loans.tsx";
import { Members } from "./Members.tsx";
import { Passkeys } from "./Passkeys.tsx";
import { Rules } from "./Rules.tsx";
import { SecondFactor } from "./SecondFactor.tsx";
import { Password, Sessions } from "./Security.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function HouseholdPage({ meta, params, anchor, onChange }: SettingsPageProps) {
  const isAdmin = meta.user.role === "admin";
  // the loans, the sessions and, for an admin, the members read their own data
  const { shown, partLoaded } = useCardsShown({ expected: isAdmin ? 3 : 2 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  return (
    <CardStack shown={shown}>
      <Loans meta={meta} onLoaded={partLoaded} />
      <Rules meta={meta} />
      {isAdmin && <Members me={meta.user} meta={meta} onChange={onChange} onLoaded={partLoaded} />}
      <Password openPassword={anchor === SETTINGS_ANCHOR.password} />
      <SecondFactor />
      <Passkeys />
      <Sessions admin={isAdmin} onLoaded={partLoaded} />
    </CardStack>
  );
}
