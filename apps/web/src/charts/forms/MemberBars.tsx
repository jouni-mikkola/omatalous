// Decision: who paid more than their share of the joint account, and who less
import { css } from "../../css.ts";
import { money } from "../../format.ts";
import "../../styles/member-bars.css";

interface MemberBar {
  key: string;
  name: string;
  /** What the member paid and the share they owe, as the settlement gives them. */
  paidCents: number;
  shareCents: number;
}

/**
 * Two bars a member, what they paid over what their share is, on one scale for all members. The settlement's figures
 * are drawn as they are; the rows under the chart say the same in words, so the bars are hidden from readers.
 */
export function MemberBars({ members, paidLabel, shareLabel }: { members: readonly MemberBar[]; paidLabel: string; shareLabel: string }) {
  const max = Math.max(1, ...members.flatMap((m) => [m.paidCents, m.shareCents]));
  const width = (cents: number) => `${(Math.min(1, Math.max(0, cents) / max) * 100).toFixed(1)}%`;
  return (
    <div className="member-bars" aria-hidden="true">
      <ul className="mbr-legend">
        <li>
          <span className="mbr-key mbr-paid" />
          {paidLabel}
        </li>
        <li>
          <span className="mbr-key mbr-share" />
          {shareLabel}
        </li>
      </ul>
      {members.map((m) => (
        <div key={m.key} className="mbr-member">
          <span className="mbr-name">{m.name}</span>
          <span className="mbr-line">
            <span className="mbr-track">
              <span className="mbr-paid" ref={css({ width: width(m.paidCents) })} />
            </span>
            <span className="mbr-fig">{money(m.paidCents, false)}</span>
          </span>
          <span className="mbr-line">
            <span className="mbr-track">
              <span className="mbr-share" ref={css({ width: width(m.shareCents) })} />
            </span>
            <span className="mbr-fig">{money(m.shareCents, false)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
