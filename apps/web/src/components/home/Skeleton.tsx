import { t } from "../../text.ts";
/**
 * The loading frame of Yhteenveto: the tiles, the month, the side column and the figures at their final size, with grey
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
      <section className="card home-pace" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-chart" />
      </section>
      <div className="home-side" aria-hidden="true">
        <section className="card">
          <span className="sk-bar sk-line" />
          <span className="sk-bar sk-rows" />
        </section>
      </div>
      <section className="card home-holdings" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-holdings" />
      </section>
      <span className="sr-only">{t("load.loading")}</span>
    </div>
  );
}
