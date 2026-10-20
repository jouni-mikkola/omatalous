import { useEffect, useState } from "react";

/**
 * Keeps the typed text to itself, so typing does not re-render the table.
 * The list follows the text after a short pause; Enter searches at once.
 */
export function SearchBox({ value, onSearch, label }: { value: string; onSearch: (q: string) => void; label: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text.trim() === value.trim()) return;
    const timer = window.setTimeout(() => onSearch(text.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [text, value, onSearch]);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(text.trim());
      }}
    >
      <input type="search" placeholder={label} value={text} onChange={(e) => setText(e.target.value)} aria-label={label} />
    </form>
  );
}

/**
 * The one button that holds the filters on a phone. It says how many are on, so a closed panel
 * is not mistaken for an unfiltered list.
 */
export function FilterToggle({ count, open, onToggle, controls }: { count: number; open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button type="button" className={`btn filter-toggle${count ? " on" : ""}`} aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {count ? `Rajaa (${count})` : "Rajaa"}
    </button>
  );
}

/**
 * A date input that changes the filter only once the date is complete.
 * While the year is being typed the browser reports "0002-03-15" and then
 * "", and navigating on each of those would wipe the field.
 */
export function DateFilter({ value, onCommit, label }: { value: string; onCommit: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (v: string) => {
    if (v !== value && (v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= "1990-01-01"))) onCommit(v);
  };
  return (
    <label className="date-filter">
      <span>{label}</span>
      <input
        type="date"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          // a picked date (or a fully typed one) applies at once
          if (/^(19|20)\d{2}-\d{2}-\d{2}$/.test(e.target.value)) commit(e.target.value);
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => e.key === "Enter" && commit(draft)}
      />
    </label>
  );
}
