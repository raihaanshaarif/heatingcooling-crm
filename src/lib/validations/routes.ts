import { z } from "zod";
import { optionalText } from "./common";

export const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

const totals = z.object({ km: z.number().min(0), minutes: z.number().int().min(0) });

export const applyRoutePlanSchema = z.object({
  technicianId: z.string().min(1),
  day: dayString,
  provider: z.enum(["google", "estimate"]),
  before: totals,
  after: totals,
  jobs: z
    .array(
      z
        .object({
          id: z.string().min(1),
          /** The job's start when the plan was made: refuse if it has moved since. */
          from: z.coerce.date(),
          start: z.coerce.date(),
          end: z.coerce.date(),
        })
        .refine((v) => v.end > v.start, { message: "End must be after start" }),
    )
    .min(1, "Nothing to change")
    .max(50),
});
export type ApplyRoutePlanInput = z.input<typeof applyRoutePlanSchema>;

export const routeStartSchema = z
  .object({
    userId: z.string().min(1),
    routeFromHome: z.boolean().default(false),
    homeAddress: optionalText(300),
  })
  .refine((v) => !v.routeFromHome || !!v.homeAddress, {
    message: "Enter the home address",
    path: ["homeAddress"],
  });
export type RouteStartInput = z.input<typeof routeStartSchema>;
