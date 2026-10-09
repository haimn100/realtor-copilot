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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      client_facts: {
        Row: {
          source_date: string | null
          evidence: string | null
          applicability: string | null
          source_at: string | null
          valid_until: string | null
          source_quote: string | null
          strength: string
          category: string
          client_id: string
          confidence: number
          created_at: string
          created_by: string | null
          id: string
          importance: string
          key: string
          source_interaction_id: string | null
          source_ref: string | null
          source_type: string
          status: string
          superseded_by_id: string | null
          valid_from: string | null
          value_json: Json
          workspace_id: string
        }
        Insert: {
          source_date?: string | null
          evidence?: string | null
          applicability?: string | null
          source_at?: string | null
          valid_until?: string | null
          source_quote?: string | null
          strength?: string
          category: string
          client_id: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          id?: string
          importance?: string
          key: string
          source_interaction_id?: string | null
          source_ref?: string | null
          source_type?: string
          status?: string
          superseded_by_id?: string | null
          valid_from?: string | null
          value_json: Json
          workspace_id: string
        }
        Update: {
          source_date?: string | null
          evidence?: string | null
          applicability?: string | null
          source_at?: string | null
          valid_until?: string | null
          source_quote?: string | null
          strength?: string
          category?: string
          client_id?: string
          confidence?: number
          created_at?: string
          created_by?: string | null
          id?: string
          importance?: string
          key?: string
          source_interaction_id?: string | null
          source_ref?: string | null
          source_type?: string
          status?: string
          superseded_by_id?: string | null
          valid_from?: string | null
          value_json?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_facts_client_id_fkey"
            columns: ["workspace_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "client_facts_source_interaction_id_fkey"
            columns: ["workspace_id", "client_id", "source_interaction_id"]
            isOneToOne: false
            referencedRelation: "interactions"
            referencedColumns: ["workspace_id", "client_id", "id"]
          },
          {
            foreignKeyName: "client_facts_superseded_by_id_fkey"
            columns: ["workspace_id", "client_id", "key", "superseded_by_id"]
            isOneToOne: false
            referencedRelation: "client_facts"
            referencedColumns: ["workspace_id", "client_id", "key", "id"]
          },
          {
            foreignKeyName: "client_facts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_properties: {
        Row: {
          client_id: string
          created_at: string
          first_considered_at: string
          id: string
          interest_level: string | null
          notes: string | null
          property_id: string
          rejection_reason: string | null
          sent_at: string | null
          status: string
          updated_at: string
          viewed_at: string | null
          workspace_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          first_considered_at?: string
          id?: string
          interest_level?: string | null
          notes?: string | null
          property_id: string
          rejection_reason?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          viewed_at?: string | null
          workspace_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          first_considered_at?: string
          id?: string
          interest_level?: string | null
          notes?: string | null
          property_id?: string
          rejection_reason?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          viewed_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_properties_client_id_fkey"
            columns: ["workspace_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "client_properties_property_id_fkey"
            columns: ["workspace_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "client_properties_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_property_events: {
        Row: {
          client_property_id: string
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          interaction_id: string | null
          metadata: Json
          notes: string | null
          occurred_at: string
          workspace_id: string
        }
        Insert: {
          client_property_id: string
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          interaction_id?: string | null
          metadata?: Json
          notes?: string | null
          occurred_at?: string
          workspace_id: string
        }
        Update: {
          client_property_id?: string
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          interaction_id?: string | null
          metadata?: Json
          notes?: string | null
          occurred_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_property_events_client_property_id_fkey"
            columns: ["workspace_id", "client_property_id"]
            isOneToOne: false
            referencedRelation: "client_properties"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "client_property_events_interaction_id_fkey"
            columns: ["workspace_id", "interaction_id"]
            isOneToOne: false
            referencedRelation: "interactions"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "client_property_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          memory_version: number
          created_at: string
          created_by: string | null
          display_name: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          notes: string | null
          phone: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          memory_version?: number
          created_at?: string
          created_by?: string | null
          display_name: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          memory_version?: number
          created_at?: string
          created_by?: string | null
          display_name?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      interactions: {
        Row: {
          request_key: string | null
          request_payload: Json | null
          response_json: Json | null
          channel: string | null
          client_id: string | null
          content: string | null
          created_at: string
          created_by: string | null
          direction: string | null
          external_id: string | null
          id: string
          interaction_type: string
          metadata: Json
          occurred_at: string
          summary: string | null
          workspace_id: string
        }
        Insert: {
          request_key?: string | null
          request_payload?: Json | null
          response_json?: Json | null
          channel?: string | null
          client_id?: string | null
          content?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          external_id?: string | null
          id?: string
          interaction_type?: string
          metadata?: Json
          occurred_at?: string
          summary?: string | null
          workspace_id: string
        }
        Update: {
          request_key?: string | null
          request_payload?: Json | null
          response_json?: Json | null
          channel?: string | null
          client_id?: string | null
          content?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          external_id?: string | null
          id?: string
          interaction_type?: string
          metadata?: Json
          occurred_at?: string
          summary?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interactions_client_id_fkey"
            columns: ["workspace_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "interactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string | null
          asking_price: number | null
          availability_status: string | null
          availability_verified_at: string | null
          bathrooms: number | null
          bedrooms: number | null
          city: string
          construction_status: string | null
          country: string
          created_at: string
          created_by: string | null
          currency: string | null
          delivery_date: string | null
          description: string | null
          development_name: string | null
          exterior_m2: number | null
          id: string
          interior_m2: number | null
          latitude: number | null
          longitude: number | null
          neighborhood: string | null
          notes: string | null
          property_type: string | null
          state: string
          title: string | null
          total_m2: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          address?: string | null
          asking_price?: number | null
          availability_status?: string | null
          availability_verified_at?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          city?: string
          construction_status?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          delivery_date?: string | null
          description?: string | null
          development_name?: string | null
          exterior_m2?: number | null
          id?: string
          interior_m2?: number | null
          latitude?: number | null
          longitude?: number | null
          neighborhood?: string | null
          notes?: string | null
          property_type?: string | null
          state?: string
          title?: string | null
          total_m2?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          address?: string | null
          asking_price?: number | null
          availability_status?: string | null
          availability_verified_at?: string | null
          bathrooms?: number | null
          bedrooms?: number | null
          city?: string
          construction_status?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          delivery_date?: string | null
          description?: string | null
          development_name?: string | null
          exterior_m2?: number | null
          id?: string
          interior_m2?: number | null
          latitude?: number | null
          longitude?: number | null
          neighborhood?: string | null
          notes?: string | null
          property_type?: string | null
          state?: string
          title?: string | null
          total_m2?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      property_sources: {
        Row: {
          accessed_at: string
          asking_price: number | null
          availability_status: string | null
          availability_verified: boolean
          availability_verified_at: string | null
          created_at: string
          currency: string | null
          external_id: string | null
          id: string
          listing_title: string | null
          listing_updated_at: string | null
          property_id: string
          raw_snapshot: Json
          source_name: string
          source_type: string
          url: string | null
          workspace_id: string
        }
        Insert: {
          accessed_at?: string
          asking_price?: number | null
          availability_status?: string | null
          availability_verified?: boolean
          availability_verified_at?: string | null
          created_at?: string
          currency?: string | null
          external_id?: string | null
          id?: string
          listing_title?: string | null
          listing_updated_at?: string | null
          property_id: string
          raw_snapshot?: Json
          source_name: string
          source_type?: string
          url?: string | null
          workspace_id: string
        }
        Update: {
          accessed_at?: string
          asking_price?: number | null
          availability_status?: string | null
          availability_verified?: boolean
          availability_verified_at?: string | null
          created_at?: string
          currency?: string | null
          external_id?: string | null
          id?: string
          listing_title?: string | null
          listing_updated_at?: string | null
          property_id?: string
          raw_snapshot?: Json
          source_name?: string
          source_type?: string
          url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_sources_property_id_fkey"
            columns: ["workspace_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "property_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      research_items: {
        Row: {
          accessed_at: string | null
          confidence: number | null
          created_at: string
          created_by: string | null
          findings: Json
          id: string
          property_id: string | null
          source_name: string | null
          source_updated_at: string | null
          source_url: string | null
          subject_key: string | null
          subject_type: string
          summary: string
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accessed_at?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          findings?: Json
          id?: string
          property_id?: string | null
          source_name?: string | null
          source_updated_at?: string | null
          source_url?: string | null
          subject_key?: string | null
          subject_type: string
          summary: string
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accessed_at?: string | null
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          findings?: Json
          id?: string
          property_id?: string | null
          source_name?: string | null
          source_updated_at?: string | null
          source_url?: string | null
          subject_key?: string | null
          subject_type?: string
          summary?: string
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_items_property_id_fkey"
            columns: ["workspace_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "research_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      search_results: {
        Row: {
          accessed_at: string
          availability_status: string | null
          availability_verified: boolean
          bathrooms: number | null
          bedrooms: number | null
          created_at: string
          currency: string | null
          data: Json
          external_id: string | null
          id: string
          interior_m2: number | null
          listing_updated_at: string | null
          neighborhood: string | null
          price: number | null
          promoted_property_id: string | null
          rank: number | null
          search_run_id: string
          source_name: string | null
          summary: string | null
          title: string | null
          total_m2: number | null
          url: string | null
          workspace_id: string
        }
        Insert: {
          accessed_at?: string
          availability_status?: string | null
          availability_verified?: boolean
          bathrooms?: number | null
          bedrooms?: number | null
          created_at?: string
          currency?: string | null
          data?: Json
          external_id?: string | null
          id?: string
          interior_m2?: number | null
          listing_updated_at?: string | null
          neighborhood?: string | null
          price?: number | null
          promoted_property_id?: string | null
          rank?: number | null
          search_run_id: string
          source_name?: string | null
          summary?: string | null
          title?: string | null
          total_m2?: number | null
          url?: string | null
          workspace_id: string
        }
        Update: {
          accessed_at?: string
          availability_status?: string | null
          availability_verified?: boolean
          bathrooms?: number | null
          bedrooms?: number | null
          created_at?: string
          currency?: string | null
          data?: Json
          external_id?: string | null
          id?: string
          interior_m2?: number | null
          listing_updated_at?: string | null
          neighborhood?: string | null
          price?: number | null
          promoted_property_id?: string | null
          rank?: number | null
          search_run_id?: string
          source_name?: string | null
          summary?: string | null
          title?: string | null
          total_m2?: number | null
          url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_results_promoted_property_id_fkey"
            columns: ["workspace_id", "promoted_property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "search_results_search_run_id_fkey"
            columns: ["workspace_id", "search_run_id"]
            isOneToOne: false
            referencedRelation: "search_runs"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "search_results_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      search_runs: {
        Row: {
          client_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          criteria_snapshot: Json
          id: string
          query_text: string
          sources_requested: Json
          sources_searched: Json
          started_at: string
          status: string
          workspace_id: string
        }
        Insert: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          criteria_snapshot?: Json
          id?: string
          query_text: string
          sources_requested?: Json
          sources_searched?: Json
          started_at?: string
          status?: string
          workspace_id: string
        }
        Update: {
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          criteria_snapshot?: Json
          id?: string
          query_text?: string
          sources_requested?: Json
          sources_searched?: Json
          started_at?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_runs_client_id_fkey"
            columns: ["workspace_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "search_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          due_date: string | null
          assigned_to: string | null
          client_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          id: string
          interaction_id: string | null
          priority: string
          property_id: string | null
          status: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          due_date?: string | null
          assigned_to?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          interaction_id?: string | null
          priority?: string
          property_id?: string | null
          status?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          due_date?: string | null
          assigned_to?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          interaction_id?: string | null
          priority?: string
          property_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_workspace_fkey"
            columns: ["workspace_id", "assigned_to"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["workspace_id", "user_id"]
          },
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["workspace_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "tasks_interaction_client_fkey"
            columns: ["workspace_id", "client_id", "interaction_id"]
            isOneToOne: false
            referencedRelation: "interactions"
            referencedColumns: ["workspace_id", "client_id", "id"]
          },
          {
            foreignKeyName: "tasks_interaction_id_fkey"
            columns: ["workspace_id", "interaction_id"]
            isOneToOne: false
            referencedRelation: "interactions"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "tasks_property_id_fkey"
            columns: ["workspace_id", "property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      persist_client_import_facts: {
        Args: { p_workspace_id: string; p_receipt_id: string }
        Returns: number
      }
      import_client_findings: {
        Args: { p_workspace_id: string; p_request: Json }
        Returns: Json
      }
      write_client_memory: {
        Args: { p_workspace_id: string; p_client_id: string; p_operation: string; p_request: Json }
        Returns: Json
      }
      get_client_history: {
        Args: { p_workspace_id: string; p_client_id: string; p_limit?: number; p_cursor?: Json }
        Returns: Json
      }
      create_client_with_facts: {
        Args: { p_client: Json; p_facts?: Json; p_workspace_id: string }
        Returns: {
          memory_version: number
          created_at: string
          created_by: string | null
          display_name: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          notes: string | null
          phone: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "clients"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remember_client_fact: {
        Args: { p_client_id: string; p_fact: Json; p_workspace_id: string }
        Returns: {
          source_date: string | null
          evidence: string | null
          applicability: string | null
          source_at: string | null
          valid_until: string | null
          source_quote: string | null
          strength: string
          category: string
          client_id: string
          confidence: number
          created_at: string
          created_by: string | null
          id: string
          importance: string
          key: string
          source_interaction_id: string | null
          source_ref: string | null
          source_type: string
          status: string
          superseded_by_id: string | null
          valid_from: string | null
          value_json: Json
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "client_facts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_property: {
        Args: {
          p_property: Json
          p_property_id?: string
          p_source?: Json
          p_workspace_id: string
        }
        Returns: Json
      }
      update_client_property: {
        Args: {
          p_changes: Json
          p_client_id: string
          p_property_id: string
          p_workspace_id: string
        }
        Returns: {
          client_id: string
          created_at: string
          first_considered_at: string
          id: string
          interest_level: string | null
          notes: string | null
          property_id: string
          rejection_reason: string | null
          sent_at: string | null
          status: string
          updated_at: string
          viewed_at: string | null
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "client_properties"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
