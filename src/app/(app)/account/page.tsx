import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { DetailList } from "@/components/shared/detail-list";
import { ChangePasswordForm } from "@/components/team/change-password-form";
import { MyCalendarCard } from "@/components/google-calendar/my-calendar-card";
import { getMyCalendarStatus } from "@/server/google-calendar/queries";

export const metadata: Metadata = { title: "My account" };

const GOOGLE_MESSAGES: Record<string, string> = {
  connected: "Google Calendar is connected. Your upcoming jobs are being added now.",
  "not-set-up":
    "Google Calendar isn't set up on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; reason?: string }>;
}) {
  const user = await requireUser();
  const { google, reason } = await searchParams;
  const calendar = await getMyCalendarStatus(user.id);
  const banner =
    google === "error"
      ? { error: true, text: `Couldn't connect Google Calendar: ${reason ?? "unknown error"}` }
      : google && GOOGLE_MESSAGES[google]
        ? { error: google !== "connected", text: GOOGLE_MESSAGES[google] }
        : null;
  return (
    <>
      <PageHeader title="My account" />
      {banner && (
        <p
          role="status"
          data-testid="google-banner"
          className={
            banner.error
              ? "border-destructive/40 text-destructive mb-4 max-w-3xl rounded-md border px-3 py-2 text-sm"
              : "mb-4 max-w-3xl rounded-md border border-emerald-500/40 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
          }
        >
          {banner.text}
        </p>
      )}
      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Name", value: user.name },
                { label: "Email", value: user.email },
                { label: "Role", value: ROLE_LABELS[user.role] },
              ]}
            />
            <p className="text-muted-foreground mt-3 text-xs">
              Ask an admin to change your name, email or role.
            </p>
          </CardContent>
        </Card>
        <MyCalendarCard status={calendar} />
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
