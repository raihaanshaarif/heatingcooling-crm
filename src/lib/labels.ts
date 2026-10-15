import type {
  ClientType,
  EquipmentType,
  InvoiceStatus,
  ItemType,
  JobStatus,
  JobType,
  LeadSource,
  LeadStatus,
  LicenceType,
  PaymentMethod,
  PaymentTerms,
  PlanFrequency,
  Priority,
  QuoteStatus,
  Role,
  ServiceCategory,
  StockLocationType,
  StockMovementType,
} from "@prisma/client";

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Owner / Admin",
  OFFICE: "Office / Dispatcher",
  TECHNICIAN: "Technician",
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  SITE_VISIT_BOOKED: "Site visit booked",
  QUOTED: "Quoted",
  WON: "Won",
  LOST: "Lost",
};

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  WEBSITE: "Website form",
  PHONE: "Phone call",
  GOOGLE_ADS: "Google Ads",
  GOOGLE_BUSINESS_PROFILE: "Google Business Profile",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  REFERRAL: "Referral",
  REPEAT_CUSTOMER: "Repeat customer",
  WALK_IN: "Walk-in",
  OTHER: "Other",
};

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  SPLIT_SYSTEM: "Split system",
  DUCTED: "Ducted",
  EVAPORATIVE: "Evaporative",
  GAS_HEATING: "Gas heating",
  HEAT_PUMP: "Heat pump",
  COMMERCIAL_HVAC: "Commercial HVAC",
  EMERGENCY_REPAIR: "Emergency repair",
  MAINTENANCE: "Maintenance",
  OTHER: "Other",
};

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  RESIDENTIAL: "Residential",
  COMMERCIAL: "Commercial",
  PROPERTY_MANAGER: "Real estate / Property manager",
  BUILDER: "Builder",
};

export const EQUIPMENT_TYPE_LABELS: Record<EquipmentType, string> = {
  SPLIT_SYSTEM: "Split system",
  MULTI_SPLIT: "Multi-split",
  DUCTED_REFRIGERATED: "Ducted refrigerated",
  DUCTED_GAS_HEATER: "Ducted gas heater",
  EVAPORATIVE_COOLER: "Evaporative cooler",
  HYDRONIC: "Hydronic",
  WALL_FURNACE: "Wall furnace",
  HEAT_PUMP: "Heat pump",
  OTHER: "Other",
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  VIEWED: "Viewed",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  EXPIRED: "Expired",
};

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  INSTALLATION: "Installation",
  SERVICE: "Service / Maintenance",
  REPAIR: "Repair",
  EMERGENCY: "Emergency",
  INSPECTION: "Inspection",
  WARRANTY: "Warranty",
  QUOTE_VISIT: "Quote visit",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  UNSCHEDULED: "Unscheduled",
  SCHEDULED: "Scheduled",
  EN_ROUTE: "En route",
  IN_PROGRESS: "In progress",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  CANCELLED: "Cancelled",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  EMERGENCY: "Emergency",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CARD: "Card (EFTPOS)",
  BANK_TRANSFER: "Bank transfer",
  CASH: "Cash",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  ON_COMPLETION: "On completion",
  DAYS_7: "7 days",
  DAYS_14: "14 days",
  DAYS_30: "30 days",
};

export const PLAN_FREQUENCY_LABELS: Record<PlanFrequency, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  SIX_MONTHLY: "Six-monthly",
  YEARLY: "Yearly",
};

export const PLAN_FREQUENCY_MONTHS: Record<PlanFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SIX_MONTHLY: 6,
  YEARLY: 12,
};

export const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  LABOUR: "Labour",
  PART: "Part",
  EQUIPMENT: "Equipment",
  CALL_OUT: "Call-out fee",
  OTHER: "Other",
};

export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  RECEIVE: "Received",
  TRANSFER: "Transfer",
  ADJUST: "Adjustment",
  JOB_USE: "Used on job",
  JOB_RETURN: "Returned from job",
};

export const STOCK_LOCATION_TYPE_LABELS: Record<StockLocationType, string> = {
  WAREHOUSE: "Warehouse",
  VAN: "Van",
};

export const STOCK_STATUS_LABELS = {
  OK: "In stock",
  LOW: "Low",
  OUT: "Out of stock",
  NEGATIVE: "Negative",
} as const;

export const STOCK_ADJUST_REASONS = [
  "Stocktake count",
  "Damaged / faulty",
  "Lost or missing",
  "Returned to supplier",
  "Used without a job",
  "Found / recounted",
  "Correction",
] as const;

export const LICENCE_TYPE_LABELS: Record<LicenceType, string> = {
  ARC_REFRIGERANT: "ARC Refrigerant Handling",
  ELECTRICAL: "Electrical",
  GAS_FITTING: "Gas fitting (VBA)",
  PLUMBING: "Plumbing (VBA)",
  DRIVERS: "Driver's licence",
  WWCC: "Working with Children",
  OTHER: "Other",
};

export const BRANDS = [
  "Daikin",
  "Mitsubishi Electric",
  "Mitsubishi Heavy Industries",
  "Fujitsu",
  "Panasonic",
  "LG",
  "Samsung",
  "Toshiba",
  "Carrier",
  "ActronAir",
  "Bonaire",
  "Braemar",
  "Brivis",
  "Rinnai",
  "Coolair",
  "Breezair",
  "Haier",
  "Hitachi",
  "Other",
] as const;

export const REFRIGERANTS = ["R32", "R410A", "R22", "R134a", "R407C", "R290"] as const;

export const LOST_REASONS = [
  "Too expensive",
  "Went with another company",
  "No reply",
  "Not ready / timing",
  "Outside service area",
  "Did it themselves",
  "Other",
] as const;

export const CLIENT_TAGS = ["VIP", "Do not service", "Slow payer", "Landlord", "Strata"] as const;

export function options<T extends string>(
  labels: Record<T, string>,
): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}
