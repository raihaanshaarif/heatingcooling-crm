"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCents, formatCentsCompact } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface BarSeries {
  key: string;
  label: string;
  color?: string;
}

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/**
 * Bar chart for dashboard and reports. Values in `money` mode are cents and are
 * shown as dollars. `layout="vertical"` draws horizontal bars (long category names).
 */
export function SimpleBarChart({
  data,
  xKey,
  series,
  money = false,
  stacked = false,
  layout = "horizontal",
  className,
}: {
  data: Record<string, string | number>[];
  xKey: string;
  series: BarSeries[];
  money?: boolean;
  stacked?: boolean;
  layout?: "horizontal" | "vertical";
  className?: string;
}) {
  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [
      s.key,
      { label: s.label, color: s.color ?? PALETTE[i % PALETTE.length] },
    ]),
  );
  const tick = (v: number) => (money ? formatCentsCompact(v) : v.toLocaleString("en-AU"));
  const vertical = layout === "vertical";
  return (
    <ChartContainer
      config={config}
      className={cn(vertical ? "aspect-auto" : "aspect-[2/1] w-full", className)}
      style={vertical ? { height: Math.max(160, data.length * 36 + 40) } : undefined}
    >
      <BarChart data={data} layout={layout} margin={{ left: vertical ? 8 : 0, right: 8 }}>
        <CartesianGrid vertical={vertical} horizontal={!vertical} />
        {/* Recharts only finds axes that are direct children, so no fragments here. */}
        <XAxis
          type={vertical ? "number" : "category"}
          dataKey={vertical ? undefined : xKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={vertical ? tick : undefined}
        />
        <YAxis
          type={vertical ? "category" : "number"}
          dataKey={vertical ? xKey : undefined}
          tickLine={false}
          axisLine={false}
          width={vertical ? 120 : money ? 56 : 32}
          tickFormatter={vertical ? undefined : tick}
          allowDecimals={false}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent valueFormatter={money ? (v) => formatCents(v) : undefined} />
          }
        />
        {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId={stacked ? "a" : undefined}
            fill={`var(--color-${s.key})`}
            radius={
              stacked
                ? i === series.length - 1
                  ? [4, 4, 0, 0]
                  : 0
                : vertical
                  ? [0, 4, 4, 0]
                  : [4, 4, 0, 0]
            }
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
