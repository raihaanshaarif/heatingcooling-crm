import "server-only";

/**
 * Phase 2: Stripe card payments.
 *
 * Plan: when an invoice is sent, create a Stripe Payment Link (or Checkout Session)
 * for the balance, store it on Invoice.stripePaymentLinkUrl, and show a "Pay now"
 * button on /i/[token]. The webhook (/api/stripe/webhook) records a Payment with
 * method CARD and stripePaymentIntentId (unique, so retries are idempotent), then
 * recalculates the invoice with recalcInvoice().
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET. Install with `pnpm add stripe`.
 */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
}

export interface PaymentLinkRequest {
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  customerEmail?: string | null;
}

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is planned for Phase 2 and not implemented yet.`);
    this.name = "NotImplementedError";
  }
}

// TODO(Phase 2): implement with the Stripe SDK:
//   const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
//   const price = await stripe.prices.create({ currency: "aud", unit_amount: amountCents, product_data: { name: `Invoice ${invoiceNumber}` } });
//   const link = await stripe.paymentLinks.create({ line_items: [{ price: price.id, quantity: 1 }], metadata: { invoiceId } });
//   return link.url;
export async function createPaymentLink(_request: PaymentLinkRequest): Promise<string> {
  throw new NotImplementedError("Stripe payment links");
}
