import { z } from "zod";
import { manilaToday } from "../reports/params";
import {
  OCCUPANCY_LABEL,
  isCurrentLease,
  occupancyText,
  stallOccupancy,
  type StallLease,
} from "./occupancy";
import { registerResource, type ColumnConfig, type ResourceConfig } from "./resource";

type StatusMarks = NonNullable<ColumnConfig["status"]>;

const ADMIN_ONLY = ["admin"] as const;
const SUPERVISOR_UP = ["supervisor", "admin"] as const;
// Who has any reason to open the screen at all. Collectors are absent by construction:
// canUseWeb() refuses them the web app, and migration 0003's master-data read policy
// refuses their JWT the rows. The sidebar is filtered by this so a role is never offered
// a screen that can only ever render empty.
const BACK_OFFICE = ["supervisor", "accounting", "admin"] as const;

// zod 4.6.5: `z.string().uuid()` and `z.string().email()` are deprecated in favour of the
// top-level `z.uuid()` / `z.email()`.
const uuid = z.uuid();
const email = z.email();
const name = z.string().min(1, "Required");
const optionalText = z.string().min(1).nullable();
const money = z.number().min(0, "Must not be negative");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

function occupancyOf(row: Record<string, unknown>) {
  return stallOccupancy(
    row.active !== false,
    (row.leases as StallLease[] | null) ?? [],
    manilaToday(),
  );
}

/**
 * "Stall 12 · Fish": the number and its section. A bare stall number is ambiguous,
 * since numbers repeat across sections. Reads a stalls row selected with `sections(name)`.
 */
function stallLabel(stall: Record<string, unknown>): string {
  const section = stall.sections as { name: string } | null;
  return [`Stall ${stall.stall_no}`, section?.name].filter(Boolean).join(" · ");
}

// State marks for the list screens' status columns, keyed by the raw value as text.
// Green for the state things are meant to be in, red where something was cut off, grey
// for the rest.
const ACTIVE_STATUS: StatusMarks = {
  true: { label: "Active", tone: "proof" },
  false: { label: "Inactive", tone: "neutral" },
};
const OCCUPANCY_STATUS: StatusMarks = {
  Vacant: { label: "Vacant", tone: "proof" },
  Occupied: { label: "Occupied", tone: "office" },
  Reserved: { label: "Reserved", tone: "warn" },
  Inactive: { label: "Inactive", tone: "neutral" },
};
const LEASE_STATUS: StatusMarks = {
  active: { label: "Active", tone: "proof" },
  ended: { label: "Ended", tone: "neutral" },
  terminated: { label: "Terminated", tone: "alert" },
};
const BOOKLET_STATUS: StatusMarks = {
  received: { label: "Received", tone: "neutral" },
  assigned: { label: "Assigned", tone: "office" },
  in_use: { label: "In use", tone: "proof" },
  returned: { label: "Returned", tone: "neutral" },
  exhausted: { label: "Exhausted", tone: "warn" },
};
const USER_STATUS: StatusMarks = {
  active: { label: "Active", tone: "proof" },
  suspended: { label: "Suspended", tone: "alert" },
};

const configs: ResourceConfig[] = [
  {
    key: "facilities",
    table: "facilities",
    title: "Facilities",
    singular: "facility",
    empty:
      "No facilities yet. A facility is one market, terminal, parking area or slaughterhouse the office collects from. Sections, stalls and leases all hang off a facility, so this is the first thing to set up.",
    schema: z.object({
      code: name,
      name,
      type: z.enum(["market", "terminal", "parking", "slaughterhouse"]),
      active: z.boolean(),
    }),
    fields: [
      { name: "code", label: "Code", type: "text", help: "Short identifier, e.g. CPM" },
      { name: "name", label: "Name", type: "text" },
      {
        name: "type",
        label: "Type",
        type: "select",
        options: [
          { value: "market", label: "Public market" },
          { value: "terminal", label: "Terminal (IBJT)" },
          { value: "parking", label: "Parking" },
          { value: "slaughterhouse", label: "Slaughterhouse" },
        ],
        help: "Only markets have sections and stalls.",
      },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "type", label: "Type" },
      { key: "active", label: "Status", status: ACTIVE_STATUS },
    ],
    select: "id, code, name, type, active",
    orderBy: "code",
    optionLabel: "name",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
    deletable: {
      inUse:
        "This facility has sections, tablets or collection areas, so it can't be deleted. Mark it inactive instead.",
    },
  },
  {
    key: "sections",
    table: "sections",
    title: "Sections",
    singular: "section",
    // Moving a section moves its stalls, leases and ledger to another market's tablets.
    lockedOnEdit: ["facility_id"],
    empty:
      "No sections yet. A section divides a market into its trades — Fish, Meat, Vegetable, Dry goods — and sets the billing period its stalls inherit. A market facility has to exist before a section can belong to one.",
    schema: z.object({
      facility_id: uuid,
      name,
      default_accrual_period: z.enum(["daily", "weekly", "monthly"]),
      active: z.boolean(),
    }),
    fields: [
      { name: "facility_id", label: "Market", type: "select", optionsFrom: "facilities" },
      { name: "name", label: "Section", type: "text", help: "Fish, Meat, Vegetable, Dry goods" },
      {
        name: "default_accrual_period",
        label: "Default billing period",
        type: "select",
        options: [
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ],
        help: "Leases inherit this and may override it.",
      },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "name", label: "Section" },
      { key: "facilities", label: "Market" },
      { key: "default_accrual_period", label: "Billing period" },
    ],
    select: "id, name, default_accrual_period, active, facilities(name)",
    orderBy: "name",
    optionLabel: "name",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "stalls",
    table: "stalls",
    title: "Stalls",
    singular: "stall",
    empty:
      "No stalls yet. A stall is one numbered space inside a section, and it is what a lease binds a tenant to. Add the sections first; stalls are numbered within them.",
    schema: z.object({
      section_id: uuid,
      stall_no: name,
      area_sqm: z.number().min(0).nullable(),
      active: z.boolean(),
    }),
    fields: [
      { name: "section_id", label: "Section", type: "select", optionsFrom: "sections" },
      { name: "stall_no", label: "Stall number", type: "text" },
      { name: "area_sqm", label: "Area (sqm)", type: "number", optional: true },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "stall_no", label: "Stall" },
      { key: "sections", label: "Section" },
      { key: "area_sqm", label: "Area (sqm)" },
      {
        key: "occupancy",
        label: "Occupancy",
        status: OCCUPANCY_STATUS,
      },
      { key: "occupant", label: "Tenant" },
      { key: "active", label: "Status", status: ACTIVE_STATUS },
    ],
    select:
      "id, stall_no, area_sqm, active, sections(name), leases(status, start_date, end_date, tenants(full_name))",
    orderBy: "stall_no",
    optionLabel: "stall_no",
    // A bare stall number is ambiguous (numbers repeat across sections) and says nothing
    // about whether the stall is free, which is the one thing a new lease needs to know.
    optionText: {
      select:
        "stall_no, active, sections(name), leases(status, start_date, end_date, tenants(full_name))",
      format: (row) => `${stallLabel(row)} — ${occupancyText(occupancyOf(row))}`,
    },
    derive: (row) => {
      const occupancy = occupancyOf(row);
      return {
        occupancy: OCCUPANCY_LABEL[occupancy.state],
        occupant: "tenant" in occupancy ? occupancy.tenant : null,
      };
    },
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
    deletable: {
      inUse: "This stall has a lease, so it can't be deleted. Mark it inactive instead.",
    },
  },
  {
    key: "tenants",
    table: "tenants",
    title: "Tenants",
    singular: "tenant",
    empty:
      "No tenants yet. A tenant is the person who holds a lease and whose name the collector writes on the paper Official Receipt.",
    schema: z.object({
      full_name: name,
      address: optionalText,
      contact_no: optionalText,
      active: z.boolean(),
    }),
    fields: [
      { name: "full_name", label: "Full name", type: "text" },
      { name: "address", label: "Address", type: "text", optional: true },
      { name: "contact_no", label: "Contact number", type: "text", optional: true },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "full_name", label: "Name", facet: false },
      { key: "address", label: "Address", facet: false },
      { key: "contact_no", label: "Contact", facet: false },
      { key: "current_stalls", label: "Stalls rented", emptyText: "None", facet: false },
      { key: "active", label: "Status", status: ACTIVE_STATUS },
    ],
    select:
      "id, full_name, address, contact_no, active, leases(status, start_date, end_date, stalls(stall_no, sections(name)))",
    // The stalls this tenant holds today, from their current leases.
    derive: (row) => {
      const today = manilaToday();
      const leases = (row.leases as (StallLease & { stalls: Record<string, unknown> | null })[] | null) ?? [];
      const stalls = leases
        .filter((lease) => lease.stalls && isCurrentLease(lease, today))
        .map((lease) => stallLabel(lease.stalls!))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return { current_stalls: stalls.length ? stalls.join(", ") : null };
    },
    orderBy: "full_name",
    optionLabel: "full_name",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
    deletable: {
      inUse: "This tenant has a lease, so they can't be deleted. Mark them inactive instead.",
    },
  },
  {
    key: "leases",
    table: "leases",
    title: "Leases",
    singular: "lease",
    // Charges already accrued belong to this stall and tenant. To change either, end this lease and create a new one.
    lockedOnEdit: ["stall_id", "tenant_id"],
    empty:
      "No leases yet. A lease binds a tenant to a stall at a rate for a billing period. It is what the nightly accrual bills, what shows up in the ledger, and what a collector looks up on the tablet — nothing is collected without one.",
    schema: z.object({
      stall_id: uuid,
      tenant_id: uuid,
      start_date: isoDate,
      end_date: isoDate.nullable(),
      rate_amount: money,
      accrual_period: z.enum(["daily", "weekly", "monthly"]),
      due_day: z.number().int().min(1).max(28).nullable(),
      status: z.enum(["active", "ended", "terminated"]),
    }),
    fields: [
      { name: "stall_id", label: "Stall", type: "select", optionsFrom: "stalls" },
      { name: "tenant_id", label: "Tenant", type: "select", optionsFrom: "tenants" },
      { name: "start_date", label: "Start date", type: "date" },
      { name: "end_date", label: "End date", type: "date", optional: true, help: "Leave blank for open-ended." },
      { name: "rate_amount", label: "Rate", type: "money", help: "Amount per billing period." },
      {
        name: "accrual_period",
        label: "Billing period",
        type: "select",
        options: [
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ],
      },
      { name: "due_day", label: "Due day of month", type: "number", optional: true, help: "Required for monthly leases. 1–28." },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "ended", label: "Ended" },
          { value: "terminated", label: "Terminated" },
        ],
        help: "To free the stall, set Ended (term ran out) or Terminated (cut short) and fill in the end date. Billing stops and the stall shows as vacant.",
      },
    ],
    columns: [
      { key: "stall", label: "Stall", facet: false },
      { key: "tenants", label: "Tenant", facet: false },
      { key: "start_date", label: "From", facet: false, dateBound: "min" },
      { key: "end_date", label: "To", facet: false, dateBound: "max" },
      { key: "rate_amount", label: "Rate", facet: false },
      { key: "accrual_period", label: "Period" },
      { key: "status", label: "Status", status: LEASE_STATUS },
    ],
    select:
      "id, start_date, end_date, rate_amount, accrual_period, due_day, status, stalls(stall_no, sections(name)), tenants(full_name)",
    derive: (row) => ({
      stall: row.stalls ? stallLabel(row.stalls as Record<string, unknown>) : null,
    }),
    orderBy: "start_date",
    optionLabel: "start_date",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "fee-types",
    table: "fee_types",
    title: "Fee types",
    singular: "fee type",
    empty:
      "No fee types yet. A fee type names something the office charges for — stall rental, ambulant vending, parking, terminal, slaughter — and records whether it accrues and what surcharge it carries.",
    schema: z.object({
      code: name,
      name,
      accrues: z.boolean(),
      surcharge_bps: z.number().int().min(0).max(10000),
      facility_type: z.enum(["market", "terminal", "parking", "slaughterhouse"]).nullable(),
      active: z.boolean(),
    })
    // An on-the-spot fee with no site would be offered on EVERY tablet (null means
    // "anywhere" on the device), which is how a test fixture's slaughter fee once appeared
    // at the bus terminal. Only an accruing fee may leave it blank: it is billed through a
    // lease, never picked on the fee screen.
    .superRefine((value, ctx) => {
      if (!value.accrues && value.facility_type === null) {
        ctx.addIssue({
          code: "custom",
          path: ["facility_type"],
          message: "Choose where this fee is collected. Tablets offer it only there.",
        });
      }
    }),
    fields: [
      { name: "code", label: "Code", type: "text", help: "e.g. MKT_DAILY, SLAUGHTER" },
      { name: "name", label: "Name", type: "text" },
      { name: "accrues", label: "Creates a receivable", type: "boolean", help: "Market rentals do. Parking, terminal and slaughter fees do not." },
      { name: "surcharge_bps", label: "Surcharge (basis points)", type: "number", help: "3% is 300. Integer only." },
      {
        name: "facility_type",
        label: "Collected at",
        type: "select",
        optional: true,
        help: "Tablets offer this fee only at this kind of facility. Required unless the fee creates a receivable.",
        options: [
          { value: "market", label: "Market" },
          { value: "terminal", label: "Terminal" },
          { value: "parking", label: "Parking" },
          { value: "slaughterhouse", label: "Slaughterhouse" },
        ],
      },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "facility_type", label: "Collected at" },
      { key: "accrues", label: "Accrues" },
      { key: "surcharge_bps", label: "Surcharge (bps)" },
    ],
    select: "id, code, name, facility_type, accrues, surcharge_bps, active",
    orderBy: "code",
    optionLabel: "name",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "rates",
    table: "rates",
    title: "Rates",
    singular: "rate",
    // Receipts already priced from this rate must keep meaning what they said. To change a rate, set Effective to and add a new one.
    lockedOnEdit: ["fee_type_id", "rate_class", "effective_from", "amount", "basis"],
    empty:
      "No rates yet. A rate is what a fee type costs from a given date onward. Rates are added and dated rather than edited, so what was charged last year stays provable this year.",
    schema: z.object({
      fee_type_id: uuid,
      // Blank means unclassified, stored as '' not NULL: the no-overlap constraint compares
      // rate_class with =, and NULL never equals NULL.
      rate_class: z.string().nullable().transform((value) => value ?? ""),
      effective_from: isoDate,
      effective_to: isoDate.nullable(),
      amount: money,
      basis: z.enum(["per_day", "per_week", "per_month", "per_entry", "per_head", "per_sqm"]),
    }),
    fields: [
      { name: "fee_type_id", label: "Fee type", type: "select", optionsFrom: "fee-types" },
      { name: "rate_class", label: "Class", type: "text", optional: true, help: "Vehicle class at the terminal, animal class at the slaughterhouse. Leave blank if unclassified." },
      { name: "effective_from", label: "Effective from", type: "date" },
      { name: "effective_to", label: "Effective to", type: "date", optional: true, help: "Leave blank while this rate is current." },
      { name: "amount", label: "Amount", type: "money" },
      {
        name: "basis",
        label: "Basis",
        type: "select",
        options: [
          { value: "per_day", label: "Per day" },
          { value: "per_week", label: "Per week" },
          { value: "per_month", label: "Per month" },
          { value: "per_entry", label: "Per entry" },
          { value: "per_head", label: "Per head" },
          { value: "per_sqm", label: "Per square metre" },
        ],
      },
    ],
    columns: [
      { key: "fee_types", label: "Fee type" },
      { key: "rate_class", label: "Class" },
      { key: "effective_from", label: "From" },
      { key: "effective_to", label: "To" },
      { key: "amount", label: "Amount" },
      { key: "basis", label: "Basis" },
    ],
    select: "id, rate_class, effective_from, effective_to, amount, basis, fee_types(name)",
    orderBy: "effective_from",
    optionLabel: "effective_from",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "form-types",
    table: "form_types",
    title: "Accountable form types",
    singular: "form type",
    empty:
      "No accountable form types yet. A form type is a class of pre-printed accountable form, such as the Official Receipt the collector hand-writes and the office must account for by serial.",
    schema: z.object({ code: name, name, active: z.boolean() }),
    fields: [
      { name: "code", label: "Code", type: "text", help: "e.g. OR51" },
      { name: "name", label: "Name", type: "text" },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
    ],
    select: "id, code, name, active",
    orderBy: "code",
    optionLabel: "code",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "booklets",
    table: "booklets",
    title: "OR booklets",
    singular: "booklet",
    // Serials already written as receipts or spoiled must stay inside the booklet they came from.
    lockedOnEdit: ["form_type_id", "serial_prefix", "start_no", "end_no"],
    empty:
      "No OR booklets yet. A booklet is a physical range of serial numbers issued to the office. A tablet refuses any serial that falls outside a booklet assigned to it, so the paper and the system stay in step.",
    schema: z.object({
      form_type_id: uuid,
      serial_prefix: name,
      start_no: z.number().int().positive(),
      end_no: z.number().int().positive(),
      received_date: isoDate,
      status: z.enum(["received", "assigned", "in_use", "returned", "exhausted"]),
    }),
    fields: [
      { name: "form_type_id", label: "Form type", type: "select", optionsFrom: "form-types" },
      { name: "serial_prefix", label: "Serial prefix", type: "text" },
      { name: "start_no", label: "First serial", type: "number" },
      { name: "end_no", label: "Last serial", type: "number" },
      { name: "received_date", label: "Received", type: "date" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "received", label: "Received" },
          { value: "assigned", label: "Assigned" },
          { value: "in_use", label: "In use" },
          { value: "returned", label: "Returned" },
          { value: "exhausted", label: "Exhausted" },
        ],
      },
    ],
    columns: [
      { key: "serial_prefix", label: "Prefix" },
      { key: "start_no", label: "From" },
      { key: "end_no", label: "To" },
      { key: "received_date", label: "Received" },
      { key: "status", label: "Status", status: BOOKLET_STATUS },
    ],
    select: "id, serial_prefix, start_no, end_no, received_date, status, form_types(code)",
    orderBy: "start_no",
    optionLabel: "serial_prefix",
    optionText: {
      select: "serial_prefix, start_no, end_no",
      format: (row) => `${row.serial_prefix} ${row.start_no}–${row.end_no}`,
    },
    readRoles: BACK_OFFICE,
    writeRoles: SUPERVISOR_UP,
  },
  {
    // Hands a booklet to a collector. A tablet refuses any OR number from a booklet its
    // collector does not hold, and post_collection() checks the same on the server against
    // assigned_at..returned_at, so an issued date in the future refuses today's receipts.
    // Supervisors may write this (migration 0008). The database refuses a non-collector
    // (booklet_assignments_collector_only) and a booklet already in someone's hands on
    // those dates (booklet_one_holder); both messages are shown as-is.
    key: "booklet-assignments",
    table: "booklet_assignments",
    title: "Booklet issuance",
    singular: "booklet issuance",
    empty:
      "No booklets issued yet. Issue an OR booklet to a collector here; until then their tablet refuses every OR number, however the booklet is registered.",
    schema: z.object({
      booklet_id: uuid,
      collector_id: uuid,
      assigned_at: isoDate,
      returned_at: isoDate.nullable(),
    }),
    fields: [
      { name: "booklet_id", label: "Booklet", type: "select", optionsFrom: "booklets" },
      {
        name: "collector_id",
        label: "Collector",
        type: "select",
        optionsFrom: "users",
        help: "Collectors only. Another role is refused by the database.",
      },
      {
        name: "assigned_at",
        label: "Issued",
        type: "date",
        help: "Receipts dated before this are refused, so use today or earlier.",
      },
      {
        name: "returned_at",
        label: "Returned",
        type: "date",
        optional: true,
        help: "Leave blank while the collector holds it. Set it when the booklet comes back.",
      },
    ],
    // Aliased embeds: formatCell shows one column per join, so the range is fetched twice
    // under different names to give From and To their own columns.
    columns: [
      { key: "booklets", label: "Booklet" },
      { key: "first", label: "From" },
      { key: "last", label: "To" },
      { key: "app_users", label: "Collector" },
      { key: "assigned_at", label: "Issued" },
      { key: "returned_at", label: "Returned" },
    ],
    select:
      "id, assigned_at, returned_at, booklets(serial_prefix), first:booklets(start_no), last:booklets(end_no), app_users(full_name)",
    orderBy: "created_at",
    optionLabel: "id",
    readRoles: BACK_OFFICE,
    writeRoles: SUPERVISOR_UP,
  },
  {
    key: "devices",
    table: "devices",
    title: "Tablets",
    singular: "tablet",
    empty:
      "No tablets yet. Register a tablet here, then issue it a credential to enrol it. A collector cannot open a shift on a device the office has not registered.",
    schema: z.object({ label: name, active: z.boolean() }),
    fields: [
      { name: "label", label: "Label", type: "text", help: "e.g. Tablet 01. Tablets are shared between collectors." },
      { name: "active", label: "Active", type: "boolean", help: "Deactivating refuses this tablet's uploads." },
    ],
    columns: [
      { key: "label", label: "Tablet" },
      { key: "registered_at", label: "Registered" },
      { key: "last_seen_at", label: "Last seen" },
      { key: "active", label: "Status", status: ACTIVE_STATUS },
    ],
    select: "id, label, registered_at, last_seen_at, active",
    orderBy: "label",
    optionLabel: "label",
    readRoles: BACK_OFFICE,
    writeRoles: SUPERVISOR_UP,
  },
  {
    // Determines WHAT DATA SYNCS TO A TABLET. Supervisors may write this (migration 0008
    // lists device_assignments among the five supervisor-writable tables); the roles here
    // mirror that policy rather than restating a preference.
    //
    // device_assignments_one_active is a unique index on (device_id) where active, so a
    // device can hold exactly one active assignment. Re-assigning a tablet means clearing
    // `active` on the current row first; a second active row is refused by the database
    // with 23505 and the form surfaces that error rather than swallowing it.
    key: "device-assignments",
    table: "device_assignments",
    title: "Tablet assignments",
    singular: "tablet assignment",
    empty:
      "No tablet assignments yet. An assignment says which facility and section a tablet collects for, which is how it knows the right leases to pull down before it goes offline.",
    schema: z.object({
      device_id: uuid,
      facility_id: uuid,
      section_id: uuid.nullable(),
      active: z.boolean(),
    }),
    fields: [
      { name: "device_id", label: "Tablet", type: "select", optionsFrom: "devices" },
      { name: "facility_id", label: "Facility", type: "select", optionsFrom: "facilities" },
      {
        name: "section_id",
        label: "Section",
        type: "select",
        optionsFrom: "sections",
        optional: true,
        emptyLabel: "All sections",
        help: "All sections covers the whole facility. A terminal or slaughterhouse has no sections.",
      },
      {
        name: "active",
        label: "Active",
        type: "boolean",
        help: "A tablet may hold only one active assignment. Deactivate the current one before adding another.",
      },
    ],
    columns: [
      { key: "devices", label: "Tablet" },
      { key: "facilities", label: "Facility" },
      { key: "sections", label: "Section", emptyText: "All sections" },
      { key: "active", label: "Status", status: ACTIVE_STATUS },
    ],
    // sections is disambiguated: device_assignments carries two foreign keys into it
    // (the plain section_id FK, and device_assignments_section_in_facility's composite
    // one), so an unqualified sections(name) is refused by PostgREST at runtime with
    // PGRST201 ("more than one relationship was found") even though it typechecks fine.
    select:
      "id, active, devices(label), facilities(name), sections!device_assignments_section_id_fkey(name)",
    orderBy: "created_at",
    optionLabel: "id",
    readRoles: BACK_OFFICE,
    writeRoles: SUPERVISOR_UP,
  },
  {
    // Determines WHERE A PERSON MAY COLLECT. Admin-only: migration 0008 does NOT list
    // collector_assignments, so apply_master_data_policies' admin-only rule stands.
    //
    // A trigger refuses any assignee whose app_users role is not 'collector'. The picker
    // cannot filter by role (optionsFrom takes a resource, not a predicate), so a wrong
    // choice is refused by the database with 23514 and its message is shown as-is.
    key: "collector-assignments",
    table: "collector_assignments",
    title: "Collection areas",
    singular: "collection area",
    empty:
      "No collection areas yet. A collection area is the facility and section a collector is responsible for. Until a collector has one, they have nothing to collect and their round will come up empty.",
    schema: z.object({
      collector_id: uuid,
      facility_id: uuid,
      section_id: uuid.nullable(),
      active: z.boolean(),
    }),
    fields: [
      {
        name: "collector_id",
        label: "Collector",
        type: "select",
        optionsFrom: "users",
        help: "Collectors only. Another role is refused by the database.",
      },
      { name: "facility_id", label: "Facility", type: "select", optionsFrom: "facilities" },
      {
        name: "section_id",
        label: "Section",
        type: "select",
        optionsFrom: "sections",
        optional: true,
        emptyLabel: "All sections",
        help: "All sections covers the whole facility.",
      },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "app_users", label: "Collector" },
      { key: "facilities", label: "Facility" },
      { key: "sections", label: "Section", emptyText: "All sections" },
      { key: "active", label: "Status", status: ACTIVE_STATUS },
    ],
    // Same disambiguation as device-assignments above: collector_assignments also carries
    // two foreign keys into sections (section_id, and the composite
    // collector_assignments_section_in_facility), so an unqualified sections(name) is
    // refused by PostgREST at runtime with PGRST201.
    select:
      "id, active, app_users(full_name), facilities(name), sections!collector_assignments_section_id_fkey(name)",
    orderBy: "created_at",
    optionLabel: "id",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
  },
  {
    // An app_users row can only exist once someone has completed Google sign-in (its id
    // references auth.users), but the access gate refuses anyone without an app_users row.
    // Inviting by email breaks that circle: an administrator records the intended staff
    // member here, and migration 0009's trigger converts the invite into a real app_users
    // row — with the invited role — the moment that person first signs in. This resource
    // only ever writes to staff_invites, never to app_users directly.
    key: "staff-invites",
    table: "staff_invites",
    title: "Staff invitations",
    singular: "invitation",
    empty:
      "No invitations yet. Register an office email address here before that person signs in with Google. An account that was never invited is refused at the door, however valid the Google sign-in.",
    schema: z.object({
      email,
      employee_no: name,
      full_name: name,
      role: z.enum(["collector", "supervisor", "accounting", "admin"]),
    }),
    fields: [
      { name: "email", label: "Email", type: "text", help: "The Google account they will sign in with." },
      { name: "employee_no", label: "Employee number", type: "text" },
      { name: "full_name", label: "Full name", type: "text" },
      {
        name: "role",
        label: "Role",
        type: "select",
        options: [
          { value: "collector", label: "Collector (tablet only)" },
          { value: "supervisor", label: "Supervisor" },
          { value: "accounting", label: "Accounting" },
          { value: "admin", label: "Administrator" },
        ],
      },
    ],
    columns: [
      { key: "email", label: "Email" },
      { key: "employee_no", label: "Employee no." },
      { key: "full_name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "invited_at", label: "Invited" },
    ],
    select: "id, email, employee_no, full_name, role, invited_at",
    orderBy: "invited_at",
    optionLabel: "full_name",
    // Migration 0009 made staff_invites admin-only reading: a pending invite names an
    // address that, until claimed, confers the role it carries. A supervisor opening this
    // screen would get an unavoidably empty table, so it is not offered to them.
    readRoles: ADMIN_ONLY,
    writeRoles: ADMIN_ONLY,
  },
  {
    // Who actually has access, distinct from who has been invited. Nothing CREATES an
    // app_users row through this UI — migration 0009's claim trigger is the only path,
    // fired by a real Google sign-in, because `id` references auth.users and this form has
    // no way to supply one.
    //
    // Editing an existing row is a different matter and is the only working way to correct
    // a wrong role or suspend a leaver: re-inviting handles the person who signs in again,
    // but an administrator must be able to act on someone who does not. Hence `role` and
    // `status` only — `id` and `employee_no` are deliberately absent from `fields`, so the
    // engine neither renders nor accepts them.
    key: "users",
    table: "app_users",
    title: "Staff",
    singular: "staff member",
    empty:
      "No staff yet. A staff record is created by the system the first time an invited person signs in with Google — it cannot be added here. Send them an invitation instead.",
    schema: z.object({
      role: z.enum(["collector", "supervisor", "accounting", "admin"]),
      status: z.enum(["active", "suspended"]),
    }),
    fields: [
      {
        name: "role",
        label: "Role",
        type: "select",
        options: [
          { value: "collector", label: "Collector (tablet only)" },
          { value: "supervisor", label: "Supervisor" },
          { value: "accounting", label: "Accounting" },
          { value: "admin", label: "Administrator" },
        ],
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "suspended", label: "Suspended" },
        ],
      },
    ],
    columns: [
      { key: "employee_no", label: "Employee no." },
      { key: "full_name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "status", label: "Status", status: USER_STATUS },
    ],
    select: "id, employee_no, full_name, role, status",
    orderBy: "full_name",
    optionLabel: "full_name",
    readRoles: BACK_OFFICE,
    writeRoles: ADMIN_ONLY,
    // Update only. An insert form here could never succeed: `id` references auth.users and
    // the form has no way to supply one.
    writeMode: "edit",
  },
  {
    // Read-only, append-only at the database (migration 0010 revokes insert/update/delete
    // from every role). No writeRoles, so the engine renders no form — but the empty array
    // is what the server-side write path actually enforces; the absent form is not itself
    // the guarantee.
    key: "audit-log",
    table: "audit_log",
    title: "Audit log",
    singular: "entry",
    empty:
      "Nothing recorded yet. Every change to master data lands here with who made it and when. The database writes this log; nobody types into it.",
    schema: z.object({}),
    fields: [],
    columns: [
      { key: "at", label: "When" },
      { key: "app_users", label: "Who" },
      { key: "action", label: "Action" },
      { key: "entity", label: "Record type" },
      { key: "entity_id", label: "Record" },
    ],
    select: "id, at, action, entity, entity_id, app_users(full_name)",
    orderBy: "at",
    // Latest first: what someone opens the log for is usually what just changed.
    orderDescending: true,
    optionLabel: "action",
    readRoles: BACK_OFFICE,
    writeRoles: [],
  },
];

for (const config of configs) registerResource(config);
