// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.
// Run `pnpm db:types` to regenerate from the local Postgres schema (schema: ceedo_collections).
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  ceedo_collections: {
    Tables: {
      app_users: {
        Row: {
          created_at: string
          employee_no: string
          full_name: string
          id: string
          pin_hash: string | null
          role: Database["ceedo_collections"]["Enums"]["app_role"]
          row_version: number
          status: Database["ceedo_collections"]["Enums"]["user_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          employee_no: string
          full_name: string
          id: string
          pin_hash?: string | null
          role: Database["ceedo_collections"]["Enums"]["app_role"]
          row_version?: number
          status?: Database["ceedo_collections"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_no?: string
          full_name?: string
          id?: string
          pin_hash?: string | null
          role?: Database["ceedo_collections"]["Enums"]["app_role"]
          row_version?: number
          status?: Database["ceedo_collections"]["Enums"]["user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          at: string
          before: Json | null
          entity: string
          entity_id: string | null
          id: number
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity: string
          entity_id?: string | null
          id?: never
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          at?: string
          before?: Json | null
          entity?: string
          entity_id?: string | null
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      booklet_assignments: {
        Row: {
          assigned_at: string
          booklet_id: string
          collector_id: string
          created_at: string
          id: string
          returned_at: string | null
          row_version: number
        }
        Insert: {
          assigned_at: string
          booklet_id: string
          collector_id: string
          created_at?: string
          id?: string
          returned_at?: string | null
          row_version?: number
        }
        Update: {
          assigned_at?: string
          booklet_id?: string
          collector_id?: string
          created_at?: string
          id?: string
          returned_at?: string | null
          row_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "booklet_assignments_booklet_id_fkey"
            columns: ["booklet_id"]
            isOneToOne: false
            referencedRelation: "booklets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booklet_assignments_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      booklets: {
        Row: {
          created_at: string
          end_no: number
          form_type_id: string
          id: string
          received_date: string
          row_version: number
          serial_prefix: string
          start_no: number
          status: Database["ceedo_collections"]["Enums"]["booklet_status"]
        }
        Insert: {
          created_at?: string
          end_no: number
          form_type_id: string
          id?: string
          received_date: string
          row_version?: number
          serial_prefix: string
          start_no: number
          status?: Database["ceedo_collections"]["Enums"]["booklet_status"]
        }
        Update: {
          created_at?: string
          end_no?: number
          form_type_id?: string
          id?: string
          received_date?: string
          row_version?: number
          serial_prefix?: string
          start_no?: number
          status?: Database["ceedo_collections"]["Enums"]["booklet_status"]
        }
        Relationships: [
          {
            foreignKeyName: "booklets_form_type_id_fkey"
            columns: ["form_type_id"]
            isOneToOne: false
            referencedRelation: "form_types"
            referencedColumns: ["id"]
          },
        ]
      }
      collector_assignments: {
        Row: {
          active: boolean
          collector_id: string
          created_at: string
          facility_id: string
          id: string
          row_version: number
          section_id: string | null
        }
        Insert: {
          active?: boolean
          collector_id: string
          created_at?: string
          facility_id: string
          id?: string
          row_version?: number
          section_id?: string | null
        }
        Update: {
          active?: boolean
          collector_id?: string
          created_at?: string
          facility_id?: string
          id?: string
          row_version?: number
          section_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collector_assignments_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collector_assignments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collector_assignments_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collector_assignments_section_in_facility"
            columns: ["section_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id", "facility_id"]
          },
        ]
      }
      device_assignments: {
        Row: {
          active: boolean
          created_at: string
          device_id: string
          facility_id: string
          id: string
          row_version: number
          section_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          device_id: string
          facility_id: string
          id?: string
          row_version?: number
          section_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          device_id?: string
          facility_id?: string
          id?: string
          row_version?: number
          section_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_assignments_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_assignments_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_assignments_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_assignments_section_in_facility"
            columns: ["section_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id", "facility_id"]
          },
        ]
      }
      devices: {
        Row: {
          active: boolean
          created_at: string
          credential_id: string | null
          id: string
          label: string
          last_seen_at: string | null
          registered_at: string | null
          row_version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          credential_id?: string | null
          id?: string
          label: string
          last_seen_at?: string | null
          registered_at?: string | null
          row_version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          credential_id?: string | null
          id?: string
          label?: string
          last_seen_at?: string | null
          registered_at?: string | null
          row_version?: number
        }
        Relationships: []
      }
      facilities: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          row_version: number
          type: Database["ceedo_collections"]["Enums"]["facility_type"]
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          row_version?: number
          type: Database["ceedo_collections"]["Enums"]["facility_type"]
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          row_version?: number
          type?: Database["ceedo_collections"]["Enums"]["facility_type"]
        }
        Relationships: []
      }
      fee_types: {
        Row: {
          accrues: boolean
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          row_version: number
          surcharge_bps: number
        }
        Insert: {
          accrues?: boolean
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          row_version?: number
          surcharge_bps?: number
        }
        Update: {
          accrues?: boolean
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          row_version?: number
          surcharge_bps?: number
        }
        Relationships: []
      }
      form_types: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          row_version: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          row_version?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          row_version?: number
        }
        Relationships: []
      }
      leases: {
        Row: {
          accrual_period: Database["ceedo_collections"]["Enums"]["accrual_period"]
          created_at: string
          due_day: number | null
          end_date: string | null
          id: string
          rate_amount: number
          row_version: number
          stall_id: string
          start_date: string
          status: Database["ceedo_collections"]["Enums"]["lease_status"]
          tenant_id: string
        }
        Insert: {
          accrual_period: Database["ceedo_collections"]["Enums"]["accrual_period"]
          created_at?: string
          due_day?: number | null
          end_date?: string | null
          id?: string
          rate_amount: number
          row_version?: number
          stall_id: string
          start_date: string
          status?: Database["ceedo_collections"]["Enums"]["lease_status"]
          tenant_id: string
        }
        Update: {
          accrual_period?: Database["ceedo_collections"]["Enums"]["accrual_period"]
          created_at?: string
          due_day?: number | null
          end_date?: string | null
          id?: string
          rate_amount?: number
          row_version?: number
          stall_id?: string
          start_date?: string
          status?: Database["ceedo_collections"]["Enums"]["lease_status"]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leases_stall_id_fkey"
            columns: ["stall_id"]
            isOneToOne: false
            referencedRelation: "stalls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rates: {
        Row: {
          amount: number
          basis: Database["ceedo_collections"]["Enums"]["rate_basis"]
          created_at: string
          effective_from: string
          effective_to: string | null
          fee_type_id: string
          id: string
          rate_class: string
          row_version: number
        }
        Insert: {
          amount: number
          basis: Database["ceedo_collections"]["Enums"]["rate_basis"]
          created_at?: string
          effective_from: string
          effective_to?: string | null
          fee_type_id: string
          id?: string
          rate_class?: string
          row_version?: number
        }
        Update: {
          amount?: number
          basis?: Database["ceedo_collections"]["Enums"]["rate_basis"]
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          fee_type_id?: string
          id?: string
          rate_class?: string
          row_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "rates_fee_type_id_fkey"
            columns: ["fee_type_id"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          active: boolean
          created_at: string
          default_accrual_period: Database["ceedo_collections"]["Enums"]["accrual_period"]
          facility_id: string
          id: string
          name: string
          row_version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          default_accrual_period: Database["ceedo_collections"]["Enums"]["accrual_period"]
          facility_id: string
          id?: string
          name: string
          row_version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          default_accrual_period?: Database["ceedo_collections"]["Enums"]["accrual_period"]
          facility_id?: string
          id?: string
          name?: string
          row_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "sections_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      spoiled_forms: {
        Row: {
          booklet_id: string
          id: string
          or_no: number
          reason: string
          recorded_at: string
          recorded_by: string
          row_version: number
        }
        Insert: {
          booklet_id: string
          id?: string
          or_no: number
          reason: string
          recorded_at?: string
          recorded_by: string
          row_version?: number
        }
        Update: {
          booklet_id?: string
          id?: string
          or_no?: number
          reason?: string
          recorded_at?: string
          recorded_by?: string
          row_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "spoiled_forms_booklet_id_fkey"
            columns: ["booklet_id"]
            isOneToOne: false
            referencedRelation: "booklets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spoiled_forms_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invites: {
        Row: {
          email: string
          employee_no: string
          full_name: string
          id: string
          invited_at: string
          invited_by: string | null
          role: Database["ceedo_collections"]["Enums"]["app_role"]
          row_version: number
        }
        Insert: {
          email: string
          employee_no: string
          full_name: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          role: Database["ceedo_collections"]["Enums"]["app_role"]
          row_version?: number
        }
        Update: {
          email?: string
          employee_no?: string
          full_name?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          role?: Database["ceedo_collections"]["Enums"]["app_role"]
          row_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      stalls: {
        Row: {
          active: boolean
          area_sqm: number | null
          created_at: string
          id: string
          row_version: number
          section_id: string
          stall_no: string
        }
        Insert: {
          active?: boolean
          area_sqm?: number | null
          created_at?: string
          id?: string
          row_version?: number
          section_id: string
          stall_no: string
        }
        Update: {
          active?: boolean
          area_sqm?: number | null
          created_at?: string
          id?: string
          row_version?: number
          section_id?: string
          stall_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "stalls_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          active: boolean
          address: string | null
          contact_no: string | null
          created_at: string
          full_name: string
          id: string
          row_version: number
        }
        Insert: {
          active?: boolean
          address?: string | null
          contact_no?: string | null
          created_at?: string
          full_name: string
          id?: string
          row_version?: number
        }
        Update: {
          active?: boolean
          address?: string | null
          contact_no?: string | null
          created_at?: string
          full_name?: string
          id?: string
          row_version?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      active_role: {
        Args: never
        Returns: Database["ceedo_collections"]["Enums"]["app_role"]
      }
      apply_master_data_policies: {
        Args: { table_name: string }
        Returns: undefined
      }
      attach_audit: { Args: { table_name: string }; Returns: undefined }
      can_collector_use_device: {
        Args: { collector: string; device: string }
        Returns: boolean
      }
      has_role: {
        Args: { roles: Database["ceedo_collections"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      next_row_version: { Args: never; Returns: number }
    }
    Enums: {
      accrual_period: "daily" | "weekly" | "monthly"
      app_role: "collector" | "supervisor" | "accounting" | "admin"
      booklet_status:
        | "received"
        | "assigned"
        | "in_use"
        | "returned"
        | "exhausted"
      facility_type: "market" | "terminal" | "parking" | "slaughterhouse"
      lease_status: "active" | "ended" | "terminated"
      rate_basis:
        | "per_day"
        | "per_week"
        | "per_month"
        | "per_entry"
        | "per_head"
        | "per_sqm"
      user_status: "active" | "suspended"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  ceedo_collections: {
    Enums: {
      accrual_period: ["daily", "weekly", "monthly"],
      app_role: ["collector", "supervisor", "accounting", "admin"],
      booklet_status: [
        "received",
        "assigned",
        "in_use",
        "returned",
        "exhausted",
      ],
      facility_type: ["market", "terminal", "parking", "slaughterhouse"],
      lease_status: ["active", "ended", "terminated"],
      rate_basis: [
        "per_day",
        "per_week",
        "per_month",
        "per_entry",
        "per_head",
        "per_sqm",
      ],
      user_status: ["active", "suspended"],
    },
  },
} as const

