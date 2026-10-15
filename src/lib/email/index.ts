import "server-only";
import type { ReactElement } from "react";
import { Resend } from "resend";

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  react: ReactElement;
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  skipped?: boolean;
  error?: string;
}

let client: Resend | null = null;

/**
 * Send a transactional email through Resend. When RESEND_API_KEY is not set (local
 * dev, CI) the email is logged to the console instead, so every flow still works.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "CoolOps <onboarding@resend.dev>";
  if (!apiKey) {
    console.info(
      `[email:dev] To: ${[input.to].flat().join(", ")} | Subject: ${input.subject} (RESEND_API_KEY not set, not sent)`,
    );
    return { ok: true, skipped: true };
  }
  client ??= new Resend(apiKey);
  try {
    const { data, error } = await client.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      react: input.react,
      replyTo: input.replyTo,
    });
    if (error) {
      console.error("[email] send failed", error);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (error) {
    console.error("[email] send failed", error);
    return { ok: false, error: error instanceof Error ? error.message : "Unknown email error" };
  }
}

/** Replace {{placeholders}} in admin-editable email templates. */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}
