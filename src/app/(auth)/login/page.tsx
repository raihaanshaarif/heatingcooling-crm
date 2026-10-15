import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Snowflake } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { homePathFor } from "@/lib/permissions";
import { db } from "@/lib/db";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(homePathFor(user.role));
  const { callbackUrl } = await searchParams;
  const settings = await db.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { businessName: true },
  });
  return (
    <div className="bg-muted/40 flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-sky-500 text-white">
            <Snowflake className="size-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">CoolOps</h1>
          <p className="text-muted-foreground text-sm">
            {settings?.businessName ?? "Cooling Service Melbourne"}
          </p>
        </div>
        <LoginForm callbackUrl={callbackUrl} />
      </div>
    </div>
  );
}
