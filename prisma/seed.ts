/**
 * CoolOps demo seed for Cooling Service Melbourne.
 *
 * Idempotent: truncates every table (except _prisma_migrations) and inserts fresh data.
 * Deterministic: all randomness comes from a seeded PRNG, while dates are relative to
 * "now" in Australia/Melbourne so the dashboard always has data for today.
 *
 * Run with: pnpm db:seed  (tsx prisma/seed.ts)
 */
import { Prisma, PrismaClient } from "@prisma/client";
import type {
  ActivityType,
  ClientType,
  EquipmentType,
  InvoiceStatus,
  ItemType,
  JobStatus,
  JobType,
  LeadSource,
  LeadStatus,
  PaymentMethod,
  PaymentTerms,
  PlanFrequency,
  Priority,
  QuoteStatus,
  ServiceCategory,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { calculateTotals, lineTotalCents } from "../src/lib/money";
import { formatDocumentNumber } from "../src/lib/numbering";
import {
  deriveInvoiceStatus,
  dueDateFromTerms,
  invoiceBalance,
  PAYMENT_TERMS_DAYS,
} from "../src/lib/invoice-status";
import {
  addMelbourneDays,
  addMelbourneMonths,
  fromMelbourneInput,
  melbourneDaysBetween,
  minutesBetween,
  startOfMelbourneDay,
  startOfMelbourneMonth,
  toDateInput,
} from "../src/lib/dates";
import { DEFAULT_EMAIL_TEMPLATES } from "../src/lib/email/templates";
import { pickMobile } from "../src/lib/sms/phone";
import { countSegments } from "../src/lib/sms/segments";
import {
  DEFAULT_SMS_ENABLED,
  DEFAULT_SMS_TEMPLATES,
  firstName,
  greetingName,
  renderSms,
} from "../src/lib/sms/templates";
import { addQty, levelsFromMovements, stockStatus } from "../src/lib/inventory";
import { DEFAULT_XERO_SETTINGS } from "../src/lib/xero/settings";

const prisma = new PrismaClient();

// ─── Deterministic randomness ───────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20_241_031);
const int = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number): boolean => rand() < p;
function weighted<T>(entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}
function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
const digits = (n: number): string => Array.from({ length: n }, () => String(int(0, 9))).join("");
const letters = (n: number): string =>
  Array.from({ length: n }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[int(0, 23)]).join("");
const mobile = (): string => `04${digits(2)} ${digits(3)} ${digits(3)}`;
const landline = (): string => `(03) 9${digits(3)} ${digits(4)}`;
const round2 = (n: number): number => Math.round(n * 100) / 100;

// ─── Melbourne date helpers ─────────────────────────────────────────────────

const NOW = new Date();
const TODAY_START = startOfMelbourneDay(NOW);

/** yyyy-MM-dd of the Melbourne day `offset` days from today. */
function dayStr(offset: number): string {
  return toDateInput(addMelbourneDays(TODAY_START, offset));
}
function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
/** A Melbourne wall-clock time on the day `offset` days from today. */
function at(offset: number, minutesFromMidnight: number): Date {
  return fromMelbourneInput(`${dayStr(offset)}T${hhmm(minutesFromMidnight)}`);
}
function isWeekend(offset: number): boolean {
  const dow = new Date(`${dayStr(offset)}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}
/** Nudge a day offset onto a weekday, moving in `dir`. */
function weekday(offset: number, dir: 1 | -1): number {
  let o = offset;
  while (isWeekend(o)) o += dir;
  return o;
}
const addMinutes = (d: Date, m: number): Date => new Date(d.getTime() + m * 60_000);
const clampPast = (d: Date): Date =>
  d.getTime() > NOW.getTime() ? addMinutes(NOW, -int(5, 90)) : d;

// ─── Static data ────────────────────────────────────────────────────────────

const PASSWORD = "ChangeMe123!";

interface PriceBookSeed {
  sku: string;
  name: string;
  type: ItemType;
  category: ServiceCategory;
  unit: string;
  costCents: number;
  priceCents: number;
  description?: string;
}

const PRICE_BOOK: PriceBookSeed[] = [
  {
    sku: "SVC-SPLIT",
    name: "Split system service",
    type: "LABOUR",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 6500,
    priceCents: 16900,
    description:
      "Clean filters, coil and fan barrel, check drain, test operation and refrigerant pressures.",
  },
  {
    sku: "SVC-SPLIT-ADD",
    name: "Additional split system service (same visit)",
    type: "LABOUR",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 4500,
    priceCents: 11900,
  },
  {
    sku: "SVC-DUCTED",
    name: "Ducted refrigerated system service",
    type: "LABOUR",
    category: "DUCTED",
    unit: "each",
    costCents: 9500,
    priceCents: 26900,
    description:
      "Return air filter clean, coil inspection, drain test, electrical checks, temperature split across all zones.",
  },
  {
    sku: "SVC-EVAP",
    name: "Evaporative cooler service",
    type: "LABOUR",
    category: "EVAPORATIVE",
    unit: "each",
    costCents: 8000,
    priceCents: 22900,
    description:
      "Drain and clean tank, inspect pads, pump and float valve, check drain valve and motor.",
  },
  {
    sku: "SVC-GAS",
    name: "Ducted gas heater service incl. CO test",
    type: "LABOUR",
    category: "GAS_HEATING",
    unit: "each",
    costCents: 8500,
    priceCents: 24900,
    description:
      "Burner and heat exchanger inspection, gas pressure test, carbon monoxide spillage test and safety check.",
  },
  {
    sku: "SVC-COMM",
    name: "Commercial HVAC preventative maintenance visit",
    type: "LABOUR",
    category: "COMMERCIAL_HVAC",
    unit: "each",
    costCents: 15000,
    priceCents: 39500,
  },
  {
    sku: "CALLOUT",
    name: "Call-out fee (metro Melbourne)",
    type: "CALL_OUT",
    category: "OTHER",
    unit: "each",
    costCents: 0,
    priceCents: 9900,
  },
  {
    sku: "CALLOUT-AH",
    name: "Emergency after-hours call-out",
    type: "CALL_OUT",
    category: "EMERGENCY_REPAIR",
    unit: "each",
    costCents: 0,
    priceCents: 24900,
  },
  {
    sku: "LAB-HR",
    name: "Labour – licensed technician",
    type: "LABOUR",
    category: "OTHER",
    unit: "hour",
    costCents: 4800,
    priceCents: 13500,
  },
  {
    sku: "LAB-APP-HR",
    name: "Labour – apprentice",
    type: "LABOUR",
    category: "OTHER",
    unit: "hour",
    costCents: 2600,
    priceCents: 7500,
  },
  {
    sku: "REGAS-R32",
    name: "Refrigerant regas – R32",
    type: "PART",
    category: "SPLIT_SYSTEM",
    unit: "kg",
    costCents: 3500,
    priceCents: 15000,
  },
  {
    sku: "REGAS-R410A",
    name: "Refrigerant regas – R410A",
    type: "PART",
    category: "SPLIT_SYSTEM",
    unit: "kg",
    costCents: 5500,
    priceCents: 18500,
  },
  {
    sku: "LEAK-SEARCH",
    name: "Refrigerant leak search (nitrogen pressure test)",
    type: "LABOUR",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 5000,
    priceCents: 22000,
  },
  {
    sku: "PART-CAP",
    name: "Run capacitor (outdoor unit)",
    type: "PART",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 1800,
    priceCents: 8900,
  },
  {
    sku: "PART-FAN-IN",
    name: "Indoor fan motor",
    type: "PART",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 14500,
    priceCents: 34900,
  },
  {
    sku: "PART-FAN-OUT",
    name: "Outdoor fan motor",
    type: "PART",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 17500,
    priceCents: 42900,
  },
  {
    sku: "PART-PCB",
    name: "Indoor PCB control board",
    type: "PART",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 28000,
    priceCents: 64900,
  },
  {
    sku: "PART-PCB-OUT",
    name: "Outdoor inverter PCB",
    type: "PART",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 52000,
    priceCents: 119000,
  },
  {
    sku: "PART-STAT",
    name: "Wall controller / thermostat",
    type: "PART",
    category: "DUCTED",
    unit: "each",
    costCents: 16500,
    priceCents: 38900,
  },
  {
    sku: "PART-DRAIN-PUMP",
    name: "Condensate drain pump",
    type: "PART",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 9500,
    priceCents: 26900,
  },
  {
    sku: "DRAIN-CLEAR",
    name: "Condensate line clear and flush",
    type: "LABOUR",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 2000,
    priceCents: 12900,
  },
  {
    sku: "FILTER-DUCT",
    name: "Ducted return air filter",
    type: "PART",
    category: "DUCTED",
    unit: "each",
    costCents: 2400,
    priceCents: 8900,
  },
  {
    sku: "EVAP-PADS",
    name: "Evaporative cooler pad set (Chillcel)",
    type: "PART",
    category: "EVAPORATIVE",
    unit: "set",
    costCents: 28000,
    priceCents: 59900,
  },
  {
    sku: "EVAP-PUMP",
    name: "Evaporative cooler water pump",
    type: "PART",
    category: "EVAPORATIVE",
    unit: "each",
    costCents: 7500,
    priceCents: 19900,
  },
  {
    sku: "GAS-IGNITER",
    name: "Gas heater hot surface igniter",
    type: "PART",
    category: "GAS_HEATING",
    unit: "each",
    costCents: 6500,
    priceCents: 18900,
  },
  {
    sku: "GAS-FLAME-SENSOR",
    name: "Gas heater flame sensor",
    type: "PART",
    category: "GAS_HEATING",
    unit: "each",
    costCents: 3500,
    priceCents: 12900,
  },
  {
    sku: "CO-TEST",
    name: "Carbon monoxide spillage test – additional appliance",
    type: "LABOUR",
    category: "GAS_HEATING",
    unit: "each",
    costCents: 2000,
    priceCents: 9900,
  },
  {
    sku: "INST-SPLIT-25",
    name: "2.5kW split system – supply and standard install",
    type: "EQUIPMENT",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 115000,
    priceCents: 199000,
    description: "Back-to-back install, up to 3m pipe run, standard wall bracket and isolator.",
  },
  {
    sku: "INST-SPLIT-35",
    name: "3.5kW split system – supply and standard install",
    type: "EQUIPMENT",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 135000,
    priceCents: 229000,
  },
  {
    sku: "INST-SPLIT-50",
    name: "5.0kW split system – supply and standard install",
    type: "EQUIPMENT",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 165000,
    priceCents: 279000,
  },
  {
    sku: "INST-SPLIT-71",
    name: "7.1kW split system – supply and standard install",
    type: "EQUIPMENT",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 215000,
    priceCents: 349000,
  },
  {
    sku: "INST-SPLIT-80",
    name: "8.0kW split system – supply and standard install",
    type: "EQUIPMENT",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 245000,
    priceCents: 389000,
  },
  {
    sku: "INST-DUCTED-14",
    name: "14kW ducted reverse cycle system – supply and install",
    type: "EQUIPMENT",
    category: "DUCTED",
    unit: "each",
    costCents: 950000,
    priceCents: 1490000,
    description: "Includes up to 8 outlets, return air grille, wall controller and commissioning.",
  },
  {
    sku: "INST-EVAP",
    name: "Evaporative cooler – supply and install",
    type: "EQUIPMENT",
    category: "EVAPORATIVE",
    unit: "each",
    costCents: 380000,
    priceCents: 589000,
  },
  {
    sku: "INST-GAS-DUCTED",
    name: "Ducted gas heater replacement (5 star, 20kW)",
    type: "EQUIPMENT",
    category: "GAS_HEATING",
    unit: "each",
    costCents: 320000,
    priceCents: 529000,
    description: "Includes gas and flue connection, commissioning and compliance certificate.",
  },
  {
    sku: "DUCT-OUTLET",
    name: "Ductwork – additional outlet incl. flexible duct",
    type: "PART",
    category: "DUCTED",
    unit: "outlet",
    costCents: 9500,
    priceCents: 24900,
  },
  {
    sku: "ZONE-MOTOR",
    name: "Zone damper motor",
    type: "PART",
    category: "DUCTED",
    unit: "each",
    costCents: 9000,
    priceCents: 24900,
  },
  {
    sku: "ISOLATOR",
    name: "Outdoor isolator switch (supply and fit)",
    type: "PART",
    category: "OTHER",
    unit: "each",
    costCents: 3500,
    priceCents: 14900,
  },
  {
    sku: "BRACKET",
    name: "Wall bracket for outdoor unit",
    type: "PART",
    category: "SPLIT_SYSTEM",
    unit: "each",
    costCents: 4500,
    priceCents: 16900,
  },
  {
    sku: "PIPE-EXT",
    name: "Pipe extension (insulated pair coil)",
    type: "PART",
    category: "SPLIT_SYSTEM",
    unit: "metre",
    costCents: 2200,
    priceCents: 7900,
  },
  {
    sku: "COVER-DUCT",
    name: "Pipe duct cover",
    type: "PART",
    category: "SPLIT_SYSTEM",
    unit: "metre",
    costCents: 1800,
    priceCents: 5900,
  },
  {
    sku: "DISPOSAL",
    name: "Removal and disposal of old unit (incl. refrigerant recovery)",
    type: "OTHER",
    category: "OTHER",
    unit: "each",
    costCents: 3000,
    priceCents: 19900,
  },
  {
    sku: "ELEC-CIRCUIT",
    name: "Dedicated power circuit (A-grade electrician)",
    type: "OTHER",
    category: "OTHER",
    unit: "each",
    costCents: 22000,
    priceCents: 45000,
  },
];

const CHECKLISTS: {
  name: string;
  jobType: JobType;
  serviceCategory: ServiceCategory | null;
  items: string[];
}[] = [
  {
    name: "Split system service",
    jobType: "SERVICE",
    serviceCategory: "SPLIT_SYSTEM",
    items: [
      "Isolate power and confirm safe to work",
      "Remove, wash and refit indoor filters",
      "Clean indoor coil and fan barrel (coil cleaner)",
      "Flush condensate drain and check for leaks",
      "Clean outdoor coil and check fan blades",
      "Check electrical connections and isolator",
      "Run in cool and heat, record supply/return temps",
      "Check refrigerant pressures for leaks",
      "Test remote and timer functions",
    ],
  },
  {
    name: "Ducted refrigerated service",
    jobType: "SERVICE",
    serviceCategory: "DUCTED",
    items: [
      "Isolate power and confirm safe to work",
      "Clean or replace return air filter",
      "Inspect indoor coil and drain tray",
      "Flush condensate drain and test safety tray",
      "Clean outdoor condenser coil",
      "Check zone motors open and close correctly",
      "Measure temperature split at each outlet",
      "Check wall controller and sensor readings",
      "Inspect ductwork in roof space for damage",
    ],
  },
  {
    name: "Evaporative cooler service",
    jobType: "SERVICE",
    serviceCategory: "EVAPORATIVE",
    items: [
      "Isolate power and water supply",
      "Drain and clean water tank",
      "Inspect cooling pads for scale and damage",
      "Test water pump and distribution channels",
      "Check float valve and drain valve operation",
      "Inspect fan motor and belt",
      "Check roof seals and ceiling dropper",
      "Run test and confirm even pad saturation",
    ],
  },
  {
    name: "Gas heater service",
    jobType: "SERVICE",
    serviceCategory: "GAS_HEATING",
    items: [
      "Inspect burner and clean if required",
      "Inspect heat exchanger for cracks",
      "Test gas pressure and adjust to data plate",
      "Carbon monoxide spillage test (record ppm)",
      "Check flue and terminal clearances",
      "Test ignition and flame sensor",
      "Replace or clean return air filter",
      "Check thermostat and fan operation",
      "Complete gas safety check report",
    ],
  },
  {
    name: "Installation commissioning",
    jobType: "INSTALLATION",
    serviceCategory: null,
    items: [
      "Confirm install location with customer",
      "Pressure test with nitrogen (hold 30 min)",
      "Evacuate to below 500 microns",
      "Electrical test and isolator labelled",
      "Commission and record operating temps",
      "Clean up and remove packaging",
      "Explain operation and remote to customer",
      "Register warranty with manufacturer",
    ],
  },
];

// ─── Client data ────────────────────────────────────────────────────────────

type EqKind = "split" | "ducted" | "gas" | "evap";
interface EqInput {
  kind: EqKind;
  brand: string;
  size?: number;
  location: string;
  warrantySoon?: boolean;
  installedByUs?: boolean;
  yearsAgo?: number;
  installDate?: Date;
  notes?: string;
}
const sp = (
  brand: string,
  size: number,
  location: string,
  extra: Partial<EqInput> = {},
): EqInput => ({
  kind: "split",
  brand,
  size,
  location,
  ...extra,
});
const du = (brand: string, size: number, extra: Partial<EqInput> = {}): EqInput => ({
  kind: "ducted",
  brand,
  size,
  location: "Roof space",
  ...extra,
});
const gas = (brand: string, extra: Partial<EqInput> = {}): EqInput => ({
  kind: "gas",
  brand,
  location: "Roof space",
  ...extra,
});
const evap = (brand: string, extra: Partial<EqInput> = {}): EqInput => ({
  kind: "evap",
  brand,
  location: "Roof",
  ...extra,
});

interface ContactSeed {
  name: string;
  role: string;
  phone?: string;
  email?: string;
  isPrimary?: boolean;
}
interface PropertySeed {
  key?: string;
  label?: string;
  addressLine1: string;
  suburb: string;
  postcode: string;
  accessNotes?: string;
  parkingNotes?: string;
  petNotes?: string;
  keyInfo?: string;
  equipment: EqInput[];
}
interface ClientSeed {
  key: string;
  type: ClientType;
  name: string;
  companyName?: string;
  abn?: string;
  email: string;
  phone?: string;
  altPhone?: string;
  tags?: string[];
  source?: LeadSource;
  doNotService?: boolean;
  noSms?: boolean;
  notes?: string;
  billing?: { line1: string; suburb: string; postcode: string };
  contacts?: ContactSeed[];
  properties: PropertySeed[];
  createdMonthsAgo: number;
}

const CLIENTS: ClientSeed[] = [
  {
    key: "thompson",
    type: "RESIDENTIAL",
    name: "Sarah Thompson",
    email: "sarah.thompson@gmail.com",
    tags: ["VIP"],
    source: "REFERRAL",
    createdMonthsAgo: 30,
    properties: [
      {
        addressLine1: "14 Albert St",
        suburb: "Brunswick",
        postcode: "3056",
        petNotes: "Friendly golden retriever (Max) – keep side gate closed",
        equipment: [
          sp("Daikin", 3.5, "Living room", { warrantySoon: true, installedByUs: true }),
          sp("Daikin", 2.5, "Master bedroom", { installedByUs: true, yearsAgo: 3 }),
          gas("Brivis", { yearsAgo: 9 }),
        ],
      },
    ],
  },
  {
    key: "nguyen",
    type: "RESIDENTIAL",
    name: "David Nguyen",
    email: "d.nguyen88@outlook.com",
    source: "GOOGLE_ADS",
    createdMonthsAgo: 3,
    properties: [
      {
        addressLine1: "7 Lennox St",
        suburb: "Richmond",
        postcode: "3121",
        parkingNotes: "Permit zone – visitor permit is in the letterbox",
        equipment: [sp("Fujitsu", 2.5, "Bedroom 2", { yearsAgo: 8 })],
      },
    ],
  },
  {
    key: "obrien",
    type: "RESIDENTIAL",
    name: "Michelle O'Brien",
    email: "michelle.obrien@bigpond.com",
    source: "PHONE",
    createdMonthsAgo: 26,
    properties: [
      {
        addressLine1: "22 Bogong Ave",
        suburb: "Glen Waverley",
        postcode: "3150",
        accessNotes: "Manhole in laundry ceiling",
        equipment: [gas("Rinnai", { yearsAgo: 7 }), evap("Breezair", { yearsAgo: 14 })],
      },
    ],
  },
  {
    key: "kowalski",
    type: "RESIDENTIAL",
    name: "Peter Kowalski",
    email: "pkowalski@iinet.net.au",
    tags: ["Slow payer"],
    source: "FACEBOOK",
    createdMonthsAgo: 14,
    notes: "Invoices usually paid after a reminder. Prefers calls after 4pm.",
    properties: [
      {
        addressLine1: "5 Beach St",
        suburb: "Frankston",
        postcode: "3199",
        equipment: [
          sp("Samsung", 5.0, "Living room", { yearsAgo: 11 }),
          gas("Braemar", { yearsAgo: 12 }),
        ],
      },
    ],
  },
  {
    key: "patel",
    type: "RESIDENTIAL",
    name: "Raj Patel",
    email: "raj.patel@gmail.com",
    source: "GOOGLE_BUSINESS_PROFILE",
    createdMonthsAgo: 18,
    properties: [
      {
        addressLine1: "31 Synnot St",
        suburb: "Werribee",
        postcode: "3030",
        equipment: [
          evap("Coolair", { yearsAgo: 13 }),
          sp("LG", 3.5, "Master bedroom", { yearsAgo: 4 }),
        ],
      },
    ],
  },
  {
    key: "walsh",
    type: "RESIDENTIAL",
    name: "Emma Walsh",
    email: "emma.walsh@icloud.com",
    source: "INSTAGRAM",
    createdMonthsAgo: 2,
    properties: [
      {
        addressLine1: "9 Thames St",
        suburb: "Box Hill",
        postcode: "3128",
        petNotes: "Two cats – keep internal doors closed",
        equipment: [sp("Panasonic", 5.0, "Living room", { yearsAgo: 2 })],
      },
    ],
  },
  {
    key: "robertson",
    type: "RESIDENTIAL",
    name: "James Robertson",
    email: "jrobertson@protonmail.com",
    source: "WEBSITE",
    createdMonthsAgo: 2,
    properties: [
      {
        addressLine1: "3/18 Grey St",
        suburb: "St Kilda",
        postcode: "3182",
        accessNotes: "Apartment 3 – buzz intercom. Outdoor unit on balcony.",
        parkingNotes: "Street parking only, 2P",
        equipment: [sp("Mitsubishi Electric", 2.5, "Bedroom", { yearsAgo: 10 })],
      },
    ],
  },
  {
    key: "mohammed",
    type: "RESIDENTIAL",
    name: "Aisha Mohammed",
    email: "aisha.m@gmail.com",
    source: "REFERRAL",
    createdMonthsAgo: 1,
    properties: [
      {
        addressLine1: "46 Droop St",
        suburb: "Footscray",
        postcode: "3011",
        equipment: [gas("Brivis", { yearsAgo: 15 })],
      },
    ],
  },
  {
    key: "henderson",
    type: "RESIDENTIAL",
    name: "Tom & Kate Henderson",
    email: "hendersons@optusnet.com.au",
    tags: ["VIP"],
    source: "REPEAT_CUSTOMER",
    createdMonthsAgo: 40,
    properties: [
      {
        addressLine1: "12 Andersons Creek Rd",
        suburb: "Doncaster",
        postcode: "3108",
        accessNotes: "Side access via left gate, code 2580",
        petNotes: "Labrador (Bella) – very friendly",
        keyInfo: "Spare key in lockbox by meter box, code 1971",
        equipment: [
          gas("Brivis", { yearsAgo: 6, installedByUs: true }),
          evap("Breezair", { yearsAgo: 16 }),
        ],
      },
    ],
  },
  {
    key: "lee",
    type: "RESIDENTIAL",
    name: "Grace Lee",
    email: "grace.lee@yahoo.com.au",
    source: "GOOGLE_ADS",
    createdMonthsAgo: 4,
    properties: [
      {
        addressLine1: "8 Charman Rd",
        suburb: "Cheltenham",
        postcode: "3192",
        equipment: [
          gas("Braemar", {
            yearsAgo: 17,
            notes: "Heat exchanger showing surface rust – advised replacement",
          }),
          sp("Toshiba", 3.5, "Study", { yearsAgo: 5 }),
        ],
      },
    ],
  },
  {
    key: "fraser",
    type: "RESIDENTIAL",
    name: "Daniel Fraser",
    noSms: true,
    email: "dan.fraser@gmail.com",
    source: "WEBSITE",
    createdMonthsAgo: 3,
    properties: [
      {
        addressLine1: "15 Featherbrook Dr",
        suburb: "Point Cook",
        postcode: "3030",
        accessNotes: "New estate – GPS sometimes sends you to the back street",
        equipment: [sp("Daikin", 5.0, "Living room", { yearsAgo: 4 })],
      },
    ],
  },
  {
    key: "stevens",
    type: "RESIDENTIAL",
    name: "Mark Stevens",
    email: "markstevens71@hotmail.com",
    doNotService: true,
    tags: ["Do not service", "Slow payer"],
    source: "PHONE",
    createdMonthsAgo: 10,
    notes:
      "Do not book. Outstanding invoice from earlier this year sent to collections; aggressive to technician on last visit.",
    properties: [
      {
        addressLine1: "19 Hothlyn Dr",
        suburb: "Craigieburn",
        postcode: "3064",
        equipment: [sp("Carrier", 7.1, "Family room", { yearsAgo: 9 })],
      },
    ],
  },
  {
    key: "bennett",
    type: "RESIDENTIAL",
    name: "Olivia Bennett",
    email: "olivia.bennett@gmail.com",
    source: "GOOGLE_ADS",
    createdMonthsAgo: 3,
    properties: [
      {
        addressLine1: "6 Clyde Rd",
        suburb: "Berwick",
        postcode: "3806",
        equipment: [evap("Bonaire", { yearsAgo: 12 })],
      },
    ],
  },
  {
    key: "papadopoulos",
    type: "RESIDENTIAL",
    name: "Chris Papadopoulos",
    email: "chris.papa@outlook.com",
    source: "FACEBOOK",
    createdMonthsAgo: 1,
    properties: [
      {
        addressLine1: "33 Warrandyte Rd",
        suburb: "Ringwood",
        postcode: "3134",
        equipment: [du("ActronAir", 14.0, { yearsAgo: 8 })],
      },
    ],
  },
  {
    key: "murphy",
    type: "RESIDENTIAL",
    name: "Hannah Murphy",
    email: "hannah.murphy@gmail.com",
    source: "GOOGLE_BUSINESS_PROFILE",
    createdMonthsAgo: 22,
    properties: [
      {
        addressLine1: "11 Buckley St",
        suburb: "Essendon",
        postcode: "3040",
        petNotes: "Small dog – may bark but is fine",
        equipment: [
          gas("Brivis", { yearsAgo: 5, installedByUs: true }),
          sp("Daikin", 2.5, "Nursery", { warrantySoon: true, installedByUs: true }),
        ],
      },
    ],
  },
  {
    key: "campbell",
    type: "RESIDENTIAL",
    name: "Robert & Jill Campbell",
    email: "rj.campbell@bigpond.com",
    tags: ["VIP", "Landlord"],
    source: "REPEAT_CUSTOMER",
    createdMonthsAgo: 48,
    properties: [
      {
        key: "campbell-home",
        label: "Home",
        addressLine1: "54 Prospect Hill Rd",
        suburb: "Camberwell",
        postcode: "3124",
        accessNotes: "Ducted unit accessed via roof hatch in garage",
        keyInfo: "Housekeeper (Rosa) on site Tue/Thu",
        equipment: [
          du("Daikin", 14.0, { warrantySoon: true, installedByUs: true }),
          sp("Mitsubishi Electric", 3.5, "Master bedroom", { yearsAgo: 6 }),
          sp("Mitsubishi Electric", 2.5, "Study", { yearsAgo: 6 }),
        ],
      },
      {
        key: "campbell-rental",
        label: "Rental",
        addressLine1: "2/9 Florence St",
        suburb: "Mentone",
        postcode: "3194",
        accessNotes: "Tenanted – give tenant 24 hours notice (Sam, 0423 118 902)",
        equipment: [sp("Fujitsu", 3.5, "Living room", { yearsAgo: 7 })],
      },
    ],
  },
  {
    key: "zhang",
    type: "RESIDENTIAL",
    name: "Wei Zhang",
    email: "wei.zhang@gmail.com",
    source: "WEBSITE",
    createdMonthsAgo: 1,
    properties: [
      {
        addressLine1: "2 Evans St",
        suburb: "Sunbury",
        postcode: "3429",
        equipment: [gas("Braemar", { yearsAgo: 10 })],
      },
    ],
  },
  // Commercial
  {
    key: "beancounter",
    type: "COMMERCIAL",
    name: "Bean Counter Cafe",
    companyName: "Bean Counter Cafe Pty Ltd",
    abn: "51 824 753 556",
    email: "hello@beancountercafe.com.au",
    source: "WALK_IN",
    createdMonthsAgo: 20,
    contacts: [
      { name: "Marco Rossi", role: "Owner", isPrimary: true },
      { name: "Jess Tran", role: "Cafe manager" },
    ],
    properties: [
      {
        addressLine1: "112 Sydney Rd",
        suburb: "Brunswick",
        postcode: "3056",
        accessNotes: "Service before 7am or after 2pm – cafe is busy at lunch",
        parkingNotes: "Loading zone at rear laneway",
        equipment: [
          sp("Mitsubishi Electric", 7.1, "Dining area", { yearsAgo: 6 }),
          sp("Mitsubishi Electric", 7.1, "Front counter", { yearsAgo: 6 }),
        ],
      },
    ],
  },
  {
    key: "southside",
    type: "COMMERCIAL",
    name: "Southside Accounting Group",
    companyName: "Southside Accounting Group Pty Ltd",
    abn: "33 615 902 418",
    email: "admin@southsideaccounting.com.au",
    source: "REFERRAL",
    createdMonthsAgo: 28,
    contacts: [
      { name: "Karen Mitchell", role: "Office manager", isPrimary: true },
      { name: "Accounts payable", role: "Accounts", email: "accounts@southsideaccounting.com.au" },
    ],
    properties: [
      {
        addressLine1: "Level 2, 450 South Rd",
        suburb: "Moorabbin",
        postcode: "3189",
        accessNotes:
          "Sign in at reception. Plant on roof – access via fire stairs, key from reception.",
        equipment: [
          du("Daikin", 14.0, { location: "Roof plant – unit 1", yearsAgo: 9 }),
          du("Daikin", 14.0, { location: "Roof plant – unit 2", yearsAgo: 9 }),
        ],
      },
    ],
  },
  {
    key: "ironrepublic",
    type: "COMMERCIAL",
    name: "Iron Republic Fitness",
    companyName: "Iron Republic Fitness Pty Ltd",
    abn: "72 409 331 785",
    email: "manager@ironrepublic.com.au",
    source: "GOOGLE_ADS",
    createdMonthsAgo: 3,
    contacts: [{ name: "Ben Taylor", role: "Gym manager", isPrimary: true }],
    properties: [
      {
        addressLine1: "88 Princes Hwy",
        suburb: "Dandenong",
        postcode: "3175",
        accessNotes: "Open 5am–10pm. Ask for Ben at the front desk.",
        equipment: [du("ActronAir", 17.0, { location: "Roof – main gym floor", yearsAgo: 11 })],
      },
    ],
  },
  {
    key: "medical",
    type: "COMMERCIAL",
    name: "Camberwell Family Medical Centre",
    companyName: "Camberwell Family Medical Pty Ltd",
    abn: "18 552 067 943",
    email: "practice@camberwellfmc.com.au",
    source: "REFERRAL",
    createdMonthsAgo: 2,
    contacts: [
      { name: "Leanne Cooper", role: "Practice manager", isPrimary: true },
      { name: "Dr Anika Sharma", role: "Practice principal" },
    ],
    properties: [
      {
        addressLine1: "701 Burke Rd",
        suburb: "Camberwell",
        postcode: "3124",
        accessNotes: "Work in consult rooms only between appointments – coordinate with reception",
        equipment: [
          du("Mitsubishi Electric", 14.0, { yearsAgo: 7 }),
          sp("Panasonic", 2.5, "Consult room 1", { yearsAgo: 4 }),
          sp("Panasonic", 2.5, "Consult room 2", { yearsAgo: 4 }),
        ],
      },
    ],
  },
  // Property managers
  {
    key: "harbour",
    type: "PROPERTY_MANAGER",
    name: "Harbour & Co Real Estate",
    companyName: "Harbour & Co Real Estate Pty Ltd",
    abn: "64 117 820 395",
    email: "maintenance@harbourco.com.au",
    tags: ["Landlord"],
    source: "REFERRAL",
    createdMonthsAgo: 34,
    billing: { line1: "1/290 Charman Rd", suburb: "Cheltenham", postcode: "3192" },
    notes:
      "All work orders must quote the PM work order number. Approval required for anything over $500 ex GST.",
    contacts: [
      { name: "Natalie Brooks", role: "Senior property manager", isPrimary: true },
      { name: "Sam Ortiz", role: "Tenant – 21 Como Pde W" },
      { name: "Lucy Vo", role: "Tenant – 8 Patty St" },
      { name: "Geoff Hall", role: "Owner – 15 Bear St" },
    ],
    properties: [
      {
        key: "harbour-como",
        addressLine1: "21 Como Pde W",
        suburb: "Mentone",
        postcode: "3194",
        keyInfo: "Keys at Harbour & Co office – sign out with reception",
        equipment: [
          sp("Daikin", 3.5, "Living room", { yearsAgo: 5 }),
          gas("Rinnai", { yearsAgo: 8 }),
        ],
      },
      {
        key: "harbour-patty",
        addressLine1: "8 Patty St",
        suburb: "Mentone",
        postcode: "3194",
        petNotes: "Tenant has a cat",
        equipment: [
          sp("Fujitsu", 3.5, "Living room", {
            yearsAgo: 12,
            notes: "Compressor noisy – nearing end of life",
          }),
        ],
      },
      {
        addressLine1: "15 Bear St",
        suburb: "Mordialloc",
        postcode: "3195",
        equipment: [evap("Coolair", { yearsAgo: 9 }), gas("Braemar", { yearsAgo: 9 })],
      },
      {
        addressLine1: "3/27 Middleton St",
        suburb: "Highett",
        postcode: "3190",
        accessNotes: "Unit 3 – rear of block",
        equipment: [sp("LG", 2.5, "Living room", { yearsAgo: 3 })],
      },
      {
        addressLine1: "62 Rowans Rd",
        suburb: "Moorabbin",
        postcode: "3189",
        equipment: [du("ActronAir", 14.0, { yearsAgo: 6 })],
      },
    ],
  },
  {
    key: "northern",
    type: "PROPERTY_MANAGER",
    name: "Northern Rentals Realty",
    companyName: "Northern Rentals Realty Pty Ltd",
    abn: "27 830 461 129",
    email: "pm@northernrentals.com.au",
    source: "PHONE",
    createdMonthsAgo: 16,
    billing: { line1: "Level 1, 1048 Mt Alexander Rd", suburb: "Essendon", postcode: "3040" },
    contacts: [
      { name: "Daniel Kurt", role: "Property manager", isPrimary: true },
      { name: "Priscilla Wong", role: "Tenant – 17 Napier St" },
      { name: "Hamid Karimi", role: "Owner – 5 Wilson St" },
    ],
    properties: [
      {
        addressLine1: "17 Napier St",
        suburb: "Essendon",
        postcode: "3040",
        equipment: [gas("Brivis", { yearsAgo: 10 })],
      },
      {
        key: "northern-wilson",
        addressLine1: "5 Wilson St",
        suburb: "Moonee Ponds",
        postcode: "3039",
        equipment: [
          gas("Brivis", {
            yearsAgo: 18,
            notes: "Failed CO test last service – isolated, replacement quoted",
          }),
        ],
      },
      {
        addressLine1: "2/88 Victoria St",
        suburb: "Brunswick",
        postcode: "3056",
        accessNotes: "Apartment – outdoor unit on balcony",
        equipment: [sp("Samsung", 3.5, "Living room", { yearsAgo: 4 })],
      },
      {
        addressLine1: "41 Sussex St",
        suburb: "Coburg",
        postcode: "3058",
        petNotes: "Tenant has two dogs – call ahead",
        equipment: [
          sp("Toshiba", 2.5, "Bedroom 1", { yearsAgo: 6 }),
          evap("Breezair", { yearsAgo: 11 }),
        ],
      },
    ],
  },
  {
    key: "eastside",
    type: "PROPERTY_MANAGER",
    name: "Eastside Property Group",
    companyName: "Eastside Property Group Pty Ltd",
    abn: "45 271 603 884",
    email: "maintenance@eastsidepg.com.au",
    source: "WEBSITE",
    createdMonthsAgo: 2,
    billing: { line1: "Suite 3, 9 Market St", suburb: "Box Hill", postcode: "3128" },
    contacts: [
      { name: "Rachel Kim", role: "Property manager", isPrimary: true },
      { name: "Tony Esposito", role: "Tenant – 10 Wantirna Rd" },
      { name: "Mei Lin", role: "Owner – 26 Bank St" },
    ],
    properties: [
      {
        addressLine1: "26 Bank St",
        suburb: "Box Hill",
        postcode: "3128",
        equipment: [sp("Hitachi", 2.5, "Bedroom", { yearsAgo: 8 }), gas("Rinnai", { yearsAgo: 8 })],
      },
      {
        addressLine1: "10 Wantirna Rd",
        suburb: "Ringwood",
        postcode: "3134",
        equipment: [du("Mitsubishi Electric", 14.0, { yearsAgo: 5 })],
      },
      {
        addressLine1: "18 Central Rd",
        suburb: "Blackburn",
        postcode: "3130",
        equipment: [evap("Bonaire", { yearsAgo: 10 }), gas("Brivis", { yearsAgo: 10 })],
      },
      {
        addressLine1: "4 Rooks Rd",
        suburb: "Mitcham",
        postcode: "3132",
        equipment: [sp("Fujitsu", 5.0, "Living room", { yearsAgo: 3 })],
      },
      {
        addressLine1: "39 Tram Rd",
        suburb: "Doncaster",
        postcode: "3108",
        equipment: [sp("Daikin", 2.5, "Bedroom 2", { yearsAgo: 2 })],
      },
    ],
  },
  // Builder
  {
    key: "maple",
    type: "BUILDER",
    name: "Maple Homes Construction",
    companyName: "Maple Homes Construction Pty Ltd",
    abn: "86 004 512 377",
    email: "sites@maplehomes.com.au",
    source: "OTHER",
    createdMonthsAgo: 13,
    billing: { line1: "Unit 7, 120 Old Geelong Rd", suburb: "Hoppers Crossing", postcode: "3029" },
    notes: "Builder account – progress claims, 30 day terms. Site induction required on each site.",
    contacts: [
      { name: "Steve Marsh", role: "Site supervisor", isPrimary: true },
      { name: "Accounts", role: "Accounts payable", email: "accounts@maplehomes.com.au" },
    ],
    properties: [
      {
        key: "maple-lot34",
        label: "Lot 34 (new build)",
        addressLine1: "Lot 34, 15 Saltwater Prm",
        suburb: "Point Cook",
        postcode: "3030",
        accessNotes: "Construction site – hi-vis and steel caps required. Sign in at site office.",
        equipment: [],
      },
      {
        label: "Lot 12 (handed over)",
        addressLine1: "Lot 12, 9 Rivergum Dr",
        suburb: "Werribee",
        postcode: "3030",
        equipment: [
          sp("Fujitsu", 2.5, "Bedroom 1", { yearsAgo: 1, installedByUs: true }),
          sp("Fujitsu", 2.5, "Bedroom 2", { yearsAgo: 1, installedByUs: true }),
          sp("Fujitsu", 7.1, "Living room", { yearsAgo: 1, installedByUs: true }),
        ],
      },
    ],
  },
];

// ─── Equipment catalogue ────────────────────────────────────────────────────

const SPLIT_MODELS: Record<string, Record<string, [string, string]>> = {
  Daikin: {
    "2.5": ["FTXM25W", "RXM25W"],
    "3.5": ["FTXM35W", "RXM35W"],
    "5.0": ["FTXM50W", "RXM50W"],
    "7.1": ["FTXM71W", "RXM71W"],
    "8.0": ["FTXM85W", "RXM85W"],
  },
  "Mitsubishi Electric": {
    "2.5": ["MSZ-AP25VGD", "MUZ-AP25VG"],
    "3.5": ["MSZ-AP35VGD", "MUZ-AP35VG"],
    "5.0": ["MSZ-AP50VGD", "MUZ-AP50VG"],
    "7.1": ["MSZ-AP71VGD", "MUZ-AP71VG"],
    "8.0": ["MSZ-AP80VGD", "MUZ-AP80VG"],
  },
  Fujitsu: {
    "2.5": ["ASTH09KMTC", "AOTH09KMTC"],
    "3.5": ["ASTH12KMTC", "AOTH12KMTC"],
    "5.0": ["ASTH18KMTC", "AOTH18KMTC"],
    "7.1": ["ASTH24KMTC", "AOTH24KMTC"],
  },
  Panasonic: {
    "2.5": ["CS-Z25XKRW", "CU-Z25XKR"],
    "3.5": ["CS-Z35XKRW", "CU-Z35XKR"],
    "5.0": ["CS-Z50XKRW", "CU-Z50XKR"],
    "7.1": ["CS-Z71XKRW", "CU-Z71XKR"],
  },
  LG: {
    "2.5": ["WH09SL-18", "WH09SL-18U"],
    "3.5": ["WH12SL-18", "WH12SL-18U"],
    "5.0": ["WH18SL-18", "WH18SL-18U"],
  },
  Samsung: {
    "2.5": ["AR09TXHZAWK", "AR09TXHZAWKX"],
    "3.5": ["AR12TXHZAWK", "AR12TXHZAWKX"],
    "5.0": ["AR18TXHZAWK", "AR18TXHZAWKX"],
  },
  Toshiba: {
    "2.5": ["RAS-10J2KVSG-A", "RAS-10J2AVSG-A"],
    "3.5": ["RAS-13J2KVSG-A", "RAS-13J2AVSG-A"],
  },
  Carrier: { "7.1": ["42QHG024DS", "38QHG024DS"] },
  Hitachi: { "2.5": ["RAK-25RXE", "RAC-25WXE"] },
};
const DUCTED_MODELS: Record<string, Record<string, [string, string]>> = {
  Daikin: { "14.0": ["FDYAN140A", "RZAS140A"] },
  "Mitsubishi Electric": { "14.0": ["PEA-M140HAA", "PUZ-ZM140YKA"] },
  ActronAir: { "14.0": ["ESP Plus IRV140S", "EVV140S"], "17.0": ["ESP Plus IRV170S", "EVV170S"] },
};
const GAS_MODELS: Record<string, string> = {
  Brivis: "StarPro SP520IN",
  Rinnai: "Ducted RDG20",
  Braemar: "TQM525IN",
};
const EVAP_MODELS: Record<string, string> = {
  Breezair: "Icon EXQ170",
  Coolair: "CPQ550",
  Bonaire: "Integra ICE180",
};

const KIND_TYPE: Record<EqKind, EquipmentType> = {
  split: "SPLIT_SYSTEM",
  ducted: "DUCTED_REFRIGERATED",
  gas: "DUCTED_GAS_HEATER",
  evap: "EVAPORATIVE_COOLER",
};
type CoreCategory = "SPLIT_SYSTEM" | "DUCTED" | "GAS_HEATING" | "EVAPORATIVE";
const TYPE_CATEGORY: Record<EqKind, CoreCategory> = {
  split: "SPLIT_SYSTEM",
  ducted: "DUCTED",
  gas: "GAS_HEATING",
  evap: "EVAPORATIVE",
};

function equipmentData(input: EqInput): Prisma.EquipmentCreateWithoutPropertyInput {
  let installDate: Date;
  let warrantyExpiresAt: Date;
  if (input.installDate) {
    installDate = input.installDate;
    warrantyExpiresAt = addMelbourneMonths(installDate, 60);
  } else if (input.warrantySoon) {
    warrantyExpiresAt = startOfMelbourneDay(addMelbourneDays(NOW, int(6, 26)));
    installDate = addMelbourneMonths(warrantyExpiresAt, -60);
  } else {
    const years = input.yearsAgo ?? int(2, 10);
    installDate = startOfMelbourneDay(
      addMelbourneDays(addMelbourneMonths(NOW, -12 * years), -int(0, 300)),
    );
    warrantyExpiresAt = addMelbourneMonths(installDate, input.kind === "gas" ? 84 : 60);
  }
  const installYear = Number(toDateInput(installDate).slice(0, 4));
  const sizeKey = input.size !== undefined ? input.size.toFixed(1) : "";
  let model: string | null = null;
  let indoorModel: string | null = null;
  let outdoorModel: string | null = null;
  let capacityKw: number | null = input.size ?? null;
  let refrigerant: string | null = null;
  if (input.kind === "split" || input.kind === "ducted") {
    const catalogue = input.kind === "split" ? SPLIT_MODELS : DUCTED_MODELS;
    const pair = catalogue[input.brand]?.[sizeKey] ?? [
      `${letters(3)}${Math.round((input.size ?? 3.5) * 10)}`,
      `${letters(3)}${Math.round((input.size ?? 3.5) * 10)}O`,
    ];
    [indoorModel, outdoorModel] = pair;
    model = indoorModel;
    refrigerant = installYear >= 2017 ? "R32" : "R410A";
  } else if (input.kind === "gas") {
    model = GAS_MODELS[input.brand] ?? "Ducted gas heater";
    capacityKw = 20;
  } else {
    model = EVAP_MODELS[input.brand] ?? "Evaporative cooler";
    capacityKw = null;
  }
  return {
    type: KIND_TYPE[input.kind],
    brand: input.brand,
    model,
    indoorModel,
    outdoorModel,
    serialNumber: `${letters(2)}${digits(7)}`,
    capacityKw,
    refrigerant,
    location: input.location,
    installDate,
    installedByUs: input.installedByUs ?? chance(0.25),
    warrantyExpiresAt,
    notes: input.notes ?? null,
  };
}

// ─── Runtime references ─────────────────────────────────────────────────────

interface PbRef {
  id: string;
  sku: string;
  name: string;
  type: ItemType;
  costCents: number;
  priceCents: number;
}
interface EqRef {
  id: string;
  type: EquipmentType;
  brand: string;
  category: CoreCategory;
  refrigerant: string | null;
  location: string | null;
  label: string;
}
interface PropRef {
  id: string;
  key: string | null;
  address: string;
  suburb: string;
  postcode: string;
  client: ClientRef;
  equipment: EqRef[];
  planId: string | null;
}
interface ClientRef {
  id: string;
  key: string;
  type: ClientType;
  name: string;
  email: string;
  phone: string;
  contactName: string;
  doNotService: boolean;
  properties: PropRef[];
}
interface LineSpec {
  priceBookItemId: string | null;
  type: ItemType;
  description: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  taxable: boolean;
}

const pbBySku = new Map<string, PbRef>();
function pb(sku: string): PbRef {
  const item = pbBySku.get(sku);
  if (!item) throw new Error(`Unknown price book SKU ${sku}`);
  return item;
}
function line(sku: string, quantity = 1, overrides: Partial<LineSpec> = {}): LineSpec {
  const item = pb(sku);
  return {
    priceBookItemId: item.id,
    type: item.type,
    description: item.name,
    quantity,
    unitPriceCents: item.priceCents,
    unitCostCents: item.costCents,
    taxable: true,
    ...overrides,
  };
}
const totalsOf = (lines: LineSpec[]) => calculateTotals(lines);

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// ─── Inventory ──────────────────────────────────────────────────────────────

type Loc = "W" | "J" | "L"; // warehouse, tech1's van, tech2's van

interface StockSeed {
  sku: string;
  reorder: number;
  supplier: string;
  supplierSku: string;
  /** Quantities wanted at the end of the seeded history (opening stocktake is worked back from these). */
  target: Record<Loc, number>;
}

const SUPPLIERS = [
  {
    key: "coolair",
    name: "Coolair Wholesale – Dandenong South",
    contact: "Trade counter (Mick)",
    phone: "03 9799 4410",
    email: "trade.dandenong@coolair-wholesale.example.com.au",
    accountNumber: "CSM-20417",
    website: "https://coolair-wholesale.example.com.au",
    notes:
      "Capacitors, fan motors, drain pumps, brackets and filters. Delivers Tue/Thu before 10am.",
  },
  {
    key: "refgas",
    name: "RefriGas Supplies Melbourne",
    contact: "Sarah Nguyen",
    phone: "03 9311 2280",
    email: "orders@refrigas.example.com.au",
    accountNumber: "77-3190",
    website: null,
    notes: "R32 and R410A cylinders (9.5 kg / 10 kg). Cylinder deposit on account. Laverton North.",
  },
  {
    key: "sparkline",
    name: "Sparkline Electrical Wholesale",
    contact: "Counter sales",
    phone: "03 9545 0071",
    email: "clayton@sparkline-elec.example.com.au",
    accountNumber: "SPK-88213",
    website: null,
    notes: "Isolators, cable and conduit. Clayton branch, open 6:30am.",
  },
  {
    key: "gasparts",
    name: "Southern Gas & Evap Parts",
    contact: "Dean Matthews",
    phone: "0412 668 903",
    email: "dean@southerngasparts.example.com.au",
    accountNumber: "SGP-1042",
    website: null,
    notes: "Igniters, flame sensors and evaporative cooler spares. Next-day courier.",
  },
  {
    key: "ductline",
    name: "Ductline Supplies (old account)",
    contact: null,
    phone: "03 9763 1200",
    email: null,
    accountNumber: "DL-5521",
    website: null,
    notes: "Switched to Coolair for filters and duct in 2025.",
    active: false,
  },
] as const;

const STOCK: StockSeed[] = [
  {
    sku: "PART-CAP",
    reorder: 6,
    supplier: "coolair",
    supplierSku: "CAP-35-5-440",
    target: { W: 8, J: 3, L: 1 },
  },
  {
    sku: "FILTER-DUCT",
    reorder: 10,
    supplier: "coolair",
    supplierSku: "RAF-600x400",
    target: { W: 4, J: 2, L: 0 },
  },
  {
    sku: "REGAS-R32",
    reorder: 10,
    supplier: "refgas",
    supplierSku: "R32-9.5",
    target: { W: 9.5, J: 3.2, L: 2.4 },
  },
  {
    sku: "REGAS-R410A",
    reorder: 10,
    supplier: "refgas",
    supplierSku: "R410A-10",
    target: { W: 0, J: 2.6, L: 1.8 },
  },
  {
    sku: "PART-DRAIN-PUMP",
    reorder: 3,
    supplier: "coolair",
    supplierSku: "MINI-ORANGE",
    target: { W: 2, J: 0, L: 0 },
  },
  {
    sku: "ISOLATOR",
    reorder: 6,
    supplier: "sparkline",
    supplierSku: "ISO-35A-2P",
    target: { W: 10, J: 3, L: 2 },
  },
  {
    sku: "BRACKET",
    reorder: 4,
    supplier: "coolair",
    supplierSku: "WB-550-HD",
    target: { W: 6, J: 1, L: 1 },
  },
  {
    sku: "PIPE-EXT",
    reorder: 20,
    supplier: "coolair",
    supplierSku: "PC-1/4-3/8-15",
    target: { W: 45, J: 8, L: 6 },
  },
  {
    sku: "COVER-DUCT",
    reorder: 15,
    supplier: "coolair",
    supplierSku: "PD-75-2M",
    target: { W: 24, J: 4, L: 3 },
  },
  {
    sku: "PART-FAN-IN",
    reorder: 1,
    supplier: "coolair",
    supplierSku: "FM-IN-UNI",
    target: { W: 1, J: 0, L: 0 },
  },
  {
    sku: "PART-FAN-OUT",
    reorder: 1,
    supplier: "coolair",
    supplierSku: "FM-OUT-UNI",
    target: { W: 0, J: 0, L: 0 },
  },
  {
    sku: "PART-STAT",
    reorder: 2,
    supplier: "coolair",
    supplierSku: "WC-UNI-WIRED",
    target: { W: 3, J: 0, L: 0 },
  },
  {
    sku: "ZONE-MOTOR",
    reorder: 2,
    supplier: "coolair",
    supplierSku: "ZM-24V",
    target: { W: 3, J: 1, L: 0 },
  },
  {
    sku: "EVAP-PUMP",
    reorder: 2,
    supplier: "gasparts",
    supplierSku: "EP-BREEZAIR",
    target: { W: 2, J: 0, L: 1 },
  },
  {
    sku: "GAS-IGNITER",
    reorder: 3,
    supplier: "gasparts",
    supplierSku: "HSI-UNI",
    target: { W: 2, J: 0, L: 1 },
  },
  {
    sku: "GAS-FLAME-SENSOR",
    reorder: 3,
    supplier: "gasparts",
    supplierSku: "FS-ROD",
    target: { W: 3, J: 0, L: -1 },
  },
];

interface StockEvent {
  at: Date;
  type: "RECEIVE" | "TRANSFER" | "ADJUST" | "JOB_USE";
  sku: string;
  qty: number;
  from?: Loc;
  to?: Loc;
  reason?: string;
  receipt?: string; // key into receipts
  unitCostCents?: number;
  jobId?: string;
  jobLineItemId?: string;
  userId: string;
}

async function seedInventory(users: {
  admin: { id: string };
  office: { id: string };
  tech1: { id: string; name: string };
  tech2: { id: string; name: string };
}): Promise<{ items: number; movements: number; low: string[] }> {
  const { admin, office, tech1, tech2 } = users;
  const opening = startOfMelbourneDay(addMelbourneDays(NOW, -60));
  const day = (offset: number, minutes: number) => at(offset, minutes);

  const suppliers = new Map<string, string>();
  for (const s of SUPPLIERS) {
    const { key, ...data } = s;
    const created = await prisma.supplier.create({
      data: { ...data, createdAt: addMelbourneMonths(NOW, -14) },
    });
    suppliers.set(key, created.id);
  }

  const warehouse = await prisma.stockLocation.create({
    data: { name: "Warehouse", type: "WAREHOUSE", createdAt: opening },
  });
  const vanJ = await prisma.stockLocation.create({
    data: { name: `${tech1.name}'s van`, type: "VAN", userId: tech1.id, createdAt: opening },
  });
  const vanL = await prisma.stockLocation.create({
    data: { name: `${tech2.name}'s van`, type: "VAN", userId: tech2.id, createdAt: opening },
  });
  const locId: Record<Loc, string> = { W: warehouse.id, J: vanJ.id, L: vanL.id };

  const itemIds = new Map<string, string>();
  for (const s of STOCK) {
    const created = await prisma.inventoryItem.create({
      data: {
        priceBookItemId: pb(s.sku).id,
        reorderLevel: s.reorder,
        supplierId: suppliers.get(s.supplier) ?? null,
        supplierSku: s.supplierSku,
        createdAt: opening,
      },
    });
    itemIds.set(s.sku, created.id);
  }

  // A flame sensor Liam fitted on his latest gas job without one in the van (shows negative stock).
  const liamJob = await prisma.job.findFirst({
    where: {
      assignments: { some: { userId: tech2.id } },
      status: { in: ["COMPLETED", "IN_PROGRESS"] },
      deletedAt: null,
      actualStart: { not: null },
    },
    orderBy: { actualStart: "desc" },
  });
  if (liamJob) {
    const sensor = pb("GAS-FLAME-SENSOR");
    const count = await prisma.jobLineItem.count({ where: { jobId: liamJob.id } });
    await prisma.jobLineItem.create({
      data: {
        jobId: liamJob.id,
        priceBookItemId: sensor.id,
        type: "PART",
        description: sensor.name,
        quantity: 1,
        unitPriceCents: sensor.priceCents,
        unitCostCents: sensor.costCents,
        sortOrder: count,
        createdAt: liamJob.actualStart ?? NOW,
      },
    });
  }

  // Parts used on recent jobs come out of the first technician's van.
  const usedLines = await prisma.jobLineItem.findMany({
    where: {
      priceBookItem: { sku: { in: STOCK.map((s) => s.sku) } },
      job: {
        deletedAt: null,
        status: { in: ["COMPLETED", "INVOICED", "IN_PROGRESS"] },
        actualStart: { gte: addMelbourneDays(opening, 2) },
      },
    },
    include: {
      priceBookItem: { select: { sku: true } },
      job: {
        select: {
          id: true,
          actualStart: true,
          actualEnd: true,
          assignments: { select: { userId: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  const receipts = {
    coolair1: {
      supplier: "coolair",
      at: day(-31, 9 * 60 + 40),
      reference: "INV-448812",
      by: office.id,
    },
    refgas1: {
      supplier: "refgas",
      at: day(-24, 8 * 60 + 15),
      reference: "DN-20931",
      by: office.id,
    },
    sparkline1: {
      supplier: "sparkline",
      at: day(-17, 7 * 60 + 5),
      reference: "C-118204",
      by: admin.id,
    },
    gas1: { supplier: "gasparts", at: day(-12, 11 * 60), reference: "SGP-7781", by: office.id },
    coolair2: {
      supplier: "coolair",
      at: day(-5, 9 * 60 + 25),
      reference: "INV-451067",
      by: office.id,
    },
  } as const;
  type ReceiptKey = keyof typeof receipts;
  const rcv = (key: ReceiptKey, sku: string, qty: number, cost?: number): StockEvent => ({
    at: receipts[key].at,
    type: "RECEIVE",
    sku,
    qty,
    to: "W",
    receipt: key,
    unitCostCents: cost ?? pb(sku).costCents,
    userId: receipts[key].by,
  });
  const move = (
    offset: number,
    to: Loc,
    sku: string,
    qty: number,
    from: Loc = "W",
  ): StockEvent => ({
    at: day(offset, 7 * 60 + 10),
    type: "TRANSFER",
    sku,
    qty,
    from,
    to,
    reason: to === "W" ? "Back to warehouse" : "Van restock",
    userId: office.id,
  });

  const events: StockEvent[] = [
    rcv("coolair1", "PART-CAP", 6, 1750),
    rcv("coolair1", "FILTER-DUCT", 6),
    rcv("coolair1", "BRACKET", 6),
    rcv("coolair1", "PIPE-EXT", 30),
    rcv("coolair1", "COVER-DUCT", 20),
    rcv("refgas1", "REGAS-R32", 9.5),
    rcv("sparkline1", "ISOLATOR", 10),
    rcv("gas1", "GAS-IGNITER", 3),
    rcv("gas1", "GAS-FLAME-SENSOR", 3),
    rcv("gas1", "EVAP-PUMP", 2),
    rcv("coolair2", "PART-CAP", 4, 1800),
    rcv("coolair2", "ZONE-MOTOR", 2),
    rcv("coolair2", "PART-STAT", 2),
    move(-30, "J", "PART-CAP", 2),
    move(-30, "L", "PART-CAP", 1),
    move(-30, "J", "FILTER-DUCT", 4),
    move(-30, "J", "PIPE-EXT", 10),
    move(-30, "L", "PIPE-EXT", 6),
    move(-30, "J", "BRACKET", 1),
    move(-23, "J", "REGAS-R410A", 2.6),
    move(-23, "L", "REGAS-R410A", 1.8),
    move(-23, "J", "REGAS-R32", 3),
    move(-23, "L", "REGAS-R32", 2.4),
    move(-16, "J", "ISOLATOR", 3),
    move(-16, "L", "ISOLATOR", 2),
    move(-11, "L", "GAS-IGNITER", 1),
    move(-11, "L", "EVAP-PUMP", 1),
    move(-4, "J", "PART-CAP", 1),
    move(-4, "J", "COVER-DUCT", 4),
    move(-4, "L", "COVER-DUCT", 3),
    move(-2, "W", "ZONE-MOTOR", 1, "L"),
    {
      at: day(-3, 16 * 60 + 30),
      type: "ADJUST",
      sku: "FILTER-DUCT",
      qty: 1,
      from: "J",
      reason: "Damaged / faulty: crushed in the van",
      userId: office.id,
    },
    {
      at: day(-9, 15 * 60),
      type: "ADJUST",
      sku: "REGAS-R410A",
      qty: 0.4,
      from: "W",
      reason: "Stocktake count: cylinder weighed 9.6 kg",
      userId: admin.id,
    },
  ];
  for (const l of usedLines) {
    const sku = l.priceBookItem!.sku!;
    const first = l.job.assignments[0]?.userId;
    const loc: Loc = first === tech1.id ? "J" : first === tech2.id ? "L" : "W";
    events.push({
      at: l.job.actualEnd ?? l.job.actualStart ?? NOW,
      type: "JOB_USE",
      sku,
      qty: Number(l.quantity),
      from: loc,
      jobId: l.job.id,
      jobLineItemId: l.id,
      unitCostCents: l.unitCostCents,
      userId: first ?? office.id,
    });
  }

  // Work the opening stocktake back from the target quantities.
  const net = new Map<string, number>();
  const bump = (sku: string, loc: Loc, delta: number) =>
    net.set(`${sku}:${loc}`, addQty(net.get(`${sku}:${loc}`) ?? 0, delta));
  for (const e of events) {
    if (e.from) bump(e.sku, e.from, -e.qty);
    if (e.to) bump(e.sku, e.to, e.qty);
  }
  const openingEvents: StockEvent[] = [];
  for (const s of STOCK) {
    for (const loc of ["W", "J", "L"] as Loc[]) {
      const qty = Math.max(0, addQty(s.target[loc], -(net.get(`${s.sku}:${loc}`) ?? 0)));
      if (qty > 0)
        openingEvents.push({
          at: addMinutes(opening, 8 * 60),
          type: "ADJUST",
          sku: s.sku,
          qty,
          to: loc,
          reason: "Stocktake count: opening balance",
          userId: admin.id,
        });
    }
  }
  const all = [...openingEvents, ...events].sort((a, b) => a.at.getTime() - b.at.getTime());

  const receiptIds = new Map<string, string>();
  for (const [key, r] of Object.entries(receipts)) {
    const lines = events.filter((e) => e.receipt === key);
    const created = await prisma.stockReceipt.create({
      data: {
        supplierId: suppliers.get(r.supplier) ?? null,
        locationId: warehouse.id,
        reference: r.reference,
        totalCostCents: lines.reduce((s, e) => s + Math.round(e.qty * (e.unitCostCents ?? 0)), 0),
        receivedAt: r.at,
        userId: r.by,
        createdAt: r.at,
      },
    });
    receiptIds.set(key, created.id);
  }

  const movements: Prisma.StockMovementCreateManyInput[] = all.map((e) => ({
    inventoryItemId: itemIds.get(e.sku)!,
    type: e.type,
    quantity: e.qty,
    fromLocationId: e.from ? locId[e.from] : null,
    toLocationId: e.to ? locId[e.to] : null,
    unitCostCents: e.unitCostCents ?? null,
    reason: e.reason ?? (e.receipt ? `Ref ${receipts[e.receipt as ReceiptKey].reference}` : null),
    jobId: e.jobId ?? null,
    jobLineItemId: e.jobLineItemId ?? null,
    receiptId: e.receipt ? receiptIds.get(e.receipt)! : null,
    userId: e.userId,
    createdAt: e.at,
    updatedAt: e.at,
  }));
  await prisma.stockMovement.createMany({ data: movements });

  // Levels are rebuilt from the ledger, exactly as the app keeps them.
  const levels = levelsFromMovements(
    movements.map((m) => ({
      inventoryItemId: m.inventoryItemId,
      type: m.type,
      quantity: Number(m.quantity),
      fromLocationId: m.fromLocationId ?? null,
      toLocationId: m.toLocationId ?? null,
    })),
  );
  await prisma.stockLevel.createMany({
    data: [...levels.entries()].map(([key, quantity]) => {
      const [inventoryItemId, locationId] = key.split(":");
      return { inventoryItemId, locationId, quantity };
    }),
  });

  const low: string[] = [];
  for (const s of STOCK) {
    const id = itemIds.get(s.sku)!;
    const total = addQty(
      ...(["W", "J", "L"] as Loc[]).map((l) => levels.get(`${id}:${locId[l]}`) ?? 0),
    );
    if (stockStatus(total, s.reorder) !== "OK") low.push(pb(s.sku).name);
    for (const l of ["W", "J", "L"] as Loc[]) {
      const actual = levels.get(`${id}:${locId[l]}`) ?? 0;
      if (actual !== s.target[l])
        console.warn(`Stock for ${s.sku} at ${l} is ${actual} (wanted ${s.target[l]})`);
    }
  }
  return { items: STOCK.length, movements: movements.length, low };
}

// ─── SMS ────────────────────────────────────────────────────────────────────
// No provider is configured in the demo, so texts are LOGGED (written to the log, not sent),
// exactly what the app records with the console provider.

async function seedSms(officeId: string): Promise<number> {
  const biz = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
  const t = DEFAULT_SMS_TEMPLATES;
  const clientInclude = {
    contacts: { orderBy: [{ isPrimary: "desc" as const }, { createdAt: "asc" as const }] },
  };
  const rows: Prisma.SmsMessageCreateManyInput[] = [];
  const activities: Prisma.ActivityCreateManyInput[] = [];
  const reminders: Prisma.ReminderCreateManyInput[] = [];
  const LABEL = {
    ON_MY_WAY: "On my way",
    APPOINTMENT_REMINDER: "Appointment reminder",
    SERVICE_DUE: "Service due",
    MANUAL: "One-off",
  } as const;

  function add(input: {
    kind: keyof typeof LABEL;
    client: {
      id: string;
      type: string;
      name: string;
      phone: string | null;
      altPhone: string | null;
      noSms: boolean;
      contacts: { name: string; phone: string | null }[];
    };
    template: string;
    vars: Record<string, string>;
    at: Date;
    jobId?: string;
    planId?: string;
    sentById?: string | null;
  }) {
    const { client } = input;
    const body = renderSms(input.template, {
      clientName: greetingName(client),
      businessName: biz.tradingName || biz.businessName,
      businessPhone: biz.phone ?? "",
      ...input.vars,
    });
    const recipient = pickMobile([
      client.phone,
      client.altPhone,
      ...client.contacts.map((c) => c.phone),
    ]);
    const reason = client.noSms
      ? "Client has opted out of SMS (No SMS)"
      : recipient.ok
        ? null
        : recipient.reason;
    const to = recipient.ok ? recipient.e164 : null;
    rows.push({
      kind: input.kind,
      status: reason ? "SKIPPED" : "LOGGED",
      to,
      rawPhone: recipient.raw,
      body,
      segments: countSegments(body).segments,
      provider: reason ? "none" : "console",
      error: reason,
      clientId: client.id,
      jobId: input.jobId ?? null,
      maintenancePlanId: input.planId ?? null,
      sentById: input.sentById ?? null,
      createdAt: input.at,
    });
    const who = to ? `0${to.slice(3, 6)} ${to.slice(6, 9)} ${to.slice(9)}` : "no number";
    activities.push({
      entityType: input.jobId ? "JOB" : "CLIENT",
      entityId: input.jobId ?? client.id,
      type: "SMS",
      body: `${LABEL[input.kind]} text ${reason ? `not sent: ${reason}` : `logged for ${who} (SMS not set up, not sent)`}\n“${body}”`,
      userId: input.sentById ?? null,
      createdAt: input.at,
    });
  }

  const jobInclude = {
    client: { include: clientInclude },
    property: true,
    assignments: {
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" as const },
    },
  };
  const jobVars = (j: {
    number: string;
    title: string;
    scheduledStart: Date | null;
    property: { addressLine1: string; suburb: string } | null;
    assignments: { user: { name: string } }[];
  }) => ({
    jobNumber: j.number,
    jobTitle: j.title,
    techName: firstName(j.assignments[0]?.user.name) || "our technician",
    address: j.property ? `${j.property.addressLine1}, ${j.property.suburb}` : "",
    suburb: j.property?.suburb ?? "",
    date: j.scheduledStart
      ? j.scheduledStart.toLocaleDateString("en-AU", {
          weekday: "short",
          day: "numeric",
          month: "short",
          timeZone: "Australia/Melbourne",
        })
      : "",
    time: j.scheduledStart
      ? j.scheduledStart
          .toLocaleTimeString("en-AU", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "Australia/Melbourne",
          })
          .replace(" ", "")
      : "",
  });

  // Visits in the last three days that the technician started: an appointment reminder the
  // day before (8am) and an on-my-way text when they set off.
  const visits = await prisma.job.findMany({
    where: {
      deletedAt: null,
      enRouteAt: { not: null },
      scheduledStart: { gte: addMelbourneDays(TODAY_START, -3), lte: NOW },
    },
    include: jobInclude,
    orderBy: { scheduledStart: "asc" },
    take: 8,
  });
  for (const j of visits) {
    const day = startOfMelbourneDay(j.scheduledStart!);
    add({
      kind: "APPOINTMENT_REMINDER",
      client: j.client,
      template: t.appointmentReminder,
      vars: jobVars(j),
      at: addMinutes(addMelbourneDays(day, -1), 8 * 60 + 1),
      jobId: j.id,
    });
    reminders.push({
      key: `APPOINTMENT_REMINDER:${j.id}:${toDateInput(j.scheduledStart)}`,
      type: "APPOINTMENT_REMINDER",
      entityType: "JOB",
      entityId: j.id,
      channel: "SMS",
      status: "SENT",
      dueAt: addMinutes(addMelbourneDays(day, -1), 8 * 60),
      sentAt: addMinutes(addMelbourneDays(day, -1), 8 * 60 + 1),
    });
    add({
      kind: "ON_MY_WAY",
      client: j.client,
      template: t.onMyWay,
      vars: jobVars(j),
      at: j.enRouteAt!,
      jobId: j.id,
      sentById: j.assignments[0]?.user.id ?? null,
    });
  }

  // Office: a one-off "running late" text for the next job today.
  const later = await prisma.job.findFirst({
    where: {
      deletedAt: null,
      status: "SCHEDULED",
      scheduledStart: { gte: NOW, lt: addMelbourneDays(TODAY_START, 1) },
      client: { noSms: false },
    },
    include: jobInclude,
    orderBy: { scheduledStart: "asc" },
  });
  if (later) {
    add({
      kind: "MANUAL",
      client: later.client,
      template: t.runningLate,
      vars: jobVars(later),
      at: addMinutes(NOW, -35),
      jobId: later.id,
      sentById: officeId,
    });
  }

  // Service-due text for the plan due soonest within the 14-day window.
  const plan = await prisma.maintenancePlan.findFirst({
    where: {
      active: true,
      nextDueDate: { gte: TODAY_START, lte: addMelbourneDays(TODAY_START, 14) },
      client: { deletedAt: null, doNotService: false },
    },
    include: { client: { include: clientInclude } },
    orderBy: { nextDueDate: "asc" },
  });
  if (plan) {
    const at = addMinutes(TODAY_START, 8 * 60 + 2);
    add({
      kind: "SERVICE_DUE",
      client: plan.client,
      template: t.serviceDue,
      vars: {
        planName: plan.name,
        dueDate: plan.nextDueDate.toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Australia/Melbourne",
        }),
      },
      at: at < NOW ? at : addMinutes(NOW, -5),
      planId: plan.id,
    });
    reminders.push({
      key: `SERVICE_DUE:${plan.id}:${toDateInput(plan.nextDueDate)}:SMS`,
      type: "SERVICE_DUE",
      entityType: "MAINTENANCE_PLAN",
      entityId: plan.id,
      channel: "SMS",
      status: "SENT",
      dueAt: at,
      sentAt: at,
    });
  }

  // The opted-out client: their on-my-way text was skipped (shows why on the job).
  const optedOut = await prisma.job.findFirst({
    where: { deletedAt: null, enRouteAt: { not: null }, client: { noSms: true } },
    include: jobInclude,
    orderBy: { scheduledStart: "desc" },
  });
  if (optedOut) {
    add({
      kind: "ON_MY_WAY",
      client: optedOut.client,
      template: t.onMyWay,
      vars: jobVars(optedOut),
      at: optedOut.enRouteAt!,
      jobId: optedOut.id,
      sentById: optedOut.assignments[0]?.user.id ?? null,
    });
  }

  await prisma.smsMessage.createMany({ data: rows });
  await prisma.activity.createMany({ data: activities });
  await prisma.reminder.createMany({ data: reminders, skipDuplicates: true });
  return rows.length;
}

// ─── Seed ───────────────────────────────────────────────────────────────────

async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function main(): Promise<void> {
  const started = Date.now();
  await resetDatabase();

  // ── Users and licences ──
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const userCreatedAt = addMelbourneMonths(NOW, -18);
  const admin = await prisma.user.create({
    data: {
      name: "Alex Morgan",
      email: "admin@coolops.local",
      passwordHash,
      role: "ADMIN",
      phone: "0412 345 678",
      color: "#7c3aed",
      hourlyCostCents: 0,
      createdAt: userCreatedAt,
    },
  });
  const office = await prisma.user.create({
    data: {
      name: "Priya Shah",
      email: "office@coolops.local",
      passwordHash,
      role: "OFFICE",
      phone: "0423 556 120",
      color: "#db2777",
      hourlyCostCents: 3800,
      createdAt: userCreatedAt,
    },
  });
  const tech1 = await prisma.user.create({
    data: {
      name: "Jack Wilson",
      email: "tech1@coolops.local",
      passwordHash,
      role: "TECHNICIAN",
      phone: "0438 201 774",
      color: "#2563eb",
      hourlyCostCents: 4500,
      createdAt: userCreatedAt,
    },
  });
  const tech2 = await prisma.user.create({
    data: {
      name: "Liam Chen",
      email: "tech2@coolops.local",
      passwordHash,
      role: "TECHNICIAN",
      phone: "0451 093 386",
      color: "#16a34a",
      hourlyCostCents: 5200,
      createdAt: userCreatedAt,
    },
  });
  const techs = [tech1, tech2];
  const techCost = new Map<string, number>([
    [tech1.id, tech1.hourlyCostCents],
    [tech2.id, tech2.hourlyCostCents],
  ]);
  const techName = new Map<string, string>([
    [tech1.id, tech1.name],
    [tech2.id, tech2.name],
  ]);

  const tech1ArcExpiry = startOfMelbourneDay(addMelbourneDays(NOW, 20));
  await prisma.technicianLicence.createMany({
    data: [
      {
        userId: tech1.id,
        type: "ARC_REFRIGERANT",
        number: "L183452",
        issuedAt: addMelbourneMonths(tech1ArcExpiry, -24),
        expiresAt: tech1ArcExpiry,
      },
      {
        userId: tech1.id,
        type: "ELECTRICAL",
        number: "REL-41872",
        issuedAt: addMelbourneMonths(NOW, -26),
        expiresAt: startOfMelbourneDay(addMelbourneMonths(NOW, 34)),
      },
      {
        userId: tech1.id,
        type: "DRIVERS",
        number: "052118734",
        issuedAt: addMelbourneMonths(NOW, -40),
        expiresAt: startOfMelbourneDay(addMelbourneMonths(NOW, 80)),
      },
      {
        userId: tech2.id,
        type: "ARC_REFRIGERANT",
        number: "L204871",
        issuedAt: addMelbourneMonths(NOW, -11),
        expiresAt: startOfMelbourneDay(addMelbourneMonths(NOW, 13)),
      },
      {
        userId: tech2.id,
        type: "GAS_FITTING",
        number: "PL38214",
        issuedAt: addMelbourneMonths(NOW, -4),
        expiresAt: startOfMelbourneDay(addMelbourneMonths(NOW, 8)),
      },
      {
        userId: tech2.id,
        type: "ELECTRICAL",
        number: "REL-50391",
        issuedAt: addMelbourneMonths(NOW, -14),
        expiresAt: startOfMelbourneDay(addMelbourneMonths(NOW, 46)),
      },
      {
        userId: tech2.id,
        type: "DRIVERS",
        number: "061447290",
        issuedAt: addMelbourneMonths(NOW, -30),
        expiresAt: startOfMelbourneDay(addMelbourneMonths(NOW, 90)),
      },
    ],
  });

  // ── Business settings ──
  await prisma.businessSettings.create({
    data: {
      id: "singleton",
      businessName: "Cooling Service Melbourne",
      abn: "00 000 000 000",
      email: "office@coolingservicemelbourne.com.au",
      phone: "(03) 9000 0000",
      website: "https://coolingservicemelbourne.com.au",
      addressLine1: "Unit 4, 21 Industrial Dr",
      suburb: "Braeside",
      state: "VIC",
      postcode: "3195",
      bankName: "Commonwealth Bank",
      bsb: "063-000",
      accountNumber: "1234 5678",
      accountName: "Cooling Service Melbourne",
      gstRegistered: true,
      defaultPaymentTerms: "DAYS_14",
      defaultPaymentTermsDays: 14,
      quoteValidityDays: 30,
      quotePrefix: "Q",
      jobPrefix: "J",
      invoicePrefix: "INV",
      creditNotePrefix: "CN",
      invoiceFooter:
        "Thank you for choosing Cooling Service Melbourne. Please use the invoice number as your payment reference. Payment by bank transfer (details above) or card via the online payment link. A 1.5% surcharge applies to credit card payments.",
      quoteTerms: [
        "1. This quote is valid for 30 days from the date of issue. Prices are in AUD and include GST where shown.",
        "2. Installations over $5,000 inc GST require a 50% deposit to secure equipment and book an installation date. The balance is due on completion.",
        "3. Standard installation assumes back-to-back mounting, up to 3m of pipe run, and existing safe roof and wall access. Additional pipework, electrical upgrades, structural work or asbestos-related delays will be quoted before proceeding.",
        "4. All refrigeration work is carried out by ARC-licensed technicians. Gas work is completed by a licensed gasfitter and a compliance certificate is issued on completion.",
        "5. Equipment is covered by the manufacturer's warranty (typically 5 years parts and labour for split and ducted systems). Our workmanship is guaranteed for 2 years from installation.",
        "6. Equipment remains the property of Cooling Service Melbourne until paid in full.",
        "7. Cancellations within 48 hours of a booked installation may incur a re-booking fee of $150.",
      ].join("\n"),
      emailTemplates: toJson(DEFAULT_EMAIL_TEMPLATES),
      smsSettings: toJson({ enabled: DEFAULT_SMS_ENABLED, templates: DEFAULT_SMS_TEMPLATES }),
      // Xero mapping defaults (Xero AU chart: 200 Sales, GST on Income / GST Free Income).
      // Not connected: connecting needs the business's own Xero login (Integrations page).
      xeroSettings: toJson(DEFAULT_XERO_SETTINGS),
    },
  });

  // ── Price book ──
  for (const item of PRICE_BOOK) {
    const created = await prisma.priceBookItem.create({
      data: { ...item, taxable: true, createdAt: addMelbourneMonths(NOW, -18) },
    });
    pbBySku.set(item.sku, {
      id: created.id,
      sku: item.sku,
      name: item.name,
      type: item.type,
      costCents: item.costCents,
      priceCents: item.priceCents,
    });
  }

  // ── Checklist templates ──
  const templateItems = new Map<string, string[]>();
  for (const t of CHECKLISTS) {
    await prisma.jobChecklistTemplate.create({
      data: {
        name: t.name,
        jobType: t.jobType,
        serviceCategory: t.serviceCategory,
        items: t.items,
      },
    });
    templateItems.set(`${t.jobType}:${t.serviceCategory ?? ""}`, t.items);
  }

  // ── Clients, contacts, properties, equipment ──
  const clients = new Map<string, ClientRef>();
  const allProps: PropRef[] = [];
  const propByKey = new Map<string, PropRef>();
  let equipmentCount = 0;
  for (const c of CLIENTS) {
    const phone = c.type === "RESIDENTIAL" ? mobile() : landline();
    const first = c.properties[0];
    const billing = c.billing ?? {
      line1: first.addressLine1,
      suburb: first.suburb,
      postcode: first.postcode,
    };
    const createdAt = addMelbourneDays(addMelbourneMonths(NOW, -c.createdMonthsAgo), -int(0, 20));
    const client = await prisma.client.create({
      data: {
        type: c.type,
        name: c.name,
        companyName: c.companyName ?? null,
        abn: c.abn ?? null,
        email: c.email,
        phone,
        altPhone: c.type === "RESIDENTIAL" && chance(0.3) ? mobile() : null,
        billingLine1: billing.line1,
        billingSuburb: billing.suburb,
        billingState: "VIC",
        billingPostcode: billing.postcode,
        notes: c.notes ?? null,
        tags: c.tags ?? [],
        source: c.source ?? null,
        doNotService: c.doNotService ?? false,
        noSms: c.noSms ?? false,
        createdAt,
        contacts: c.contacts
          ? {
              create: c.contacts.map((ct) => ({
                name: ct.name,
                role: ct.role,
                phone: ct.phone ?? mobile(),
                email:
                  ct.email ??
                  `${ct.name
                    .toLowerCase()
                    .replace(/[^a-z]+/g, ".")
                    .replace(/^\.|\.$/g, "")}@${c.email.split("@")[1]}`,
                isPrimary: ct.isPrimary ?? false,
              })),
            }
          : undefined,
      },
    });
    const ref: ClientRef = {
      id: client.id,
      key: c.key,
      type: c.type,
      name: c.name,
      email: c.email,
      phone,
      contactName: c.contacts?.find((x) => x.isPrimary)?.name ?? c.name.split(" & ")[0],
      doNotService: c.doNotService ?? false,
      properties: [],
    };
    clients.set(c.key, ref);
    for (const p of c.properties) {
      const created = await prisma.property.create({
        data: {
          clientId: client.id,
          label: p.label ?? null,
          addressLine1: p.addressLine1,
          suburb: p.suburb,
          state: "VIC",
          postcode: p.postcode,
          accessNotes: p.accessNotes ?? null,
          parkingNotes: p.parkingNotes ?? null,
          petNotes: p.petNotes ?? null,
          keyInfo: p.keyInfo ?? null,
          createdAt,
          equipment: { create: p.equipment.map((e) => ({ ...equipmentData(e), createdAt })) },
        },
        include: { equipment: { orderBy: { createdAt: "asc" } } },
      });
      equipmentCount += created.equipment.length;
      const prop: PropRef = {
        id: created.id,
        key: p.key ?? null,
        address: `${p.addressLine1}, ${p.suburb} VIC ${p.postcode}`,
        suburb: p.suburb,
        postcode: p.postcode,
        client: ref,
        planId: null,
        equipment: created.equipment.map((e, i) => {
          const kind = p.equipment[i].kind;
          return {
            id: e.id,
            type: e.type,
            brand: e.brand,
            category: TYPE_CATEGORY[kind],
            refrigerant: e.refrigerant,
            location: e.location,
            label: `${e.brand} ${e.model ?? ""}`.trim(),
          };
        }),
      };
      ref.properties.push(prop);
      allProps.push(prop);
      if (p.key) propByKey.set(p.key, prop);
    }
  }
  const client = (key: string): ClientRef => {
    const c = clients.get(key);
    if (!c) throw new Error(`Unknown client ${key}`);
    return c;
  };
  const propOf = (key: string): PropRef => {
    const c = clients.get(key);
    if (c) return c.properties[0];
    const p = propByKey.get(key);
    if (!p) throw new Error(`Unknown property ${key}`);
    return p;
  };

  // ── Quotes (specs first, created after leads) ──
  interface OptionSpec {
    name: string;
    description: string;
    lines: LineSpec[];
  }
  interface QuoteSpec {
    clientKey: string;
    propKey: string;
    status: QuoteStatus;
    createdOffset: number;
    title: string;
    intro: string;
    category: ServiceCategory;
    brand: string;
    options: OptionSpec[];
    selected?: number;
    lostReason?: string;
    leadSource?: LeadSource;
    installEquipment?: EqInput[];
    jobOffset?: number | null; // accepted: install job day (null = unscheduled)
    jobMinutes?: number;
  }
  const splitInstall = (
    sku: string,
    label: string,
    extras: [string, number][] = [["PIPE-EXT", 2]],
  ): LineSpec[] => [
    line(sku, 1, {
      description: `${label} reverse cycle split system – supply and standard back-to-back install`,
    }),
    line("ISOLATOR"),
    ...extras.map(([s, q]) => line(s, q)),
  ];
  const goodBetterBest = (
    location: string,
    opts: [string, string, string][], // [tier, sku, label]
    extras: [string, number][] = [["PIPE-EXT", 2]],
  ): OptionSpec[] =>
    opts.map(([tier, sku, label]) => ({
      name: `${tier} – ${label}`,
      description: `${label} for the ${location.toLowerCase()}. Includes standard install, isolator and commissioning.`,
      lines: splitInstall(sku, label, extras),
    }));

  const QUOTES: QuoteSpec[] = [
    // Accepted
    {
      clientKey: "bennett",
      propKey: "bennett",
      status: "ACCEPTED",
      createdOffset: -86,
      category: "SPLIT_SYSTEM",
      brand: "Daikin",
      leadSource: "GOOGLE_ADS",
      title: "Reverse cycle split system – living room",
      intro:
        "Thanks for having us out to measure up. Based on the 32m² open living area we recommend a 3.5kW to 5.0kW system.",
      options: goodBetterBest(
        "Living room",
        [
          ["Good", "INST-SPLIT-25", "Fujitsu Lifestyle 2.5kW"],
          ["Better", "INST-SPLIT-35", "Daikin Cora 3.5kW"],
          ["Best", "INST-SPLIT-50", "Mitsubishi Electric 5.0kW"],
        ],
        [
          ["PIPE-EXT", 3],
          ["COVER-DUCT", 2],
        ],
      ),
      selected: 1,
      installEquipment: [sp("Daikin", 3.5, "Living room", { installedByUs: true })],
      jobOffset: -70,
      jobMinutes: 300,
    },
    {
      clientKey: "ironrepublic",
      propKey: "ironrepublic",
      status: "ACCEPTED",
      createdOffset: -58,
      category: "COMMERCIAL_HVAC",
      brand: "Mitsubishi Electric",
      leadSource: "GOOGLE_ADS",
      title: "2 x high wall splits – weights area",
      intro:
        "Supplementary cooling for the weights area where the existing ducted system can't keep up in summer.",
      options: [
        {
          name: "Option A – 2 x Mitsubishi Electric 8.0kW",
          description: "Two 8.0kW high wall units on a dedicated circuit.",
          lines: [
            line("INST-SPLIT-80", 2, {
              description: "Mitsubishi Electric MSZ-AP80VGD 8.0kW split – supply and install",
            }),
            line("ELEC-CIRCUIT"),
            line("PIPE-EXT", 6),
            line("COVER-DUCT", 4),
          ],
        },
        {
          name: "Option B – 2 x Daikin 7.1kW",
          description: "Two 7.1kW high wall units on a dedicated circuit.",
          lines: [
            line("INST-SPLIT-71", 2, {
              description: "Daikin FTXM71W 7.1kW split – supply and install",
            }),
            line("ELEC-CIRCUIT"),
            line("PIPE-EXT", 6),
            line("COVER-DUCT", 4),
          ],
        },
      ],
      selected: 0,
      installEquipment: [
        sp("Mitsubishi Electric", 8.0, "Weights area – north wall", { installedByUs: true }),
        sp("Mitsubishi Electric", 8.0, "Weights area – south wall", { installedByUs: true }),
      ],
      jobOffset: -40,
      jobMinutes: 420,
    },
    {
      clientKey: "fraser",
      propKey: "fraser",
      status: "ACCEPTED",
      createdOffset: -32,
      category: "GAS_HEATING",
      brand: "Brivis",
      leadSource: "WEBSITE",
      title: "Ducted gas heater replacement",
      intro:
        "Your existing Rinnai heater failed its CO test and the heat exchanger is cracked, so replacement is recommended.",
      options: [
        {
          name: "Standard – Brivis StarPro 5 star",
          description: "Like-for-like replacement using existing ductwork and controller.",
          lines: [
            line("INST-GAS-DUCTED", 1, {
              description: "Brivis StarPro SP520IN 5 star ducted gas heater – supply and install",
            }),
            line("DISPOSAL"),
          ],
        },
        {
          name: "Upgrade – Brivis StarPro + Networker zoning",
          description: "Replacement heater plus Networker controller and two zone motors.",
          lines: [
            line("INST-GAS-DUCTED", 1, {
              description: "Brivis StarPro SP520IN 5 star ducted gas heater – supply and install",
            }),
            line("PART-STAT", 1, { description: "Brivis Networker touch controller" }),
            line("ZONE-MOTOR", 2),
            line("DISPOSAL"),
          ],
        },
      ],
      selected: 1,
      installEquipment: [gas("Brivis", { installedByUs: true })],
      jobOffset: -15,
      jobMinutes: 360,
    },
    {
      clientKey: "henderson",
      propKey: "henderson",
      status: "ACCEPTED",
      createdOffset: -20,
      category: "DUCTED",
      brand: "ActronAir",
      leadSource: "REPEAT_CUSTOMER",
      title: "Ducted reverse cycle – replace evaporative cooler",
      intro:
        "Replacing the 16 year old Breezair with ducted refrigerated cooling, reusing the existing gas heating ductwork where possible.",
      options: [
        {
          name: "ActronAir 14kW – 8 outlets",
          description: "ActronAir ESP Plus 14kW with 8 outlets and single zone.",
          lines: [
            line("INST-DUCTED-14", 1, {
              description: "ActronAir ESP Plus 14kW ducted reverse cycle – supply and install",
            }),
            line("DISPOSAL", 1, {
              description: "Remove evaporative cooler, patch roof and ceiling",
            }),
            line("ELEC-CIRCUIT"),
          ],
        },
        {
          name: "ActronAir 14kW – 10 outlets, 4 zones",
          description: "Adds two outlets and four-zone control with wall controller.",
          lines: [
            line("INST-DUCTED-14", 1, {
              description: "ActronAir ESP Plus 14kW ducted reverse cycle – supply and install",
            }),
            line("DUCT-OUTLET", 2),
            line("ZONE-MOTOR", 4),
            line("PART-STAT", 1, { description: "ActronAir LM24 wall controller" }),
            line("DISPOSAL", 1, {
              description: "Remove evaporative cooler, patch roof and ceiling",
            }),
            line("ELEC-CIRCUIT"),
          ],
        },
      ],
      selected: 1,
      jobOffset: 6,
      jobMinutes: 480,
    },
    {
      clientKey: "maple",
      propKey: "maple-lot34",
      status: "ACCEPTED",
      createdOffset: -10,
      category: "SPLIT_SYSTEM",
      brand: "Fujitsu",
      leadSource: "OTHER",
      title: "Lot 34 – three split systems (new build)",
      intro: "As per plans rev C: two bedrooms and the open plan living area.",
      options: [
        {
          name: "Fujitsu package",
          description: "2 x 2.5kW bedroom units and 1 x 5.0kW living unit.",
          lines: [
            line("INST-SPLIT-25", 2, {
              description: "Fujitsu ASTH09KMTC 2.5kW split – supply and install",
            }),
            line("INST-SPLIT-50", 1, {
              description: "Fujitsu ASTH18KMTC 5.0kW split – supply and install",
            }),
            line("PIPE-EXT", 8),
            line("ISOLATOR", 3),
          ],
        },
      ],
      selected: 0,
      jobOffset: null,
      jobMinutes: 480,
    },
    // Sent
    {
      clientKey: "zhang",
      propKey: "zhang",
      status: "SENT",
      createdOffset: -6,
      category: "EVAPORATIVE",
      brand: "Breezair",
      leadSource: "WEBSITE",
      title: "Evaporative cooler supply and install",
      intro: "Whole-of-home evaporative cooling using a roof-mounted Breezair unit with 6 outlets.",
      options: [
        {
          name: "Breezair Icon EXQ170",
          description: "Includes 6 outlets, wall controller and dedicated circuit.",
          lines: [
            line("INST-EVAP", 1, {
              description: "Breezair Icon EXQ170 evaporative cooler – supply and install",
            }),
            line("ELEC-CIRCUIT"),
          ],
        },
      ],
    },
    {
      clientKey: "murphy",
      propKey: "murphy",
      status: "SENT",
      createdOffset: -4,
      category: "SPLIT_SYSTEM",
      brand: "Daikin",
      leadSource: "GOOGLE_BUSINESS_PROFILE",
      title: "Split system – master bedroom",
      intro: "Options for the master bedroom as discussed on site.",
      options: goodBetterBest("Master bedroom", [
        ["Good", "INST-SPLIT-25", "Fujitsu Lifestyle 2.5kW"],
        ["Better", "INST-SPLIT-25", "Daikin Cora 2.5kW"],
        ["Best", "INST-SPLIT-35", "Mitsubishi Electric 3.5kW"],
      ]),
    },
    {
      clientKey: "southside",
      propKey: "southside",
      status: "SENT",
      createdOffset: -9,
      category: "COMMERCIAL_HVAC",
      brand: "Daikin",
      leadSource: "REPEAT_CUSTOMER",
      title: "Repair – unit 2 outdoor inverter board",
      intro:
        "Unit 2 is faulting with an L5 error. Diagnosis confirmed a failed outdoor inverter PCB.",
      options: [
        {
          name: "Replace inverter PCB",
          description: "Genuine Daikin replacement board, fitted and tested.",
          lines: [
            line("PART-PCB-OUT", 1, { description: "Daikin genuine outdoor inverter PCB" }),
            line("LAB-HR", 3),
            line("CALLOUT"),
          ],
        },
      ],
    },
    {
      clientKey: "lee",
      propKey: "lee",
      status: "SENT",
      createdOffset: -12,
      category: "GAS_HEATING",
      brand: "Brivis",
      leadSource: "GOOGLE_ADS",
      title: "Ducted gas heater replacement",
      intro:
        "Your 17 year old Braemar has surface rust on the heat exchanger. Two replacement options below.",
      options: [
        {
          name: "Brivis StarPro 5 star",
          description: "Like-for-like replacement.",
          lines: [line("INST-GAS-DUCTED"), line("DISPOSAL")],
        },
        {
          name: "Rinnai 6 star with zoning",
          description: "Higher efficiency model with two zones.",
          lines: [
            line("INST-GAS-DUCTED", 1, {
              unitPriceCents: 589000,
              description: "Rinnai 6 star ducted gas heater – supply and install",
            }),
            line("ZONE-MOTOR", 2),
            line("PART-STAT"),
            line("DISPOSAL"),
          ],
        },
      ],
    },
    // Viewed
    {
      clientKey: "papadopoulos",
      propKey: "papadopoulos",
      status: "VIEWED",
      createdOffset: -8,
      category: "SPLIT_SYSTEM",
      brand: "Mitsubishi Electric",
      leadSource: "FACEBOOK",
      title: "Split system – upstairs retreat",
      intro: "The upstairs retreat isn't on the ducted system. Two sizing options below.",
      options: goodBetterBest(
        "Upstairs retreat",
        [
          ["Good", "INST-SPLIT-25", "Mitsubishi Electric 2.5kW"],
          ["Better", "INST-SPLIT-35", "Mitsubishi Electric 3.5kW"],
        ],
        [
          ["PIPE-EXT", 5],
          ["COVER-DUCT", 4],
        ],
      ),
    },
    {
      clientKey: "patel",
      propKey: "patel",
      status: "VIEWED",
      createdOffset: -14,
      category: "EVAPORATIVE",
      brand: "Coolair",
      leadSource: "GOOGLE_BUSINESS_PROFILE",
      title: "Replace evaporative cooler",
      intro: "Your Coolair is 13 years old and the tank is leaking into the roof space.",
      options: [
        {
          name: "Coolair CPQ550 replacement",
          description: "Like-for-like replacement on the existing roof transition.",
          lines: [
            line("INST-EVAP", 1, {
              description: "Coolair CPQ550 evaporative cooler – supply and install",
              unitPriceCents: 549000,
            }),
            line("DISPOSAL"),
          ],
        },
      ],
    },
    {
      clientKey: "harbour",
      propKey: "harbour-patty",
      status: "VIEWED",
      createdOffset: -3,
      category: "SPLIT_SYSTEM",
      brand: "Fujitsu",
      leadSource: "REPEAT_CUSTOMER",
      title: "Replace failed split system – 8 Patty St",
      intro:
        "PM work order WO-22817. The 12 year old Fujitsu compressor has failed; replacement is more economical than repair.",
      options: goodBetterBest(
        "Living room",
        [
          ["Option 1", "INST-SPLIT-35", "Fujitsu 3.5kW"],
          ["Option 2", "INST-SPLIT-35", "Daikin 3.5kW"],
        ],
        [["DISPOSAL", 1]],
      ),
    },
    // Draft
    {
      clientKey: "walsh",
      propKey: "walsh",
      status: "DRAFT",
      createdOffset: -1,
      category: "SPLIT_SYSTEM",
      brand: "Panasonic",
      leadSource: "INSTAGRAM",
      title: "Two bedroom split systems",
      intro: "Two 2.5kW units for bedrooms 2 and 3, outdoor units side by side on the east wall.",
      options: [
        {
          name: "Panasonic 2 x 2.5kW",
          description: "Two Panasonic Aero 2.5kW units.",
          lines: [
            line("INST-SPLIT-25", 2, {
              description: "Panasonic CS-Z25XKRW 2.5kW split – supply and install",
            }),
            line("PIPE-EXT", 4),
            line("ISOLATOR", 2),
          ],
        },
      ],
    },
    {
      clientKey: "northern",
      propKey: "northern-wilson",
      status: "DRAFT",
      createdOffset: -2,
      category: "GAS_HEATING",
      brand: "Brivis",
      leadSource: "PHONE",
      title: "Gas heater replacement – 5 Wilson St",
      intro:
        "Heater isolated after failed CO test. Replacement required before tenants can use heating.",
      options: [
        {
          name: "Brivis StarPro 5 star",
          description: "Replacement using existing ductwork.",
          lines: [line("INST-GAS-DUCTED"), line("DISPOSAL")],
        },
      ],
    },
    {
      clientKey: "mohammed",
      propKey: "mohammed",
      status: "DRAFT",
      createdOffset: -5,
      category: "SPLIT_SYSTEM",
      brand: "LG",
      leadSource: "REFERRAL",
      title: "Split system – living area",
      intro: "Cooling for the living area to go with the existing gas ducted heating.",
      options: goodBetterBest("Living area", [
        ["Good", "INST-SPLIT-50", "LG 5.0kW"],
        ["Better", "INST-SPLIT-71", "Daikin 7.1kW"],
      ]),
    },
    // Declined
    {
      clientKey: "robertson",
      propKey: "robertson",
      status: "DECLINED",
      createdOffset: -25,
      category: "SPLIT_SYSTEM",
      brand: "Mitsubishi Electric",
      leadSource: "WEBSITE",
      lostReason: "Too expensive",
      title: "Replace bedroom split system",
      intro: "Replacement for the 10 year old bedroom unit, balcony mounted.",
      options: [
        {
          name: "Mitsubishi Electric 2.5kW",
          description: "Like-for-like replacement.",
          lines: [...splitInstall("INST-SPLIT-25", "Mitsubishi Electric 2.5kW", [["DISPOSAL", 1]])],
        },
      ],
    },
    {
      clientKey: "kowalski",
      propKey: "kowalski",
      status: "DECLINED",
      createdOffset: -40,
      category: "DUCTED",
      brand: "Daikin",
      leadSource: "FACEBOOK",
      lostReason: "Not ready / timing",
      title: "Ducted reverse cycle system",
      intro: "Whole-of-home ducted reverse cycle to replace the split and old gas heater.",
      options: [
        {
          name: "Daikin 14kW – 8 outlets",
          description: "Single zone.",
          lines: [line("INST-DUCTED-14"), line("DISPOSAL", 2)],
        },
        {
          name: "Daikin 14kW – 8 outlets, 3 zones",
          description: "Three-zone control.",
          lines: [
            line("INST-DUCTED-14"),
            line("ZONE-MOTOR", 3),
            line("PART-STAT"),
            line("DISPOSAL", 2),
          ],
        },
      ],
    },
    {
      clientKey: "beancounter",
      propKey: "beancounter",
      status: "DECLINED",
      createdOffset: -55,
      category: "COMMERCIAL_HVAC",
      brand: "Mitsubishi Electric",
      leadSource: "WALK_IN",
      lostReason: "Went with another company",
      title: "Replace 2 x cafe split systems",
      intro: "Replacement of both dining-area units with higher capacity models.",
      options: [
        {
          name: "2 x Mitsubishi Electric 8.0kW",
          description: "Two 8.0kW units, existing circuits.",
          lines: [line("INST-SPLIT-80", 2), line("DISPOSAL", 2)],
        },
      ],
    },
    // Expired
    {
      clientKey: "obrien",
      propKey: "obrien",
      status: "EXPIRED",
      createdOffset: -62,
      category: "EVAPORATIVE",
      brand: "Breezair",
      leadSource: "PHONE",
      lostReason: "No reply",
      title: "Replace evaporative cooler",
      intro: "Your 14 year old Breezair has a cracked tank and worn motor.",
      options: [
        {
          name: "Breezair Icon EXQ170",
          description: "Replacement on existing transition.",
          lines: [
            line("INST-EVAP", 1, { description: "Breezair Icon EXQ170 – supply and install" }),
            line("DISPOSAL"),
          ],
        },
      ],
    },
    {
      clientKey: "nguyen",
      propKey: "nguyen",
      status: "EXPIRED",
      createdOffset: -78,
      category: "SPLIT_SYSTEM",
      brand: "Daikin",
      leadSource: "GOOGLE_ADS",
      lostReason: "No reply",
      title: "Split system – living room",
      intro: "Cooling for the front living room.",
      options: goodBetterBest("Living room", [
        ["Good", "INST-SPLIT-35", "Fujitsu 3.5kW"],
        ["Better", "INST-SPLIT-35", "Daikin 3.5kW"],
        ["Best", "INST-SPLIT-50", "Daikin 5.0kW"],
      ]),
    },
  ];

  // ── Leads ──
  interface LeadSpec {
    status: LeadStatus;
    source: LeadSource;
    name: string;
    email: string;
    phone: string;
    suburb: string;
    postcode: string;
    category: ServiceCategory;
    brand: string | null;
    message: string;
    urgency: Priority;
    estimatedValueCents: number | null;
    createdAt: Date;
    clientId: string | null;
    convertedAt: Date | null;
    lostReason: string | null;
    followUpAt: Date | null;
    quoteIndex: number | null;
    sourceDetail: string | null;
  }
  const leadSpecs: LeadSpec[] = [];

  const MESSAGES: Record<string, string[]> = {
    SPLIT_SYSTEM: [
      "Looking to get a split system installed in our main bedroom before summer. Can you give me a quote?",
      "Our split system is blowing warm air in cool mode. Can someone come and have a look this week?",
      "Need a price for 2 split systems for the kids' bedrooms. Brick veneer single storey.",
      "Water dripping from the indoor unit onto the floor. Please call me.",
    ],
    DUCTED: [
      "Interested in ducted reverse cycle for a 4 bedroom double storey. What would it cost roughly?",
      "One of our zones isn't working on the ducted system and the controller shows an error.",
      "Want a service on our ducted system before summer. It hasn't been serviced in 3 years.",
    ],
    EVAPORATIVE: [
      "Evap cooler needs a pre-summer service. Can you do weekends?",
      "Our evaporative cooler smells musty when it runs. Do you clean pads?",
      "Looking at replacing our old evaporative cooler. Please quote.",
    ],
    GAS_HEATING: [
      "Gas heater not igniting – clicking but no flame. Have two young kids so pretty urgent.",
      "Need our ducted heater serviced and a CO test for the rental (landlord requirement).",
      "Heater keeps shutting off after 10 minutes. Brivis about 12 years old.",
    ],
    COMMERCIAL_HVAC: [
      "We manage a small office in the area and need a maintenance contract for 3 ducted units.",
      "Our restaurant kitchen gets very hot – need advice on extra cooling.",
    ],
    EMERGENCY_REPAIR: [
      "No heating at all and it's freezing. Elderly mother lives here. Can anyone come today?",
      "Aircon completely dead after storm last night. Need someone ASAP.",
    ],
    MAINTENANCE: ["Do you offer annual service plans? We have 2 splits and a gas ducted heater."],
    HEAT_PUMP: ["Interested in a heat pump hot water system to go with our solar."],
    OTHER: ["Can you relocate an existing split system to another room?"],
  };

  const FIRST = [
    "Jessica",
    "Matthew",
    "Sophie",
    "Ryan",
    "Chloe",
    "Nathan",
    "Ella",
    "Josh",
    "Mia",
    "Ben",
    "Zara",
    "Lachlan",
    "Isabella",
    "Harrison",
    "Ruby",
    "Mohammed",
    "Ananya",
    "Lucas",
    "Georgia",
    "Ahmed",
    "Nikolai",
    "Holly",
    "Sanjay",
    "Jasmine",
  ];
  const LAST = [
    "Smith",
    "Jones",
    "Williams",
    "Brown",
    "Taylor",
    "Wilson",
    "Martin",
    "Anderson",
    "White",
    "Kelly",
    "Nguyen",
    "Singh",
    "Ryan",
    "Murray",
    "Clarke",
    "Costa",
    "Ali",
    "Kaur",
    "Russo",
    "Byrne",
    "Tan",
    "Novak",
  ];
  const SUBURBS: [string, string][] = [
    ["Preston", "3072"],
    ["Reservoir", "3073"],
    ["Bentleigh", "3204"],
    ["Brighton", "3186"],
    ["Carnegie", "3163"],
    ["Hawthorn", "3122"],
    ["Northcote", "3070"],
    ["Sunshine", "3020"],
    ["Tarneit", "3029"],
    ["Mernda", "3754"],
    ["Narre Warren", "3805"],
    ["Mornington", "3931"],
    ["Bundoora", "3083"],
    ["Templestowe", "3106"],
    ["Williamstown", "3016"],
    ["Pakenham", "3810"],
    ["Keysborough", "3173"],
    ["Ascot Vale", "3032"],
  ];
  const SPLIT_BRANDS = [
    "Daikin",
    "Mitsubishi Electric",
    "Fujitsu",
    "Panasonic",
    "LG",
    "Samsung",
    "Toshiba",
  ];
  const brandFor = (cat: ServiceCategory): string | null => {
    if (cat === "SPLIT_SYSTEM") return pick(SPLIT_BRANDS);
    if (cat === "DUCTED") return pick(["ActronAir", "Daikin", "Mitsubishi Electric"]);
    if (cat === "EVAPORATIVE") return pick(["Breezair", "Coolair", "Bonaire"]);
    if (cat === "GAS_HEATING") return pick(["Brivis", "Rinnai", "Braemar"]);
    return chance(0.5) ? pick(SPLIT_BRANDS) : null;
  };
  const emailFor = (name: string): string =>
    `${name
      .toLowerCase()
      .replace(/&.*$/, "")
      .trim()
      .replace(
        /[^a-z]+/g,
        ".",
      )}${chance(0.5) ? int(1, 99) : ""}@${pick(["gmail.com", "outlook.com", "bigpond.com", "icloud.com", "yahoo.com.au"])}`;
  const timeOn = (offset: number): Date => at(offset, int(28, 76) * 15); // 07:00–19:00 enquiry times

  // Sources: every value at least twice, then weighted towards the busy channels.
  const ALL_SOURCES: LeadSource[] = [
    "WEBSITE",
    "PHONE",
    "GOOGLE_ADS",
    "GOOGLE_BUSINESS_PROFILE",
    "FACEBOOK",
    "INSTAGRAM",
    "REFERRAL",
    "REPEAT_CUSTOMER",
    "WALK_IN",
    "OTHER",
  ];

  // Leads tied to quotes
  QUOTES.forEach((q, i) => {
    const c = client(q.clientKey);
    const p = propOf(q.propKey);
    const createdAt = timeOn(q.createdOffset - int(1, 4));
    const status: LeadStatus =
      q.status === "ACCEPTED"
        ? "WON"
        : q.status === "DRAFT"
          ? "SITE_VISIT_BOOKED"
          : q.status === "DECLINED" || q.status === "EXPIRED"
            ? "LOST"
            : "QUOTED";
    const sel = q.options[q.selected ?? 0];
    leadSpecs.push({
      status,
      source: q.leadSource ?? "WEBSITE",
      name: c.type === "RESIDENTIAL" ? c.name : c.contactName,
      email: c.email,
      phone: c.phone,
      suburb: p.suburb,
      postcode: p.postcode,
      category: q.category,
      brand: q.brand,
      message: q.intro.startsWith("PM work order")
        ? `Work order WO-22817: split system at 8 Patty St not working, tenant reports loud noise from outdoor unit.`
        : pick(MESSAGES[q.category] ?? MESSAGES.OTHER),
      urgency: q.category === "GAS_HEATING" ? "HIGH" : "NORMAL",
      estimatedValueCents: totalsOf(sel.lines).totalCents,
      createdAt,
      clientId: c.id,
      convertedAt: null, // set once quote acceptance time is known
      lostReason: q.lostReason ?? null,
      followUpAt: status === "QUOTED" ? at(int(1, 6), 600) : null,
      quoteIndex: i,
      sourceDetail: q.leadSource === "REPEAT_CUSTOMER" ? "Existing client" : null,
    });
  });
  // Won leads without a quote (repair / service conversions)
  for (const [key, source, cat, offset] of [
    ["medical", "REFERRAL", "COMMERCIAL_HVAC", -60],
    ["eastside", "WEBSITE", "MAINTENANCE", -55],
    ["campbell", "GOOGLE_BUSINESS_PROFILE", "DUCTED", -33],
  ] as const) {
    const c = client(key);
    const createdAt = timeOn(offset);
    leadSpecs.push({
      status: "WON",
      source,
      name: c.type === "RESIDENTIAL" ? c.name : c.contactName,
      email: c.email,
      phone: c.phone,
      suburb: c.properties[0].suburb,
      postcode: c.properties[0].postcode,
      category: cat,
      brand: brandFor(cat),
      message: pick(MESSAGES[cat] ?? MESSAGES.OTHER),
      urgency: "NORMAL",
      estimatedValueCents: int(30, 120) * 1000,
      createdAt,
      clientId: c.id,
      convertedAt: addMinutes(createdAt, int(60 * 24, 60 * 24 * 4)),
      lostReason: null,
      followUpAt: null,
      quoteIndex: null,
      sourceDetail: source === "REFERRAL" ? "Referred by Southside Accounting" : null,
    });
  }
  // Prospects not yet tied to a client
  const prospectPlan: { status: LeadStatus; offsetRange: [number, number] }[] = [
    ...Array.from({ length: 7 }, () => ({
      status: "NEW" as LeadStatus,
      offsetRange: [-6, 0] as [number, number],
    })),
    ...Array.from({ length: 7 }, () => ({
      status: "CONTACTED" as LeadStatus,
      offsetRange: [-28, -3] as [number, number],
    })),
    ...Array.from({ length: 2 }, () => ({
      status: "SITE_VISIT_BOOKED" as LeadStatus,
      offsetRange: [-12, -2] as [number, number],
    })),
    { status: "LOST", offsetRange: [-70, -30] },
  ];
  prospectPlan.forEach((pp, i) => {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const [suburb, postcode] =
      pp.status === "LOST" ? (["Geelong", "3220"] as [string, string]) : pick(SUBURBS);
    const cat = weighted<ServiceCategory>([
      ["SPLIT_SYSTEM", 5],
      ["DUCTED", 2],
      ["EVAPORATIVE", 2],
      ["GAS_HEATING", 2],
      ["EMERGENCY_REPAIR", 1],
      ["MAINTENANCE", 1],
      ["COMMERCIAL_HVAC", 1],
      ["HEAT_PUMP", 0.5],
      ["OTHER", 0.5],
    ]);
    const offset = int(pp.offsetRange[0], pp.offsetRange[1]);
    let createdAt = timeOn(offset);
    if (createdAt.getTime() > NOW.getTime()) createdAt = addMinutes(NOW, -int(20, 300) - i * 7);
    const followUpAt =
      pp.status === "NEW"
        ? chance(0.5)
          ? at(int(0, 2), 600)
          : null
        : pp.status === "CONTACTED"
          ? i === 9
            ? at(-2, 600)
            : at(int(1, 7), int(36, 60) * 15)
          : pp.status === "SITE_VISIT_BOOKED"
            ? at(weekday(int(1, 8), 1), int(36, 60) * 15)
            : null;
    leadSpecs.push({
      status: pp.status,
      source: "WEBSITE",
      name,
      email: emailFor(name),
      phone: mobile(),
      suburb,
      postcode,
      category: cat,
      brand: brandFor(cat),
      message: pick(MESSAGES[cat] ?? MESSAGES.OTHER),
      urgency:
        cat === "EMERGENCY_REPAIR"
          ? "EMERGENCY"
          : cat === "GAS_HEATING" && chance(0.5)
            ? "HIGH"
            : chance(0.15)
              ? "LOW"
              : "NORMAL",
      estimatedValueCents:
        cat === "SPLIT_SYSTEM"
          ? int(18, 60) * 10000
          : cat === "DUCTED"
            ? int(10, 18) * 100000
            : int(2, 60) * 10000,
      createdAt,
      clientId: null,
      convertedAt: null,
      lostReason: pp.status === "LOST" ? "Outside service area" : null,
      followUpAt,
      quoteIndex: null,
      sourceDetail: null,
    });
  });

  // Assign sources so every LeadSource appears; keep quote-linked sources as written.
  const freeIdx = leadSpecs
    .map((l, i) => (l.quoteIndex === null && l.clientId === null ? i : -1))
    .filter((i) => i >= 0);
  const sourcePool = shuffle([
    ...ALL_SOURCES,
    "GOOGLE_ADS",
    "GOOGLE_ADS",
    "WEBSITE",
    "WEBSITE",
    "PHONE",
    "GOOGLE_BUSINESS_PROFILE",
    "INSTAGRAM",
  ] as LeadSource[]);
  freeIdx.forEach((li, k) => {
    leadSpecs[li].source = sourcePool[k % sourcePool.length];
  });

  leadSpecs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const leadIdByQuote = new Map<number, string>();
  const leadRecords: { id: string; spec: LeadSpec }[] = [];
  const assignees = [admin.id, office.id];
  for (const l of leadSpecs) {
    const isAds = l.source === "GOOGLE_ADS";
    const isSocial = l.source === "FACEBOOK" || l.source === "INSTAGRAM";
    const campaign =
      l.category === "GAS_HEATING"
        ? "gas-heater-service-winter"
        : l.category === "DUCTED"
          ? "ducted-aircon-melbourne"
          : l.category === "EVAPORATIVE"
            ? "evap-service-spring"
            : "split-system-install-melb";
    const created = await prisma.lead.create({
      data: {
        status: l.status,
        source: l.source,
        sourceDetail:
          l.sourceDetail ??
          (isAds ? "Search – " + campaign : l.source === "WEBSITE" ? "Contact form" : null),
        serviceCategory: l.category,
        brand: l.brand,
        name: l.name,
        email: l.email,
        phone: l.phone,
        suburb: l.suburb,
        postcode: l.postcode,
        message: l.message,
        urgency: l.urgency,
        estimatedValueCents: l.estimatedValueCents,
        assignedToId: l.status === "NEW" && chance(0.4) ? null : pick(assignees),
        clientId: l.clientId,
        lostReason: l.lostReason,
        followUpAt: l.followUpAt,
        utmSource: isAds ? "google" : isSocial ? l.source.toLowerCase() : null,
        utmMedium: isAds ? "cpc" : isSocial ? "paid_social" : null,
        utmCampaign: isAds || isSocial ? campaign : null,
        gclid: isAds ? `Cj0KCQjw${letters(6)}${digits(4)}${letters(10).toLowerCase()}_BwE` : null,
        convertedAt: l.convertedAt,
        createdAt: l.createdAt,
      },
    });
    leadRecords.push({ id: created.id, spec: l });
    if (l.quoteIndex !== null) leadIdByQuote.set(l.quoteIndex, created.id);
  }

  // Lead activity
  const activities: Prisma.ActivityCreateManyInput[] = [];
  const STATUS_TEXT: Record<LeadStatus, string> = {
    NEW: "New",
    CONTACTED: "Contacted",
    SITE_VISIT_BOOKED: "Site visit booked",
    QUOTED: "Quoted",
    WON: "Won",
    LOST: "Lost",
  };
  for (const { id, spec } of leadRecords) {
    if (spec.status === "NEW" && chance(0.6)) continue;
    const userId = pick(assignees);
    let t = addMinutes(spec.createdAt, int(20, 240));
    const push = (type: ActivityType, body: string) => {
      if (t.getTime() > NOW.getTime()) t = addMinutes(NOW, -int(5, 60));
      activities.push({
        entityType: "LEAD",
        entityId: id,
        type,
        body,
        userId,
        createdAt: t,
        updatedAt: t,
      });
      t = addMinutes(t, int(60 * 6, 60 * 48));
    };
    push(
      "CALL",
      pick([
        `Called ${spec.name.split(" ")[0]} – discussed requirements and rough pricing.`,
        "Left voicemail, sent follow-up SMS.",
        `Spoke with ${spec.name.split(" ")[0]}. Keen to get it sorted before summer.`,
      ]),
    );
    if (spec.status !== "NEW" && spec.status !== "CONTACTED")
      push(
        "STATUS_CHANGE",
        `Status changed from Contacted to ${STATUS_TEXT[spec.status === "WON" || spec.status === "LOST" ? "QUOTED" : spec.status]}`,
      );
    if (spec.status === "WON" || spec.status === "LOST")
      push(
        "STATUS_CHANGE",
        `Status changed from Quoted to ${STATUS_TEXT[spec.status]}${spec.lostReason ? ` (${spec.lostReason})` : ""}`,
      );
    if (spec.status === "CONTACTED" && chance(0.5))
      push("NOTE", "Customer wants to compare a couple of quotes. Follow up next week.");
  }

  // ── Create quotes ──
  interface QuoteRecord {
    id: string;
    spec: QuoteSpec;
    number: string;
    selectedOptionId: string | null;
    acceptedAt: Date | null;
  }
  const quoteOrder = QUOTES.map((q, i) => ({ q, i })).sort(
    (a, b) => a.q.createdOffset - b.q.createdOffset,
  );
  const quoteRecords: QuoteRecord[] = [];
  let quoteNo = 0;
  for (const { q, i } of quoteOrder) {
    quoteNo += 1;
    const number = formatDocumentNumber("Q", quoteNo);
    const c = client(q.clientKey);
    const p = propOf(q.propKey);
    const createdAt = clampPast(at(q.createdOffset, int(36, 64) * 15));
    const sentAt = q.status === "DRAFT" ? null : clampPast(addMinutes(createdAt, int(30, 60 * 20)));
    const viewedAt =
      sentAt && q.status !== "SENT" ? clampPast(addMinutes(sentAt, int(60, 60 * 30))) : null;
    const decisionAt = viewedAt ? clampPast(addMinutes(viewedAt, int(60 * 12, 60 * 24 * 6))) : null;
    const acceptedAt = q.status === "ACCEPTED" ? decisionAt : null;
    const declinedAt = q.status === "DECLINED" ? decisionAt : null;
    const validUntil = startOfMelbourneDay(addMelbourneDays(createdAt, 30));
    const optionTotals = q.options.map((o) => totalsOf(o.lines));
    const headline = optionTotals[q.selected ?? 0];
    const created = await prisma.quote.create({
      data: {
        number,
        clientId: c.id,
        propertyId: p.id,
        leadId: leadIdByQuote.get(i) ?? null,
        status: q.status,
        title: q.title,
        intro: q.intro,
        terms: "See terms and conditions below. Installations over $5,000 require a 50% deposit.",
        validUntil,
        subtotalCents: headline.subtotalCents,
        gstCents: headline.gstCents,
        totalCents: headline.totalCents,
        sentAt,
        viewedAt,
        acceptedAt,
        declinedAt,
        createdAt,
        options: {
          create: q.options.map((o, oi) => ({
            name: o.name,
            description: o.description,
            sortOrder: oi,
            subtotalCents: optionTotals[oi].subtotalCents,
            gstCents: optionTotals[oi].gstCents,
            totalCents: optionTotals[oi].totalCents,
            createdAt,
            lineItems: {
              create: o.lines.map((l, li) => ({
                priceBookItemId: l.priceBookItemId,
                description: l.description,
                quantity: l.quantity,
                unitPriceCents: l.unitPriceCents,
                taxable: l.taxable,
                totalCents: lineTotalCents(l.quantity, l.unitPriceCents),
                sortOrder: li,
                createdAt,
              })),
            },
          })),
        },
      },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
    let selectedOptionId: string | null = null;
    if (q.status === "ACCEPTED" && q.selected !== undefined) {
      selectedOptionId = created.options[q.selected].id;
      await prisma.quote.update({ where: { id: created.id }, data: { selectedOptionId } });
      const leadId = leadIdByQuote.get(i);
      if (leadId && acceptedAt)
        await prisma.lead.update({ where: { id: leadId }, data: { convertedAt: acceptedAt } });
    }
    quoteRecords.push({ id: created.id, spec: q, number, selectedOptionId, acceptedAt });
    const qActs: [ActivityType, string, Date | null][] = [
      ["SYSTEM", `Quote ${number} created`, createdAt],
      ["EMAIL", `Quote ${number} emailed to ${c.email}`, sentAt],
      ["SYSTEM", "Quote viewed by client", viewedAt],
      ["STATUS_CHANGE", `Quote accepted online – ${q.options[q.selected ?? 0].name}`, acceptedAt],
      ["STATUS_CHANGE", "Quote declined by client", declinedAt],
    ];
    for (const [type, body, when] of qActs) {
      if (when)
        activities.push({
          entityType: "QUOTE",
          entityId: created.id,
          type,
          body,
          userId: type === "EMAIL" ? office.id : null,
          createdAt: when,
          updatedAt: when,
        });
    }
  }

  // ── Maintenance plans ──
  const PLAN_SPECS: {
    key: string;
    name: string;
    frequency: PlanFrequency;
    priceCents: number;
    nextDue: number;
  }[] = [
    {
      key: "thompson",
      name: "Annual heating & cooling service plan",
      frequency: "YEARLY",
      priceCents: 39900,
      nextDue: -6,
    },
    {
      key: "henderson",
      name: "Annual comfort plan",
      frequency: "YEARLY",
      priceCents: 34900,
      nextDue: 3,
    },
    {
      key: "campbell-home",
      name: "Premium comfort plan",
      frequency: "YEARLY",
      priceCents: 49900,
      nextDue: 9,
    },
    {
      key: "beancounter",
      name: "Quarterly commercial maintenance",
      frequency: "QUARTERLY",
      priceCents: 29900,
      nextDue: 12,
    },
    {
      key: "southside",
      name: "Six-monthly rooftop plant maintenance",
      frequency: "SIX_MONTHLY",
      priceCents: 59900,
      nextDue: 30,
    },
    {
      key: "medical",
      name: "Quarterly clinic HVAC maintenance",
      frequency: "QUARTERLY",
      priceCents: 44900,
      nextDue: 45,
    },
    {
      key: "ironrepublic",
      name: "Six-monthly gym HVAC maintenance",
      frequency: "SIX_MONTHLY",
      priceCents: 54900,
      nextDue: 60,
    },
    {
      key: "obrien",
      name: "Annual heater & evap service",
      frequency: "YEARLY",
      priceCents: 32900,
      nextDue: 90,
    },
    {
      key: "murphy",
      name: "Annual heating & cooling service plan",
      frequency: "YEARLY",
      priceCents: 29900,
      nextDue: 120,
    },
    {
      key: "harbour-como",
      name: "Annual rental compliance service (gas safety + split)",
      frequency: "YEARLY",
      priceCents: 24900,
      nextDue: 150,
    },
  ];
  const FREQ_MONTHS: Record<PlanFrequency, number> = {
    MONTHLY: 1,
    QUARTERLY: 3,
    SIX_MONTHLY: 6,
    YEARLY: 12,
  };
  interface PlanRecord {
    id: string;
    prop: PropRef;
    frequency: PlanFrequency;
    nextDueDate: Date;
    name: string;
  }
  const plans: PlanRecord[] = [];
  for (const ps of PLAN_SPECS) {
    const prop = propOf(ps.key);
    const nextDueDate = startOfMelbourneDay(addMelbourneDays(NOW, ps.nextDue));
    const periods = ps.frequency === "YEARLY" ? int(1, 3) : int(2, 4);
    const startDate = addMelbourneMonths(nextDueDate, -FREQ_MONTHS[ps.frequency] * periods);
    const created = await prisma.maintenancePlan.create({
      data: {
        clientId: prop.client.id,
        propertyId: prop.id,
        name: ps.name,
        frequency: ps.frequency,
        priceCents: ps.priceCents,
        startDate,
        nextDueDate,
        active: true,
        notes:
          ps.frequency === "YEARLY"
            ? "Book in before the start of the season."
            : "Coordinate with site contact; out of hours preferred.",
        createdAt: startDate,
        equipment: { create: prop.equipment.slice(0, 4).map((e) => ({ equipmentId: e.id })) },
      },
    });
    prop.planId = created.id;
    plans.push({ id: created.id, prop, frequency: ps.frequency, nextDueDate, name: ps.name });
  }

  // ── Jobs ──
  interface JobSpec {
    prop: PropRef;
    quoteId: string | null;
    maintenancePlanId: string | null;
    type: JobType;
    status: JobStatus;
    priority: Priority;
    serviceCategory: ServiceCategory;
    checklistCategory: CoreCategory | null;
    title: string;
    description: string;
    dayOffset: number | null;
    startMin: number | null;
    estimatedMinutes: number;
    techIds: string[];
    equipmentIds: string[];
    lines: LineSpec[];
    completionNotes: string | null;
    refrigerantAddedKg: number | null;
    refrigerantRecoveredKg: number | null;
    gas: boolean;
    onHoldReason: string | null;
    createdAt: Date | null;
    installEquipment: EqInput[] | null;
  }
  const jobSpecs: JobSpec[] = [];

  // Technician day planner so jobs never overlap.
  const nextFree = new Map<string, number>();
  function allocate(
    techIds: string[],
    offset: number,
    minutes: number,
    dir: 1 | -1,
    preferredStart?: number,
  ): { offset: number; start: number } {
    let o = weekday(offset, dir);
    for (let guard = 0; guard < 60; guard++) {
      const base = preferredStart ?? 450 + int(0, 2) * 15;
      const start = Math.max(base, ...techIds.map((t) => nextFree.get(`${t}:${o}`) ?? 0));
      const rounded = Math.ceil(start / 15) * 15;
      if (rounded + minutes <= 990 || (rounded === base && minutes > 480)) {
        for (const t of techIds) nextFree.set(`${t}:${o}`, rounded + minutes + int(2, 3) * 15);
        return { offset: o, start: rounded };
      }
      o = weekday(o + dir, dir);
    }
    throw new Error("Could not allocate a job slot");
  }

  const REPAIRS: Record<
    CoreCategory,
    {
      title: string;
      description: string;
      notes: string;
      parts: [string, number][];
      hours: number;
      regas?: boolean;
    }[]
  > = {
    SPLIT_SYSTEM: [
      {
        title: "Split system not cooling",
        description: "Customer reports unit runs but blows room-temperature air in cool mode.",
        notes:
          "Low refrigerant charge. Nitrogen pressure test found a leaking flare at the indoor unit. Re-flared, evacuated and regassed to nameplate charge. Delta-T 11°C on completion.",
        parts: [["LEAK-SEARCH", 1]],
        hours: 1.5,
        regas: true,
      },
      {
        title: "Outdoor unit not starting",
        description: "Indoor fan runs but outdoor unit doesn't start. Possible capacitor.",
        notes:
          "Outdoor fan run capacitor failed (swollen, reading 0µF). Replaced and tested in heat and cool.",
        parts: [["PART-CAP", 1]],
        hours: 1,
      },
      {
        title: "Indoor unit leaking water",
        description: "Water dripping from the bottom of the indoor unit onto the carpet.",
        notes:
          "Condensate drain blocked with slime. Cleared and flushed the line, treated the tray with tablets. Recommend annual service.",
        parts: [["DRAIN-CLEAR", 1]],
        hours: 1,
      },
      {
        title: "Error code – unit shuts down",
        description: "Unit flashing error code and shutting down after a few minutes.",
        notes:
          "Indoor PCB faulty (no output to fan motor). Replaced PCB, reset and tested for 30 minutes.",
        parts: [["PART-PCB", 1]],
        hours: 1.5,
      },
      {
        title: "Noisy indoor fan",
        description: "Loud rattling from the indoor unit when running on high fan.",
        notes:
          "Indoor fan motor bearings worn. Replaced fan motor and cleaned barrel. Running quietly.",
        parts: [["PART-FAN-IN", 1]],
        hours: 2,
      },
    ],
    DUCTED: [
      {
        title: "Ducted system blowing warm air",
        description: "Ducted system not cooling – warm air from all outlets.",
        notes:
          "Low charge. Leak found on the outdoor service valve. Repaired, pressure tested, evacuated and regassed. All zones now cooling.",
        parts: [["LEAK-SEARCH", 1]],
        hours: 2,
        regas: true,
      },
      {
        title: "Zone not opening",
        description: "Bedroom zone not getting any air flow.",
        notes: "Zone damper motor seized. Replaced motor and recalibrated zones on the controller.",
        parts: [["ZONE-MOTOR", 1]],
        hours: 1.5,
      },
      {
        title: "Wall controller blank",
        description: "Wall controller screen is blank, system won't start.",
        notes:
          "Controller failed (no display with 12V present). Replaced wall controller and re-programmed zones and schedule.",
        parts: [["PART-STAT", 1]],
        hours: 1,
      },
    ],
    GAS_HEATING: [
      {
        title: "Heater not igniting",
        description: "Gas ducted heater clicks but doesn't light.",
        notes:
          "Hot surface igniter cracked. Replaced igniter, tested ignition sequence, CO spillage test passed (0ppm).",
        parts: [["GAS-IGNITER", 1]],
        hours: 1,
      },
      {
        title: "Heater locks out after a few minutes",
        description: "Heater starts but shuts down and shows a fault after 2–5 minutes.",
        notes:
          "Flame sensor heavily carboned. Replaced flame sensor, checked gas pressures and flue. CO test passed.",
        parts: [["GAS-FLAME-SENSOR", 1]],
        hours: 1,
      },
      {
        title: "Heater blowing cold air",
        description: "Fan runs but only cold air comes out.",
        notes:
          "Burner not proving flame due to faulty flame sensor and dirty burner. Cleaned burner, replaced sensor, full safety check completed.",
        parts: [["GAS-FLAME-SENSOR", 1]],
        hours: 1.5,
      },
    ],
    EVAPORATIVE: [
      {
        title: "Evap cooler not pumping water",
        description: "Cooler runs but blows warm air – pads look dry.",
        notes:
          "Water pump failed. Replaced pump, cleaned distribution channels and tested pad saturation.",
        parts: [["EVAP-PUMP", 1]],
        hours: 1,
      },
      {
        title: "Musty smell from evaporative cooler",
        description: "Strong musty smell through the house when the evap runs.",
        notes: "Pads blocked with scale and algae. Replaced pad set, drained and sanitised tank.",
        parts: [["EVAP-PADS", 1]],
        hours: 2,
      },
    ],
  };
  const SERVICE_NOTES: Record<CoreCategory, string[]> = {
    SPLIT_SYSTEM: [
      "Filters washed, coil and fan barrel cleaned with coil cleaner. Drain flushed. Unit operating to spec.",
      "Serviced all split systems. Outdoor coils were dusty – cleaned. Recommend annual service.",
    ],
    DUCTED: [
      "Return air filter replaced, coil inspected, drain flushed. Temperature split 10–12°C across all zones.",
      "Full ducted service completed. One outlet in bedroom 3 has a loose collar – re-taped.",
    ],
    GAS_HEATING: [
      "Burner cleaned, heat exchanger inspected (no cracks), gas pressure set to data plate. CO test 0ppm. Safe to operate.",
      "Annual gas safety check completed. CO spillage test passed. Filter cleaned.",
    ],
    EVAPORATIVE: [
      "Tank drained and cleaned, pads inspected (serviceable for another season), pump and float tested. Ready for summer.",
      "Pre-summer evap service done. Drain valve replaced under warranty of last service.",
    ],
  };
  const catLabel: Record<CoreCategory, string> = {
    SPLIT_SYSTEM: "split system",
    DUCTED: "ducted system",
    GAS_HEATING: "gas heater",
    EVAPORATIVE: "evaporative cooler",
  };
  const SERVICE_SKU: Record<CoreCategory, string> = {
    SPLIT_SYSTEM: "SVC-SPLIT",
    DUCTED: "SVC-DUCTED",
    GAS_HEATING: "SVC-GAS",
    EVAPORATIVE: "SVC-EVAP",
  };
  const SERVICE_MIN: Record<CoreCategory, number> = {
    SPLIT_SYSTEM: 60,
    DUCTED: 120,
    GAS_HEATING: 90,
    EVAPORATIVE: 120,
  };

  function pickTechs(both = false): string[] {
    if (both) return [tech1.id, tech2.id];
    return chance(0.12) ? [tech1.id, tech2.id] : [pick(techs).id];
  }

  function buildJob(
    prop: PropRef,
    type: JobType,
    opts: { emergency?: boolean; planId?: string | null } = {},
  ): Omit<JobSpec, "dayOffset" | "startMin" | "status" | "createdAt" | "techIds"> {
    const eqAll = prop.equipment;
    const eq = eqAll.length ? pick(eqAll) : null;
    const cat: CoreCategory = eq?.category ?? "SPLIT_SYSTEM";
    const sameCat = eqAll.filter((e) => e.category === cat);
    const commercial = prop.client.type === "COMMERCIAL";
    const base = {
      prop,
      quoteId: null,
      maintenancePlanId: null as string | null,
      priority: "NORMAL" as Priority,
      serviceCategory: cat as ServiceCategory,
      checklistCategory: null as CoreCategory | null,
      equipmentIds: eq ? [eq.id] : [],
      refrigerantAddedKg: null as number | null,
      refrigerantRecoveredKg: null as number | null,
      gas: cat === "GAS_HEATING",
      onHoldReason: null,
      installEquipment: null,
    };
    if (type === "SERVICE") {
      const units = Math.max(1, Math.min(3, sameCat.length));
      const lines: LineSpec[] = commercial
        ? [line("SVC-COMM", 1), ...(cat === "DUCTED" ? [line("FILTER-DUCT", units)] : [])]
        : cat === "SPLIT_SYSTEM"
          ? [line("SVC-SPLIT"), ...(units > 1 ? [line("SVC-SPLIT-ADD", units - 1)] : [])]
          : [
              line(SERVICE_SKU[cat]),
              ...(cat === "DUCTED" && chance(0.6) ? [line("FILTER-DUCT")] : []),
              ...(cat === "EVAPORATIVE" && chance(0.25) ? [line("EVAP-PADS")] : []),
            ];
      return {
        ...base,
        type,
        maintenancePlanId: opts.planId ?? prop.planId,
        serviceCategory: commercial ? "COMMERCIAL_HVAC" : cat,
        checklistCategory: cat,
        title: commercial
          ? `Preventative maintenance – ${units} x ${catLabel[cat]}`
          : units > 1
            ? `${catLabel[cat][0].toUpperCase()}${catLabel[cat].slice(1)} service x${units}`
            : `Annual ${catLabel[cat]} service`,
        description: commercial
          ? "Scheduled preventative maintenance per service agreement."
          : `Routine ${catLabel[cat]} service${cat === "GAS_HEATING" ? " including CO spillage test" : ""}.`,
        estimatedMinutes: commercial ? 180 : SERVICE_MIN[cat] + (units - 1) * 40,
        equipmentIds: sameCat.slice(0, 2).map((e) => e.id),
        lines,
        completionNotes: pick(SERVICE_NOTES[cat]),
      };
    }
    if (type === "REPAIR" || type === "EMERGENCY") {
      const scenario = pick(REPAIRS[cat]);
      const hours = scenario.hours + (chance(0.3) ? 0.5 : 0);
      const lines: LineSpec[] = [
        line(type === "EMERGENCY" ? "CALLOUT-AH" : "CALLOUT"),
        line("LAB-HR", hours),
        ...scenario.parts.map(([sku, q]) => line(sku, q)),
      ];
      let refrigerantAddedKg: number | null = null;
      if (scenario.regas) {
        refrigerantAddedKg = round2(int(6, 18) / 10);
        lines.push(
          line(eq?.refrigerant === "R410A" ? "REGAS-R410A" : "REGAS-R32", refrigerantAddedKg),
        );
      }
      return {
        ...base,
        type,
        priority:
          type === "EMERGENCY"
            ? chance(0.6)
              ? "EMERGENCY"
              : "HIGH"
            : chance(0.2)
              ? "HIGH"
              : "NORMAL",
        serviceCategory: type === "EMERGENCY" ? "EMERGENCY_REPAIR" : cat,
        title: type === "EMERGENCY" ? `URGENT: ${scenario.title}` : scenario.title,
        description: `${scenario.description}${eq ? ` (${eq.label}${eq.location ? `, ${eq.location.toLowerCase()}` : ""})` : ""}`,
        estimatedMinutes: Math.round(hours * 60) + 30,
        lines,
        completionNotes: scenario.notes,
        refrigerantAddedKg,
      };
    }
    if (type === "INSPECTION") {
      const prePurchase = chance(0.4);
      return {
        ...base,
        type,
        title: prePurchase ? "Pre-purchase HVAC inspection" : "Pre-summer system check",
        description: prePurchase
          ? "Buyer's inspection of all heating and cooling equipment."
          : "Check all units are ready for summer and report on condition.",
        estimatedMinutes: 60,
        equipmentIds: eqAll.slice(0, 2).map((e) => e.id),
        lines: [line("CALLOUT"), line("LAB-HR", 1)],
        completionNotes:
          "Inspection complete. Written condition report emailed to client. All units operational; outdoor coil cleaning recommended.",
      };
    }
    if (type === "WARRANTY") {
      return {
        ...base,
        type,
        title: `Warranty: ${eq?.brand ?? ""} ${catLabel[cat]} fault`.replace(/\s+/g, " "),
        description: `Unit under manufacturer's warranty showing intermittent fault. Claim lodged with ${eq?.brand ?? "manufacturer"}.`,
        estimatedMinutes: 90,
        lines: [],
        completionNotes: `Replaced faulty sensor under ${eq?.brand ?? "manufacturer"} warranty. Claim lodged – no charge to customer.`,
      };
    }
    // QUOTE_VISIT
    return {
      ...base,
      type: "QUOTE_VISIT",
      title: `Site visit to quote – ${pick(["new split system", "ducted replacement", "heater replacement", "additional outlets"])}`,
      description: "Measure up and discuss options. Quote to follow.",
      estimatedMinutes: 45,
      equipmentIds: [],
      lines: [],
      completionNotes:
        "Measured up and discussed options. Quote to be sent within 2 business days.",
      gas: false,
    };
  }

  const serviceableProps = allProps.filter(
    (p) => !p.client.doNotService && p.equipment.length > 0 && p.client.type !== "BUILDER",
  );
  const pastType = (): JobType =>
    weighted<JobType>([
      ["SERVICE", 40],
      ["REPAIR", 30],
      ["EMERGENCY", 8],
      ["INSPECTION", 7],
      ["WARRANTY", 5],
      ["QUOTE_VISIT", 10],
    ]);

  // Accepted quote installations
  for (const qr of quoteRecords.filter((r) => r.spec.status === "ACCEPTED")) {
    const q = qr.spec;
    const prop = propOf(q.propKey);
    const sel = q.options[q.selected ?? 0];
    const cat: CoreCategory =
      q.category === "COMMERCIAL_HVAC" ? "SPLIT_SYSTEM" : (q.category as CoreCategory);
    const recovered = sel.lines.some(
      (l) =>
        l.description.toLowerCase().includes("disposal") || l.priceBookItemId === pb("DISPOSAL").id,
    );
    jobSpecs.push({
      prop,
      quoteId: qr.id,
      maintenancePlanId: null,
      type: "INSTALLATION",
      status:
        q.jobOffset === null || q.jobOffset === undefined
          ? "UNSCHEDULED"
          : q.jobOffset < 0
            ? "COMPLETED"
            : "SCHEDULED",
      priority: "NORMAL",
      serviceCategory: q.category,
      checklistCategory: null,
      title: `Install: ${q.title}`,
      description: `${sel.name}. As per accepted quote ${qr.number}.${q.jobOffset === null ? " Awaiting builder to confirm lock-up stage before booking." : ""}`,
      dayOffset: q.jobOffset ?? null,
      startMin: q.jobOffset === null || q.jobOffset === undefined ? null : 450,
      estimatedMinutes: q.jobMinutes ?? 240,
      techIds: [tech1.id, tech2.id],
      equipmentIds: [],
      lines: sel.lines,
      completionNotes:
        "Installation complete and commissioned. Pressure tested, evacuated below 500 microns. Customer shown operation. Warranty registered.",
      refrigerantAddedKg: null,
      refrigerantRecoveredKg: recovered && cat !== "GAS_HEATING" ? round2(int(8, 16) / 10) : null,
      gas: cat === "GAS_HEATING",
      onHoldReason: null,
      createdAt: qr.acceptedAt ? addMinutes(qr.acceptedAt, int(30, 240)) : null,
      installEquipment: q.installEquipment ?? null,
    });
  }

  // Maintenance plan jobs
  for (const plan of plans) {
    const prevDue = melbourneDaysBetween(
      NOW,
      addMelbourneMonths(plan.nextDueDate, -FREQ_MONTHS[plan.frequency]),
    );
    const dueIn = melbourneDaysBetween(NOW, plan.nextDueDate);
    if (prevDue >= -88 && prevDue <= -2) {
      jobSpecs.push({
        ...buildJob(plan.prop, "SERVICE", { planId: plan.id }),
        dayOffset: prevDue,
        startMin: null,
        status: "COMPLETED",
        createdAt: null,
        techIds: pickTechs(),
      });
    }
    if (dueIn >= 1 && dueIn <= 14) {
      jobSpecs.push({
        ...buildJob(plan.prop, "SERVICE", { planId: plan.id }),
        dayOffset: dueIn,
        startMin: null,
        status: "SCHEDULED",
        createdAt: null,
        techIds: pickTechs(),
      });
    }
    if (dueIn < 0) {
      const j = buildJob(plan.prop, "SERVICE", { planId: plan.id });
      jobSpecs.push({
        ...j,
        description: `${j.description} Plan service overdue – call client to book.`,
        dayOffset: null,
        startMin: null,
        status: "UNSCHEDULED",
        createdAt: null,
        techIds: [],
      });
    }
  }

  // General past jobs (31)
  const PAST_COUNT = 31;
  for (let i = 0; i < PAST_COUNT; i++) {
    // Denser in the recent past so the invoice pipeline (draft/sent/part paid) has fresh work.
    const offset = -Math.round(1 + 86 * Math.pow(i / (PAST_COUNT - 1), 1.4));
    const type =
      offset >= -21
        ? weighted<JobType>([
            ["SERVICE", 5],
            ["REPAIR", 4],
            ["EMERGENCY", 1],
          ])
        : pastType();
    jobSpecs.push({
      ...buildJob(pick(serviceableProps), type),
      dayOffset: offset,
      startMin: null,
      status: "COMPLETED",
      createdAt: null,
      techIds: pickTechs(),
    });
  }
  // Cancelled and on-hold variants among the past jobs
  const generalPast = jobSpecs.filter(
    (j) => j.status === "COMPLETED" && j.quoteId === null && j.maintenancePlanId === null,
  );
  const cancelTargets = [generalPast[12], generalPast[24]];
  for (const j of cancelTargets) {
    j.status = "CANCELLED";
    j.description = `${j.description} Cancelled – customer ${pick(["sorted it with the builder's warranty", "rescheduled and then cancelled", "no longer requires the work"])}.`;
  }
  const holdTarget =
    generalPast.find((j) => (j.dayOffset ?? 0) >= -8 && j.status === "COMPLETED") ??
    generalPast[generalPast.length - 1];
  {
    const prop = holdTarget.prop;
    const splitProp = prop.equipment.some((e) => e.category === "SPLIT_SYSTEM")
      ? prop
      : (serviceableProps.find((p) => p.equipment.some((e) => e.category === "SPLIT_SYSTEM")) ??
        prop);
    const eq =
      splitProp.equipment.find((e) => e.category === "SPLIT_SYSTEM") ?? splitProp.equipment[0];
    Object.assign(holdTarget, {
      prop: splitProp,
      type: "REPAIR" as JobType,
      status: "ON_HOLD" as JobStatus,
      serviceCategory: "SPLIT_SYSTEM" as ServiceCategory,
      checklistCategory: null,
      maintenancePlanId: null,
      title: "Error code – unit shuts down",
      description: `Indoor unit showing U4 communication error (${eq.label}).`,
      equipmentIds: [eq.id],
      lines: [],
      completionNotes: null,
      onHoldReason: `Waiting on replacement outdoor PCB from ${eq.brand} – ETA 5 business days. Customer advised.`,
      gas: false,
      refrigerantAddedKg: null,
    });
  }

  // Today's jobs (5)
  const todayPlan: { tech: string[]; start: number; type: JobType; emergency?: boolean }[] = [
    { tech: [tech1.id], start: 450, type: "SERVICE" },
    { tech: [tech2.id], start: 480, type: "EMERGENCY" },
    { tech: [tech1.id], start: 630, type: "REPAIR" },
    { tech: [tech2.id], start: 720, type: "SERVICE" },
    { tech: [tech1.id], start: 870, type: "INSPECTION" },
  ];
  for (const t of todayPlan) {
    jobSpecs.push({
      ...buildJob(pick(serviceableProps), t.type),
      dayOffset: 0,
      startMin: t.start,
      status: "SCHEDULED",
      createdAt: null,
      techIds: t.tech,
    });
  }

  // Future jobs (10)
  for (let i = 0; i < 10; i++) {
    const offset = 1 + Math.round((i * 20) / 9);
    const type = weighted<JobType>([
      ["SERVICE", 55],
      ["REPAIR", 20],
      ["QUOTE_VISIT", 15],
      ["INSPECTION", 10],
    ]);
    jobSpecs.push({
      ...buildJob(pick(serviceableProps), type),
      dayOffset: offset,
      startMin: null,
      status: "SCHEDULED",
      createdAt: null,
      techIds: pickTechs(),
    });
  }
  // Unscheduled general (3)
  for (const type of ["REPAIR", "SERVICE", "QUOTE_VISIT"] as JobType[]) {
    jobSpecs.push({
      ...buildJob(pick(serviceableProps), type),
      dayOffset: null,
      startMin: null,
      status: "UNSCHEDULED",
      createdAt: null,
      techIds: [],
    });
  }

  // Resolve schedule times; today's fixed slots first so others fit around them.
  const ordered = [...jobSpecs].sort(
    (a, b) => (a.dayOffset === 0 ? -1 : 0) - (b.dayOffset === 0 ? -1 : 0),
  );
  for (const j of ordered) {
    if (j.dayOffset === null) continue;
    if (j.dayOffset === 0) {
      for (const t of j.techIds)
        nextFree.set(
          `${t}:0`,
          Math.max(nextFree.get(`${t}:0`) ?? 0, (j.startMin ?? 450) + j.estimatedMinutes + 30),
        );
      continue;
    }
    const isPast = j.dayOffset < 0;
    const slot = allocate(
      j.techIds,
      j.dayOffset,
      Math.min(j.estimatedMinutes, 540),
      isPast ? -1 : 1,
      j.startMin ?? undefined,
    );
    j.dayOffset = slot.offset;
    j.startMin = slot.start;
    if (j.type === "EMERGENCY" && isPast)
      j.priority = j.priority === "NORMAL" ? "HIGH" : j.priority;
  }

  // createdAt for each job
  for (const j of jobSpecs) {
    if (j.createdAt) continue;
    if (j.dayOffset === null) j.createdAt = clampPast(at(-int(1, 12), int(32, 64) * 15));
    else if (j.type === "EMERGENCY")
      j.createdAt = clampPast(at(j.dayOffset, Math.max(360, (j.startMin ?? 480) - int(60, 120))));
    else j.createdAt = clampPast(at(Math.min(j.dayOffset, 0) - int(1, 9), int(32, 64) * 15));
  }

  jobSpecs.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));

  // Today's statuses depend on the actual time of day.
  const nowMinutes = minutesBetween(TODAY_START, NOW);

  interface CompletedJob {
    id: string;
    number: string;
    prop: PropRef;
    lines: LineSpec[];
    completedAt: Date;
  }
  const completedJobs: CompletedJob[] = [];
  let jobNo = 0;
  const jobIdsByNumber = new Map<string, string>();
  for (const j of jobSpecs) {
    jobNo += 1;
    const number = formatDocumentNumber("J", jobNo);
    const scheduledStart =
      j.dayOffset !== null && j.startMin !== null ? at(j.dayOffset, j.startMin) : null;
    const scheduledEnd = scheduledStart ? addMinutes(scheduledStart, j.estimatedMinutes) : null;
    let status = j.status;
    let actualStart: Date | null = null;
    let actualEnd: Date | null = null;
    let enRouteAt: Date | null = null;
    if (j.dayOffset === 0 && scheduledStart && j.startMin !== null) {
      if (nowMinutes >= j.startMin + j.estimatedMinutes + 30) status = "COMPLETED";
      else if (nowMinutes >= j.startMin) status = "IN_PROGRESS";
      else if (nowMinutes >= j.startMin - 30) status = "EN_ROUTE";
      else status = "SCHEDULED";
    }
    const isDone = status === "COMPLETED";
    if (status === "EN_ROUTE" || status === "IN_PROGRESS" || isDone)
      enRouteAt = scheduledStart ? clampPast(addMinutes(scheduledStart, -int(15, 30))) : null;
    if ((status === "IN_PROGRESS" || isDone) && scheduledStart)
      actualStart = clampPast(addMinutes(scheduledStart, int(-5, 20)));
    if (isDone && actualStart)
      actualEnd = clampPast(
        addMinutes(actualStart, Math.round(j.estimatedMinutes * (0.8 + rand() * 0.45))),
      );
    const signedByName =
      isDone && j.lines.length > 0 && chance(0.7) ? j.prop.client.contactName : null;

    // Equipment created by an installation becomes part of the property.
    let equipmentIds = j.equipmentIds;
    if (isDone && j.installEquipment && actualEnd) {
      const installDate = startOfMelbourneDay(actualEnd);
      const created: { id: string }[] = [];
      for (const e of j.installEquipment) {
        created.push(
          await prisma.equipment.create({
            data: {
              ...equipmentData({ ...e, installDate }),
              propertyId: j.prop.id,
              createdAt: actualEnd,
            },
          }),
        );
      }
      equipmentCount += created.length;
      equipmentIds = created.map((c) => c.id);
    } else if (j.type === "INSTALLATION" && j.prop.equipment.length) {
      equipmentIds = j.prop.equipment
        .filter((e) => e.category === "EVAPORATIVE")
        .map((e) => e.id)
        .slice(0, 1);
    }

    const checklist = j.checklistCategory
      ? templateItems.get(`SERVICE:${j.checklistCategory}`)
      : j.type === "INSTALLATION"
        ? templateItems.get("INSTALLATION:")
        : undefined;
    const createdAt = j.createdAt ?? NOW;
    const job = await prisma.job.create({
      data: {
        number,
        clientId: j.prop.client.id,
        propertyId: j.prop.id,
        quoteId: j.quoteId,
        maintenancePlanId: j.maintenancePlanId,
        type: j.type,
        status,
        priority: j.priority,
        serviceCategory: j.serviceCategory,
        title: j.title,
        description: j.description,
        scheduledStart,
        scheduledEnd,
        estimatedMinutes: j.estimatedMinutes,
        actualStart,
        actualEnd,
        enRouteAt,
        completionNotes: isDone ? j.completionNotes : null,
        signedByName,
        refrigerantAddedKg: isDone ? j.refrigerantAddedKg : null,
        refrigerantRecoveredKg: isDone ? j.refrigerantRecoveredKg : null,
        gasComplianceCertNumber:
          isDone && j.gas && j.type !== "QUOTE_VISIT" ? `CoC-${digits(7)}` : null,
        onHoldReason: j.onHoldReason,
        createdAt,
        assignments: j.techIds.length
          ? { create: j.techIds.map((userId) => ({ userId, createdAt })) }
          : undefined,
        equipment: equipmentIds.length
          ? { create: equipmentIds.map((equipmentId) => ({ equipmentId, createdAt })) }
          : undefined,
        checklistItems: checklist
          ? {
              create: checklist.map((label, i) => ({
                label,
                checked: isDone || (status === "IN_PROGRESS" && i < 3),
                sortOrder: i,
                createdAt,
              })),
            }
          : undefined,
        lineItems:
          isDone && j.lines.length
            ? {
                create: j.lines.map((l, i) => ({
                  priceBookItemId: l.priceBookItemId,
                  type: l.type,
                  description: l.description,
                  quantity: l.quantity,
                  unitPriceCents: l.unitPriceCents,
                  unitCostCents:
                    l.priceBookItemId === pb("LAB-HR").id
                      ? (techCost.get(j.techIds[0]) ?? l.unitCostCents)
                      : l.unitCostCents,
                  taxable: l.taxable,
                  sortOrder: i,
                  createdAt: actualEnd ?? createdAt,
                })),
              }
            : undefined,
        timeEntries:
          isDone && actualStart && actualEnd
            ? {
                create: j.techIds.map((userId) => ({
                  userId,
                  startedAt: actualStart,
                  endedAt: actualEnd,
                  minutes: minutesBetween(actualStart, actualEnd),
                  createdAt: actualEnd,
                })),
              }
            : status === "IN_PROGRESS" && actualStart
              ? {
                  create: j.techIds.map((userId) => ({
                    userId,
                    startedAt: actualStart,
                    createdAt: actualStart,
                  })),
                }
              : undefined,
      },
    });
    jobIdsByNumber.set(number, job.id);
    const actor = j.techIds[0] ?? office.id;
    activities.push({
      entityType: "JOB",
      entityId: job.id,
      type: "SYSTEM",
      body: `Job ${number} created`,
      userId: office.id,
      createdAt,
      updatedAt: createdAt,
    });
    if (scheduledStart) {
      const t = clampPast(addMinutes(createdAt, 30));
      activities.push({
        entityType: "JOB",
        entityId: job.id,
        type: "STATUS_CHANGE",
        body: `Status changed from Unscheduled to Scheduled (${j.techIds.map((t2) => techName.get(t2)).join(", ")})`,
        userId: office.id,
        createdAt: t,
        updatedAt: t,
      });
    }
    if (actualEnd)
      activities.push({
        entityType: "JOB",
        entityId: job.id,
        type: "STATUS_CHANGE",
        body: "Status changed from In progress to Completed",
        userId: actor,
        createdAt: actualEnd,
        updatedAt: actualEnd,
      });
    if (status === "CANCELLED" || status === "ON_HOLD") {
      const t = clampPast(scheduledStart ? addMinutes(scheduledStart, -60 * 20) : createdAt);
      activities.push({
        entityType: "JOB",
        entityId: job.id,
        type: "STATUS_CHANGE",
        body: `Status changed from Scheduled to ${status === "CANCELLED" ? "Cancelled" : "On hold"}`,
        userId: office.id,
        createdAt: t,
        updatedAt: t,
      });
    }
    if (isDone && actualEnd && j.lines.length) {
      completedJobs.push({
        id: job.id,
        number,
        prop: j.prop,
        completedAt: actualEnd,
        lines: j.lines.map((l) => ({
          ...l,
          unitCostCents:
            l.priceBookItemId === pb("LAB-HR").id
              ? (techCost.get(j.techIds[0]) ?? l.unitCostCents)
              : l.unitCostCents,
        })),
      });
    }
  }

  // ── Invoices ──
  type DesiredStatus =
    | "UNINVOICED"
    | "DRAFT"
    | "SENT"
    | "PARTIAL"
    | "OVERDUE"
    | "OVERDUE_PARTIAL"
    | "PAID"
    | "PAID_CREDIT"
    | "VOID";
  const plan = new Map<string, DesiredStatus>();
  const ageOf = (j: CompletedJob) => melbourneDaysBetween(j.completedAt, NOW);
  const youngest = [...completedJobs].sort(
    (a, b) => b.completedAt.getTime() - a.completedAt.getTime(),
  );
  // Freshest work: two not yet invoiced, three drafts, then sent and part-paid invoices that are not yet due.
  const sequence: [DesiredStatus, number][] = [
    ["UNINVOICED", 3],
    ["UNINVOICED", 3],
    ["DRAFT", 9],
    ["DRAFT", 9],
    ["DRAFT", 9],
    ["SENT", 12],
    ["SENT", 12],
    ["SENT", 25],
    ["PARTIAL", 27],
    ["PARTIAL", 27],
  ];
  for (const [desired, maxAge] of sequence) {
    const candidate = youngest.find((j) => !plan.has(j.id) && ageOf(j) <= maxAge);
    if (candidate) plan.set(candidate.id, desired);
  }
  const takeNearest = (targetAge: number, status: DesiredStatus) => {
    const candidates = completedJobs.filter((j) => !plan.has(j.id));
    if (!candidates.length) return;
    const best = candidates.reduce((a, b) =>
      Math.abs(ageOf(a) - targetAge) <= Math.abs(ageOf(b) - targetAge) ? a : b,
    );
    plan.set(best.id, status);
  };
  takeNearest(24, "OVERDUE");
  takeNearest(36, "OVERDUE");
  takeNearest(55, "OVERDUE_PARTIAL");
  takeNearest(68, "OVERDUE");
  takeNearest(84, "OVERDUE");
  takeNearest(30, "VOID");
  takeNearest(45, "PAID_CREDIT");

  interface InvoiceSpec {
    clientId: string;
    clientType: ClientType;
    propertyId: string | null;
    jobId: string | null;
    desired: Exclude<DesiredStatus, "UNINVOICED">;
    issueDate: Date;
    terms: PaymentTerms;
    lines: LineSpec[];
    notes: string | null;
  }
  const invoiceSpecs: InvoiceSpec[] = [];
  const invoicedJobIds = new Set<string>();
  const defaultTerms = (type: ClientType): PaymentTerms =>
    type === "RESIDENTIAL" ? (chance(0.3) ? "ON_COMPLETION" : "DAYS_14") : "DAYS_30";
  for (const j of completedJobs) {
    const desired = plan.get(j.id) ?? "PAID";
    if (desired === "UNINVOICED") continue;
    invoicedJobIds.add(j.id);
    const issueDate = clampPast(addMinutes(j.completedAt, int(20, 90)));
    let terms = defaultTerms(j.prop.client.type);
    if (desired === "OVERDUE" || desired === "OVERDUE_PARTIAL") terms = "DAYS_14";
    if (desired === "PARTIAL" || (desired === "SENT" && ageOf(j) > 12)) terms = "DAYS_30";
    if ((desired === "SENT" || desired === "DRAFT") && terms === "ON_COMPLETION") terms = "DAYS_14";
    const base = {
      clientId: j.prop.client.id,
      clientType: j.prop.client.type,
      propertyId: j.prop.id,
      jobId: j.id,
      issueDate,
      terms,
      lines: j.lines,
    };
    if (desired === "VOID") {
      invoiceSpecs.push({
        ...base,
        desired: "VOID",
        notes: "Voided – raised against the wrong billing entity. Re-issued.",
      });
      invoiceSpecs.push({
        ...base,
        desired: "PAID",
        issueDate: addMelbourneDays(issueDate, 1),
        notes: "Re-issued with corrected billing details.",
      });
    } else {
      invoiceSpecs.push({
        ...base,
        desired,
        notes:
          desired === "PAID_CREDIT"
            ? "Goodwill credit applied for the delayed return visit."
            : null,
      });
    }
  }

  // Historic paid invoices (no job) for the 12-month revenue chart, plus one 90+ day debt.
  for (let m = 3; m <= 12; m++) {
    const monthStart = startOfMelbourneMonth(NOW, -m);
    const melMonth = Number(toDateInput(monthStart).slice(5, 7));
    const busy =
      melMonth === 12 || melMonth === 1 || melMonth === 2 || melMonth === 6 || melMonth === 7;
    const count = busy ? 3 : 2;
    for (let k = 0; k < count; k++) {
      const prop = pick(serviceableProps);
      const offset = weekday(melbourneDaysBetween(NOW, monthStart) + int(2, 16), -1);
      const built = buildJob(
        prop,
        weighted<JobType>([
          ["SERVICE", 5],
          ["REPAIR", 4],
          ["EMERGENCY", 1],
        ]),
      );
      const issueDate = at(offset, int(56, 66) * 15);
      invoiceSpecs.push({
        clientId: prop.client.id,
        clientType: prop.client.type,
        propertyId: prop.id,
        jobId: null,
        desired: "PAID",
        issueDate,
        terms: defaultTerms(prop.client.type),
        lines: built.lines,
        notes: built.title,
      });
    }
  }
  {
    const stevens = client("stevens");
    const prop = stevens.properties[0];
    invoiceSpecs.push({
      clientId: stevens.id,
      clientType: "RESIDENTIAL",
      propertyId: prop.id,
      jobId: null,
      desired: "OVERDUE",
      issueDate: at(weekday(-128, -1), 15 * 60),
      terms: "DAYS_14",
      lines: [line("CALLOUT"), line("LAB-HR", 2), line("PART-PCB"), line("REGAS-R410A", 1.2)],
      notes: "Repair: Carrier family room unit – PCB and regas. Sent to collections.",
    });
  }

  invoiceSpecs.sort((a, b) => a.issueDate.getTime() - b.issueDate.getTime());

  const METHODS: [PaymentMethod, number][] = [
    ["CARD", 4],
    ["BANK_TRANSFER", 4],
    ["CASH", 1],
    ["CHEQUE", 1],
  ];
  let invoiceNo = 0;
  let creditNoteNo = 0;
  const invoiceStatusCounts = new Map<InvoiceStatus, number>();
  let paymentCount = 0;
  const paidInvoiceNotices: { id: string; number: string; client: string; at: Date }[] = [];
  for (const s of invoiceSpecs) {
    invoiceNo += 1;
    const number = formatDocumentNumber("INV", invoiceNo);
    const totals = calculateTotals(s.lines);
    const dueDate = dueDateFromTerms(s.issueDate, s.terms);
    const termDays = PAYMENT_TERMS_DAYS[s.terms];

    const payments: {
      amountCents: number;
      method: PaymentMethod;
      paidAt: Date;
      reference: string | null;
    }[] = [];
    const methodFor = (): PaymentMethod =>
      s.clientType === "RESIDENTIAL"
        ? weighted(METHODS)
        : chance(0.85)
          ? "BANK_TRANSFER"
          : "CHEQUE";
    const refFor = (m: PaymentMethod): string | null =>
      m === "CARD"
        ? `SQ-${letters(4)}${digits(4)}`
        : m === "BANK_TRANSFER"
          ? number
          : m === "CHEQUE"
            ? `Chq ${digits(6)}`
            : null;
    let creditedCents = 0;
    let creditReason: string | null = null;
    if (s.desired === "PAID" || s.desired === "PAID_CREDIT") {
      if (s.desired === "PAID_CREDIT") {
        creditedCents = 11000;
        creditReason = "Goodwill credit – delayed return visit";
      }
      const method = s.terms === "ON_COMPLETION" ? (chance(0.7) ? "CARD" : "CASH") : methodFor();
      const paidAt = clampPast(
        s.terms === "ON_COMPLETION"
          ? addMinutes(s.issueDate, int(5, 60))
          : at(melbourneDaysBetween(NOW, s.issueDate) + int(1, termDays + 4), int(36, 70) * 15),
      );
      const amount = totals.totalCents - creditedCents;
      if (s.clientType === "RESIDENTIAL" && amount > 300000 && chance(0.7)) {
        // Larger jobs often paid as a deposit plus balance.
        const deposit = Math.round(amount / 2);
        payments.push({
          amountCents: deposit,
          method: "BANK_TRANSFER",
          paidAt: addMinutes(s.issueDate, 10),
          reference: `${number} deposit`,
        });
        payments.push({ amountCents: amount - deposit, method, paidAt, reference: refFor(method) });
      } else {
        payments.push({ amountCents: amount, method, paidAt, reference: refFor(method) });
      }
    } else if (s.desired === "PARTIAL" || s.desired === "OVERDUE_PARTIAL") {
      const method = methodFor();
      const amount = Math.round(totals.totalCents * (s.desired === "PARTIAL" ? 0.5 : 0.4));
      payments.push({
        amountCents: amount,
        method,
        paidAt: clampPast(addMinutes(s.issueDate, int(60 * 24, 60 * 24 * 6))),
        reference: refFor(method),
      });
    }
    const amountPaidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
    const baseStatus: InvoiceStatus =
      s.desired === "VOID" ? "VOID" : s.desired === "DRAFT" ? "DRAFT" : "SENT";
    const status = deriveInvoiceStatus(
      {
        status: baseStatus,
        totalCents: totals.totalCents,
        amountPaidCents,
        creditedCents,
        dueDate,
      },
      NOW,
    );
    const balanceCents =
      status === "VOID"
        ? 0
        : invoiceBalance({ totalCents: totals.totalCents, amountPaidCents, creditedCents });
    const sentAt = baseStatus === "DRAFT" ? null : clampPast(addMinutes(s.issueDate, int(5, 120)));
    const lastPaid = payments.length
      ? payments.map((p) => p.paidAt).reduce((a, b) => (a > b ? a : b))
      : null;
    const invoice = await prisma.invoice.create({
      data: {
        number,
        clientId: s.clientId,
        propertyId: s.propertyId,
        jobId: s.jobId,
        status,
        issueDate: s.issueDate,
        dueDate,
        paymentTerms: s.terms,
        subtotalCents: totals.subtotalCents,
        gstCents: totals.gstCents,
        totalCents: totals.totalCents,
        amountPaidCents,
        creditedCents,
        balanceCents,
        notes: s.notes,
        sentAt,
        paidAt: status === "PAID" ? lastPaid : null,
        voidedAt: status === "VOID" ? clampPast(addMelbourneDays(s.issueDate, 1)) : null,
        createdAt: s.issueDate,
        lineItems: {
          create: s.lines.map((l, i) => ({
            description: l.description,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            unitCostCents: l.unitCostCents,
            taxable: l.taxable,
            totalCents: lineTotalCents(l.quantity, l.unitPriceCents),
            sortOrder: i,
            createdAt: s.issueDate,
          })),
        },
        payments: payments.length
          ? {
              create: payments.map((p) => ({
                clientId: s.clientId,
                amountCents: p.amountCents,
                method: p.method,
                reference: p.reference,
                paidAt: p.paidAt,
                recordedById: office.id,
                createdAt: p.paidAt,
              })),
            }
          : undefined,
        creditNotes:
          creditedCents > 0
            ? {
                create: [
                  {
                    number: formatDocumentNumber("CN", ++creditNoteNo),
                    amountCents: creditedCents,
                    reason: creditReason ?? "Credit",
                    issuedAt: addMinutes(s.issueDate, 60),
                    createdAt: addMinutes(s.issueDate, 60),
                  },
                ],
              }
            : undefined,
      },
    });
    paymentCount += payments.length;
    invoiceStatusCounts.set(status, (invoiceStatusCounts.get(status) ?? 0) + 1);
    if (sentAt)
      activities.push({
        entityType: "INVOICE",
        entityId: invoice.id,
        type: "EMAIL",
        body: `Invoice ${number} emailed to client`,
        userId: office.id,
        createdAt: sentAt,
        updatedAt: sentAt,
      });
    if (status === "PAID" && lastPaid) {
      activities.push({
        entityType: "INVOICE",
        entityId: invoice.id,
        type: "STATUS_CHANGE",
        body: "Invoice paid in full",
        userId: office.id,
        createdAt: lastPaid,
        updatedAt: lastPaid,
      });
      paidInvoiceNotices.push({ id: invoice.id, number, client: s.clientId, at: lastPaid });
    }
  }
  await prisma.job.updateMany({
    where: { id: { in: [...invoicedJobIds] } },
    data: { status: "INVOICED" },
  });

  await prisma.activity.createMany({ data: activities });

  // ── Inventory: suppliers, warehouse + vans, stock history and job usage ──
  const inventory = await seedInventory({ admin, office, tech1, tech2 });

  // ── SMS log: on-my-way and appointment texts for recent visits, a one-off, a service-due ──
  const smsCount = await seedSms(office.id);

  // ── Notifications ──
  const newestWebLead = [...leadRecords].reverse().find((l) => l.spec.status === "NEW");
  const acceptedQuote = [...quoteRecords]
    .filter((q) => q.acceptedAt)
    .sort((a, b) => (b.acceptedAt?.getTime() ?? 0) - (a.acceptedAt?.getTime() ?? 0))[0];
  const lastPaid = paidInvoiceNotices.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  const notifications: Prisma.NotificationCreateManyInput[] = [];
  for (const userId of [admin.id, office.id]) {
    if (inventory.low[0]) {
      notifications.push({
        userId,
        title: `Low stock: ${inventory.low[0]}`,
        body: `Below its reorder level. ${inventory.low.length} parts need ordering.`,
        link: "/inventory?view=low",
        createdAt: addMinutes(NOW, -60 * 26),
      });
    }
    if (newestWebLead) {
      notifications.push({
        userId,
        title: `New lead: ${newestWebLead.spec.name}`,
        body: `${newestWebLead.spec.suburb} – ${newestWebLead.spec.message.slice(0, 80)}`,
        link: `/leads/${newestWebLead.id}`,
        createdAt: newestWebLead.spec.createdAt,
      });
    }
    if (acceptedQuote?.acceptedAt) {
      notifications.push({
        userId,
        title: `Quote ${acceptedQuote.number} accepted`,
        body: acceptedQuote.spec.title,
        link: `/quotes/${acceptedQuote.id}`,
        createdAt: acceptedQuote.acceptedAt,
        readAt: addMinutes(acceptedQuote.acceptedAt, 45),
      });
    }
    if (lastPaid) {
      notifications.push({
        userId,
        title: `Invoice ${lastPaid.number} paid`,
        body: "Payment received in full.",
        link: `/invoices/${lastPaid.id}`,
        createdAt: lastPaid.at,
        readAt: userId === office.id ? addMinutes(lastPaid.at, 20) : null,
      });
    }
  }
  notifications.push({
    userId: admin.id,
    title: "Licence expiring soon",
    body: `Jack Wilson's ARC refrigerant licence (L183452) expires in 20 days.`,
    link: "/settings/team",
    createdAt: addMinutes(NOW, -60 * 5),
  });
  notifications.push({
    userId: admin.id,
    title: "Warranty expiring",
    body: "3 units have manufacturer warranties expiring in the next 30 days.",
    link: "/reports",
    createdAt: addMinutes(NOW, -60 * 26),
    readAt: addMinutes(NOW, -60 * 20),
  });
  await prisma.notification.createMany({ data: notifications });

  // ── Audit log sample ──
  await prisma.auditLog.createMany({
    data: [
      {
        userId: admin.id,
        action: "LOGIN",
        entityType: "USER",
        entityId: admin.id,
        createdAt: addMinutes(NOW, -60 * 3),
      },
      {
        userId: office.id,
        action: "UPDATE",
        entityType: "SETTINGS",
        entityId: "singleton",
        changes: toJson({ invoiceFooter: "updated" }),
        createdAt: addMinutes(NOW, -60 * 24 * 12),
      },
    ],
  });

  // ── Counters ──
  await prisma.counter.createMany({
    data: [
      { id: "counter_quote", key: "QUOTE", value: quoteNo },
      { id: "counter_job", key: "JOB", value: jobNo },
      { id: "counter_invoice", key: "INVOICE", value: invoiceNo },
      { id: "counter_credit_note", key: "CREDIT_NOTE", value: creditNoteNo },
    ],
  });

  // ── Summary ──
  const counts = {
    users: 4,
    clients: clients.size,
    properties: allProps.length,
    equipment: equipmentCount,
    priceBookItems: PRICE_BOOK.length,
    leads: leadRecords.length,
    quotes: quoteRecords.length,
    jobs: jobNo,
    jobsToday: jobSpecs.filter((j) => j.dayOffset === 0).length,
    invoices: invoiceNo,
    payments: paymentCount,
    maintenancePlans: plans.length,
    stockedParts: inventory.items,
    stockMovements: inventory.movements,
    lowStock: inventory.low.length,
    smsLogged: smsCount,
  };
  console.log("\nSeed complete in", ((Date.now() - started) / 1000).toFixed(1), "s");
  console.table(counts);
  console.log("Invoice statuses:", Object.fromEntries(invoiceStatusCounts));
  console.log("\nLogins (password for all: " + PASSWORD + ")");
  console.table([
    { role: "ADMIN", name: admin.name, email: admin.email },
    { role: "OFFICE", name: office.name, email: office.email },
    { role: "TECHNICIAN", name: tech1.name, email: tech1.email },
    { role: "TECHNICIAN", name: tech2.name, email: tech2.email },
  ]);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
