import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { formatPhoneAU, appUrl } from "@/lib/utils";
import { LEAD_SOURCE_LABELS, SERVICE_CATEGORY_LABELS } from "@/lib/labels";
import { mapServiceCategory, webhookLeadSchema } from "@/lib/validations/leads";
import { sendEmail } from "@/lib/email";
import NewLeadAlertEmail from "@/emails/new-lead-alert";
import { createLeadRecord, findRecentDuplicate } from "@/server/leads/service";
import { logActivity } from "@/server/audit";
import { getSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (process.env.LEAD_WEBHOOK_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-api-key",
  };
}

function validKey(provided: string | null): boolean {
  const expected = process.env.LEAD_WEBHOOK_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

/** The sending site's host name when the form posts from the browser (Origin / Referer). */
function siteFromHeaders(req: Request): string | null {
  const raw = req.headers.get("origin") ?? req.headers.get("referer");
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Public lead intake for the website contact form.
 * POST JSON with header `x-api-key: $LEAD_WEBHOOK_SECRET`. See README for a curl example.
 */
export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get("origin"));
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const limit = rateLimit(`lead-webhook:${ip}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { ...headers, "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      },
    );
  }
  if (!validKey(req.headers.get("x-api-key"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401, headers });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400, headers });
  }
  const parsed = webhookLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid lead", details: parsed.error.flatten().fieldErrors },
      { status: 422, headers },
    );
  }
  const d = parsed.data;
  if (d.website) return NextResponse.json({ ok: true }, { status: 200, headers }); // honeypot: pretend success

  const site = d.site || siteFromHeaders(req);
  const email = d.email ? d.email : null;
  const phone = d.phone ? formatPhoneAU(d.phone) : null;

  const duplicate = await findRecentDuplicate(email, phone, new Date(Date.now() - 24 * 3600_000));
  if (duplicate) {
    await logActivity(db, {
      entityType: "LEAD",
      entityId: duplicate.id,
      type: "SYSTEM",
      body: `Duplicate website enquiry received${site ? ` from ${site}` : ""}${d.message ? `:\n${d.message}` : ""}`,
    });
    return NextResponse.json(
      { ok: true, id: duplicate.id, duplicate: true },
      { status: 200, headers },
    );
  }

  const serviceCategory = mapServiceCategory(d.service);
  const isGoogleAds =
    !!d.gclid ||
    (d.utm_source?.toLowerCase() === "google" && d.utm_medium?.toLowerCase() === "cpc");
  const lead = await db.$transaction((tx) =>
    createLeadRecord(
      tx,
      {
        name: d.name,
        email,
        phone,
        suburb: d.suburb || null,
        postcode: d.postcode || null,
        source: isGoogleAds
          ? "GOOGLE_ADS"
          : d.utm_source?.toLowerCase().includes("facebook")
            ? "FACEBOOK"
            : "WEBSITE",
        sourceDetail: site,
        serviceCategory,
        brand: d.brand || null,
        message:
          [d.service && !serviceCategory ? `Service: ${d.service}` : null, d.message]
            .filter(Boolean)
            .join("\n") || null,
        urgency: serviceCategory === "EMERGENCY_REPAIR" ? "EMERGENCY" : "NORMAL",
        utmSource: d.utm_source || null,
        utmMedium: d.utm_medium || null,
        utmCampaign: d.utm_campaign || null,
        gclid: d.gclid || null,
      },
      null,
    ),
  );

  const [settings, recipients] = await Promise.all([
    getSettings(),
    db.user.findMany({
      where: { active: true, role: { in: ["ADMIN", "OFFICE"] } },
      select: { email: true },
    }),
  ]);
  if (recipients.length > 0) {
    await sendEmail({
      to: recipients.map((r) => r.email),
      subject: `New lead: ${lead.name}${lead.suburb ? ` (${lead.suburb})` : ""}`,
      react: NewLeadAlertEmail({
        business: settings,
        leadName: lead.name,
        phone: lead.phone,
        email: lead.email,
        suburb: lead.suburb,
        service: serviceCategory ? SERVICE_CATEGORY_LABELS[serviceCategory] : d.service,
        message: lead.message,
        source: LEAD_SOURCE_LABELS[lead.source],
        link: appUrl(`/leads/${lead.id}`),
      }),
    });
  }
  return NextResponse.json({ ok: true, id: lead.id }, { status: 201, headers });
}
