import { t } from "../../text.ts";
/**
 * The loading frame of Yhteenveto: what is left to the payday, the month's figures, the coming months and the accounts at their final size, with grey
 * bars where the text stands (the same classes as the finished blocks give them their place, home.css), so nothing moves
 * when the answer lands.
 */
export function HomeSkeleton() {
  return (
    <div className="page-grid front home-skeleton" role="status" aria-live="polite" aria-busy="true">
      <section className="card home-now" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <span className="sk-bar sk-fig" />
      </section>
      {/* the month's own boxes, so the block is as high as the finished one on every width */}
      <section className="home-summary" aria-hidden="true">
        <span className="sk-bar sk-line" />
        <ul className="home-figs">
          {(["income", "spent", "result"] as const).map((id) => (
            <li key={id} data-fig={id}>
              <span className="sk-bar" />
              <span className="sk-bar sk-fig" />
              <span className="sk-bar" />
            </li>
          ))}
        </ul>
        <span className="sk-bar sk-flow" />
      </section>
      {/* the blocks in the page's own order and places */}
      <div className="front-rail">
        <section className="card home-coming" aria-hidden="true">
          <span className="sk-bar sk-line" />
          <span className="sk-bar sk-coming" />
        </section>
        <section className="card holdings" aria-hidden="true">
          <span className="sk-bar sk-line" />
          <span className="sk-bar sk-holdings" />
        </section>
      </div>
      <span className="sr-only">{t("load.loading")}</span>
    </div>
  );
}
