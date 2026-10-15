import { describe, expect, it } from "vitest";
import { can, canAccessJob, canViewPath, homePathFor, resourceForPath } from "./permissions";

const admin = { id: "a", role: "ADMIN" as const };
const office = { id: "o", role: "OFFICE" as const };
const tech = { id: "t", role: "TECHNICIAN" as const };

describe("permissions", () => {
  it("lets admin do everything", () => {
    expect(can(admin, "delete", "users")).toBe(true);
    expect(can(admin, "update", "settings")).toBe(true);
    expect(can(admin, "view", "priceBookCosts")).toBe(true);
  });

  it("keeps office out of settings, users and costs", () => {
    expect(can(office, "create", "invoices")).toBe(true);
    expect(can(office, "create", "payments")).toBe(true);
    expect(can(office, "view", "reports")).toBe(true);
    expect(can(office, "view", "settings")).toBe(false);
    expect(can(office, "create", "users")).toBe(false);
    expect(can(office, "view", "priceBookCosts")).toBe(false);
    expect(can(office, "update", "priceBook")).toBe(false);
  });

  it("limits technicians to their jobs", () => {
    expect(can(tech, "view", "myJobs")).toBe(true);
    expect(can(tech, "update", "jobs")).toBe(true);
    expect(can(tech, "create", "jobs")).toBe(false);
    expect(can(tech, "view", "invoices")).toBe(false);
    expect(can(tech, "view", "reports")).toBe(false);
    expect(can(tech, "view", "prices")).toBe(false);
    expect(can(tech, "view", "leads")).toBe(false);
  });

  it("lets office move stock but keeps stock value and deleting to admin", () => {
    expect(can(admin, "view", "inventoryCosts")).toBe(true);
    expect(can(office, "view", "inventory")).toBe(true);
    expect(can(office, "create", "inventory")).toBe(true);
    expect(can(office, "delete", "inventory")).toBe(false);
    expect(can(office, "view", "inventoryCosts")).toBe(false);
    expect(can(office, "update", "suppliers")).toBe(true);
    expect(can(tech, "view", "inventory")).toBe(false);
    expect(can(tech, "view", "suppliers")).toBe(false);
    expect(canViewPath(tech, "/inventory")).toBe(false);
    expect(canViewPath(office, "/suppliers")).toBe(true);
  });

  it("denies anonymous users", () => {
    expect(can(null, "view", "dashboard")).toBe(false);
    expect(can(undefined, "view", "myJobs")).toBe(false);
  });

  it("checks job ownership for technicians", () => {
    const job = { assignments: [{ userId: "t" }] };
    expect(canAccessJob(tech, job)).toBe(true);
    expect(canAccessJob({ id: "other", role: "TECHNICIAN" }, job)).toBe(false);
    expect(canAccessJob(office, { assignments: [] })).toBe(true);
    expect(canAccessJob(null, job)).toBe(false);
  });

  it("maps routes to resources", () => {
    expect(resourceForPath("/settings")).toBe("settings");
    expect(resourceForPath("/invoices/abc")).toBe("invoices");
    expect(resourceForPath("/my-jobs/123")).toBe("myJobs");
    expect(resourceForPath("/unknown")).toBeNull();
    expect(canViewPath(tech, "/invoices")).toBe(false);
    expect(canViewPath(tech, "/my-jobs/x")).toBe(true);
    expect(canViewPath(office, "/settings")).toBe(false);
    expect(canViewPath(admin, "/settings")).toBe(true);
  });

  it("sends each role to the right home page", () => {
    expect(homePathFor("TECHNICIAN")).toBe("/my-jobs");
    expect(homePathFor("OFFICE")).toBe("/dashboard");
  });
});
