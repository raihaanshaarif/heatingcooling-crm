import type { EmailTemplateKey } from "@/lib/validations/settings";

export interface EmailTemplate {
  subject: string;
  body: string;
}

/** Defaults for the admin-editable templates (Settings → Email templates). */
export const DEFAULT_EMAIL_TEMPLATES: Record<EmailTemplateKey, EmailTemplate> = {
  quoteSent: {
    subject: "Your quote {{number}} from {{businessName}}",
    body: 'Hi {{clientName}},\n\nThanks for the opportunity to quote. Your quote {{number}} for "{{title}}" is ready ({{total}} inc GST).\n\nYou can view the options and accept online using the button below.',
  },
  invoiceSent: {
    subject: "Invoice {{number}} from {{businessName}}",
    body: "Hi {{clientName}},\n\nPlease find your invoice {{number}} for {{total}} inc GST. The balance of {{balance}} is due by {{dueDate}}.",
  },
  invoiceOverdue: {
    subject: "Reminder: invoice {{number}} is overdue",
    body: "Hi {{clientName}},\n\nThis is a friendly reminder that invoice {{number}} was due on {{dueDate}} and {{balance}} is still outstanding.\n\nIf you've already paid, thank you, and please ignore this email.",
  },
  serviceDue: {
    subject: "Your {{planName}} is due",
    body: "Hi {{clientName}},\n\nYour {{planName}} is due on {{dueDate}}. Regular servicing keeps your system efficient, reliable and within warranty.\n\nReply to this email or give us a call and we'll lock in a time that suits you.",
  },
};

export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateKey, string> = {
  quoteSent: "Quote sent",
  invoiceSent: "Invoice sent",
  invoiceOverdue: "Invoice overdue reminder",
  serviceDue: "Service due reminder",
};

export const EMAIL_TEMPLATE_VARIABLES: Record<EmailTemplateKey, string[]> = {
  quoteSent: ["clientName", "number", "title", "total", "businessName"],
  invoiceSent: ["clientName", "number", "total", "balance", "dueDate", "businessName"],
  invoiceOverdue: ["clientName", "number", "balance", "dueDate", "daysOverdue", "businessName"],
  serviceDue: ["clientName", "planName", "dueDate", "businessName"],
};

export function resolveTemplates(stored: unknown): Record<EmailTemplateKey, EmailTemplate> {
  const result = { ...DEFAULT_EMAIL_TEMPLATES };
  if (stored && typeof stored === "object") {
    for (const key of Object.keys(DEFAULT_EMAIL_TEMPLATES) as EmailTemplateKey[]) {
      const value = (stored as Record<string, unknown>)[key];
      if (value && typeof value === "object") {
        const t = value as Partial<EmailTemplate>;
        result[key] = {
          subject: t.subject || DEFAULT_EMAIL_TEMPLATES[key].subject,
          body: t.body || DEFAULT_EMAIL_TEMPLATES[key].body,
        };
      }
    }
  }
  return result;
}
