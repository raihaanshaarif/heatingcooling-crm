"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { markAllNotificationsRead, markNotificationRead } from "@/server/notifications/actions";

export interface BellNotification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export function NotificationsBell({
  notifications,
  unreadCount,
}: {
  notifications: BellNotification[];
  unreadCount: number;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications (${unreadCount} unread)`}
        >
          <Bell />
          {unreadCount > 0 && (
            <span className="bg-destructive absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Notifications</p>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || unreadCount === 0}
            onClick={() => startTransition(async () => void (await markAllNotificationsRead()))}
          >
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {notifications.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center text-sm">
              You&apos;re all caught up.
            </p>
          ) : (
            <ul className="divide-y">
              {notifications.map((n) => {
                const content = (
                  <div className={cn("px-3 py-2.5 text-sm", !n.readAt && "bg-sky-500/5")}>
                    <div className="flex items-start gap-2">
                      {!n.readAt && (
                        <span
                          className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-500"
                          aria-label="Unread"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium">{n.title}</p>
                        {n.body && (
                          <p className="text-muted-foreground line-clamp-2 text-xs">{n.body}</p>
                        )}
                        <p className="text-muted-foreground mt-0.5 text-[11px]">
                          {formatDateTime(n.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
                const markRead = () => {
                  if (!n.readAt)
                    startTransition(async () => void (await markNotificationRead({ id: n.id })));
                };
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link href={n.link} onClick={markRead} className="hover:bg-muted/60 block">
                        {content}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={markRead}
                        className="hover:bg-muted/60 block w-full text-left"
                      >
                        {content}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
