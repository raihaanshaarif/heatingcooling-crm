"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, FileText, Loader2, Receipt, Search, UserPlus, Wrench } from "lucide-react";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { can } from "@/lib/permissions";
import { globalSearch, type SearchResult } from "@/server/search/actions";
import { NAV_GROUPS } from "./nav-items";

const TYPE_ICON = {
  client: Building2,
  lead: UserPlus,
  job: Wrench,
  quote: FileText,
  invoice: Receipt,
} as const;
const TYPE_LABEL = {
  client: "Clients",
  lead: "Leads",
  job: "Jobs",
  quote: "Quotes",
  invoice: "Invoices",
} as const;

export function CommandMenu({ user }: { user: { id: string; role: Role } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => setResults(await globalSearch(query)));
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const pages = NAV_GROUPS.flatMap((g) => g.items).filter((i) => can(user, "view", i.resource));
  const quickActions = [
    { label: "New lead", href: "/leads?new=1", ok: can(user, "create", "leads") },
    { label: "New client", href: "/clients?new=1", ok: can(user, "create", "clients") },
    { label: "New quote", href: "/quotes/new", ok: can(user, "create", "quotes") },
    { label: "New job", href: "/jobs?new=1", ok: can(user, "create", "jobs") },
    { label: "New invoice", href: "/invoices/new", ok: can(user, "create", "invoices") },
  ].filter((a) => a.ok);
  const grouped = (Object.keys(TYPE_LABEL) as SearchResult["type"][])
    .map((type) => ({ type, items: results.filter((r) => r.type === type) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <Button
        variant="outline"
        className="text-muted-foreground h-9 w-full max-w-sm justify-start gap-2 px-3 font-normal"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" />
        <span className="truncate">Search clients, jobs, invoices…</span>
        <kbd className="bg-muted ml-auto hidden rounded px-1.5 font-mono text-[10px] sm:inline">
          Ctrl K
        </kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search clients, leads, jobs, quotes and invoices"
        shouldFilter={false}
      >
        <CommandInput
          placeholder="Name, number, phone or email…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {pending && (
            <div className="text-muted-foreground flex items-center gap-2 px-4 py-3 text-sm">
              <Loader2 className="size-4 animate-spin" /> Searching…
            </div>
          )}
          {query.trim().length >= 2 && !pending && results.length === 0 && (
            <CommandEmpty>No matches.</CommandEmpty>
          )}
          {grouped.map((g) => {
            const Icon = TYPE_ICON[g.type];
            return (
              <CommandGroup key={g.type} heading={TYPE_LABEL[g.type]}>
                {g.items.map((r) => (
                  <CommandItem
                    key={`${r.type}-${r.id}`}
                    value={`${r.type}-${r.id}`}
                    onSelect={() => go(r.href)}
                  >
                    <Icon />
                    <div className="min-w-0">
                      <p className="truncate">{r.title}</p>
                      {r.subtitle && (
                        <p className="text-muted-foreground truncate text-xs">{r.subtitle}</p>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
          {query.trim().length < 2 && (
            <>
              {quickActions.length > 0 && (
                <CommandGroup heading="Quick actions">
                  {quickActions.map((a) => (
                    <CommandItem key={a.href} value={a.label} onSelect={() => go(a.href)}>
                      {a.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandSeparator />
              <CommandGroup heading="Go to">
                {pages.map((p) => (
                  <CommandItem key={p.href} value={p.title} onSelect={() => go(p.href)}>
                    <p.icon /> {p.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
