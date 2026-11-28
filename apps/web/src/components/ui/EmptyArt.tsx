/** A small line drawing for an empty page or list, in the quiet text colour. Decorative: the sentence beside it says everything. */
export function EmptyArt({ kind }: { kind: "house" | "coins" }) {
  return (
    <svg className="empty-art" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
      {kind === "house" ? (
        <path d="M6 23 24 8l18 15M10 20v20h28V20M20 40V28h8v12" />
      ) : (
        <>
          <ellipse cx="24" cy="13" rx="12" ry="4.5" />
          <path d="M12 13v7c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5v-7M12 20v7c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5v-7M12 27v7c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5v-7" />
        </>
      )}
    </svg>
  );
}
