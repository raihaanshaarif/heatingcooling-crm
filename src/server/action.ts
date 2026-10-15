import "server-only";
import { unstable_rethrow } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getCurrentUser, type SessionUser } from "@/lib/auth/session";
import { ForbiddenError, can, type Action, type Resource } from "@/lib/permissions";

export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/** An error whose message is safe to show to the user. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export class NotFoundError extends UserError {
  constructor(what = "Record") {
    super(`${what} not found.`);
    this.name = "NotFoundError";
  }
}

interface ActionConfig<S extends z.ZodTypeAny> {
  schema: S;
  permission?: [Action, Resource];
}

/**
 * Every server action goes through here: authenticate, check permission, validate
 * with Zod, run, and turn errors into a typed result the client can show.
 */
export async function runAction<S extends z.ZodTypeAny, T>(
  config: ActionConfig<S>,
  input: unknown,
  handler: (data: z.output<S>, user: SessionUser) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "Your session has expired. Please sign in again." };
    if (config.permission && !can(user, config.permission[0], config.permission[1])) {
      throw new ForbiddenError();
    }
    const parsed = config.schema.safeParse(input);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      return {
        ok: false,
        error: flat.formErrors[0] ?? "Please fix the highlighted fields.",
        fieldErrors: flat.fieldErrors as Record<string, string[] | undefined>,
      };
    }
    const data = await handler(parsed.data, user);
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error); // let redirect() / notFound() through
    return toErrorResult(error);
  }
}

export function toErrorResult(error: unknown): { ok: false; error: string } {
  if (error instanceof UserError || error instanceof ForbiddenError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      const target = (error.meta?.target as string[] | undefined)?.join(", ");
      return { ok: false, error: `That ${target ?? "value"} is already in use.` };
    }
    if (error.code === "P2025") return { ok: false, error: "Record not found." };
    if (error.code === "P2003")
      return { ok: false, error: "This record is linked to other records and cannot be changed." };
  }
  console.error("[action] unexpected error", error);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Schema for actions that only take an id. */
export const idSchema = z.object({ id: z.string().min(1) });
