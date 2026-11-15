/** The targets of Asetukset as route components: each hands the shell's meta and address to its page (pages/settings/). */
import type { ComponentType } from "react";
import { AddOnPage } from "../pages/settings/AddOnPage.tsx";
import { BanksPage } from "../pages/settings/BanksPage.tsx";
import { DataPage } from "../pages/settings/DataPage.tsx";
import { HouseholdPage } from "../pages/settings/HouseholdPage.tsx";
import { MembersPage } from "../pages/settings/MembersPage.tsx";
import { SecurityPage } from "../pages/settings/SecurityPage.tsx";
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
export const MembersView = viewOf(MembersPage);
export const SecurityView = viewOf(SecurityPage);
export const DataView = viewOf(DataPage);
export const ServerView = viewOf(ServerPage);
export const AddOnView = viewOf(AddOnPage);
