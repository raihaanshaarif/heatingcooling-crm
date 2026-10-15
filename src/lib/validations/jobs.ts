import { z } from "zod";
import { ItemType, JobStatus, JobType, Priority, ServiceCategory } from "@prisma/client";
import {
  idList,
  money,
  optionalDateTime,
  optionalDecimal,
  optionalId,
  optionalInt,
  optionalText,
  quantity,
  requiredDateTime,
  requiredText,
} from "./common";

export const jobSchema = z
  .object({
    clientId: z.string().min(1, "Choose a client"),
    propertyId: optionalId,
    quoteId: optionalId,
    maintenancePlanId: optionalId,
    type: z.nativeEnum(JobType),
    priority: z.nativeEnum(Priority).default("NORMAL"),
    serviceCategory: z
      .nativeEnum(ServiceCategory)
      .nullish()
      .transform((v) => v ?? null),
    title: requiredText("Title"),
    description: optionalText(5000),
    scheduledStart: optionalDateTime,
    scheduledEnd: optionalDateTime,
    estimatedMinutes: optionalInt("Estimated minutes"),
    assigneeIds: idList,
    equipmentIds: idList,
    applyChecklist: z.boolean().default(true),
  })
  .refine((v) => !v.scheduledStart || !v.scheduledEnd || v.scheduledEnd > v.scheduledStart, {
    message: "End must be after start",
    path: ["scheduledEnd"],
  });
export type JobInput = z.input<typeof jobSchema>;

export const jobStatusSchema = z
  .object({
    id: z.string().min(1),
    status: z.nativeEnum(JobStatus),
    onHoldReason: optionalText(500),
  })
  .refine((v) => v.status !== "ON_HOLD" || !!v.onHoldReason, {
    message: "Say why the job is on hold",
    path: ["onHoldReason"],
  });

export const jobCompletionSchema = z.object({
  id: z.string().min(1),
  completionNotes: optionalText(10000),
  refrigerantRecoveredKg: optionalDecimal("Refrigerant recovered"),
  refrigerantAddedKg: optionalDecimal("Refrigerant added"),
  gasComplianceCertNumber: optionalText(50),
  signedByName: optionalText(200),
});
export type JobCompletionInput = z.input<typeof jobCompletionSchema>;

export const jobLineItemSchema = z.object({
  jobId: z.string().min(1),
  priceBookItemId: optionalId,
  type: z.nativeEnum(ItemType),
  description: requiredText("Description", 1000),
  quantity,
  unitPrice: money("Unit price"),
  unitCost: money("Unit cost").optional(),
  taxable: z.boolean().default(true),
});
export type JobLineItemInput = z.input<typeof jobLineItemSchema>;

export const timeEntrySchema = z
  .object({
    jobId: z.string().min(1),
    userId: optionalId,
    startedAt: requiredDateTime("Start"),
    endedAt: optionalDateTime,
    note: optionalText(1000),
  })
  .refine((v) => !v.endedAt || v.endedAt > v.startedAt, {
    message: "End must be after start",
    path: ["endedAt"],
  });
export type TimeEntryInput = z.input<typeof timeEntrySchema>;

export const checklistToggleSchema = z.object({
  itemId: z.string().min(1),
  checked: z.boolean(),
  note: optionalText(1000),
});

export const checklistAddSchema = z.object({
  jobId: z.string().min(1),
  label: requiredText("Item", 200),
});

export const rescheduleSchema = z
  .object({
    id: z.string().min(1),
    start: z.coerce.date(),
    end: z.coerce.date(),
    technicianId: optionalId,
  })
  .refine((v) => v.end > v.start, { message: "End must be after start", path: ["end"] });

export const assignSchema = z.object({ id: z.string().min(1), assigneeIds: idList });
export const linkEquipmentSchema = z.object({ id: z.string().min(1), equipmentIds: idList });
export const jobNoteSchema = z.object({ id: z.string().min(1), body: requiredText("Note", 5000) });
export const signatureSchema = z.object({
  id: z.string().min(1),
  signedByName: requiredText("Name", 200),
  dataUrl: z
    .string()
    .startsWith("data:image/png;base64,", "Invalid signature")
    .max(2_000_000, "Signature image is too large"),
});
