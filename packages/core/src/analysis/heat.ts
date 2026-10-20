/**
 * The shade of each value of a row (a category's months, a calendar's days) against the row's own usual level: 1 under
 * half of it, 2 up to it, 3 up to one and a half times it, 4 above that. So a jump reads as a dark cell in a light row
 * whatever the row's size, and one huge value does not wash the others into one step. A row that barely moves (its
 * highest complete value within 15 % of its lowest) stays plain. An incomplete value is low only because it is not
 * whole, and a value without spending is blank: neither sets the range, and both are plain.
 */
export function heatLevels(values: readonly number[], complete: readonly boolean[], usual: number | null): number[] {
  const full = values.filter((v, i) => complete[i] && v > 0);
  const max = full.length ? Math.max(...full) : 0;
  const min = full.length ? Math.min(...full) : 0;
  return values.map((v, i) => {
    if (usual === null || usual <= 0 || !complete[i] || v <= 0 || max <= min * 1.15) return 0;
    return v < usual / 2 ? 1 : v <= usual ? 2 : v <= usual * 1.5 ? 3 : 4;
  });
}
