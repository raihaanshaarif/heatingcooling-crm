import type { Role } from "@prisma/client";

export type Action = "view" | "create" | "update" | "delete";

export type Resource =
  | "dashboard"
  | "leads"
  | "clients"
  | "equipment"
  | "quotes"
  | "jobs"
  | "schedule"
  | "myJobs"
  | "invoices"
  | "payments"
  | "maintenance"
  | "priceBook"
  | "priceBookCosts"
  | "inventory"
  | "inventoryCosts"
  | "suppliers"
  | "reports"
  | "team"
  | "users"
  | "settings"
  | "auditLog"
  | "notifications"
  | "sms"
  | "xero"
  | "routes"
  | "prices";

export interface PermissionUser {
  id: string;
  role: Role;
}

const ALL: readonly Action[] = ["view", "create", "update", "delete"];
const READ: readonly Action[] = ["view"];

type Matrix = Record<Role, Partial<Record<Resource, readonly Action[]>>>;

/**
 * Central permission matrix. ADMIN can do everything. OFFICE runs the day to day
 * but cannot manage users, settings, or see costs/margins. TECHNICIAN only works
 * on jobs assigned to them (ownership is checked with canAccessJob) and can only see
 * their own van's stock (from My jobs, read-only).
 */
export const PERMISSIONS: Matrix = {
  ADMIN: {
    dashboard: ALL,
    leads: ALL,
    clients: ALL,
    equipment: ALL,
    quotes: ALL,
    jobs: ALL,
    schedule: ALL,
    myJobs: ALL,
    invoices: ALL,
    payments: ALL,
    maintenance: ALL,
    priceBook: ALL,
    priceBookCosts: ALL,
    inventory: ALL,
    inventoryCosts: ALL,
    suppliers: ALL,
    reports: ALL,
    team: ALL,
    users: ALL,
    settings: ALL,
    auditLog: ALL,
    notifications: ALL,
    sms: ALL,
    xero: ALL,
    routes: ALL,
    prices: ALL,
  },
  OFFICE: {
    dashboard: READ,
    leads: ALL,
    clients: ALL,
    equipment: ALL,
    quotes: ALL,
    jobs: ALL,
    schedule: ALL,
    myJobs: READ,
    invoices: ALL,
    payments: ALL,
    maintenance: ALL,
    priceBook: READ,
    inventory: ["view", "create", "update"], // see and move stock; no costs or stock value
    suppliers: ["view", "create", "update"],
    reports: READ,
    team: READ,
    notifications: ALL,
    sms: ["view", "create"], // send one-off texts and see them on timelines; SMS settings/log are admin
    xero: ["view", "update"], // see an invoice's Xero sync status and click Retry; connect/settings are admin
    routes: ["view", "update"], // plan and apply technicians' routes; set where a technician starts
    prices: READ,
  },
  TECHNICIAN: {
    myJobs: ["view", "update"],
    jobs: ["view", "update"], // own jobs only — see canAccessJob
    equipment: READ, // only on their jobs
    routes: READ, // their own day's "Open in Google Maps" link on My jobs
    notifications: ALL,
  },
};

export function can(
  user: PermissionUser | null | undefined,
  action: Action,
  resource: Resource,
): boolean {
  if (!user) return false;
  const allowed = PERMISSIONS[user.role]?.[resource];
  return allowed?.includes(action) ?? false;
}

/** Technicians may only touch jobs they are assigned to; office and admin see all jobs. */
export function canAccessJob(
  user: PermissionUser | null | undefined,
  job: { assignments: { userId: string }[] },
): boolean {
  if (!user) return false;
  if (user.role === "ADMIN" || user.role === "OFFICE") return true;
  return job.assignments.some((a) => a.userId === user.id);
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function assertCan(
  user: PermissionUser | null | undefined,
  action: Action,
  resource: Resource,
): void {
  if (!can(user, action, resource)) throw new ForbiddenError();
}

/** Route prefix → resource. Used by middleware and the sidebar. Order matters (most specific first). */
export const ROUTE_RESOURCES: { prefix: string; resource: Resource }[] = [
  { prefix: "/dashboard", resource: "dashboard" },
  { prefix: "/leads", resource: "leads" },
  { prefix: "/clients", resource: "clients" },
  { prefix: "/properties", resource: "clients" },
  { prefix: "/equipment", resource: "clients" },
  { prefix: "/quotes", resource: "quotes" },
  { prefix: "/jobs", resource: "schedule" },
  { prefix: "/schedule", resource: "schedule" },
  { prefix: "/my-jobs", resource: "myJobs" },
  { prefix: "/invoices", resource: "invoices" },
  { prefix: "/payments", resource: "payments" },
  { prefix: "/maintenance", resource: "maintenance" },
  { prefix: "/price-book", resource: "priceBook" },
  { prefix: "/inventory", resource: "inventory" },
  { prefix: "/suppliers", resource: "suppliers" },
  { prefix: "/reports", resource: "reports" },
  { prefix: "/team", resource: "team" },
  { prefix: "/settings", resource: "settings" },
  { prefix: "/notifications", resource: "notifications" },
  { prefix: "/audit-log", resource: "auditLog" },
  { prefix: "/integrations", resource: "settings" },
];

export function resourceForPath(pathname: string): Resource | null {
  const match = ROUTE_RESOURCES.find(
    (r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`),
  );
  return match?.resource ?? null;
}

export function canViewPath(user: PermissionUser | null | undefined, pathname: string): boolean {
  const resource = resourceForPath(pathname);
  if (!resource) return !!user;
  return can(user, "view", resource);
}

export function homePathFor(role: Role): string {
  return role === "TECHNICIAN" ? "/my-jobs" : "/dashboard";
}
