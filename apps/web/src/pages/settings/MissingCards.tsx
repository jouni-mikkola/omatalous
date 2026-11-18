/** Asetukset > Pankit ja tilit: the cards whose purchases are not in the data, each with the way to bring them in. */
// Decision: a household that sees "Kortin ostot eivät näy historiassa" connects the card or adds its statement from the card it names
import { query } from "../../api.ts";
import { Table } from "../../components/table/Table.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { date, money } from "../../format.ts";
import { useApi } from "../../hooks.ts";
import { periodRange } from "../../period.ts";
import { CONNECT_BANK_HASH, SETTINGS_ANCHOR, settingsCardHash } from "../../routes.ts";
import { t } from "../../text.ts";
import type { DashboardData, Meta } from "../../types.ts";
import { useReportLoaded } from "./use-settings-page.ts";

type MissingCard = DashboardData["questions"]["cardBills"][number];

/** What the bills cover: before the day a connected card's rows begin, else up to the last bill. */
function periodOf(card: MissingCard): string {
  return card.reason === "before_history" && card.since ? t("set.banks.cards_before", { date: date(card.since) }) : t("set.banks.cards_until", { date: date(card.lastDate) });
}

/**
 * The cards of core's `questions.cardBills` (the bills of the twelve complete months whose purchases no row holds): the
 * name, the bills' sum and the period. A card that is not connected is connected; one that is connected and has no rows
 * for these bills gets a statement. Nothing is added up here.
 */
export function MissingCards({ meta, onLoaded }: { meta: Meta; onLoaded?: (failed?: boolean) => void }) {
  const dashboard = useApi<DashboardData>(meta.accounts.length > 0 ? `/api/dashboard${query({ ...periodRange("month", meta.today), scope: "own" })}` : null, true);
  useReportLoaded(meta.accounts.length === 0 || dashboard.data !== null || dashboard.error !== null, onLoaded);
  const cards = dashboard.data?.questions.cardBills ?? [];
  if (!cards.length) return null;
  return (
    <div className="card" id={SETTINGS_ANCHOR.missingCards}>
      <div className="card-head">
        <div>
          <h2>{t("rpt.q_cards_caption")}</h2>
        </div>
      </div>
      <Table
        caption={t("rpt.q_cards_caption")}
        rows={cards}
        rowKey={(c) => `${c.issuer}:${c.reason}`}
        search={false}
        csv={false}
        columns={[
          { key: "card", label: t("rpt.q_card"), kind: "text", rowHead: true, cell: (c) => c.label },
          { key: "bills", label: t("rpt.q_bills_12"), kind: "money", cents: (c) => c.cents, cell: (c) => money(c.cents), csv: false },
          { key: "period", label: t("set.banks.cards_period"), kind: "text", cell: periodOf, csv: false },
          {
            key: "action",
            label: t("set.mt.action"),
            kind: "text",
            headHidden: true,
            csv: false,
            cell: (c) =>
              c.reason === "not_connected" ? (
                <Button className="missing-card-action" href={CONNECT_BANK_HASH} aria-label={`${t("set.banks.cards_connect")}: ${c.label}`}>
                  {t("set.banks.cards_connect")}
                </Button>
              ) : (
                <Button className="missing-card-action" href={settingsCardHash(SETTINGS_ANCHOR.statement)} aria-label={`${t("set.banks.cards_add_statement")}: ${c.label}`}>
                  {t("set.banks.cards_add_statement")}
                </Button>
              ),
          },
        ]}
      />
    </div>
  );
}
