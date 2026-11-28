import { query } from "../api.ts";
import { BalanceDays } from "../components/home/BalanceDays.tsx";
import { Now, paydayOf } from "../components/home/Now.tsx";
import { FirstFetch } from "../components/home/FirstFetch.tsx";
import { HomeSkeleton } from "../components/home/Skeleton.tsx";
import { FirstRun } from "./FirstRun.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { Button } from "../components/ui/Button.tsx";
import { useApi } from "../hooks.ts";
import { periodRange } from "../period.ts";
import type { DashboardData, Meta, Scope } from "../types.ts";
import "../styles/home.css";
import { t } from "../text.ts";

/**
 * Yhteenveto: what is left until the payday (Nyt, its parts behind the figure) and the balance of the days to it (BalanceDays).
 * The month's sums are on Tapahtumat, the coming months on Laskut and the accounts, cards and loans on Varat ja velat. No
 * notice and no question stands here: the notices are on Asetukset > Turvallisuus, the questions on Tarkistettavat. Every
 * figure is a field of an answer; nothing is added up here. The page always tells today and the running month.
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
          <Now data={{ ...data, nyt }} />
          {data.home.lowPoint?.known && data.home.lowPoint.line.length > 1 && <BalanceDays low={data.home.lowPoint} payday={paydayOf({ ...data, nyt })} past={data.home.pastPeriods} />}
        </>
      ) : (
        <p className="home-detail">{t("home.no_payments_shown")}</p>
      )}
    </div>
  );
}
