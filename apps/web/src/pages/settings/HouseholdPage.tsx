/** Asetukset > Talous: the household's loans and category rules. An add-on module's card comes after the rules (extensions.ts). */
import { WEB_EXTENSIONS } from "../../extensions.ts";
import { CardStack } from "./CardStack.tsx";
import { Loans } from "./Loans.tsx";
import { Rules } from "./Rules.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function HouseholdPage({ meta, params, anchor }: SettingsPageProps) {
  // the loans read their own data
  const { shown, partLoaded } = useCardsShown({ expected: 1 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  return (
    <CardStack shown={shown}>
      <Loans meta={meta} onLoaded={partLoaded} />
      <Rules meta={meta} />
      {WEB_EXTENSIONS.map((e) => e.settingsCard && <e.settingsCard key={e.id} />)}
    </CardStack>
  );
}
