"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Snowflake } from "lucide-react";
import type { Role } from "@prisma/client";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { NAV_GROUPS } from "./nav-items";

export function SidebarNav({
  user,
  onNavigate,
}: {
  user: { id: string; role: Role };
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-5 px-3 py-4" aria-label="Main">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter(
          (item) =>
            can(user, "view", item.resource) && (!item.roles || item.roles.includes(user.role)),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.label} className="flex flex-col gap-0.5">
            <p className="text-muted-foreground px-2 pb-1 text-xs font-medium">{group.label}</p>
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.title}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

export function SidebarBrand({ businessName }: { businessName: string }) {
  return (
    <Link href="/" className="flex h-14 items-center gap-2 border-b px-4">
      <div className="flex size-8 items-center justify-center rounded-lg bg-sky-500 text-white">
        <Snowflake className="size-4.5" />
      </div>
      <div className="min-w-0 leading-tight">
        <p className="text-sm font-semibold">CoolOps</p>
        <p className="text-muted-foreground truncate text-xs">{businessName}</p>
      </div>
    </Link>
  );
}

export function AppSidebar({
  user,
  businessName,
}: {
  user: { id: string; role: Role };
  businessName: string;
}) {
  return (
    <aside className="bg-sidebar text-sidebar-foreground sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r md:flex">
      <SidebarBrand businessName={businessName} />
      <div className="flex-1 overflow-y-auto">
        <SidebarNav user={user} />
      </div>
    </aside>
  );
}
