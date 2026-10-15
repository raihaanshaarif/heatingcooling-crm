import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Convert Prisma Decimal / string / number / null into a plain number (or null). */
export function toNumber(
  value: { toString(): string } | number | string | null | undefined,
): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

/** Empty strings from forms become null so optional DB columns stay clean. */
export function emptyToNull<T extends string | null | undefined>(value: T): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatAddress(p: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
}) {
  const street = [p.addressLine1, p.addressLine2].filter(Boolean).join(", ");
  const locality = [p.suburb, p.state, p.postcode].filter(Boolean).join(" ");
  return [street, locality].filter(Boolean).join(", ");
}

export function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Normalise an Australian phone number for display: 0412 345 678 / (03) 9123 4567 / 1300 123 456. */
export function formatPhoneAU(raw: string | null | undefined): string {
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("61") && digits.length === 11) digits = `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith("04")) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10 && /^0[2378]/.test(digits)) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }
  if (digits.length === 10 && /^1[38]00/.test(digits)) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return raw.trim();
}

/** Digits-only form used for dedupe and search. */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("61") && digits.length === 11) digits = `0${digits.slice(2)}`;
  return digits || null;
}

export function appUrl(path = "") {
  const base = process.env.APP_URL ?? process.env.AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path}`;
}
