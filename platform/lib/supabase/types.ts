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
    };
  };
}
