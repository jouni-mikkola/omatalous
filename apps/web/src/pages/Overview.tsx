import { query } from "../api.ts";
import { MonthPace } from "../components/home/MonthPace.tsx";
import { Answer } from "../components/home/Answer.tsx";
import { Notable } from "../components/home/Notable.tsx";
import { FirstFetch } from "../components/home/FirstFetch.tsx";
import { HomeSkeleton } from "../components/home/Skeleton.tsx";
import { monthLine, updatedText } from "../components/home/texts.ts";
import { EmptyStart } from "../components/EmptyStart.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { ServerNotices } from "../components/Notices.tsx";
import { Button } from "../components/ui/Button.tsx";
import { useApi } from "../hooks.ts";
import { periodRange } from "../period.ts";
import type { DashboardData, Meta, Scope } from "../types.ts";
import { THIS_MONTH_ID } from "./reports/sections/ids.ts";
import "../styles/home.css";
import { t } from "../text.ts";

/**
 * Yhteenveto answers one question: do the money last to the next payday, and how much is left. Three blocks in one
 * order: the answer with its sum row (Answer), how the month goes against the expected one (MonthPace, with the way to
 * the days and categories the difference comes from), and the findings worth acting on, each with its euros a year
 * (Notable). Every figure is a field of `home` in the dashboard answer; nothing is added up here. The page always tells today and the running
 * month: the questions it does not settle by itself are on Tarkistettavat.
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
  if (!hasData) return <EmptyStart onDemo={onEmptyAction} meta={meta} onReload={onReload} />;
  if (now.error && !now.data) return <ErrorCard message={now.error} onRetry={now.reload} />;
  if (!now.data) return <HomeSkeleton />;

  const data = now.data;
  const { home } = data;
  const syncedAt = meta.lastSync?.finishedAt ?? null;
  return (
    <div className={`page-grid front${now.loading ? " loading" : ""}`}>
      <ServerNotices />
      <FirstFetch meta={meta} onReload={onReload} />
      {home.runway ? (
        <Answer runway={home.runway} ahead={data.ahead} line={monthLine(meta.today.slice(0, 7), home.pace, updatedText(syncedAt, meta.today))} />
      ) : (
        <section className="home-answer">
          <p className="home-eyebrow">{monthLine(meta.today.slice(0, 7), home.pace, updatedText(syncedAt, meta.today))}</p>
          <p className="home-detail">{t("home.no_payments_shown")}</p>
        </section>
      )}
      <MonthPace data={data} reportHref={`#/reports#${THIS_MONTH_ID}`} />
      <Notable insights={home.notable} />
    </div>
  );
}
