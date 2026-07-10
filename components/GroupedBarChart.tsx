// Dependency-free grouped bar chart (SVG). Presentational only.

export type Series = { key: string; label: string; color: string };
export type Group = { label: string; values: Record<string, number> };

export default function GroupedBarChart({
  groups,
  series,
  formatValue = (n) => String(n),
  height = 240,
}: {
  groups: Group[];
  series: Series[];
  formatValue?: (n: number) => string;
  height?: number;
}) {
  const W = 640;
  const H = height;
  const padX = 40;
  const padTop = 16;
  const padBottom = 44;
  const chartW = W - padX * 2;
  const chartH = H - padTop - padBottom;

  const max = Math.max(
    1,
    ...groups.flatMap((g) => series.map((s) => g.values[s.key] ?? 0))
  );
  const groupW = chartW / Math.max(1, groups.length);
  const barGap = 6;
  const barW = Math.max(
    6,
    (groupW - barGap * (series.length + 1)) / series.length
  );

  const y = (v: number) => padTop + chartH - (v / max) * chartH;

  // 4 gridlines
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    v: max * t,
    y: padTop + chartH - t * chartH,
  }));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Grouped bar chart"
        style={{ minWidth: 480 }}
      >
        {/* gridlines + y labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={padX}
              x2={W - padX}
              y1={t.y}
              y2={t.y}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={1}
            />
            <text x={padX - 6} y={t.y + 4} textAnchor="end" fontSize="10" fill="#9db5a8">
              {formatValue(Math.round(t.v))}
            </text>
          </g>
        ))}

        {groups.map((g, gi) => {
          const gx = padX + gi * groupW;
          return (
            <g key={g.label}>
              {series.map((s, si) => {
                const v = g.values[s.key] ?? 0;
                const bx = gx + barGap + si * (barW + barGap);
                const by = y(v);
                const bh = padTop + chartH - by;
                return (
                  <g key={s.key}>
                    <rect
                      x={bx}
                      y={by}
                      width={barW}
                      height={Math.max(0, bh)}
                      rx={3}
                      fill={s.color}
                    />
                    {v > 0 ? (
                      <text
                        x={bx + barW / 2}
                        y={by - 4}
                        textAnchor="middle"
                        fontSize="9"
                        fill="#cfe0d6"
                      >
                        {formatValue(Math.round(v))}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              <text
                x={gx + groupW / 2}
                y={H - padBottom + 18}
                textAnchor="middle"
                fontSize="11"
                fill="#cfe0d6"
                fontWeight={500}
              >
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <div className="mt-1 flex flex-wrap gap-4 justify-center">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-mint">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: s.color }}
            />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export const REPORT_SERIES: Series[] = [
  { key: "purchasedQty", label: "Purchased", color: "#059669" },
  { key: "dispersedQty", label: "Dispersed", color: "#f59e0b" },
  { key: "onHandQty", label: "On-hand", color: "#3b82f6" },
];
