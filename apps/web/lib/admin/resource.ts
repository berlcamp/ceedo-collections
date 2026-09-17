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
  help?: string;
}

type TableName = keyof Database["ceedo_collections"]["Tables"];

export interface ColumnConfig {
  key: string;
  label: string;
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
   * Roles for whom this screen can show anything. Presentation only — RLS is what
   * actually decides, and this must mirror it: a role listed here that the policy denies
   * gets an empty screen, and a role omitted here that the policy allows loses a screen it
   * is entitled to. Used to filter the sidebar so nobody is offered a dead link.
   */
  readRoles: readonly Role[];
  writeRoles: readonly Role[];
  /**
   * "create" (the default) renders a blank form that inserts. "edit" renders a picker of
   * existing rows and updates the chosen one, and never inserts.
   *
   * app_users is the reason this exists: its `id` references auth.users, so a row can only
   * come into being through migration 0009's claim trigger on a real Google sign-in. An
   * insert form for it could not work — there is no id to supply — but an administrator
   * still has to be able to correct a role or suspend a leaver, and until now the engine
   * had no update path at all for any resource.
   */
  writeMode?: "create" | "edit";
}

export const RESOURCES: Record<string, ResourceConfig> = {};

export function registerResource(config: ResourceConfig): void {
  RESOURCES[config.key] = config;
}
