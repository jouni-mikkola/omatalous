/** The three targets of Asetukset as route components: each hands the shell's meta and address to its page (pages/settings/). */
import type { ComponentType } from "react";
import { BanksPage } from "../pages/settings/BanksPage.tsx";
import { HouseholdPage } from "../pages/settings/HouseholdPage.tsx";
import { ServerPage } from "../pages/settings/ServerPage.tsx";
import type { SettingsPageProps } from "../pages/settings/SettingsPage.ts";
import { useShell } from "../shell-context.ts";

function viewOf(Page: ComponentType<SettingsPageProps>) {
  return function SettingsTargetView() {
    const { meta, params, anchor, reloadMeta } = useShell();
    return <Page meta={meta} params={params} anchor={anchor} onChange={reloadMeta} />;
  };
}

export const BanksView = viewOf(BanksPage);
export const HouseholdView = viewOf(HouseholdPage);
export const ServerView = viewOf(ServerPage);
