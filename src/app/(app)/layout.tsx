import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSettings } from "@/server/settings";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandMenu } from "@/components/layout/command-menu";
import { NotificationsBell } from "@/components/layout/notifications-bell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [settings, notifications, unreadCount] = await Promise.all([
    getSettings(),
    db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  const navUser = { id: user.id, role: user.role };
  return (
    <div className="flex min-h-dvh">
      <AppSidebar user={navUser} businessName={settings.businessName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/95 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-3 backdrop-blur md:px-6">
          <MobileNav user={navUser} businessName={settings.businessName} />
          <div className="flex-1">
            <CommandMenu user={navUser} />
          </div>
          <NotificationsBell notifications={notifications} unreadCount={unreadCount} />
          <ThemeToggle />
          <UserMenu user={user} />
        </header>
        <main className="flex-1 px-3 py-4 md:px-6 md:py-6">{children}</main>
      </div>
    </div>
  );
}
