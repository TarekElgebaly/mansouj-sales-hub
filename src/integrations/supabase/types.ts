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
      inventory: {
        Row: {
          barcode: string | null
          color: string | null
          cost_price: number
          created_at: string
          current_inventory: number
          id: string
          low_stock_threshold: number
          product_images: Json
          product_name: string
          sale_price: number
          size: string | null
          sku: string
          status: string
          updated_at: string
          variant_name: string | null
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          cost_price?: number
          created_at?: string
          current_inventory?: number
          id?: string
          low_stock_threshold?: number
          product_images?: Json
          product_name: string
          sale_price?: number
          size?: string | null
          sku: string
          status?: string
          updated_at?: string
          variant_name?: string | null
        }
        Update: {
          barcode?: string | null
          color?: string | null
          cost_price?: number
          created_at?: string
          current_inventory?: number
          id?: string
          low_stock_threshold?: number
          product_images?: Json
          product_name?: string
          sale_price?: number
          size?: string | null
          sku?: string
          status?: string
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
      shopify_sync_settings: {
        Row: {
          id: number
          last_sync_at: string | null
          last_sync_status: string | null
          store_url: string | null
          updated_at: string
          webhook_endpoint: string | null
        }
        Insert: {
          id?: number
          last_sync_at?: string | null
          last_sync_status?: string | null
          store_url?: string | null
          updated_at?: string
          webhook_endpoint?: string | null
        }
        Update: {
          id?: number
          last_sync_at?: string | null
          last_sync_status?: string | null
          store_url?: string | null
          updated_at?: string
          webhook_endpoint?: string | null
        }
        Relationships: []
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
