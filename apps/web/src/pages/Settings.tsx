import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { settingsTargets } from "../routes.ts";
import { t } from "../text.ts";
import type { Meta } from "../types.ts";
import "../styles/settings.css";

/**
 * Asetukset is six targets, each a route of its own (`#/settings/<id>`, routes.ts `SETTINGS_TARGETS`): Pankit ja tilit,
 * Talous, Turvallisuus, Tiedot and, for an admin, Jäsenet and Palvelin ja ylläpito. While an add-on module is loaded,
 * Lisäosa comes after them (`ADD_ON_TARGET`). This is the frame: the links to the
 * targets that the signed-in role is offered, and the outlet where the router puts the open one. An address from before
 * the targets (`?section=`, a bare `#/settings`, an anchor such as `#lainat`) is rewritten to its target in `redirectRoute`.
 * `?add=1` opens Pankit ja tilit at the bank picker, and an address anchor scrolls to its card. Should the
 * labels be wider than a phone's screen the row scrolls, so the open one is brought into view when the address changes.
 */
export function Settings({ meta }: { meta: Meta }) {
  const row = useRef<HTMLElement>(null);
  const path = useLocation({ select: (l) => l.pathname });
  useEffect(() => {
    const open = row.current?.querySelector<HTMLElement>('[aria-current="page"]');
    // scrolls the row only: scrollIntoView would move the page too
    if (open && row.current) row.current.scrollLeft = open.offsetLeft - (row.current.clientWidth - open.offsetWidth) / 2;
  }, [path]);
  return (
    <div className="stack">
      <nav className="tabs" aria-label={t("set.tab.nav")} ref={row}>
        {settingsTargets(meta.user.role).map((tab) => (
          <Link key={tab.id} to={`/settings/${tab.id}`} preload="intent" activeProps={{ "aria-current": "page" }}>
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
