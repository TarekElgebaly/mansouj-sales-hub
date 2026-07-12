export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      areas: {
        Row: {
          active: boolean
          area: string
          city: string
          created_at: string
          delivery_notes: string | null
          id: string
          shipping_company: string | null
          shipping_cost: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          area: string
          city: string
          created_at?: string
          delivery_notes?: string | null
          id?: string
          shipping_company?: string | null
          shipping_cost?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          area?: string
          city?: string
          created_at?: string
          delivery_notes?: string | null
          id?: string
          shipping_company?: string | null
          shipping_cost?: number
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          area: string | null
          city: string | null
          created_at: string
          full_address: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string
          second_phone: string | null
          updated_at: string
        }
        Insert: {
          area?: string | null
          city?: string | null
          created_at?: string
          full_address?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone: string
          second_phone?: string | null
          updated_at?: string
        }
        Update: {
          area?: string | null
          city?: string | null
          created_at?: string
          full_address?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string
          second_phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          active: boolean
          created_at: string
          id: string
          monthly_salary: number
          name: string
          role: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          monthly_salary?: number
          name: string
          role: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          monthly_salary?: number
          name?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string | null
          expense_date: string
          id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          category: string
          created_at?: string
          description?: string | null
          expense_date?: string
          id?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string | null
          expense_date?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory: {
        Row: {
          available_quantity: number | null
          barcode: string | null
          color: string | null
          committed_quantity: number | null
          cost_price: number
          created_at: string
          current_inventory: number
          id: string
          incoming_quantity: number | null
          inventory_item_id: string | null
          is_shopify_stale: boolean
          low_stock_threshold: number
          on_hand_quantity: number | null
          product_images: Json
          product_name: string
          sale_price: number
          shopify_product_id: string | null
          shopify_product_status: string | null
          shopify_product_type: string | null
          shopify_raw: Json | null
          shopify_synced_at: string | null
          shopify_variant_id: string | null
          size: string | null
          sku: string
          status: string
          unavailable_quantity: number | null
          updated_at: string
          variant_name: string | null
        }
        Insert: {
          available_quantity?: number | null
          barcode?: string | null
          color?: string | null
          committed_quantity?: number | null
          cost_price?: number
          created_at?: string
          current_inventory?: number
          id?: string
          incoming_quantity?: number | null
          inventory_item_id?: string | null
          is_shopify_stale?: boolean
          low_stock_threshold?: number
          on_hand_quantity?: number | null
          product_images?: Json
          product_name: string
          sale_price?: number
          shopify_product_id?: string | null
          shopify_product_status?: string | null
          shopify_product_type?: string | null
          shopify_raw?: Json | null
          shopify_synced_at?: string | null
          shopify_variant_id?: string | null
          size?: string | null
          sku: string
          status?: string
          unavailable_quantity?: number | null
          updated_at?: string
          variant_name?: string | null
        }
        Update: {
          available_quantity?: number | null
          barcode?: string | null
          color?: string | null
          committed_quantity?: number | null
          cost_price?: number
          created_at?: string
          current_inventory?: number
          id?: string
          incoming_quantity?: number | null
          inventory_item_id?: string | null
          is_shopify_stale?: boolean
          low_stock_threshold?: number
          on_hand_quantity?: number | null
          product_images?: Json
          product_name?: string
          sale_price?: number
          shopify_product_id?: string | null
          shopify_product_status?: string | null
          shopify_product_type?: string | null
          shopify_raw?: Json | null
          shopify_synced_at?: string | null
          shopify_variant_id?: string | null
          size?: string | null
          sku?: string
          status?: string
          unavailable_quantity?: number | null
          updated_at?: string
          variant_name?: string | null
        }
        Relationships: []
      }
      migration_logs: {
        Row: {
          created_at: string
          entity: string
          id: string
          message: string | null
          rows_processed: number | null
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          entity: string
          id?: string
          message?: string | null
          rows_processed?: number | null
          source: string
          status: string
        }
        Update: {
          created_at?: string
          entity?: string
          id?: string
          message?: string | null
          rows_processed?: number | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      order_activity: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          order_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          order_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          order_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_activity_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_intake_logs: {
        Row: {
          error_message: string | null
          id: string
          matched_order_id: string | null
          message_id: string | null
          order_number: string | null
          payload_hash: string | null
          raw_payload: Json | null
          received_at: string
          repaired_fields: Json
          source: string | null
          status: string
        }
        Insert: {
          error_message?: string | null
          id?: string
          matched_order_id?: string | null
          message_id?: string | null
          order_number?: string | null
          payload_hash?: string | null
          raw_payload?: Json | null
          received_at?: string
          repaired_fields?: Json
          source?: string | null
          status: string
        }
        Update: {
          error_message?: string | null
          id?: string
          matched_order_id?: string | null
          message_id?: string | null
          order_number?: string | null
          payload_hash?: string | null
          raw_payload?: Json | null
          received_at?: string
          repaired_fields?: Json
          source?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_intake_logs_matched_order_id_fkey"
            columns: ["matched_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          color: string | null
          created_at: string
          id: string
          order_id: string
          product_name: string
          quantity: number
          size: string | null
          sku: string
          total_cost: number | null
          total_selling_price: number | null
          unit_cost: number
          unit_selling_price: number
          variant: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          order_id: string
          product_name: string
          quantity?: number
          size?: string | null
          sku: string
          total_cost?: number | null
          total_selling_price?: number | null
          unit_cost?: number
          unit_selling_price?: number
          variant?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          order_id?: string
          product_name?: string
          quantity?: number
          size?: string | null
          sku?: string
          total_cost?: number | null
          total_selling_price?: number | null
          unit_cost?: number
          unit_selling_price?: number
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_notes: {
        Row: {
          body: string
          created_at: string
          id: string
          order_id: string
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          order_id: string
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          order_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_notes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          area: string | null
          city: string | null
          confirm_note: string | null
          confirmation_status: string
          created_at: string
          customer_full_name: string
          customer_id: string | null
          delivered: boolean
          full_address: string | null
          id: string
          internal_notes: string | null
          items_cost: number
          label_attachment: string | null
          net_profit: number | null
          order_date: string
          order_number: string
          order_status: string
          packaging_cost: number
          payment_gateway: string | null
          phone: string
          profit: number | null
          rto: boolean
          second_phone: string | null
          shipping_company: string | null
          shipping_cost: number
          shipping_notes: string | null
          shopify_created_at: string | null
          shopify_order_id: string | null
          tags: string[] | null
          total_selling_price: number
          updated_at: string
          uploaded_to_shipping: boolean
        }
        Insert: {
          area?: string | null
          city?: string | null
          confirm_note?: string | null
          confirmation_status?: string
          created_at?: string
          customer_full_name: string
          customer_id?: string | null
          delivered?: boolean
          full_address?: string | null
          id?: string
          internal_notes?: string | null
          items_cost?: number
          label_attachment?: string | null
          net_profit?: number | null
          order_date?: string
          order_number: string
          order_status?: string
          packaging_cost?: number
          payment_gateway?: string | null
          phone: string
          profit?: number | null
          rto?: boolean
          second_phone?: string | null
          shipping_company?: string | null
          shipping_cost?: number
          shipping_notes?: string | null
          shopify_created_at?: string | null
          shopify_order_id?: string | null
          tags?: string[] | null
          total_selling_price?: number
          updated_at?: string
          uploaded_to_shipping?: boolean
        }
        Update: {
          area?: string | null
          city?: string | null
          confirm_note?: string | null
          confirmation_status?: string
          created_at?: string
          customer_full_name?: string
          customer_id?: string | null
          delivered?: boolean
          full_address?: string | null
          id?: string
          internal_notes?: string | null
          items_cost?: number
          label_attachment?: string | null
          net_profit?: number | null
          order_date?: string
          order_number?: string
          order_status?: string
          packaging_cost?: number
          payment_gateway?: string | null
          phone?: string
          profit?: number | null
          rto?: boolean
          second_phone?: string | null
          shipping_company?: string | null
          shipping_cost?: number
          shipping_notes?: string | null
          shopify_created_at?: string | null
          shopify_order_id?: string | null
          tags?: string[] | null
          total_selling_price?: number
          updated_at?: string
          uploaded_to_shipping?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_inventory_items: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string
          raw: Json
          sku: string | null
          synced_at: string
          tracked: boolean | null
          unit_cost_amount: number | null
          unit_cost_currency_code: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id: string
          raw?: Json
          sku?: string | null
          synced_at?: string
          tracked?: boolean | null
          unit_cost_amount?: number | null
          unit_cost_currency_code?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string
          raw?: Json
          sku?: string | null
          synced_at?: string
          tracked?: boolean | null
          unit_cost_amount?: number | null
          unit_cost_currency_code?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shopify_inventory_levels: {
        Row: {
          available: number | null
          created_at: string
          id: string
          inventory_item_id: string
          raw: Json
          shopify_location_id: string
          shopify_updated_at: string | null
          updated_at: string
        }
        Insert: {
          available?: number | null
          created_at?: string
          id?: string
          inventory_item_id: string
          raw?: Json
          shopify_location_id: string
          shopify_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          available?: number | null
          created_at?: string
          id?: string
          inventory_item_id?: string
          raw?: Json
          shopify_location_id?: string
          shopify_updated_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_inventory_levels_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "shopify_inventory_items"
            referencedColumns: ["inventory_item_id"]
          },
          {
            foreignKeyName: "shopify_inventory_levels_shopify_location_id_fkey"
            columns: ["shopify_location_id"]
            isOneToOne: false
            referencedRelation: "shopify_locations"
            referencedColumns: ["shopify_location_id"]
          },
        ]
      }
      shopify_locations: {
        Row: {
          active: boolean | null
          address: Json
          created_at: string
          id: string
          name: string
          raw: Json
          shopify_location_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          address?: Json
          created_at?: string
          id?: string
          name: string
          raw?: Json
          shopify_location_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          address?: Json
          created_at?: string
          id?: string
          name?: string
          raw?: Json
          shopify_location_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          shop_domain: string
          state: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          shop_domain: string
          state: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          shop_domain?: string
          state?: string
        }
        Relationships: []
      }
      shopify_products: {
        Row: {
          created_at: string
          handle: string | null
          id: string
          image: Json | null
          is_shopify_stale: boolean
          last_synced_at: string | null
          product_type: string | null
          raw: Json
          shopify_created_at: string | null
          shopify_product_id: string
          shopify_updated_at: string | null
          status: string | null
          title: string
          updated_at: string
          vendor: string | null
        }
        Insert: {
          created_at?: string
          handle?: string | null
          id?: string
          image?: Json | null
          is_shopify_stale?: boolean
          last_synced_at?: string | null
          product_type?: string | null
          raw?: Json
          shopify_created_at?: string | null
          shopify_product_id: string
          shopify_updated_at?: string | null
          status?: string | null
          title: string
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          created_at?: string
          handle?: string | null
          id?: string
          image?: Json | null
          is_shopify_stale?: boolean
          last_synced_at?: string | null
          product_type?: string | null
          raw?: Json
          shopify_created_at?: string | null
          shopify_product_id?: string
          shopify_updated_at?: string | null
          status?: string | null
          title?: string
          updated_at?: string
          vendor?: string | null
        }
        Relationships: []
      }
      shopify_sku_remaps: {
        Row: {
          created_at: string
          id: string
          inventory_item_id: string | null
          is_active: boolean
          new_sku: string | null
          note: string | null
          old_sku: string
          shopify_variant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          is_active?: boolean
          new_sku?: string | null
          note?: string | null
          old_sku: string
          shopify_variant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          is_active?: boolean
          new_sku?: string | null
          note?: string | null
          old_sku?: string
          shopify_variant_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      shopify_sync_runs: {
        Row: {
          created_at: string
          created_count: number
          error_message: string | null
          failed_count: number
          finished_at: string | null
          id: string
          metadata: Json
          pages_fetched: number
          records_processed: number
          started_at: string
          status: string
          sync_type: string
          updated_count: number
        }
        Insert: {
          created_at?: string
          created_count?: number
          error_message?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          metadata?: Json
          pages_fetched?: number
          records_processed?: number
          started_at?: string
          status: string
          sync_type: string
          updated_count?: number
        }
        Update: {
          created_at?: string
          created_count?: number
          error_message?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          metadata?: Json
          pages_fetched?: number
          records_processed?: number
          started_at?: string
          status?: string
          sync_type?: string
          updated_count?: number
        }
        Relationships: []
      }
      shopify_sync_settings: {
        Row: {
          access_token: string | null
          granted_scopes: string[] | null
          id: number
          install_status: string | null
          installed_at: string | null
          last_connection_test_at: string | null
          last_connection_test_error: string | null
          last_connection_test_status: string | null
          last_error: string | null
          last_orders_imported: number | null
          last_orders_updated: number | null
          last_sync_at: string | null
          last_sync_status: string | null
          last_test_at: string | null
          last_test_message: string | null
          last_test_ok: boolean | null
          oauth_state_expires_at: string | null
          oauth_state_hash: string | null
          shop_domain: string | null
          store_url: string | null
          token_stored: boolean
          updated_at: string
          webhook_endpoint: string | null
        }
        Insert: {
          access_token?: string | null
          granted_scopes?: string[] | null
          id?: number
          install_status?: string | null
          installed_at?: string | null
          last_connection_test_at?: string | null
          last_connection_test_error?: string | null
          last_connection_test_status?: string | null
          last_error?: string | null
          last_orders_imported?: number | null
          last_orders_updated?: number | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          oauth_state_expires_at?: string | null
          oauth_state_hash?: string | null
          shop_domain?: string | null
          store_url?: string | null
          token_stored?: boolean
          updated_at?: string
          webhook_endpoint?: string | null
        }
        Update: {
          access_token?: string | null
          granted_scopes?: string[] | null
          id?: number
          install_status?: string | null
          installed_at?: string | null
          last_connection_test_at?: string | null
          last_connection_test_error?: string | null
          last_connection_test_status?: string | null
          last_error?: string | null
          last_orders_imported?: number | null
          last_orders_updated?: number | null
          last_sync_at?: string | null
          last_sync_status?: string | null
          last_test_at?: string | null
          last_test_message?: string | null
          last_test_ok?: boolean | null
          oauth_state_expires_at?: string | null
          oauth_state_hash?: string | null
          shop_domain?: string | null
          store_url?: string | null
          token_stored?: boolean
          updated_at?: string
          webhook_endpoint?: string | null
        }
        Relationships: []
      }
      shopify_variants: {
        Row: {
          barcode: string | null
          compare_at_price: number | null
          created_at: string
          id: string
          inventory_item_id: string | null
          inventory_quantity: number | null
          is_shopify_stale: boolean
          last_synced_at: string | null
          option1: string | null
          option2: string | null
          option3: string | null
          options: Json
          price: number | null
          raw: Json
          shopify_created_at: string | null
          shopify_product_id: string
          shopify_updated_at: string | null
          shopify_variant_id: string
          sku: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          compare_at_price?: number | null
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          inventory_quantity?: number | null
          is_shopify_stale?: boolean
          last_synced_at?: string | null
          option1?: string | null
          option2?: string | null
          option3?: string | null
          options?: Json
          price?: number | null
          raw?: Json
          shopify_created_at?: string | null
          shopify_product_id: string
          shopify_updated_at?: string | null
          shopify_variant_id: string
          sku?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          compare_at_price?: number | null
          created_at?: string
          id?: string
          inventory_item_id?: string | null
          inventory_quantity?: number | null
          is_shopify_stale?: boolean
          last_synced_at?: string | null
          option1?: string | null
          option2?: string | null
          option3?: string | null
          options?: Json
          price?: number | null
          raw?: Json
          shopify_created_at?: string | null
          shopify_product_id?: string
          shopify_updated_at?: string | null
          shopify_variant_id?: string
          sku?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopify_variants_shopify_product_id_fkey"
            columns: ["shopify_product_id"]
            isOneToOne: false
            referencedRelation: "shopify_products"
            referencedColumns: ["shopify_product_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_finance: { Args: { _uid: string }; Returns: boolean }
      can_ops: { Args: { _uid: string }; Returns: boolean }
      can_shipping: { Args: { _uid: string }; Returns: boolean }
      can_write: { Args: { _uid: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "operations" | "finance" | "shipping" | "viewer"
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
  public: {
    Enums: {
      app_role: ["admin", "operations", "finance", "shipping", "viewer"],
    },
  },
} as const
