import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";
import { canViewPath, homePathFor } from "@/lib/permissions";

const PUBLIC_PREFIXES = [
  "/login",
  "/q/",
  "/i/",
  "/api/auth",
  "/api/leads/webhook",
  "/api/cron",
  "/api/stripe",
  "/api/public",
];

export function isPublicPath(pathname: string) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * Edge-safe Auth.js config (no Prisma, no bcrypt). Used by middleware for route
 * protection and extended in lib/auth/index.ts with the adapter and providers.
 */
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: Role }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      if (token.role) session.user.role = token.role as Role;
      return session;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (isPublicPath(pathname)) return true;
      const user = auth?.user;
      if (!user?.id || !user.role) return false; // → redirect to /login
      const sessionUser = { id: user.id, role: user.role };
      if (pathname === "/")
        return Response.redirect(new URL(homePathFor(user.role), request.nextUrl));
      if (pathname.startsWith("/api/")) return true; // API routes check permissions themselves
      if (!canViewPath(sessionUser, pathname)) {
        return Response.redirect(new URL(homePathFor(user.role), request.nextUrl));
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
