import { query } from "../api.ts";
import { Answer } from "../components/home/Answer.tsx";
import { Direction } from "../components/home/Direction.tsx";
import { MonthPace } from "../components/home/MonthPace.tsx";
import { Notable, NOTABLE_SHOWN, type NotableRow } from "../components/home/Notable.tsx";
import { eyebrow, figureOf, nameOf, needsUser, NEW_SITTING, openItems, type ReviewAnswer, type ReviewItem, withFetch } from "./review-items.ts";
import { Where } from "../components/home/Where.tsx";
import { FirstFetch } from "../components/home/FirstFetch.tsx";
import { HomeSkeleton } from "../components/home/Skeleton.tsx";
import { FirstRun } from "./FirstRun.tsx";
import { ErrorCard } from "../components/ErrorCard.tsx";
import { NoticeLine } from "../components/Notices.tsx";
import { Button } from "../components/ui/Button.tsx";
import { useApi } from "../hooks.ts";
import { periodRange } from "../period.ts";
import type { DashboardData, Meta, Scope } from "../types.ts";
import "../styles/home.css";
import { t } from "../text.ts";

/** The first items of the Tarkistettavat queue that need the household (`needsUser`) as Huomioitavaa shows them, in the queue's order, and the count of all the header's mark says. */
export function notableOf(items: readonly ReviewItem[]): { rows: NotableRow[]; count: number } {
  const open = openItems(items, NEW_SITTING);
  const rows = open.filter(needsUser).slice(0, NOTABLE_SHOWN).map((item) => {
    const figure = figureOf(item);
    return { id: item.id, kind: eyebrow(item), name: nameOf(item), figure: figure.text, unit: figure.unit };
  });
  return { rows, count: open.length };
}

/**
 * Yhteenveto (docs/design/README.md section 1.1): how much can still be spent before payday with the sum row that makes
 * it (Answer), under it one line for a notice of the server at most (NoticeLine), the month against its usual course as a chart and its days (MonthPace), beside it the first open
 * questions (Notable) and the largest categories (Where), and under them what the household has and owes (Direction).
 * Every figure is a field of the dashboard answer; nothing is added up here. The page always tells today and the
 * running month.
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

  // the queue of Tarkistettavat, read as that page reads it (a failed fetch is its first item)
  const queue = useApi<ReviewAnswer>(hasData ? "/api/review" : null, true);
  const notable = notableOf(queue.data ? withFetch(queue.data.items, meta.lastSync) : []);

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
  // the queue is waited for too, so Huomioitavaa does not push the block under it down when it lands; a queue that fails leaves the block out
  if (!now.data || (!queue.data && !queue.error)) return <HomeSkeleton />;

  const data = now.data;
  const { nyt } = data;
  return (
    <div className={`page-grid front${now.loading ? " loading" : ""}`}>
      <FirstFetch meta={meta} onReload={onReload} />
      {nyt ? (
        <>
          <Answer nyt={nyt} ahead={data.ahead} scope={scope} />
          <NoticeLine />
          <MonthPace data={{ ...data, nyt }} />
          <div className="home-side">
            <Notable rows={notable.rows} count={notable.count} />
            <Where data={{ ...data, nyt }} />
          </div>
          <Direction holdings={data.holdings} direction={data.home.direction} today={meta.today} scope={scope} />
        </>
      ) : (
        <>
          <section className="home-answer">
            <p className="home-detail">{t("home.no_payments_shown")}</p>
          </section>
          <NoticeLine />
        </>
      )}
    </div>
  );
}
