// Supabase Database Schema TypeScript Types for KaziBox Phase 4

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string;
          name: string;
          country: string;
          currency: string;
          language: string;
          logo_url: string | null;
          plan: 'free' | 'starter' | 'pro' | 'enterprise';
          status: 'active' | 'trial' | 'suspended';
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          country?: string;
          currency?: string;
          language?: string;
          logo_url?: string | null;
          plan?: 'free' | 'starter' | 'pro' | 'enterprise';
          status?: 'active' | 'trial' | 'suspended';
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          country?: string;
          currency?: string;
          language?: string;
          logo_url?: string | null;
          plan?: 'free' | 'starter' | 'pro' | 'enterprise';
          status?: 'active' | 'trial' | 'suspended';
          created_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          name: string;
          avatar_url: string | null;
          phone: string | null;
          role: 'platform_admin' | 'owner' | 'manager' | 'worker';
          company_id: string;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          name: string;
          avatar_url?: string | null;
          phone?: string | null;
          role?: 'platform_admin' | 'owner' | 'manager' | 'worker';
          company_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          name?: string;
          avatar_url?: string | null;
          phone?: string | null;
          role?: 'platform_admin' | 'owner' | 'manager' | 'worker';
          company_id?: string;
          created_at?: string;
        };
      };
      team_members: {
        Row: {
          id: string;
          company_id: string;
          user_id: string | null;
          name: string;
          email: string;
          role: 'platform_admin' | 'owner' | 'manager' | 'worker';
          status: 'active' | 'invited' | 'deactivated';
          joined_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          user_id?: string | null;
          name: string;
          email: string;
          role?: 'platform_admin' | 'owner' | 'manager' | 'worker';
          status?: 'active' | 'invited' | 'deactivated';
          joined_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          user_id?: string | null;
          name?: string;
          email?: string;
          role?: 'platform_admin' | 'owner' | 'manager' | 'worker';
          status?: 'active' | 'invited' | 'deactivated';
          joined_at?: string;
        };
      };
      modules: {
        Row: {
          id: string;
          slug: string;
          name: Json;
          description: Json;
          tagline: Json | null;
          category: string;
          icon: string;
          kind: 'internal' | 'external';
          status: 'active' | 'beta' | 'deprecated';
          developer: string;
          version: string;
          min_platform_version: string;
          features: Json;
          pricing: Json;
          manifest: Json;
          created_at: string;
        };
        Insert: {
          id: string;
          slug: string;
          name: Json;
          description: Json;
          tagline?: Json | null;
          category: string;
          icon: string;
          kind?: 'internal' | 'external';
          status?: 'active' | 'beta' | 'deprecated';
          developer?: string;
          version?: string;
          min_platform_version?: string;
          features?: Json;
          pricing?: Json;
          manifest?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name?: Json;
          description?: Json;
          tagline?: Json | null;
          category?: string;
          icon?: string;
          kind?: 'internal' | 'external';
          status?: 'active' | 'beta' | 'deprecated';
          developer?: string;
          version?: string;
          min_platform_version?: string;
          features?: Json;
          pricing?: Json;
          manifest?: Json;
          created_at?: string;
        };
      };
      company_modules: {
        Row: {
          id: string;
          company_id: string;
          module_id: string;
          plan_id: string;
          status: 'active' | 'trial' | 'suspended' | 'cancelled';
          activated_at: string;
          expires_at: string | null;
          auto_renew: boolean;
        };
        Insert: {
          id?: string;
          company_id: string;
          module_id: string;
          plan_id?: string;
          status?: 'active' | 'trial' | 'suspended' | 'cancelled';
          activated_at?: string;
          expires_at?: string | null;
          auto_renew?: boolean;
        };
        Update: {
          id?: string;
          company_id?: string;
          module_id?: string;
          plan_id?: string;
          status?: 'active' | 'trial' | 'suspended' | 'cancelled';
          activated_at?: string;
          expires_at?: string | null;
          auto_renew?: boolean;
        };
      };
      subscriptions: {
        Row: {
          id: string;
          company_id: string;
          plan_id: string;
          status: 'active' | 'trial' | 'suspended' | 'cancelled';
          current_period_start: string;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          included_module_ids: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          plan_id?: string;
          status?: 'active' | 'trial' | 'suspended' | 'cancelled';
          current_period_start?: string;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          included_module_ids?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          plan_id?: string;
          status?: 'active' | 'trial' | 'suspended' | 'cancelled';
          current_period_start?: string;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          included_module_ids?: Json;
          created_at?: string;
        };
      };
      payment_history: {
        Row: {
          id: string;
          company_id: string;
          amount: number;
          currency: string;
          status: 'paid' | 'pending' | 'failed';
          description: string;
          invoice_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          amount: number;
          currency?: string;
          status?: 'paid' | 'pending' | 'failed';
          description: string;
          invoice_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          amount?: number;
          currency?: string;
          status?: 'paid' | 'pending' | 'failed';
          description?: string;
          invoice_url?: string | null;
          created_at?: string;
        };
      };
      finance_records: {
        Row: {
          id: string;
          company_id: string;
          module_id: string;
          type: 'revenue' | 'expense';
          amount: number;
          currency: string;
          category_or_source: string;
          reference: string;
          occurred_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          module_id: string;
          type: 'revenue' | 'expense';
          amount: number;
          currency?: string;
          category_or_source: string;
          reference: string;
          occurred_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          module_id?: string;
          type?: 'revenue' | 'expense';
          amount?: number;
          currency?: string;
          category_or_source?: string;
          reference?: string;
          occurred_at?: string;
          created_at?: string;
        };
      };
      notifications: {
        Row: {
          id: string;
          company_id: string;
          user_id: string | null;
          title: string;
          message: string;
          type: 'info' | 'warning' | 'success' | 'alert';
          read: boolean;
          link: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          user_id?: string | null;
          title: string;
          message: string;
          type?: 'info' | 'warning' | 'success' | 'alert';
          read?: boolean;
          link?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          user_id?: string | null;
          title?: string;
          message?: string;
          type?: 'info' | 'warning' | 'success' | 'alert';
          read?: boolean;
          link?: string | null;
          created_at?: string;
        };
      };
      activity_logs: {
        Row: {
          id: string;
          company_id: string;
          user_id: string | null;
          action: string;
          details: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          user_id?: string | null;
          action: string;
          details?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          user_id?: string | null;
          action?: string;
          details?: Json;
          created_at?: string;
        };
      };
      module_api_keys: {
        Row: {
          id: string;
          company_id: string;
          module_id: string;
          key_prefix: string;
          key_hash: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          module_id: string;
          key_prefix: string;
          key_hash: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          module_id?: string;
          key_prefix?: string;
          key_hash?: string;
          created_at?: string;
        };
      };
      webhook_events: {
        Row: {
          id: string;
          company_id: string | null;
          event_type: string;
          payload: Json;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          event_type: string;
          payload: Json;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          event_type?: string;
          payload?: Json;
          status?: string;
          created_at?: string;
        };
      };
      garage_customers: {
        Row: {
          id: string;
          company_id: string;
          name: string;
          phone: string;
          email: string | null;
          address: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          name: string;
          phone: string;
          email?: string | null;
          address?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          name?: string;
          phone?: string;
          email?: string | null;
          address?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      garage_vehicles: {
        Row: {
          id: string;
          company_id: string;
          customer_id: string;
          registration_number: string;
          make: string;
          model: string;
          year: number | null;
          color: string | null;
          mileage: number | null;
          vin: string | null;
          notes: string | null;
          status: 'active' | 'inactive';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          customer_id: string;
          registration_number: string;
          make: string;
          model: string;
          year?: number | null;
          color?: string | null;
          mileage?: number | null;
          vin?: string | null;
          notes?: string | null;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          customer_id?: string;
          registration_number?: string;
          make?: string;
          model?: string;
          year?: number | null;
          color?: string | null;
          mileage?: number | null;
          vin?: string | null;
          notes?: string | null;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
      };
      garage_jobs: {
        Row: {
          id: string;
          company_id: string;
          customer_id: string;
          vehicle_id: string;
          job_number: string;
          title: string;
          description: string | null;
          diagnosis: string | null;
          mechanic_name: string | null;
          status: 'open' | 'diagnosing' | 'in_progress' | 'waiting_parts' | 'completed' | 'delivered' | 'cancelled';
          estimated_amount: number | null;
          total_amount: number;
          paid_amount: number;
          outstanding_amount: number;
          payment_status: 'unpaid' | 'partially_paid' | 'paid';
          opened_at: string;
          expected_completion_at: string | null;
          completed_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          customer_id: string;
          vehicle_id: string;
          job_number: string;
          title: string;
          description?: string | null;
          diagnosis?: string | null;
          mechanic_name?: string | null;
          status?: 'open' | 'diagnosing' | 'in_progress' | 'waiting_parts' | 'completed' | 'delivered' | 'cancelled';
          estimated_amount?: number | null;
          total_amount?: number;
          paid_amount?: number;
          outstanding_amount?: number;
          payment_status?: 'unpaid' | 'partially_paid' | 'paid';
          opened_at?: string;
          expected_completion_at?: string | null;
          completed_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          customer_id?: string;
          vehicle_id?: string;
          job_number?: string;
          title?: string;
          description?: string | null;
          diagnosis?: string | null;
          mechanic_name?: string | null;
          status?: 'open' | 'diagnosing' | 'in_progress' | 'waiting_parts' | 'completed' | 'delivered' | 'cancelled';
          estimated_amount?: number | null;
          total_amount?: number;
          paid_amount?: number;
          outstanding_amount?: number;
          payment_status?: 'unpaid' | 'partially_paid' | 'paid';
          opened_at?: string;
          expected_completion_at?: string | null;
          completed_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      garage_job_items: {
        Row: {
          id: string;
          company_id: string;
          job_id: string;
          item_type: 'service' | 'part';
          name: string;
          quantity: number;
          unit_price: number;
          total: number;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          job_id: string;
          item_type: 'service' | 'part';
          name: string;
          quantity?: number;
          unit_price?: number;
          total?: number;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          job_id?: string;
          item_type?: 'service' | 'part';
          name?: string;
          quantity?: number;
          unit_price?: number;
          total?: number;
          notes?: string | null;
          created_at?: string;
        };
      };
      garage_payments: {
        Row: {
          id: string;
          company_id: string;
          job_id: string;
          amount: number;
          payment_method: 'cash' | 'mobile_money' | 'card' | 'bank_transfer' | 'other';
          reference: string | null;
          paid_at: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          job_id: string;
          amount: number;
          payment_method?: 'cash' | 'mobile_money' | 'card' | 'bank_transfer' | 'other';
          reference?: string | null;
          paid_at?: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          job_id?: string;
          amount?: number;
          payment_method?: 'cash' | 'mobile_money' | 'card' | 'bank_transfer' | 'other';
          reference?: string | null;
          paid_at?: string;
          notes?: string | null;
          created_at?: string;
        };
      };
    };
  };
}
