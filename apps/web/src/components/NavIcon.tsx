/** What a tab of the phone's bar draws above its label: a 20 px line drawing in the colour of the text, 1.5 px stroke. */
const DRAWINGS: Record<string, string> = {
  overview: "M3.5 11 12 4l8.5 7M5.5 9.5V20h13V9.5",
  transactions: "M4 8h14m-3-3 3 3-3 3M20 16H6m3-3-3 3 3 3",
  bills: "M6 3.5h9l3 3V20.5H6zM9 11h6M9 15h6",
  balances: "M3.5 9.5 12 4l8.5 5.5M5.5 10v8M10 10v8M14 10v8M18.5 10v8M3.5 20h17",
  reports: "M4 20h16M7 17v-5M12 17V6M17 17v-8",
};
/** A page of an add-on module has no drawing of its own: four squares. */
const OTHER = "M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z";

export function NavIcon({ id }: { id: string }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={DRAWINGS[id] ?? OTHER} />
    </svg>
  );
}
