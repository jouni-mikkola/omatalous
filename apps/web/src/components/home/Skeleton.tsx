import { t } from "../../text.ts";
/**
 * The loading frame of Yhteenveto: the tiles, the months, the bills, the categories, the accounts and the figures at their final size, with grey
 * bars where the text stands (the same classes as the finished blocks give them their place, home.css), so nothing moves
 * when the answer lands.
 */
export function HomeSkeleton() {
  return (
    <div className="page-grid front home-skeleton" role="status" aria-live="polite" aria-busy="true">
      {/* the tiles' own boxes, so the row is as high as the tiles on every width */}
      <ul className="home-tiles" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <li key={i}>
            <span className="home-tile">
              <span className="sk-bar sk-tile-label" />
              <span className="sk-bar sk-tile-fig" />
              <span className="sk-bar sk-tile-line" />
            </span>
          </li>
        ))}
      </ul>
      {/* the blocks in the page's own order and places: the months and the bills, then the categories and the accounts */}
      <section className="card home-months" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-chart" />
      </section>
      <section className="card home-bills" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-bills" />
      </section>
      <section className="card home-where" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-rows" />
      </section>
      <section className="card holdings" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-holdings" />
      </section>
      <span className="sr-only">{t("load.loading")}</span>
    </div>
  );
}
