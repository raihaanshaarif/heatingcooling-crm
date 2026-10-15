import { differenceInCalendarDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/** Every date in CoolOps is shown and scheduled in Melbourne time. */
export const TIMEZONE = "Australia/Melbourne";

type DateLike = Date | string | number;

function toDate(value: DateLike): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(value: DateLike | null | undefined, pattern = "d MMM yyyy"): string {
  if (value === null || value === undefined) return "";
  return formatInTimeZone(toDate(value), TIMEZONE, pattern);
}

export function formatDateTime(value: DateLike | null | undefined): string {
  return formatDate(value, "d MMM yyyy, h:mm a");
}

export function formatTime(value: DateLike | null | undefined): string {
  return formatDate(value, "h:mm a");
}

/** yyyy-MM-dd for <input type="date">, in Melbourne time. */
export function toDateInput(value: DateLike | null | undefined): string {
  return formatDate(value, "yyyy-MM-dd");
}

/** yyyy-MM-ddTHH:mm for <input type="datetime-local">, in Melbourne time. */
export function toDateTimeInput(value: DateLike | null | undefined): string {
  return formatDate(value, "yyyy-MM-dd'T'HH:mm");
}

/** Interpret a wall-clock string typed in Melbourne ("2025-03-01" or "2025-03-01T09:30") as a UTC Date. */
export function fromMelbourneInput(value: string): Date {
  const normalised = value.length === 10 ? `${value}T00:00:00` : value;
  return fromZonedTime(normalised, TIMEZONE);
}

/** Wall-clock parts of a date in Melbourne. */
export function melbourneParts(value: DateLike = new Date()) {
  const z = toZonedTime(toDate(value), TIMEZONE);
  return { year: z.getFullYear(), month: z.getMonth(), day: z.getDate(), hours: z.getHours() };
}

/** Midnight in Melbourne at the start of the given instant's Melbourne day. */
export function startOfMelbourneDay(value: DateLike = new Date()): Date {
  return fromZonedTime(
    `${formatInTimeZone(toDate(value), TIMEZONE, "yyyy-MM-dd")}T00:00:00`,
    TIMEZONE,
  );
}

export function endOfMelbourneDay(value: DateLike = new Date()): Date {
  return new Date(addMelbourneDays(startOfMelbourneDay(value), 1).getTime() - 1);
}

export function startOfMelbourneMonth(value: DateLike = new Date(), offsetMonths = 0): Date {
  const { year, month } = melbourneParts(value);
  const d = new Date(Date.UTC(year, month + offsetMonths, 1));
  const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00`;
  return fromZonedTime(iso, TIMEZONE);
}

export function startOfMelbourneWeek(value: DateLike = new Date()): Date {
  // Weeks start on Monday in Australia.
  const z = toZonedTime(toDate(value), TIMEZONE);
  const diff = (z.getDay() + 6) % 7;
  return addMelbourneDays(startOfMelbourneDay(value), -diff);
}

/** Add calendar days in Melbourne (DST-safe: keeps the wall-clock time). */
export function addMelbourneDays(value: DateLike, days: number): Date {
  const iso = formatInTimeZone(toDate(value), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  const [datePart, timePart] = iso.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  const shiftedDate = shifted.toISOString().slice(0, 10);
  return fromZonedTime(`${shiftedDate}T${timePart}`, TIMEZONE);
}

/** Add calendar months in Melbourne, clamping to the end of shorter months. */
export function addMelbourneMonths(value: DateLike, months: number): Date {
  const iso = formatInTimeZone(toDate(value), TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
  const [datePart, timePart] = iso.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const day = Math.min(d, lastDay);
  const shiftedDate = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return fromZonedTime(`${shiftedDate}T${timePart}`, TIMEZONE);
}

/** Whole Melbourne calendar days from `from` to `to` (positive when `to` is later). */
export function melbourneDaysBetween(from: DateLike, to: DateLike): number {
  return differenceInCalendarDays(
    toZonedTime(toDate(to), TIMEZONE),
    toZonedTime(toDate(from), TIMEZONE),
  );
}

export function isPastMelbourneDay(value: DateLike, now: DateLike = new Date()): boolean {
  return melbourneDaysBetween(value, now) > 0;
}

/** "3 days ago" / "in 2 days" / "today" relative to Melbourne calendar days. */
export function relativeDays(value: DateLike, now: DateLike = new Date()): string {
  const diff = melbourneDaysBetween(now, value);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

export function minutesBetween(start: DateLike, end: DateLike): number {
  return Math.max(0, Math.round((toDate(end).getTime() - toDate(start).getTime()) / 60000));
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (!minutes) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** Parse ?from=yyyy-MM-dd&to=yyyy-MM-dd (Melbourne days, `to` inclusive) into a [from, to) range. */
export function parseDateRange(range: { from?: string | null; to?: string | null }): {
  from: Date | null;
  to: Date | null;
} {
  const valid = (v?: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return {
    from: valid(range.from) ? fromMelbourneInput(range.from) : null,
    to: valid(range.to) ? addMelbourneDays(fromMelbourneInput(range.to), 1) : null,
  };
}
