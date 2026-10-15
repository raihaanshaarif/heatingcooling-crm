import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { can, homePathFor, type Action, type Resource } from "@/lib/permissions";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  color: string;
}

/** The signed-in user, re-read from the database so role changes and deactivation apply immediately. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, color: true, active: true },
  });
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, color: user.color };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: send the user home when they lack permission. */
export async function requirePermission(action: Action, resource: Resource): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, action, resource)) redirect(homePathFor(user.role));
  return user;
}
