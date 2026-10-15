import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileText,
  Gauge,
  History,
  Plug,
  Receipt,
  Settings,
  Smartphone,
  Users,
  UserPlus,
  Wind,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { Resource } from "@/lib/permissions";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  resource: Resource;
  /** Hide from roles that can see the resource but should not get the menu item. */
  roles?: ("ADMIN" | "OFFICE" | "TECHNICIAN")[];
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Work",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: Gauge, resource: "dashboard" },
      { title: "My jobs", href: "/my-jobs", icon: Smartphone, resource: "myJobs" },
      { title: "Leads", href: "/leads", icon: UserPlus, resource: "leads" },
      { title: "Clients", href: "/clients", icon: Building2, resource: "clients" },
      { title: "Equipment", href: "/equipment", icon: Wind, resource: "clients" },
      { title: "Quotes", href: "/quotes", icon: FileText, resource: "quotes" },
      { title: "Jobs", href: "/jobs", icon: Wrench, resource: "schedule" },
      { title: "Schedule", href: "/schedule", icon: CalendarDays, resource: "schedule" },
      { title: "Maintenance", href: "/maintenance", icon: ClipboardList, resource: "maintenance" },
    ],
  },
  {
    label: "Money",
    items: [
      { title: "Invoices", href: "/invoices", icon: Receipt, resource: "invoices" },
      { title: "Payments", href: "/payments", icon: CreditCard, resource: "payments" },
      { title: "Reports", href: "/reports", icon: BarChart3, resource: "reports" },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Price book", href: "/price-book", icon: BookOpen, resource: "priceBook" },
      { title: "Team", href: "/team", icon: Users, resource: "team" },
      { title: "Settings", href: "/settings", icon: Settings, resource: "settings" },
      { title: "Audit log", href: "/audit-log", icon: History, resource: "auditLog" },
      { title: "Integrations", href: "/integrations", icon: Plug, resource: "settings" },
    ],
  },
];
