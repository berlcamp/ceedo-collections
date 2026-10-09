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
      account_rule_shares: {
        Row: {
          account_id: string
          id: string
          rule_id: string
          share_bps: number
        }
        Insert: {
          account_id: string
          id?: string
          rule_id: string
          share_bps: number
        }
        Update: {
          account_id?: string
          id?: string
          rule_id?: string
          share_bps?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_rule_shares_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "collection_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rule_shares_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "account_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      account_rules: {
        Row: {
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          facility_id: string | null
          fee_type_id: string
          id: string
          portion: string
          rate_class: string | null
          section_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          facility_id?: string | null
          fee_type_id: string
          id?: string
          portion: string
          rate_class?: string | null
          section_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          facility_id?: string | null
          fee_type_id?: string
          id?: string
          portion?: string
          rate_class?: string | null
          section_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rules_fee_type_id_fkey"
            columns: ["fee_type_id"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_rules_section_in_facility"
            columns: ["section_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id", "facility_id"]
          },
        ]
      }
      accrual_runs: {
        Row: {
          business_date: string
          charges_raised: number
          error: string | null
          finished_at: string | null
          id: string
          started_at: string
          status: string
          surcharges_raised: number
        }
        Insert: {
          business_date: string
          charges_raised?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          surcharges_raised?: number
        }
        Update: {
          business_date?: string
          charges_raised?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          started_at?: string
          status?: string
          surcharges_raised?: number
        }
        Relationships: []
      }
      app_users: {
        Row: {
          created_at: string
          employee_no: string | null
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
          employee_no?: string | null
          full_name: string
          id?: string
          pin_hash?: string | null
          role: Database["ceedo_collections"]["Enums"]["app_role"]
          row_version?: number
          status?: Database["ceedo_collections"]["Enums"]["user_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          employee_no?: string | null
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
          note: string | null
          pg_role: string
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
          note?: string | null
          pg_role: string
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
          note?: string | null
          pg_role?: string
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
      charge_condonations: {
        Row: {
          amount: number
          authority_ref: string
          charge_id: string
          condoned_at: string
          condoned_by: string
          id: string
          reason: string
          row_version: number
        }
        Insert: {
          amount: number
          authority_ref: string
          charge_id: string
          condoned_at?: string
          condoned_by: string
          id?: string
          reason: string
          row_version?: number
        }
        Update: {
          amount?: number
          authority_ref?: string
          charge_id?: string
          condoned_at?: string
          condoned_by?: string
          id?: string
          reason?: string
          row_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "charge_condonations_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charge_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_condonations_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_condonations_condoned_by_fkey"
            columns: ["condoned_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      charges: {
        Row: {
          amount: number
          charge_type: Database["ceedo_collections"]["Enums"]["charge_type"]
          created_at: string
          created_by: string | null
          due_date: string
          fee_type_id: string
          id: string
          lease_id: string
          parent_charge_id: string | null
          period_end: string
          period_start: string
          row_version: number
          source: Database["ceedo_collections"]["Enums"]["charge_source"]
          surcharge_bps: number
        }
        Insert: {
          amount: number
          charge_type: Database["ceedo_collections"]["Enums"]["charge_type"]
          created_at?: string
          created_by?: string | null
          due_date: string
          fee_type_id: string
          id?: string
          lease_id: string
          parent_charge_id?: string | null
          period_end: string
          period_start: string
          row_version?: number
          source: Database["ceedo_collections"]["Enums"]["charge_source"]
          surcharge_bps?: number
        }
        Update: {
          amount?: number
          charge_type?: Database["ceedo_collections"]["Enums"]["charge_type"]
          created_at?: string
          created_by?: string | null
          due_date?: string
          fee_type_id?: string
          id?: string
          lease_id?: string
          parent_charge_id?: string | null
          period_end?: string
          period_start?: string
          row_version?: number
          source?: Database["ceedo_collections"]["Enums"]["charge_source"]
          surcharge_bps?: number
        }
        Relationships: [
          {
            foreignKeyName: "charges_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_fee_type_id_fkey"
            columns: ["fee_type_id"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "leases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_parent_charge_id_fkey"
            columns: ["parent_charge_id"]
            isOneToOne: false
            referencedRelation: "charge_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_parent_charge_id_fkey"
            columns: ["parent_charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_accounts: {
        Row: {
          active: boolean
          code: string
          created_at: string
          facility_id: string | null
          group_name: string
          id: string
          kind: string
          name: string
          rcd_column_id: string
          row_version: number
          sort_order: number
          treasurer_line_id: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          facility_id?: string | null
          group_name: string
          id?: string
          kind: string
          name: string
          rcd_column_id: string
          row_version?: number
          sort_order: number
          treasurer_line_id: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          facility_id?: string | null
          group_name?: string
          id?: string
          kind?: string
          name?: string
          rcd_column_id?: string
          row_version?: number
          sort_order?: number
          treasurer_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_accounts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_accounts_rcd_column_id_fkey"
            columns: ["rcd_column_id"]
            isOneToOne: false
            referencedRelation: "rcd_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_accounts_treasurer_line_id_fkey"
            columns: ["treasurer_line_id"]
            isOneToOne: false
            referencedRelation: "treasurer_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_allocations: {
        Row: {
          amount: number
          charge_id: string
          collection_id: string
          id: string
          row_version: number
        }
        Insert: {
          amount: number
          charge_id: string
          collection_id: string
          id?: string
          row_version?: number
        }
        Update: {
          amount?: number
          charge_id?: string
          collection_id?: string
          id?: string
          row_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "collection_allocations_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charge_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_allocations_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_allocations_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_cancellations: {
        Row: {
          cancelled_at: string
          cancelled_by: string
          collection_id: string
          id: string
          reason: string
          row_version: number
        }
        Insert: {
          cancelled_at?: string
          cancelled_by: string
          collection_id: string
          id?: string
          reason: string
          row_version?: number
        }
        Update: {
          cancelled_at?: string
          cancelled_by?: string
          collection_id?: string
          id?: string
          reason?: string
          row_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "collection_cancellations_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_cancellations_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_lines: {
        Row: {
          amount: number | null
          collection_id: string
          fee_type_id: string
          id: string
          quantity: number
          rate_class: string
          row_version: number
          unit_rate: number
        }
        Insert: {
          amount?: number | null
          collection_id: string
          fee_type_id: string
          id?: string
          quantity: number
          rate_class?: string
          row_version?: number
          unit_rate: number
        }
        Update: {
          amount?: number | null
          collection_id?: string
          fee_type_id?: string
          id?: string
          quantity?: number
          rate_class?: string
          row_version?: number
          unit_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "collection_lines_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_lines_fee_type_id_fkey"
            columns: ["fee_type_id"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_recoveries: {
        Row: {
          collection_id: string
          reason: string
          recorded_at: string
          recorded_by: string
        }
        Insert: {
          collection_id: string
          reason: string
          recorded_at?: string
          recorded_by: string
        }
        Update: {
          collection_id?: string
          reason?: string
          recorded_at?: string
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_recoveries_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: true
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_recoveries_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_reinstatements: {
        Row: {
          cancellation_id: string
          id: string
          reason: string
          reinstated_at: string
          reinstated_by: string
          row_version: number
        }
        Insert: {
          cancellation_id: string
          id?: string
          reason: string
          reinstated_at?: string
          reinstated_by: string
          row_version?: number
        }
        Update: {
          cancellation_id?: string
          id?: string
          reason?: string
          reinstated_at?: string
          reinstated_by?: string
          row_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "collection_reinstatements_cancellation_id_fkey"
            columns: ["cancellation_id"]
            isOneToOne: true
            referencedRelation: "collection_cancellations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_reinstatements_cancellation_id_fkey"
            columns: ["cancellation_id"]
            isOneToOne: true
            referencedRelation: "standing_cancellations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_reinstatements_reinstated_by_fkey"
            columns: ["reinstated_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          bank: string | null
          booklet_id: string
          business_date: string
          check_date: string | null
          check_no: string | null
          collected_at: string
          collector_id: string
          device_id: string | null
          fee_type_id: string
          gross_amount: number
          id: string
          lease_id: string | null
          notes: string | null
          or_no: number
          payer_ref: string | null
          payment_mode: string
          posted_at: string
          posted_by: string | null
          row_version: number
          shift_id: string | null
          synced_at: string | null
        }
        Insert: {
          bank?: string | null
          booklet_id: string
          business_date: string
          check_date?: string | null
          check_no?: string | null
          collected_at: string
          collector_id: string
          device_id?: string | null
          fee_type_id: string
          gross_amount: number
          id: string
          lease_id?: string | null
          notes?: string | null
          or_no: number
          payer_ref?: string | null
          payment_mode?: string
          posted_at?: string
          posted_by?: string | null
          row_version?: number
          shift_id?: string | null
          synced_at?: string | null
        }
        Update: {
          bank?: string | null
          booklet_id?: string
          business_date?: string
          check_date?: string | null
          check_no?: string | null
          collected_at?: string
          collector_id?: string
          device_id?: string | null
          fee_type_id?: string
          gross_amount?: number
          id?: string
          lease_id?: string | null
          notes?: string | null
          or_no?: number
          payer_ref?: string | null
          payment_mode?: string
          posted_at?: string
          posted_by?: string | null
          row_version?: number
          shift_id?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collections_booklet_id_fkey"
            columns: ["booklet_id"]
            isOneToOne: false
            referencedRelation: "booklets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_fee_type_id_fkey"
            columns: ["fee_type_id"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "leases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collections_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
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
          facility_id: string | null
          id: string
          row_version: number
          section_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          device_id: string
          facility_id?: string | null
          id?: string
          row_version?: number
          section_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          device_id?: string
          facility_id?: string | null
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
      device_credentials: {
        Row: {
          device_id: string
          id: string
          issued_at: string
          issued_by: string | null
          revoked_at: string | null
          revoked_by: string | null
          row_version: number
          secret_hash: string
        }
        Insert: {
          device_id: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          row_version?: number
          secret_hash: string
        }
        Update: {
          device_id?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          row_version?: number
          secret_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_credentials_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_credentials_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_credentials_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          active: boolean
          assignment_epoch: number
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
          assignment_epoch?: number
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
          assignment_epoch?: number
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
          amount_mode: string
          code: string
          created_at: string
          facility_id: string | null
          facility_type:
            | Database["ceedo_collections"]["Enums"]["facility_type"]
            | null
          id: string
          name: string
          row_version: number
          surcharge_bps: number
        }
        Insert: {
          accrues?: boolean
          active?: boolean
          amount_mode?: string
          code: string
          created_at?: string
          facility_id?: string | null
          facility_type?:
            | Database["ceedo_collections"]["Enums"]["facility_type"]
            | null
          id?: string
          name: string
          row_version?: number
          surcharge_bps?: number
        }
        Update: {
          accrues?: boolean
          active?: boolean
          amount_mode?: string
          code?: string
          created_at?: string
          facility_id?: string | null
          facility_type?:
            | Database["ceedo_collections"]["Enums"]["facility_type"]
            | null
          id?: string
          name?: string
          row_version?: number
          surcharge_bps?: number
        }
        Relationships: [
          {
            foreignKeyName: "fee_types_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
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
      rcd_columns: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          row_version: number
          sort_order: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          row_version?: number
          sort_order: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          row_version?: number
          sort_order?: number
        }
        Relationships: []
      }
      remittances: {
        Row: {
          amount: number
          bank: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          collector_id: string
          deposit_slip_no: string
          deposited_at: string
          id: string
          recorded_at: string
          recorded_by: string
          row_version: number
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount: number
          bank: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          collector_id: string
          deposit_slip_no: string
          deposited_at: string
          id?: string
          recorded_at?: string
          recorded_by: string
          row_version?: number
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          bank?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          collector_id?: string
          deposit_slip_no?: string
          deposited_at?: string
          id?: string
          recorded_at?: string
          recorded_by?: string
          row_version?: number
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "remittances_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remittances_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remittances_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "remittances_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "app_users"
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
      settings: {
        Row: {
          cutover_date: string
          id: string
          row_version: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cutover_date: string
          id?: string
          row_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cutover_date?: string
          id?: string
          row_version?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          business_date: string
          closed_at: string | null
          collector_id: string
          declared_total: number | null
          device_id: string | null
          id: string
          kind: string
          opened_at: string
          remittance_id: string | null
          row_version: number
          status: string
          system_count: number | null
          system_total: number | null
          variance: number | null
        }
        Insert: {
          business_date: string
          closed_at?: string | null
          collector_id: string
          declared_total?: number | null
          device_id?: string | null
          id: string
          kind?: string
          opened_at: string
          remittance_id?: string | null
          row_version?: number
          status: string
          system_count?: number | null
          system_total?: number | null
          variance?: number | null
        }
        Update: {
          business_date?: string
          closed_at?: string | null
          collector_id?: string
          declared_total?: number | null
          device_id?: string | null
          id?: string
          kind?: string
          opened_at?: string
          remittance_id?: string | null
          row_version?: number
          status?: string
          system_count?: number | null
          system_total?: number | null
          variance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_remittance_id_fkey"
            columns: ["remittance_id"]
            isOneToOne: false
            referencedRelation: "remittances"
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
          employee_no: string | null
          full_name: string
          id: string
          invited_at: string
          invited_by: string | null
          role: Database["ceedo_collections"]["Enums"]["app_role"]
          row_version: number
        }
        Insert: {
          email: string
          employee_no?: string | null
          full_name: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          role: Database["ceedo_collections"]["Enums"]["app_role"]
          row_version?: number
        }
        Update: {
          email?: string
          employee_no?: string | null
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
      super_admins: {
        Row: {
          created_at: string
          email: string
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: []
      }
      sync_exceptions: {
        Row: {
          attempts: number
          collection_uuid: string
          collector_id: string
          detail: string | null
          device_id: string
          first_seen_at: string
          id: string
          last_seen_at: string
          payload: Json
          reason_code: string
          resolution: string | null
          resolution_reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          row_version: number
          status: string
        }
        Insert: {
          attempts?: number
          collection_uuid: string
          collector_id: string
          detail?: string | null
          device_id: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          payload: Json
          reason_code: string
          resolution?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          row_version?: number
          status?: string
        }
        Update: {
          attempts?: number
          collection_uuid?: string
          collector_id?: string
          detail?: string | null
          device_id?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          payload?: Json
          reason_code?: string
          resolution?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          row_version?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_exceptions_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_exceptions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "app_users"
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
      treasurer_lines: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          row_version: number
          sort_order: number
          subtotal_group: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          row_version?: number
          sort_order: number
          subtotal_group: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          row_version?: number
          sort_order?: number
          subtotal_group?: number
        }
        Relationships: []
      }
      variance_settlements: {
        Row: {
          amount: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          id: string
          received_at: string
          recorded_at: string
          recorded_by: string
          reference: string
          row_version: number
          shift_id: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          id?: string
          received_at: string
          recorded_at?: string
          recorded_by: string
          reference: string
          row_version?: number
          shift_id: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          id?: string
          received_at?: string
          recorded_at?: string
          recorded_by?: string
          reference?: string
          row_version?: number
          shift_id?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "variance_settlements_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variance_settlements_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variance_settlements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variance_settlements_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      accrual_health: {
        Row: {
          business_date: string | null
          charges_raised: number | null
          error: string | null
          finished_at: string | null
          status: string | null
          surcharges_raised: number | null
        }
        Relationships: []
      }
      aging_of_receivables: {
        Row: {
          bucket_1_30: number | null
          bucket_31_60: number | null
          bucket_61_90: number | null
          bucket_over_90: number | null
          lease_id: string | null
          not_yet_due: number | null
          stall_id: string | null
          stall_no: string | null
          tenant_name: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "charges_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "leases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leases_stall_id_fkey"
            columns: ["stall_id"]
            isOneToOne: false
            referencedRelation: "stalls"
            referencedColumns: ["id"]
          },
        ]
      }
      charge_balances: {
        Row: {
          allocated: number | null
          amount: number | null
          charge_type:
            | Database["ceedo_collections"]["Enums"]["charge_type"]
            | null
          condoned: number | null
          created_at: string | null
          days_overdue: number | null
          due_date: string | null
          fee_type_id: string | null
          id: string | null
          is_settled: boolean | null
          lease_id: string | null
          outstanding: number | null
          parent_charge_id: string | null
          period_end: string | null
          period_start: string | null
          surcharge_bps: number | null
        }
        Relationships: [
          {
            foreignKeyName: "charges_fee_type_id_fkey"
            columns: ["fee_type_id"]
            isOneToOne: false
            referencedRelation: "fee_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "leases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_parent_charge_id_fkey"
            columns: ["parent_charge_id"]
            isOneToOne: false
            referencedRelation: "charge_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charges_parent_charge_id_fkey"
            columns: ["parent_charge_id"]
            isOneToOne: false
            referencedRelation: "charges"
            referencedColumns: ["id"]
          },
        ]
      }
      delinquency_list: {
        Row: {
          address: string | null
          contact_no: string | null
          days_overdue: number | null
          lease_id: string | null
          oldest_due_date: string | null
          outstanding: number | null
          stall_no: string | null
          tenant_name: string | null
          unpaid_charges: number | null
        }
        Relationships: [
          {
            foreignKeyName: "charges_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "leases"
            referencedColumns: ["id"]
          },
        ]
      }
      lease_balances: {
        Row: {
          days_overdue: number | null
          lease_id: string | null
          oldest_due_date: string | null
          outstanding: number | null
          unpaid_charges: number | null
        }
        Relationships: [
          {
            foreignKeyName: "charges_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "leases"
            referencedColumns: ["id"]
          },
        ]
      }
      standing_cancellations: {
        Row: {
          cancelled_at: string | null
          cancelled_by: string | null
          collection_id: string | null
          id: string | null
          reason: string | null
          row_version: number | null
        }
        Insert: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          collection_id?: string | null
          id?: string | null
          reason?: string | null
          row_version?: number | null
        }
        Update: {
          cancelled_at?: string | null
          cancelled_by?: string | null
          collection_id?: string | null
          id?: string | null
          reason?: string | null
          row_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_cancellations_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_cancellations_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
        ]
      }
      subsidiary_ledger: {
        Row: {
          cancelled: boolean | null
          credit: number | null
          debit: number | null
          detail: string | null
          entry_date: string | null
          entry_type: string | null
          lease_id: string | null
          or_no: number | null
          period_end: string | null
          period_start: string | null
          running_balance: number | null
          source_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      active_role: {
        Args: never
        Returns: Database["ceedo_collections"]["Enums"]["app_role"]
      }
      apply_ledger_policies: {
        Args: { table_name: string }
        Returns: undefined
      }
      apply_master_data_policies: {
        Args: { table_name: string }
        Returns: undefined
      }
      assert_can_resolve_exceptions: {
        Args: { p_reason: string }
        Returns: undefined
      }
      assert_office_poster: { Args: never; Returns: undefined }
      assert_recovery_admin: { Args: { p_reason: string }; Returns: undefined }
      attach_audit: { Args: { table_name: string }; Returns: undefined }
      authenticate_device: {
        Args: { p_credential_id: string; p_secret: string }
        Returns: string
      }
      business_date: { Args: never; Returns: string }
      can_collector_use_device: {
        Args: { collector: string; device: string }
        Returns: boolean
      }
      cancel_collection: {
        Args: { p_collection_id: string; p_reason: string }
        Returns: string
      }
      cancel_remittance: {
        Args: { p_reason: string; p_remittance_id: string }
        Returns: undefined
      }
      cancel_variance_settlement: {
        Args: { p_reason: string; p_settlement_id: string }
        Returns: undefined
      }
      claim_my_invite: { Args: never; Returns: boolean }
      clear_all_data: { Args: never; Returns: number }
      close_office_shift: {
        Args: { p_declared_total: number; p_shift_id: string }
        Returns: Json
      }
      close_shift: {
        Args: {
          p_declared_total: number
          p_device_count: number
          p_device_id: string
          p_device_total: number
          p_shift_id: string
        }
        Returns: Json
      }
      condone_charge: {
        Args: {
          p_amount: number
          p_authority_ref: string
          p_charge_id: string
          p_reason: string
        }
        Returns: string
      }
      create_collector: {
        Args: { p_employee_no?: string; p_full_name: string }
        Returns: string
      }
      cutover_date: { Args: never; Returns: string }
      escalate_exception: {
        Args: { p_exception_id: string; p_reason: string }
        Returns: undefined
      }
      has_role: {
        Args: { roles: Database["ceedo_collections"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      install_chart_builtins: { Args: never; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      issue_device_credential: { Args: { p_device_id: string }; Returns: Json }
      lease_balances_as_of: {
        Args: { p_date: string }
        Returns: {
          accrual_period: Database["ceedo_collections"]["Enums"]["accrual_period"]
          bucket_1_30: number
          bucket_31_60: number
          bucket_61_90: number
          bucket_over_90: number
          facility_id: string
          facility_name: string
          lease_id: string
          not_yet_due: number
          oldest_due_date: string
          outstanding: number
          rate_amount: number
          section_id: string
          section_name: string
          stall_no: string
          tenant_name: string
          unpaid_charges: number
        }[]
      }
      lease_periods: {
        Args: {
          p_accrual_period: Database["ceedo_collections"]["Enums"]["accrual_period"]
          p_cutover: string
          p_due_day: number
          p_lease_end: string
          p_lease_start: string
          p_through: string
        }
        Returns: {
          due_date: string
          period_end: string
          period_start: string
        }[]
      }
      lease_receipts_by_day: {
        Args: { p_from: string; p_to: string }
        Returns: {
          base: number
          business_date: string
          lease_id: string
          surcharge: number
        }[]
      }
      leases_active_between: {
        Args: { p_from: string; p_to: string }
        Returns: {
          accrual_period: Database["ceedo_collections"]["Enums"]["accrual_period"]
          facility_id: string
          facility_name: string
          lease_id: string
          rate_amount: number
          section_id: string
          section_name: string
          stall_no: string
          tenant_name: string
        }[]
      }
      next_row_version: { Args: never; Returns: number }
      office_close_shift: {
        Args: { p_declared_total: number; p_reason: string; p_shift_id: string }
        Returns: Json
      }
      office_shift: {
        Args: { p_business_date: string; p_collector_id: string }
        Returns: string
      }
      open_shift: {
        Args: { p_collector: string; p_device_id: string; p_payload: Json }
        Returns: Json
      }
      post_collection: { Args: { p_payload: Json }; Returns: Json }
      post_office_receipt: {
        Args: { p_receipt: Json; p_shift_id: string }
        Returns: string
      }
      record_opening_balance: {
        Args: {
          p_amount: number
          p_authority_ref: string
          p_lease_id: string
          p_oldest_unpaid_date: string
        }
        Returns: string
      }
      record_remittance: {
        Args: {
          p_amount: number
          p_bank: string
          p_collector_id: string
          p_deposit_slip_no: string
          p_deposited_at: string
          p_shift_ids: string[]
        }
        Returns: string
      }
      record_spoiled_form: {
        Args: { p_collector: string; p_device_id: string; p_payload: Json }
        Returns: Json
      }
      record_variance_settlement: {
        Args: {
          p_amount: number
          p_received_at: string
          p_reference: string
          p_shift_id: string
        }
        Returns: string
      }
      recover_collection: {
        Args: {
          p_reason: string
          p_receipt: Json
          p_shift_id: string
          p_stub_total: number
        }
        Returns: string
      }
      recovery_refusal: { Args: { p_result: Json }; Returns: string }
      recovery_shift: {
        Args: {
          p_business_date: string
          p_collector_id: string
          p_device_id: string
          p_reason: string
        }
        Returns: string
      }
      reinstate_collection: {
        Args: { p_collection_id: string; p_reason: string }
        Returns: string
      }
      rental_fee_type: {
        Args: {
          p_accrual_period: Database["ceedo_collections"]["Enums"]["accrual_period"]
        }
        Returns: string
      }
      replace_account_rule: {
        Args: {
          p_effective_from: string
          p_facility_id: string
          p_fee_type_id: string
          p_portion: string
          p_rate_class: string
          p_section_id: string
          p_shares: Json
        }
        Returns: string
      }
      resolve_exception_corrected: {
        Args: { p_exception_id: string; p_payload: Json; p_reason: string }
        Returns: Json
      }
      resolve_exception_spoiled: {
        Args: { p_exception_id: string; p_reason: string }
        Returns: Json
      }
      revoke_device_credential: {
        Args: { p_device_id: string }
        Returns: undefined
      }
      run_accrual: { Args: { p_business_date?: string }; Returns: string }
      run_nightly: { Args: never; Returns: string }
      run_surcharge: {
        Args: { p_business_date?: string; p_run_id?: string }
        Returns: number
      }
      seed_test_data: { Args: never; Returns: Json }
      set_collector_pin: {
        Args: { p_collector_id: string; p_pin: string }
        Returns: undefined
      }
      sync_pull: {
        Args: { p_cursor: number; p_device_id: string }
        Returns: Json
      }
      sync_push: {
        Args: { p_device_id: string; p_entries: Json }
        Returns: Json
      }
      unpaid_period_groups: {
        Args: { p_lease_id: string }
        Returns: {
          charge_ids: string[]
          due_date: string
          group_rank: number
          outstanding: number
          period_end: string
          period_start: string
        }[]
      }
      verify_remittance: {
        Args: { p_remittance_id: string }
        Returns: undefined
      }
      verify_variance_settlement: {
        Args: { p_settlement_id: string }
        Returns: undefined
      }
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
      charge_source: "accrual" | "opening_balance" | "manual"
      charge_type: "rental" | "surcharge" | "opening_balance"
      facility_type:
        | "market"
        | "terminal"
        | "parking"
        | "slaughterhouse"
        | "other"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      charge_source: ["accrual", "opening_balance", "manual"],
      charge_type: ["rental", "surcharge", "opening_balance"],
      facility_type: [
        "market",
        "terminal",
        "parking",
        "slaughterhouse",
        "other",
      ],
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

