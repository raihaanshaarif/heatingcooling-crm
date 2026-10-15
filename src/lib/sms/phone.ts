/**
 * Australian phone numbers → E.164 for SMS. Only mobiles (04xx xxx xxx) can receive
 * texts; landlines, 13/1300/1800 numbers and anything else are rejected with a reason
 * that is shown to the office and stored on the SMS log.
 */
export type PhoneCheck = { ok: true; e164: string } | { ok: false; reason: string };

export const NO_PHONE_REASON = "No phone number on file";

export function normaliseAuMobile(raw: string | null | undefined): PhoneCheck {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, reason: NO_PHONE_REASON };
  if (/[a-z]/i.test(input.replace(/\bext\b.*$/i, ""))) {
    return { ok: false, reason: `“${input}” is not a phone number` };
  }
  const hasPlus = input.startsWith("+");
  let digits = input.replace(/\D/g, "");
  if (!digits) return { ok: false, reason: `“${input}” is not a phone number` };

  // International forms: +61 4…, 0061 4…, 61 4… (also "+61 (0)4…").
  if (hasPlus || digits.startsWith("00")) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (!digits.startsWith("61")) {
      return { ok: false, reason: "Not an Australian number (only +61 numbers are texted)" };
    }
    digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
  } else if (digits.startsWith("61") && digits.length === 11) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  } else if (/^(13|1300|1800)/.test(digits)) {
    return { ok: false, reason: "13 / 1300 / 1800 numbers can't receive texts" };
  }

  // `digits` is now the 9-digit national significant number.
  if (/^4\d{8}$/.test(digits)) return { ok: true, e164: `+61${digits}` };
  if (/^[2378]\d{8}$/.test(digits))
    return { ok: false, reason: "Landline number, can't receive texts" };
  if (/^(13|1300|1800)/.test(digits)) {
    return { ok: false, reason: "13 / 1300 / 1800 numbers can't receive texts" };
  }
  if (/^\d{8}$/.test(digits) && digits === input.replace(/\D/g, "")) {
    return { ok: false, reason: "Landline number without area code, can't receive texts" };
  }
  return { ok: false, reason: "Not a valid Australian mobile number" };
}

/** Pretty-print an E.164 AU mobile for people: +61412345678 → 0412 345 678. */
export function formatAuMobile(e164: string): string {
  const m = /^\+614(\d{2})(\d{3})(\d{3})$/.exec(e164);
  return m ? `04${m[1]} ${m[2]} ${m[3]}` : e164;
}

/**
 * Pick the first number that can receive a text from a list of candidates (client
 * phone, alt phone, primary contact…). When none can, returns the reason for the
 * first number that was actually filled in.
 */
export function pickMobile(
  candidates: (string | null | undefined)[],
): { ok: true; e164: string; raw: string } | { ok: false; reason: string; raw: string | null } {
  let firstFailure: { reason: string; raw: string } | null = null;
  for (const raw of candidates) {
    if (!raw?.trim()) continue;
    const check = normaliseAuMobile(raw);
    if (check.ok) return { ok: true, e164: check.e164, raw };
    firstFailure ??= { reason: check.reason, raw };
  }
  return firstFailure
    ? { ok: false, reason: firstFailure.reason, raw: firstFailure.raw }
    : { ok: false, reason: NO_PHONE_REASON, raw: null };
}
