import { t } from "../../text.ts";
/**
 * The loading frame of Yhteenveto: the month's figures, the months, the bills, the categories, the accounts and the figures at their final size, with grey
 * bars where the text stands (the same classes as the finished blocks give them their place, home.css), so nothing moves
 * when the answer lands.
 */
export function HomeSkeleton() {
  return (
    <div className="page-grid front home-skeleton" role="status" aria-live="polite" aria-busy="true">
      {/* the month's own boxes, so the block is as high as the finished one on every width */}
      <section className="home-summary" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <ul className="home-figs">
          {(["income", "spent", "result"] as const).map((id) => (
            <li key={id} data-fig={id}>
              <span className="sk-bar" />
              <span className="sk-bar sk-fig" />
              <span className="home-gauge" />
              <span className="sk-bar" />
            </li>
          ))}
        </ul>
        <span className="sk-bar sk-flow" />
      </section>
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
