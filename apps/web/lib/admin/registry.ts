import { z } from "zod";
import { registerResource, type ResourceConfig } from "./resource";

const ADMIN_ONLY = ["admin"] as const;
const SUPERVISOR_UP = ["supervisor", "admin"] as const;

// zod 4.6.5: `z.string().uuid()` and `z.string().email()` are deprecated in favour of the
// top-level `z.uuid()` / `z.email()`.
const uuid = z.uuid();
const email = z.email();
const name = z.string().min(1, "Required");
const optionalText = z.string().min(1).nullable();
const money = z.number().min(0, "Must not be negative");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const configs: ResourceConfig[] = [
  {
    key: "facilities",
    table: "facilities",
    title: "Facilities",
    singular: "facility",
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
      { key: "active", label: "Active" },
    ],
    select: "id, code, name, type, active",
    orderBy: "code",
    optionLabel: "name",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "sections",
    table: "sections",
    title: "Sections",
    singular: "section",
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
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "stalls",
    table: "stalls",
    title: "Stalls",
    singular: "stall",
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
      { key: "active", label: "Active" },
    ],
    select: "id, stall_no, area_sqm, active, sections(name)",
    orderBy: "stall_no",
    optionLabel: "stall_no",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "tenants",
    table: "tenants",
    title: "Tenants",
    singular: "tenant",
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
      { key: "full_name", label: "Name" },
      { key: "contact_no", label: "Contact" },
      { key: "active", label: "Active" },
    ],
    select: "id, full_name, address, contact_no, active",
    orderBy: "full_name",
    optionLabel: "full_name",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "leases",
    table: "leases",
    title: "Leases",
    singular: "lease",
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
      },
    ],
    columns: [
      { key: "stalls", label: "Stall" },
      { key: "tenants", label: "Tenant" },
      { key: "start_date", label: "From" },
      { key: "end_date", label: "To" },
      { key: "rate_amount", label: "Rate" },
      { key: "accrual_period", label: "Period" },
      { key: "status", label: "Status" },
    ],
    select:
      "id, start_date, end_date, rate_amount, accrual_period, due_day, status, stalls(stall_no), tenants(full_name)",
    orderBy: "start_date",
    optionLabel: "start_date",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "fee-types",
    table: "fee_types",
    title: "Fee types",
    singular: "fee type",
    schema: z.object({
      code: name,
      name,
      accrues: z.boolean(),
      surcharge_bps: z.number().int().min(0).max(10000),
      active: z.boolean(),
    }),
    fields: [
      { name: "code", label: "Code", type: "text", help: "e.g. MKT_DAILY, SLAUGHTER" },
      { name: "name", label: "Name", type: "text" },
      { name: "accrues", label: "Creates a receivable", type: "boolean", help: "Market rentals do. Parking, terminal and slaughter fees do not." },
      { name: "surcharge_bps", label: "Surcharge (basis points)", type: "number", help: "3% is 300. Integer only." },
      { name: "active", label: "Active", type: "boolean" },
    ],
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "accrues", label: "Accrues" },
      { key: "surcharge_bps", label: "Surcharge (bps)" },
    ],
    select: "id, code, name, accrues, surcharge_bps, active",
    orderBy: "code",
    optionLabel: "name",
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "rates",
    table: "rates",
    title: "Rates",
    singular: "rate",
    schema: z.object({
      fee_type_id: uuid,
      rate_class: z.string(),
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
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "form-types",
    table: "form_types",
    title: "Accountable form types",
    singular: "form type",
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
    writeRoles: ADMIN_ONLY,
  },
  {
    key: "booklets",
    table: "booklets",
    title: "OR booklets",
    singular: "booklet",
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
      { key: "status", label: "Status" },
    ],
    select: "id, serial_prefix, start_no, end_no, received_date, status, form_types(code)",
    orderBy: "start_no",
    optionLabel: "serial_prefix",
    writeRoles: SUPERVISOR_UP,
  },
  {
    key: "devices",
    table: "devices",
    title: "Tablets",
    singular: "tablet",
    schema: z.object({ label: name, active: z.boolean() }),
    fields: [
      { name: "label", label: "Label", type: "text", help: "e.g. Tablet 01. Tablets are shared between collectors." },
      { name: "active", label: "Active", type: "boolean", help: "Deactivating refuses this tablet's uploads." },
    ],
    columns: [
      { key: "label", label: "Tablet" },
      { key: "registered_at", label: "Registered" },
      { key: "last_seen_at", label: "Last seen" },
      { key: "active", label: "Active" },
    ],
    select: "id, label, registered_at, last_seen_at, active",
    orderBy: "label",
    optionLabel: "label",
    writeRoles: SUPERVISOR_UP,
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
    writeRoles: ADMIN_ONLY,
  },
  {
    // Read-only: who actually has access, distinct from who has been invited. Nothing
    // creates an app_users row through this UI — migration 0009's trigger is the only
    // path, fired by a real Google sign-in.
    key: "users",
    table: "app_users",
    title: "Staff",
    singular: "staff member",
    schema: z.object({
      employee_no: name,
      full_name: name,
      role: z.enum(["collector", "supervisor", "accounting", "admin"]),
      status: z.enum(["active", "suspended"]),
    }),
    fields: [
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
      { key: "status", label: "Status" },
    ],
    select: "id, employee_no, full_name, role, status",
    orderBy: "full_name",
    optionLabel: "full_name",
    writeRoles: [],
  },
];

for (const config of configs) registerResource(config);
