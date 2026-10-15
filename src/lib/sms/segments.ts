/**
 * SMS length and segment counting. Plain GSM-7 messages fit 160 characters in one SMS
 * (153 per part when split); a single emoji or other non-GSM character switches the
 * whole message to UCS-2, where one SMS holds only 70 characters (67 per part).
 * Providers bill per segment, so the office sees this count while writing.
 */
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "\f^{}\\[~]|€"; // each takes two septets

const BASIC = new Set(GSM_BASIC);
const EXTENDED = new Set(GSM_EXTENDED);

export type SmsEncoding = "GSM-7" | "UCS-2";

export interface SegmentInfo {
  encoding: SmsEncoding;
  /** Length as the network counts it: septets for GSM-7, UTF-16 units for UCS-2. */
  length: number;
  segments: number;
  /** Characters per segment for this message (160/153 or 70/67). */
  perSegment: number;
  /** Characters left before the next segment starts. */
  remaining: number;
  /** Characters that forced UCS-2 (e.g. emoji), de-duplicated. */
  unicodeChars: string[];
}

export function countSegments(text: string): SegmentInfo {
  let septets = 0;
  const unicode = new Set<string>();
  for (const ch of text) {
    if (BASIC.has(ch)) septets += 1;
    else if (EXTENDED.has(ch)) septets += 2;
    else unicode.add(ch);
  }
  if (unicode.size === 0) {
    const segments = septets === 0 ? 0 : septets <= 160 ? 1 : Math.ceil(septets / 153);
    const perSegment = segments > 1 ? 153 : 160;
    return {
      encoding: "GSM-7",
      length: septets,
      segments,
      perSegment,
      remaining: segments === 0 ? 160 : segments * perSegment - septets,
      unicodeChars: [],
    };
  }
  const units = text.length; // UTF-16 code units, which is what UCS-2 counts
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  const perSegment = segments > 1 ? 67 : 70;
  return {
    encoding: "UCS-2",
    length: units,
    segments,
    perSegment,
    remaining: segments * perSegment - units,
    unicodeChars: [...unicode],
  };
}

const chars = (...codes: number[]) => new RegExp(`[${String.fromCharCode(...codes)}]`, "g");

// Curly quotes, primes, dashes, ellipsis, non-breaking spaces, middle dot.
const REPLACEMENTS: [RegExp, string][] = [
  [chars(0x2018, 0x2019, 0x201a, 0x2032), "'"],
  [chars(0x201c, 0x201d, 0x201e, 0x2033), '"'],
  [chars(0x2013, 0x2014, 0x2212), "-"],
  [chars(0x2026), "..."],
  [chars(0x00a0, 0x2007, 0x202f), " "],
  [chars(0x00b7), "-"],
];

/**
 * Swap "smart" punctuation (curly quotes, dashes, ellipsis, non-breaking spaces) for
 * plain GSM characters so a template pasted from Word doesn't silently cost 2-3× as
 * much. Also trims and collapses runs of 3+ blank lines.
 */
export function normaliseSmsText(text: string): string {
  let out = text;
  for (const [re, to] of REPLACEMENTS) out = out.replace(re, to);
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function describeSegments(info: SegmentInfo): string {
  const parts = `${info.segments} SMS`;
  return `${info.length} character${info.length === 1 ? "" : "s"} · ${parts}${info.encoding === "UCS-2" ? " (unicode)" : ""}`;
}
