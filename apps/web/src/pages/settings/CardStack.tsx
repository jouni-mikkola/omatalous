import type { ReactNode } from "react";
import { Loading } from "../../components/Loading.tsx";

/** The cards of a target of Asetukset: the loading placeholder until `shown` (use-settings-page.ts `useCardsShown`), while the cards stay mounted to load their data. */
export function CardStack({ shown, children }: { shown: boolean; children: ReactNode }) {
  return (
    <>
      {!shown && <Loading />}
      <div className="stack card-stack" hidden={!shown}>
        {children}
      </div>
    </>
  );
}
