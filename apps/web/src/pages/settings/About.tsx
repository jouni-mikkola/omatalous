import type { ReactNode } from "react";
import { ABOUT } from "../../about.ts";

const outside = { target: "_blank", rel: "noopener noreferrer" } as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="st-row">
      <dt className="st-name">{label}</dt>
      <dd className="st-num">{children}</dd>
    </div>
  );
}

/** Asetukset > Tietoja: the version, who made the app, the source and the licence; a support link only when its address is set. */
export function About({ version, supportUrl = ABOUT.supportUrl }: { version: string; supportUrl?: string }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Tietoja</h2>
      </div>
      <dl className="st-rows">
        <Row label="Versio">{version}</Row>
        <Row label="Tekijä">
          <a href={ABOUT.authorUrl} {...outside}>
            {ABOUT.authorName}
          </a>
        </Row>
        <Row label="Lähdekoodi">
          <a href={ABOUT.sourceUrl} {...outside}>
            GitHub
          </a>
        </Row>
        <Row label="Lisenssi">{ABOUT.licence}</Row>
      </dl>
      {supportUrl !== "" && (
        <p className="small muted">
          Omatalous on ilmainen. Jos pidät siitä, voit{" "}
          <a href={supportUrl} {...outside}>
            tukea kehitystä
          </a>
          .
        </p>
      )}
    </div>
  );
}
