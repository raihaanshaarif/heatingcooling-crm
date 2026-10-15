"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { sendSmsSchema } from "@/lib/validations/settings";
import { NotFoundError, UserError, runAction } from "@/server/action";
import { audit } from "@/server/audit";
import { OPTED_OUT_REASON, describeSmsResult, sendClientSms, smsRecipient } from "./service";

/** Office / admin: send a one-off text to a client from the client or job page. */
export async function sendOneOffSms(input: z.input<typeof sendSmsSchema>) {
  return runAction(
    { schema: sendSmsSchema, permission: ["create", "sms"] },
    input,
    async ({ clientId, jobId, body }, user) => {
      const client = await db.client.findFirst({
        where: { id: clientId, deletedAt: null },
        select: {
          id: true,
          type: true,
          name: true,
          phone: true,
          altPhone: true,
          noSms: true,
          contacts: {
            select: { name: true, phone: true, isPrimary: true },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          },
        },
      });
      if (!client) throw new NotFoundError("Client");
      if (client.noSms)
        throw new UserError(`${OPTED_OUT_REASON}. Untick No SMS on the client to text them.`);
      const recipient = smsRecipient(client);
      if (!recipient.ok) throw new UserError(`Can't text ${client.name}: ${recipient.reason}.`);
      if (jobId) {
        const job = await db.job.findFirst({ where: { id: jobId, clientId, deletedAt: null } });
        if (!job) throw new NotFoundError("Job");
      }
      const result = await sendClientSms({
        kind: "MANUAL",
        clientId,
        jobId: jobId ?? null,
        body,
        sentById: user.id,
      });
      await audit(db, {
        userId: user.id,
        action: "SMS",
        entityType: jobId ? "JOB" : "CLIENT",
        entityId: jobId ?? clientId,
        changes: { smsId: result.id, status: result.status, to: result.to },
      });
      revalidatePath(`/clients/${clientId}`);
      if (jobId) revalidatePath(`/jobs/${jobId}`);
      if (result.status === "FAILED") throw new UserError(describeSmsResult(result)!);
      return { status: result.status, message: describeSmsResult(result)! };
    },
  );
}
