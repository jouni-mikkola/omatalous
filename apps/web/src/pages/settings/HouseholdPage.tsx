/** Asetukset > Talous: the household's loans, the category rules and the cards the build's extensions add (extensions.ts). */
import { WEB_EXTENSIONS } from "../../extensions.ts";
import { CardStack } from "./CardStack.tsx";
import { Loans } from "./Loans.tsx";
import { Rules } from "./Rules.tsx";
import type { SettingsPageProps } from "./SettingsPage.ts";
import { useCardScroll, useCardsShown } from "./use-settings-page.ts";

export function HouseholdPage({ meta, params, anchor }: SettingsPageProps) {
  const { shown, partLoaded } = useCardsShown({ expected: 1 });
  useCardScroll(anchor, `${params.toString()}#${anchor}`, shown);
  return (
    <CardStack shown={shown}>
      <Loans meta={meta} onLoaded={partLoaded} />
      <Rules meta={meta} />
      {WEB_EXTENSIONS.map(({ id, settingsCard: Card }) => Card && (meta.features as Record<string, boolean>)[id] && <Card key={id} />)}
    </CardStack>
  );
}
