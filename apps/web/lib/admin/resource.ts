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
  writeRoles: readonly Role[];
}

export const RESOURCES: Record<string, ResourceConfig> = {};

export function registerResource(config: ResourceConfig): void {
  RESOURCES[config.key] = config;
}
