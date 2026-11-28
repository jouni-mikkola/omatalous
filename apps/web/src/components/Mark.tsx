/**
 * The mark: three rising bars inside a house outline, in the colour of the text around it. The favicon in index.html
 * and the pictures in public/icons are drawn from the same shapes on a tile of the header's colour.
 */
export function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M6.5 15.5 16 6.5l9.5 9V25.5h-19z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <g fill="currentColor">
        <rect x="10.9" y="19" width="2.8" height="3.5" rx=".8" />
        <rect x="14.6" y="16.5" width="2.8" height="6" rx=".8" />
        <rect x="18.3" y="14" width="2.8" height="8.5" rx=".8" />
      </g>
    </svg>
  );
}
