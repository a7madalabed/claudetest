"use client";

import { scaleLinear } from "d3-scale";
import { line as d3line, curveMonotoneX } from "d3-shape";
import { motion } from "motion/react";

/**
 * A word-sized trend: the history in the quiet de-emphasis grey, the CURRENT
 * point in the accent. No axes, no labels — the tile around it names the value.
 */
export function Sparkline({
  values,
  width = 120,
  height = 36,
  color = "var(--chart-1)",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return null;
  const x = scaleLinear()
    .domain([0, values.length - 1])
    .range([4, width - 4]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const y = scaleLinear()
    .domain([lo, hi === lo ? lo + 1 : hi])
    .range([height - 4, 4]);
  const path =
    d3line<number>()
      .x((_, i) => x(i))
      .y((v) => y(v))
      .curve(curveMonotoneX)(values) ?? "";
  const last = values.length - 1;
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <motion.path
        d={path}
        fill="none"
        stroke="var(--chart-muted)"
        strokeWidth={2}
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9 }}
      />
      <circle
        cx={x(last)}
        cy={y(values[last]!)}
        r={4}
        fill={color}
        stroke="var(--surface)"
        strokeWidth={2}
      />
    </svg>
  );
}
