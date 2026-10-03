"use client";

// One measure per chart, inline SVG, no chart library. Spend is a thin line
// with a soft area; results are thin bars anchored to the baseline. Hovering a
// day shows its numbers in a tooltip; the whole series is also available as a
// table for screen readers and printing.

import { useEffect, useId, useRef, useState } from "react";
import type { TrendPoint } from "./types";
import { integer, money, shortDate } from "./format";
import { cx } from "./ui";

type Measure = "spend" | "results";

// The SVG is drawn at the container's real pixel width (one unit = one pixel)
// so axis text never scales below 14px on a phone.
const FALLBACK_WIDTH = 640;
const HEIGHT = 220;
const PAD = { top: 26, right: 12, bottom: 30, left: 60 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = value / magnitude;
  const nice = step <= 1 ? 1 : step <= 2 ? 2 : step <= 2.5 ? 2.5 : step <= 5 ? 5 : 10;
  return nice * magnitude;
}

export function TrendChart({ points, measure, currency, title }: { points: TrendPoint[]; measure: Measure; currency: string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [WIDTH, setWidth] = useState(FALLBACK_WIDTH);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const update = () => setWidth(Math.max(240, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const values = points.map((point) => (measure === "spend" ? point.spend ?? 0 : point.results));
  const max = niceMax(Math.max(...values, 0));
  const innerWidth = WIDTH - PAD.left - PAD.right;
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
  const y = (value: number) => PAD.top + innerHeight - (value / max) * innerHeight;
  const format = (value: number) => (measure === "spend" ? money(value, currency, value >= 100 ? 0 : 2) : integer(value));
  const ticks = [0, 0.5, 1].map((fraction) => max * fraction);
  // One date label per ~76px so labels never collide, the last day always labelled.
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor((WIDTH - PAD.left - PAD.right) / 76))));
  const showLabel = (index: number) => index === points.length - 1 || (index % labelEvery === 0 && points.length - 1 - index >= labelEvery);
  const slot = points.length > 1 ? innerWidth / (points.length - 1) : innerWidth;
  const barWidth = Math.max(4, Math.min(28, slot * 0.6));
  const total = values.reduce((sum, value) => sum + value, 0);

  if (!points.length) {
    return (
      <div className="rounded-lg border border-dashed border-dark-border p-6 text-sm text-dark-muted">
        {title}: day-by-day numbers arrive with the next refresh.
      </div>
    );
  }

  const linePath = points.map((_, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(values[index]).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${(PAD.top + innerHeight).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + innerHeight).toFixed(1)} Z`;
  const active = hover === null ? null : points[hover];

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-dark-text">{title}</span>
        <span className="text-sm text-dark-muted tnum">
          Total {format(total)}
        </span>
      </figcaption>
      <div className="relative" ref={box}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={`${id}-title`}
          className="block w-full" style={{ height: HEIGHT }}
          onMouseLeave={() => setHover(null)}
        >
          <title id={`${id}-title`}>{title}, {points.length} days</title>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-border-strong)" strokeOpacity={tick === 0 ? 0.9 : 0.35} strokeWidth={1} />
              <text x={PAD.left - 6} y={y(tick) + 4} textAnchor="end" fontSize={14} fill="var(--color-text-3)" className="tnum">
                {format(tick)}
              </text>
            </g>
          ))}
          {points.map((point, index) => (
            showLabel(index) ? (
              <text key={point.date} x={x(index)} y={HEIGHT - 8} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} fontSize={14} fill="var(--color-text-3)">
                {shortDate(point.date)}
              </text>
            ) : null
          ))}
          {measure === "spend" ? (
            <>
              <path d={areaPath} fill="var(--color-purple)" fillOpacity={0.12} />
              <path d={linePath} fill="none" stroke="var(--color-purple)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {active && hover !== null && <circle cx={x(hover)} cy={y(values[hover])} r={5} fill="var(--color-purple)" stroke="var(--color-panel)" strokeWidth={2} />}
            </>
          ) : (
            points.map((point, index) => {
              const height = Math.max(0, PAD.top + innerHeight - y(values[index]));
              return (
                <rect
                  key={point.date}
                  x={x(index) - barWidth / 2}
                  y={y(values[index])}
                  width={barWidth}
                  height={height}
                  rx={height > 4 ? 3 : 0}
                  fill="var(--color-purple)"
                  fillOpacity={hover === null || hover === index ? 1 : 0.55}
                />
              );
            })
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerHeight} stroke="var(--color-text-3)" strokeDasharray="3 3" strokeWidth={1} />}
          {points.map((point, index) => (
            <rect
              key={`hit-${point.date}`}
              x={x(index) - slot / 2}
              y={PAD.top}
              width={slot}
              height={innerHeight}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
              onFocus={() => setHover(index)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${shortDate(point.date)}: ${format(values[index])}`}
            />
          ))}
        </svg>
        {active && hover !== null && (
          <div
            className={cx("pointer-events-none absolute top-0 z-10 rounded-md border border-dark-border bg-dark-panel2 px-2.5 py-1.5 text-sm shadow-lg", hover > points.length / 2 ? "right-0" : "left-12")}
            role="status"
          >
            <div className="font-medium text-dark-text">{shortDate(active.date)}</div>
            <div className="text-dark-muted tnum">Spent {money(active.spend, currency)}</div>
            <div className="text-dark-muted tnum">Results {integer(active.results)} · Clicks {integer(active.clicks)}</div>
          </div>
        )}
      </div>
      <details className="mt-2 text-sm text-dark-muted">
        <summary className="cursor-pointer">Show as a table</summary>
        <table className="mt-2 w-full text-left tnum">
          <thead>
            <tr className="text-dark-muted">
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 font-medium">Spent</th>
              <th className="py-1 font-medium">Results</th>
              <th className="py-1 font-medium">Clicks</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.date} className="border-t border-dark-border text-dark-text">
                <td className="py-1">{shortDate(point.date)}</td>
                <td className="py-1">{money(point.spend, currency)}</td>
                <td className="py-1">{integer(point.results)}</td>
                <td className="py-1">{integer(point.clicks)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
