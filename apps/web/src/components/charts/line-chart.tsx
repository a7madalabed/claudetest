"use client";

import { scaleLinear } from "d3-scale";
import { area as d3area, curveMonotoneX, line as d3line } from "d3-shape";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { axisMoney, fullMoney } from "./format";
import { ChartTooltip, type TooltipRow } from "./tooltip";
import { useSize } from "./use-size";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** The ONE series the story is about: drawn last, gets the end dot and end label. */
  emphasis?: boolean;
  /** Soft 10% wash under the line (single-series area charts). */
  area?: boolean;
}

const PLOT_HEIGHT = 200;
const AXIS_BAND = 28;
const MARGIN = { top: 12, left: 56, right: 72 };
/** The chart's full height — skeletons use it so loading never shifts the layout. */
export const LINE_CHART_HEIGHT = PLOT_HEIGHT + MARGIN.top + AXIS_BAND;

/**
 * Line / area chart with a CROSSHAIR: a hairline that snaps to the nearest x as
 * the pointer moves. Readers aim at a month, not at a 2px line. One tooltip lists
 * every series at that x. Lines "draw" themselves in on first render.
 *
 * Values may be missing (`null`) for a series — e.g. days of this month that
 * haven't happened yet — and the line simply stops there.
 */
export function LineChart<T>({
  data,
  xKey,
  xLabel,
  xTitle,
  series,
  currency,
  includeZero = false,
  endLabel,
}: {
  data: T[];
  xKey: keyof T;
  xLabel: (datum: T, index: number) => string | null;
  xTitle: (datum: T) => string;
  series: LineSeries[];
  currency: string;
  includeZero?: boolean;
  endLabel?: (value: number) => ReactNode;
}) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hovered, setHovered] = useState<number | null>(null);
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);

  const valueOf = (d: T, key: string) => d[key as keyof T] as unknown as number | null;
  const describePoint = (d: T | undefined) =>
    d === undefined
      ? undefined
      : `${xTitle(d)}: ${series
          .map((s) => {
            const v = valueOf(d, s.key);
            return `${s.label} ${v === null ? "no data" : fullMoney(v, currency)}`;
          })
          .join(", ")}`;
  const values = data.flatMap((d) =>
    series.map((s) => valueOf(d, s.key)).filter((v): v is number => v !== null),
  );
  const lo = Math.min(...values, includeZero ? 0 : Infinity);
  const hi = Math.max(...values, includeZero ? 0 : -Infinity);
  const pad = (hi - lo) * 0.08 || 1;
  const y = scaleLinear()
    .domain([includeZero ? Math.min(lo, 0) : lo - pad, hi + pad])
    .nice(4)
    .range([PLOT_HEIGHT, 0]);
  const x = scaleLinear()
    .domain([0, Math.max(1, data.length - 1)])
    .range([0, plotWidth]);
  const ticks = y.ticks(4);
  const compact =
    Math.max(Math.abs(y.domain()[0] ?? 0), Math.abs(y.domain()[1] ?? 0)) / 100 >= 10_000;

  const ordered = [...series].sort(
    (a, b) => Number(Boolean(a.emphasis)) - Number(Boolean(b.emphasis)),
  );

  function onPointerMove(event: React.PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.round(x.invert(event.clientX - box.left));
    setHovered(Math.max(0, Math.min(data.length - 1, index)));
  }

  const active = hovered !== null ? data[hovered] : undefined;
  const rows: TooltipRow[] = active
    ? series
        .map((s) => ({ s, v: valueOf(active, s.key) }))
        .filter(({ v }) => v !== null)
        .map(({ s, v }) => ({ label: s.label, color: s.color, value: fullMoney(v!, currency) }))
    : [];

  return (
    <div
      ref={ref}
      className="relative"
      // Reserve the chart's height BEFORE its width is measured: an empty 0-px
      // box that later grows to 240 px pushed everything below it down
      // (a measured layout shift of 0.106 on the dashboard — Stage 12).
      style={{ height: LINE_CHART_HEIGHT }}
      onPointerLeave={() => setHovered(null)}
    >
      {width > 0 && data.length > 0 && (
        <svg
          width={width}
          height={PLOT_HEIGHT + MARGIN.top + AXIS_BAND}
          // A labelled GROUP, not role="img": an img's children are hidden from
          // assistive tech, and the scrubber below must be reachable (Stage 13).
          role="group"
          aria-label={`Line chart of ${series.map((s) => s.label).join(" and ")}`}
        >
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {ticks.map((tick) => (
              <g key={tick} transform={`translate(0,${y(tick)})`}>
                <line
                  x2={plotWidth}
                  stroke={tick === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
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
              const label = xLabel(d, i);
              return label ? (
                <text
                  key={String(d[xKey])}
                  x={x(i)}
                  y={PLOT_HEIGHT + 18}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px]"
                >
                  {label}
                </text>
              ) : null;
            })}

            {ordered.map((s) => {
              const defined = (d: T) => valueOf(d, s.key) !== null;
              const linePath =
                d3line<T>()
                  .defined(defined)
                  .x((_, i) => x(i))
                  .y((d) => y(valueOf(d, s.key) ?? 0))
                  .curve(curveMonotoneX)(data) ?? "";
              const areaPath = s.area
                ? (d3area<T>()
                    .defined(defined)
                    .x((_, i) => x(i))
                    .y0(PLOT_HEIGHT)
                    .y1((d) => y(valueOf(d, s.key) ?? 0))
                    .curve(curveMonotoneX)(data) ?? "")
                : null;
              let lastIndex = -1;
              data.forEach((d, i) => {
                if (defined(d)) lastIndex = i;
              });
              const lastValue = lastIndex >= 0 ? valueOf(data[lastIndex]!, s.key)! : null;
              return (
                <g key={s.key}>
                  {areaPath && (
                    <motion.path
                      d={areaPath}
                      fill={s.color}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 0.1 }}
                      transition={{ duration: 0.6, delay: 0.3 }}
                    />
                  )}
                  <motion.path
                    d={linePath}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  />
                  {s.emphasis && lastValue !== null && (
                    <>
                      {/* End dot: r=4 (8px) with a 2px surface ring so it stays legible over the line. */}
                      <motion.circle
                        cx={x(lastIndex)}
                        cy={y(lastValue)}
                        r={4}
                        fill={s.color}
                        stroke="var(--surface)"
                        strokeWidth={2}
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.8, type: "spring", stiffness: 400, damping: 20 }}
                        style={{ transformBox: "fill-box", transformOrigin: "center" }}
                      />
                      {endLabel && (
                        <text
                          x={x(lastIndex) + 10}
                          y={y(lastValue)}
                          dy="0.32em"
                          className="fill-foreground text-xs font-medium tabular-nums"
                        >
                          {endLabel(lastValue)}
                        </text>
                      )}
                    </>
                  )}
                </g>
              );
            })}

            {active && hovered !== null && (
              <g pointerEvents="none">
                <line
                  x1={x(hovered)}
                  x2={x(hovered)}
                  y2={PLOT_HEIGHT}
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.5}
                  shapeRendering="crispEdges"
                />
                {series.map((s) => {
                  const v = valueOf(active, s.key);
                  return v === null ? null : (
                    <circle
                      key={s.key}
                      cx={x(hovered)}
                      cy={y(v)}
                      r={4}
                      fill={s.color}
                      stroke="var(--surface)"
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            )}

            {/* The crosshair's hit area is the whole plot. Keyboard users focus it and
                move the crosshair with ← → (Home/End jump to the ends). To a screen
                reader it's a SLIDER over the data points: each move announces its
                value text ("March 2026: Income $5,200.00, Spending $3,100.00"). */}
            <rect
              width={plotWidth}
              height={PLOT_HEIGHT}
              fill="transparent"
              tabIndex={0}
              role="slider"
              aria-label="Read chart values (left and right arrow keys)"
              aria-valuemin={1}
              aria-valuemax={data.length}
              aria-valuenow={(hovered ?? data.length - 1) + 1}
              aria-valuetext={describePoint(data[hovered ?? data.length - 1])}
              className="outline-none"
              onPointerMove={onPointerMove}
              onPointerDown={onPointerMove}
              onFocus={() => setHovered((h) => h ?? data.length - 1)}
              onBlur={() => setHovered(null)}
              onKeyDown={(event) => {
                const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
                if (step)
                  setHovered((h) =>
                    Math.max(0, Math.min(data.length - 1, (h ?? data.length - 1) + step)),
                  );
                if (event.key === "Home") setHovered(0);
                if (event.key === "End") setHovered(data.length - 1);
              }}
            />
          </g>
        </svg>
      )}
      {active && hovered !== null && rows.length > 0 && (
        <ChartTooltip
          x={MARGIN.left + x(hovered)}
          y={MARGIN.top}
          containerWidth={width}
          title={xTitle(active)}
          rows={rows}
        />
      )}
    </div>
  );
}
