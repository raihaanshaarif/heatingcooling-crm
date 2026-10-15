import "server-only";
import {
  addMelbourneDays,
  fromMelbourneInput,
  melbourneParts,
  parseDateRange,
  startOfMelbourneDay,
  startOfMelbourneMonth,
  toDateInput,
} from "@/lib/dates";
import { defaultRange, type Range } from "./queries";

/** ?from / ?to (inclusive Melbourne days) → [from, to). Defaults to the last 12 months. */
export function resolveRange(params: { from?: string; to?: string }): Range {
  const parsed = parseDateRange(params);
  const fallback = defaultRange();
  return { from: parsed.from ?? fallback.from, to: parsed.to ?? fallback.to };
}

export function rangePresets(now = new Date()) {
  const last = (r: Range) => toDateInput(new Date(r.to.getTime() - 1));
  const { year, month } = melbourneParts(now);
  const fyStartYear = month >= 6 ? year : year - 1; // Australian financial year starts 1 July
  const fyStart = fromMelbourneInput(`${fyStartYear}-07-01`);
  const ranges: { label: string; range: Range }[] = [
    {
      label: "This month",
      range: { from: startOfMelbourneMonth(now), to: startOfMelbourneMonth(now, 1) },
    },
    {
      label: "Last month",
      range: { from: startOfMelbourneMonth(now, -1), to: startOfMelbourneMonth(now) },
    },
    {
      label: "This financial year",
      range: { from: fyStart, to: fromMelbourneInput(`${fyStartYear + 1}-07-01`) },
    },
    {
      label: "Last financial year",
      range: { from: fromMelbourneInput(`${fyStartYear - 1}-07-01`), to: fyStart },
    },
    { label: "Last 12 months", range: defaultRange(now) },
    {
      label: "Last 30 days",
      range: {
        from: addMelbourneDays(startOfMelbourneDay(now), -29),
        to: addMelbourneDays(startOfMelbourneDay(now), 1),
      },
    },
  ];
  return ranges.map((r) => ({
    label: r.label,
    from: toDateInput(r.range.from),
    to: last(r.range),
  }));
}
