import { Link, Outlet } from "@tanstack/react-router";
import { settingsTargets } from "../routes.ts";
import { t } from "../text.ts";
import type { Meta } from "../types.ts";
import { Tabs } from "../components/ui/Tabs.tsx";
import "../styles/settings.css";

/**
 * Asetukset is six targets, each a route of its own (`#/settings/<id>`, routes.ts `SETTINGS_TARGETS`): Pankit ja tilit,
 * Talous, Turvallisuus, Tiedot and, for an admin, Jäsenet and Palvelin ja ylläpito. While an add-on module is loaded,
 * Lisäosa comes after them (`ADD_ON_TARGET`). This is the frame: the links to the
 * targets that the signed-in role is offered, and the outlet where the router puts the open one. An address from before
 * the targets (`?section=`, a bare `#/settings`, an anchor such as `#lainat`) is rewritten to its target in `redirectRoute`.
 * `?add=1` opens Pankit ja tilit at the bank picker, and an address anchor scrolls to its card. The row of
 * tabs scrolls sideways where it does not fit, with the open target brought into sight.
 */
export function Settings({ meta }: { meta: Meta }) {
  return (
    <div className="stack">
      <Tabs label={t("set.tab.nav")}>
        {settingsTargets(meta.user.role).map((tab) => (
          <Link key={tab.id} to={`/settings/${tab.id}`} preload="intent" activeProps={{ "aria-current": "page" }}>
            {tab.label}
          </Link>
        ))}
      </Tabs>
      <Outlet />
    </div>
  );
}
