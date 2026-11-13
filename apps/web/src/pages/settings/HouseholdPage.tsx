/** Asetukset > Talous: the household's loans. An add-on module's cards are on Asetukset > Lisäosa (AddOnPage.tsx). */
import { CardStack } from "./CardStack.tsx";
import { Loans } from "./Loans.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function HouseholdPage({ meta, params, anchor }: SettingsPageProps) {
  // the loans read their own data
  const { shown, partLoaded } = useCardsShown({ expected: 1 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  return (
    <CardStack shown={shown}>
      <Loans meta={meta} onLoaded={partLoaded} />
    </CardStack>
  );
}
