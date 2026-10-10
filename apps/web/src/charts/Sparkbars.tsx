/** Tiny columns for a table row: the shape of a series, with one month marked. */
export function Sparkbars({ values, active, color, label }: { values: number[]; active: number; color: string; label: string }) {
  const max = Math.max(...values, 1);
  const bar = 4;
  const gap = 2;
  const h = 22;
  return (
    <svg className="sparkbars" width={values.length * (bar + gap) - gap} height={h} role="img" aria-label={label}>
      {values.map((v, i) => {
        const bh = v > 0 ? Math.max(1.5, (v / max) * h) : 0;
        return <rect key={i} x={i * (bar + gap)} y={h - bh} width={bar} height={bh} rx={1} fill={color} opacity={i === active ? 1 : 0.32} />;
      })}
    </svg>
  );
}
