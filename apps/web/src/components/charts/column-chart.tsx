"use client";

import { scaleBand, scaleLinear } from "d3-scale";
import { motion } from "motion/react";
import { useState } from "react";
import { axisMoney, fullMoney, longMonth, shortMonth } from "./format";
import { ChartTooltip } from "./tooltip";
import { useSize } from "./use-size";

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
}

/** A column with a 4px rounded DATA end and a square BASELINE end (mark spec). */
export function columnPath(x: number, y: number, width: number, height: number) {
  if (height <= 0) return "";
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

const PLOT_HEIGHT = 220;
const AXIS_BAND = 28; // the x-axis labels are INSIDE the chart's height, so nothing gets clipped
const MARGIN = { top: 8, left: 52 };
/** The chart's full height — skeletons use it so loading never shifts the layout. */
export const COLUMN_CHART_HEIGHT = PLOT_HEIGHT + MARGIN.top + AXIS_BAND;

/**
 * Grouped columns: one group per month, one column per series (income, spending).
 * Hovering anywhere in a month's band — a target much bigger than the thin
 * columns — shows one tooltip with every series for that month.
 */
export function ColumnChart<T extends { month: string }>({
  data,
  series,
  currency,
  footer,
}: {
  data: T[];
  series: ColumnSeries[];
  currency: string;
  footer?: (datum: T) => string;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);

  const plotWidth = Math.max(0, width - MARGIN.left);
  const max = Math.max(
    1,
    ...data.flatMap((d) => series.map((s) => Number(d[s.key as keyof T]) || 0)),
  );
  const y = scaleLinear().domain([0, max]).nice(4).range([PLOT_HEIGHT, 0]);
  const x = scaleBand<string>()
    .domain(data.map((d) => d.month))
    .range([0, plotWidth])
    .paddingInner(0.3)
    .paddingOuter(0.15);
  const ticks = y.ticks(4);
  const compact = (y.domain()[1] ?? 0) / 100 >= 10_000;

  const gap = 2; // surface gap between touching columns
  const columnWidth = Math.max(
    2,
    Math.min(24, (x.bandwidth() - gap * (series.length - 1)) / series.length),
  );
  const groupWidth = columnWidth * series.length + gap * (series.length - 1);
  const active = hovered !== null ? data[hovered] : undefined;

  return (
    <div
      ref={ref}
      className="relative"
      // Reserve the chart's height BEFORE its width is measured: an empty 0-px
      // box that later grows to 240 px pushed everything below it down
      // (a measured layout shift of 0.106 on the dashboard — Stage 12).
      style={{ height: COLUMN_CHART_HEIGHT }}
      onPointerLeave={() => setHovered(null)}
    >
      {width > 0 && (
        <svg
          width={width}
          height={PLOT_HEIGHT + MARGIN.top + AXIS_BAND}
          role="img"
          aria-label={`Column chart of ${series.map((s) => s.label).join(" and ")} by month`}
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {/* Recessive hairline grid; solid, never dashed. */}
            {ticks.map((tick) => (
              <g key={tick} transform={`translate(0,${y(tick)})`}>
                <line
                  x2={plotWidth}
                  stroke={tick === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={-10}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {axisMoney(tick, currency, compact)}
                </text>
              </g>
            ))}

            {data.map((d, i) => {
              const x0 = (x(d.month) ?? 0) + (x.bandwidth() - groupWidth) / 2;
              return (
                <g key={d.month}>
                  {hovered === i && (
                    <rect
                      x={(x(d.month) ?? 0) - 4}
                      y={0}
                      width={x.bandwidth() + 8}
                      height={PLOT_HEIGHT}
                      rx={6}
                      className="fill-muted"
                    />
                  )}
                  {series.map((s, si) => {
                    const value = Number(d[s.key as keyof T]) || 0;
                    return (
                      <motion.path
                        key={s.key}
                        d={columnPath(
                          x0 + si * (columnWidth + gap),
                          y(value),
                          columnWidth,
                          PLOT_HEIGHT - y(value),
                        )}
                        fill={s.color}
                        // Columns GROW from the baseline, a few ms apart, on a spring.
                        initial={{ scaleY: 0 }}
                        animate={{
                          scaleY: 1,
                          opacity: hovered === null || hovered === i ? 1 : 0.45,
                        }}
                        transition={{
                          scaleY: { type: "spring", stiffness: 220, damping: 26, delay: i * 0.03 },
                          opacity: { duration: 0.15 },
                        }}
                        style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
                      />
                    );
                  })}
                  <text
                    x={(x(d.month) ?? 0) + x.bandwidth() / 2}
                    y={PLOT_HEIGHT + 18}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[11px]"
                  >
                    {shortMonth(d.month)}
                  </text>
                  {/* Hit target: the WHOLE band, focusable for keyboard users too. */}
                  <rect
                    x={x(d.month) ?? 0}
                    y={0}
                    width={x.bandwidth()}
                    height={PLOT_HEIGHT}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${longMonth(d.month)}: ${series.map((s) => `${s.label} ${fullMoney(Number(d[s.key as keyof T]) || 0, currency)}`).join(", ")}`}
                    onPointerMove={() => setHovered(i)}
                    onFocus={() => setHovered(i)}
                    onBlur={() => setHovered(null)}
                    className="outline-none"
                  />
                </g>
              );
            })}
          </g>
        </svg>
      )}
      {active && hovered !== null && (
        <ChartTooltip
          x={MARGIN.left + (x(active.month) ?? 0) + x.bandwidth() / 2}
          y={MARGIN.top + 8}
          containerWidth={width}
          title={longMonth(active.month)}
          rows={series.map((s) => ({
            label: s.label,
            color: s.color,
            value: fullMoney(Number(active[s.key as keyof T]) || 0, currency),
          }))}
          footer={footer?.(active)}
        />
      )}
    </div>
  );
}
