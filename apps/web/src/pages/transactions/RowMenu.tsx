/**
 * Decision: which of a row's actions to take (change its category, whether the change becomes a rule for the payee, the
 * payee's rows, the statement of a card bill, whose share a joint row is). One menu in the opened row, so a list of
 * hundreds of rows carries a button per row and one menu, not a handful of controls per row. The category picker opens
 * in the same panel: it needs a search, which a menu list does not give.
 */
import { type ReactNode, useState } from "react";
import { Button, Menu, MenuItem, MenuSection, MenuTrigger, Popover } from "react-aria-components";
import { t } from "../../text.ts";
import "../../styles/toolbar.css";

export type RowAction = { key: string; label: string; ariaLabel?: string } & ({ href: string; onAction?: undefined } | { onAction: () => void; href?: undefined });

/** A choice that stays set after the menu closes: the rule for the payee's other rows. */
export type RowToggle = { key: string; label: string; checked: boolean; onChange: (on: boolean) => void };

/** The item that swaps the menu for a panel of its own; `render` gets the way to close the whole menu. */
export type RowPanel = { key: string; label: string; ariaLabel: string; title: string; render: (close: () => void) => ReactNode };

type Props = { label: string; items: readonly RowAction[]; toggles?: readonly RowToggle[]; panel?: RowPanel | null };

export function RowMenu({ label, items, toggles = [], panel = null }: Props) {
  const [open, setOpen] = useState(false);
  const [showing, setShowing] = useState(false);
  if (items.length === 0 && toggles.length === 0 && !panel) return null;
  const change = (next: boolean) => {
    setOpen(next);
    if (!next) setShowing(false);
  };
  const on = toggles.filter((t) => t.checked).map((t) => t.key);
  return (
    <MenuTrigger isOpen={open} onOpenChange={change}>
      <Button className="btn tx-row-menu" aria-label={label}>
        {t("tx.actions")}
      </Button>
      <Popover className="rtb-pop" placement="bottom start">
        {showing && panel ? (
          <div role="dialog" aria-label={panel.title} className="tx-row-panel">
            {panel.render(() => change(false))}
          </div>
        ) : (
          <Menu className="rtb-list" aria-label={label}>
            {panel && (
              <MenuItem id={panel.key} className="rtb-item" aria-label={panel.ariaLabel} shouldCloseOnSelect={false} onAction={() => setShowing(true)}>
                {panel.label}
              </MenuItem>
            )}
            {items.map((a) => (
              <MenuItem key={a.key} id={a.key} className="rtb-item" aria-label={a.ariaLabel} href={a.href} onAction={a.onAction}>
                {a.label}
              </MenuItem>
            ))}
            {toggles.length > 0 && (
              <MenuSection
                selectionMode="multiple"
                selectedKeys={on}
                onSelectionChange={(keys) => {
                  const set = keys === "all" ? new Set(toggles.map((t) => t.key)) : new Set([...keys].map(String));
                  for (const t of toggles) if (set.has(t.key) !== t.checked) t.onChange(set.has(t.key));
                }}
              >
                {toggles.map((t) => (
                  <MenuItem key={t.key} id={t.key} className="rtb-item" shouldCloseOnSelect={false}>
                    {t.label}
                  </MenuItem>
                ))}
              </MenuSection>
            )}
          </Menu>
        )}
      </Popover>
    </MenuTrigger>
  );
}
