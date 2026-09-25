import type { Database, Role } from "@ceedo/shared";
import type { ZodObject, ZodRawShape } from "zod";

export interface SelectOption {
  value: string;
  label: string;
}

export interface FieldConfig {
  name: string;
  label: string;
  type: "text" | "number" | "money" | "date" | "select" | "boolean";
  /** Static choices. Dynamic ones are loaded by the page and merged in. */
  options?: SelectOption[];
  /** Names a resource whose rows become the choices, e.g. "facilities". */
  optionsFrom?: string;
  optional?: boolean;
  /**
   * An optional select's choice for "no value", e.g. "All sections". Without it an
   * optional select cannot be cleared once set: Radix refuses an item whose value is "".
   */
  emptyLabel?: string;
  help?: string;
}

type TableName = keyof Database["ceedo_collections"]["Tables"];

export interface ColumnConfig {
  key: string;
  label: string;
  /** Shown for a null value when null has a meaning, e.g. a section of "All sections". */
  emptyText?: string;
}

export interface ResourceConfig<S extends ZodObject<ZodRawShape> = ZodObject<ZodRawShape>> {
  /** URL segment, e.g. "facilities". */
  key: string;
  /** Table name inside ceedo_collections. A typo here fails to typecheck. */
  table: TableName;
  title: string;
  singular: string;
  schema: S;
  fields: FieldConfig[];
  columns: ColumnConfig[];
  /** PostgREST select expression, including any joined labels. */
  select: string;
  orderBy: string;
  /** Column used as the display label when this resource is another field's optionsFrom source. */
  optionLabel: string;
  /**
   * When one column cannot tell the choices apart: the columns to fetch and how to join
   * them into a label. Booklets need it, since many share a prefix and differ by range.
   */
  optionText?: { select: string; format: (row: Record<string, unknown>) => string };
  /**
   * What to say when this screen has no rows.
   *
   * Required, not optional, and deliberately per-resource: "Nothing here yet." is true of
   * every table and useful on none of them. An operator meeting an empty screen needs to
   * know what a record here *is* and what depends on it — several of these resources are
   * only reachable in a particular order (a stall needs a section, a section needs a
   * market), and an empty screen is exactly where that order has to be visible.
   */
  empty: string;
  /**
   * Roles for whom this screen can show anything. Presentation only — RLS is what
   * actually decides, and this must mirror it: a role listed here that the policy denies
   * gets an empty screen, and a role omitted here that the policy allows loses a screen it
   * is entitled to. Used to filter the sidebar so nobody is offered a dead link.
   */
  readRoles: readonly Role[];
  writeRoles: readonly Role[];
  /**
   * "create" (the default) inserts from a blank form AND updates an existing row picked in
   * the table. "edit" only updates, and never inserts.
   *
   * app_users is the reason this exists: its `id` references auth.users, so a row can only
   * come into being through migration 0009's claim trigger on a real Google sign-in. An
   * insert form for it could not work — there is no id to supply — but an administrator
   * still has to be able to correct a role or suspend a leaver, and until now the engine
   * had no update path at all for any resource.
   */
  writeMode?: "create" | "edit";
  /**
   * Fields shown but not changeable on an edit, because changing them once money exists
   * would rewrite history rather than correct a record: a lease's stall, a booklet's serial
   * range, a rate's amount. The remedy is always a new row (end the lease, add a rate), and
   * each field's `help` says so. Enforced in `saveResource`, not just by the form.
   */
  lockedOnEdit?: readonly string[];
  /**
   * Offers Delete on the edit form, to the resource's writeRoles. The database decides:
   * a row anything still refers to is refused by its foreign key, and `inUse` says so.
   */
  deletable?: { inUse: string };
}

export const RESOURCES: Record<string, ResourceConfig> = {};

export function registerResource(config: ResourceConfig): void {
  RESOURCES[config.key] = config;
}
