/** Asetukset > Talous: the household's loans, its monthly spending goal and the cards the build's extensions add (extensions.ts). */
import { WEB_EXTENSIONS } from "../../extensions.ts";
import { CardStack } from "./CardStack.tsx";
import { Loans } from "./Loans.tsx";
import { SpendingGoalCard } from "./SpendingGoalCard.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function HouseholdPage({ meta, params, anchor }: SettingsPageProps) {
  const { shown, partLoaded } = useCardsShown({ expected: 2 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  return (
    <CardStack shown={shown}>
      <Loans meta={meta} onLoaded={partLoaded} />
      <SpendingGoalCard onLoaded={partLoaded} />
      {WEB_EXTENSIONS.map(({ id, settingsCard: Card }) => Card && (meta.features as Record<string, boolean>)[id] && <Card key={id} />)}
    </CardStack>
  );
}
