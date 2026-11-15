/**
 * Decision: which rows of this table to look at, in what order and in what groups, and whether to take them away.
 *
 * The one toolbar of every table that has something to choose: a search box, the filter chips with their counts
 * ("Kaikki 21", "Odotettua enemmän 5"), and the grouping menu. "Lataa CSV" is not here: it is a link under the table (Table.tsx). Where the head is hidden (a phone shows each
 * row as a block) it also has the sort choice, so the order stays in reach. It holds no state of its own and adds up
 * nothing: Table passes the view, the counts and what to do when it changes. The chips come from the columns' own
 * definitions (columns.ts), never from a page.
 */
import { localeOf } from "@banking/core";
import { language } from "../../format.ts";
import type { ReactNode } from "react";
import { type Key } from "react-aria-components";
import {
  Button,
  I18nProvider,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  SearchField,
  Select,
  SelectValue,
  ToggleButton,
  ToggleButtonGroup,
} from "react-aria-components";
import { t } from "../../text.ts";
import "../../styles/toolbar.css";
import type { ChipCount } from "./model.ts";
import type { Sort } from "./sort.ts";

type SortChoice = { key: string; text: string; dir: "ascending" | "descending"; phrase: string };

export type ToolbarProps = {
  /** What the table is, for a screen reader: "Taulukon rajaus: Kaikki kategoriat". */
  label: string;
  searchLabel: string;
  query: string;
  onQuery: (query: string) => void;
  /** The chips, without "Kaikki"; empty when no column defines one. */
  chips: ChipCount[];
  all: number | null;
  chip: string | null;
  onChip: (key: string | null) => void;
  /** The columns the rows can be grouped by; empty hides the menu. */
  groups: { key: string; label: string }[];
  group: string | null;
  onGroup: (key: string | null) => void;
  /** The sort choice; Table gives it only where the head is hidden. */
  sort?: { choices: SortChoice[]; value: Sort<string>; onChange: (next: Sort<string>) => void };
  /** What the filters have done to the rows ("5 / 21 rivistä"), when they did. */
  note?: string;
  /** The search box is shown. */
  searchable: boolean;
  /** The page's own controls, after the chips. */
  extra?: ReactNode;
};

const SORT_NONE = "none";
const GROUP_NONE = "none";

export function Toolbar(p: ToolbarProps) {
  const sortKey = p.sort?.value ? `${p.sort.value.key}:${p.sort.value.dir}` : SORT_NONE;
  const groupLabel = p.groups.find((g) => g.key === p.group)?.label;
  return (
    <I18nProvider locale={localeOf(language())}>
      <div className="rtb" role="group" aria-label={p.label}>
        {p.searchable && (
          <SearchField className="rtb-search" aria-label={p.searchLabel} value={p.query} onChange={p.onQuery}>
            <Input placeholder={p.searchLabel} />
            <Button className="rtb-clear">×</Button>
          </SearchField>
        )}
        {p.chips.length > 0 && (
          <ToggleButtonGroup
            className="rtb-chips"
            aria-label={t("table.filter")}
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[p.chip ?? ""]}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (next !== undefined) p.onChip(next === "" ? null : String(next));
            }}
          >
            <ToggleButton id="" className="rtb-chip">
              {t("table.all")}
              {p.all !== null && <> <b>{p.all}</b></>}
            </ToggleButton>
            {p.chips.map((c) => (
              <ToggleButton key={c.key} id={c.key} className="rtb-chip">
                {c.label}
                {c.count !== null && <> <b>{c.count}</b></>}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )}
        {p.extra}
        <div className="rtb-tools">
          {p.sort && (
            <Select
              className="rtb-sort"
              selectedKey={sortKey}
              onSelectionChange={(key: Key | null) => {
                const choice = p.sort!.choices.find((c) => `${c.key}:${c.dir}` === key);
                p.sort!.onChange(choice ? { key: choice.key, dir: choice.dir } : null);
              }}
            >
              <Label className="rtb-label">{t("table.sort")}</Label>
              <Button className="btn">
                <SelectValue />
              </Button>
              <Popover className="rtb-pop">
                <ListBox className="rtb-list">
                  <ListBoxItem id={SORT_NONE} textValue={t("table.original")} className="rtb-item">
                    {t("table.original")}
                  </ListBoxItem>
                  {p.sort.choices.map((c) => (
                    <ListBoxItem key={`${c.key}:${c.dir}`} id={`${c.key}:${c.dir}`} textValue={c.phrase} className="rtb-item">
                      {c.phrase}
                    </ListBoxItem>
                  ))}
                </ListBox>
              </Popover>
            </Select>
          )}
          {p.groups.length > 0 && (
            <MenuTrigger>
              <Button className="btn">{t("table.group_by", { group: groupLabel ?? t("table.group_none_short") })}</Button>
              <Popover className="rtb-pop" placement="bottom end">
                <Menu
                  className="rtb-list"
                  aria-label={t("table.group")}
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[p.group ?? GROUP_NONE]}
                  onSelectionChange={(keys) => {
                    const next = [...keys][0];
                    if (next !== undefined) p.onGroup(next === GROUP_NONE ? null : String(next));
                  }}
                >
                  <MenuItem id={GROUP_NONE} className="rtb-item">
                    {t("table.group_none")}
                  </MenuItem>
                  {p.groups.map((g) => (
                    <MenuItem key={g.key} id={g.key} className="rtb-item">
                      {g.label}
                    </MenuItem>
                  ))}
                </Menu>
              </Popover>
            </MenuTrigger>
          )}
        </div>
        {p.note && <p className="rtb-note">{p.note}</p>}
      </div>
    </I18nProvider>
  );
}
