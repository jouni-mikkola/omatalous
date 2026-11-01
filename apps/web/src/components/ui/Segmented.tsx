import { cx } from "./cx.ts";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** For a screen reader when the visible word is not enough alone. */
  ariaLabel?: string;
  disabled?: boolean;
  /** Said on hover and focus, such as why a choice is off. */
  hint?: string;
}

/** Two or three choices that exclude each other, all in sight, the chosen one pressed: Oma/Koko talous, 3 kk/6 kk/12 kk. More choices or choices that are pages are Tabs. */
export function Segmented<T extends string>({ label, value, options, onChange, className, busy }: {
  label: string;
  value: T | null;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  /** The choice that is saving: its button says so. */
  busy?: T | null;
}) {
  return (
    <div className={cx("segmented", className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} aria-label={o.ariaLabel} title={o.hint} disabled={o.disabled} aria-busy={busy === o.value || undefined} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
