import { query } from "../api.ts";
import { Bills } from "../components/home/Bills.tsx";
import { Categories } from "../components/home/Categories.tsx";
import { Months } from "../components/home/Months.tsx";
import { Tiles } from "../components/home/Tiles.tsx";
import { FirstFetch } from "../components/home/FirstFetch.tsx";
import { HomeSkeleton } from "../components/home/Skeleton.tsx";
import { FirstRun } from "./FirstRun.tsx";
import { Holdings } from "./reports/holdings/Holdings.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Button } from "../components/ui/Button.tsx";
import { useApi } from "../hooks.ts";
import { periodRange } from "../period.ts";
import type { DashboardData, Meta, Scope } from "../types.ts";
import "../styles/home.css";
import { t } from "../text.ts";

/**
 * Yhteenveto: how the household's money stands and is going, on one screen. The four tiles first (Tiles: what is left
 * to the payday, the month's spending and income against the usual, what the household has net), then the last twelve
 * months of income and spending (Months) with the bills to the payday beside it (Bills), then the accounts, cards and
 * loans (Holdings, the block of Raportit > Tilit ja saldot) with the month's categories against their usual beside them
 * (Categories). The source order is the order a phone reads: tiles, months, bills, categories, accounts. No notice and no question stands here: the notices are on
 * Asetukset > Turvallisuus, the questions on Tarkistettavat. Every figure is a field of the dashboard answer and a link
 * to its rows; nothing is added up here. The page always tells today and the running month.
 */
export function Overview({
  meta,
  scope,
  onEmptyAction,
  onShowHousehold,
  onReload,
}: {
  meta: Meta;
  scope: Scope;
  onEmptyAction: () => Promise<void>;
  onShowHousehold: () => void;
  /** Reads the meta again: the first fetch of a new bank ends there. */
  onReload?: () => void;
}) {
  const hasData = meta.accounts.length > 0 || (scope === "household" && meta.sharedAccounts.length > 0);
  // no request while there are no accounts: the first one after demo data or a sync is a fresh fetch
  const now = useApi<DashboardData>(hasData ? `/api/dashboard${query({ ...periodRange("month", meta.today), scope })}` : null, true);

  // a member who only sees accounts shared with them has nothing under "Oma"
  if (!hasData && meta.sharedAccounts.length > 0) {
    return (
      <>
        <FirstFetch meta={meta} onReload={onReload} />
        <section className="card empty">
          <h2>{t("home.no_own_accounts")}</h2>
          <p>{t("home.shared_see_household")}</p>
          <Button variant="primary" onClick={onShowHousehold}>
            {t("home.show_household")}
          </Button>
        </section>
      </>
    );
  }
  if (!hasData) return <FirstRun view="overview" meta={meta} onDemo={onEmptyAction} onReload={onReload} />;
  if (now.error && !now.data) return <ErrorCard message={now.error} onRetry={now.reload} />;
  if (!now.data) return <HomeSkeleton />;

  const data = now.data;
  const { nyt } = data;
  return (
    <div className={`page-grid front${now.loading ? " loading" : ""}`}>
      <FirstFetch meta={meta} onReload={onReload} />
      {nyt ? (
        <>
          <Tiles data={{ ...data, nyt }} scope={scope} />
          <Months data={data} today={meta.today} />
          <Bills data={{ ...data, nyt }} />
          <Categories data={{ ...data, nyt }} />
        </>
      ) : (
        <p className="home-detail">{t("home.no_payments_shown")}</p>
      )}
      <Holdings holdings={data.holdings} meta={meta} scope={scope} ahead={data.ahead} title={t("home.accounts_title")} />
    </div>
  );
}
