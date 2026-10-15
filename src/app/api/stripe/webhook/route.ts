import { NextResponse } from "next/server";
import { isStripeConfigured } from "@/lib/payments/stripe";

export const runtime = "nodejs";

/**
 * Phase 2: Stripe webhook.
 *
 * TODO(Phase 2):
 *  1. Verify the signature: stripe.webhooks.constructEvent(rawBody, req.headers.get("stripe-signature"), STRIPE_WEBHOOK_SECRET).
 *  2. On `checkout.session.completed` / `payment_intent.succeeded`, read metadata.invoiceId and, in a transaction,
 *     create a Payment { method: "CARD", amountCents, stripePaymentIntentId } (unique → idempotent),
 *     then recalcInvoice(tx, invoiceId), logActivity and notifyRoles(["ADMIN", "OFFICE"]).
 *  3. On `charge.refunded`, record a negative Payment.
 */
export async function POST() {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET." },
      { status: 501 },
    );
  }
  return NextResponse.json(
    { error: "Stripe webhook handling is planned for Phase 2." },
    { status: 501 },
  );
}
