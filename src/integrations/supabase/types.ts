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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      blocked_users: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          deleted_for: string[] | null
          id: string
          last_message: string | null
          last_message_time: string | null
          participant_names: Json
          participants: string[]
          train_number: string | null
          travel_date: string | null
        }
        Insert: {
          created_at?: string
          deleted_for?: string[] | null
          id?: string
          last_message?: string | null
          last_message_time?: string | null
          participant_names?: Json
          participants: string[]
          train_number?: string | null
          travel_date?: string | null
        }
        Update: {
          created_at?: string
          deleted_for?: string[] | null
          id?: string
          last_message?: string | null
          last_message_time?: string | null
          participant_names?: Json
          participants?: string[]
          train_number?: string | null
          travel_date?: string | null
        }
        Relationships: []
      }
      journeys: {
        Row: {
          boarding_station: string | null
          coach: string | null
          college: string | null
          created_at: string
          destination_station: string | null
          gender: string | null
          id: string
          train_name: string | null
          train_number: string
          travel_date: string
          user_id: string
          user_name: string | null
        }
        Insert: {
          boarding_station?: string | null
          coach?: string | null
          college?: string | null
          created_at?: string
          destination_station?: string | null
          gender?: string | null
          id?: string
          train_name?: string | null
          train_number: string
          travel_date: string
          user_id: string
          user_name?: string | null
        }
        Update: {
          boarding_station?: string | null
          coach?: string | null
          college?: string | null
          created_at?: string
          destination_station?: string | null
          gender?: string | null
          id?: string
          train_name?: string | null
          train_number?: string
          travel_date?: string
          user_id?: string
          user_name?: string | null
        }
        Relationships: []
      }
      last_read: {
        Row: {
          conversation_id: string
          id: string
          timestamp: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          timestamp?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          timestamp?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "last_read_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_name: string | null
          attachment_size: number | null
          attachment_type: string | null
          attachment_url: string | null
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
          sender_name: string | null
          text: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
          sender_name?: string | null
          text: string
        }
        Update: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
          sender_name?: string | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          college: string | null
          created_at: string
          email: string | null
          gender: string | null
          hobbies: string | null
          id: string
          name: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          college?: string | null
          created_at?: string
          email?: string | null
          gender?: string | null
          hobbies?: string | null
          id: string
          name?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          college?: string | null
          created_at?: string
          email?: string | null
          gender?: string | null
          hobbies?: string | null
          id?: string
          name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      requests: {
        Row: {
          boarding_station: string | null
          created_at: string
          destination_station: string | null
          from_email: string | null
          from_name: string | null
          from_user_id: string
          id: string
          status: string
          to_email: string | null
          to_name: string | null
          to_user_id: string
          train_number: string | null
          travel_date: string | null
          updated_at: string
        }
        Insert: {
          boarding_station?: string | null
          created_at?: string
          destination_station?: string | null
          from_email?: string | null
          from_name?: string | null
          from_user_id: string
          id?: string
          status?: string
          to_email?: string | null
          to_name?: string | null
          to_user_id: string
          train_number?: string | null
          travel_date?: string | null
          updated_at?: string
        }
        Update: {
          boarding_station?: string | null
          created_at?: string
          destination_station?: string | null
          from_email?: string | null
          from_name?: string | null
          from_user_id?: string
          id?: string
          status?: string
          to_email?: string | null
          to_name?: string | null
          to_user_id?: string
          train_number?: string | null
          travel_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      trains: {
        Row: {
          active: boolean
          created_at: string
          train_name: string
          train_number: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          train_name: string
          train_number: string
        }
        Update: {
          active?: boolean
          created_at?: string
          train_name?: string
          train_number?: string
        }
        Relationships: []
      }
      unverified_trains: {
        Row: {
          created_at: string
          entered_value: string | null
          id: string
          normalized_value: string | null
          submitted_by: string | null
          train_name: string | null
          train_number: string
        }
        Insert: {
          created_at?: string
          entered_value?: string | null
          id?: string
          normalized_value?: string | null
          submitted_by?: string | null
          train_name?: string | null
          train_number: string
        }
        Update: {
          created_at?: string
          entered_value?: string | null
          id?: string
          normalized_value?: string | null
          submitted_by?: string | null
          train_name?: string | null
          train_number?: string
        }
        Relationships: []
      }
      user_reports: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          reported_id: string
          reporter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          reported_id: string
          reporter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          reported_id?: string
          reporter_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      profiles_safe: {
        Row: {
          avatar_url: string | null
          bio: string | null
          college: string | null
          created_at: string | null
          email: string | null
          gender: string | null
          hobbies: string | null
          id: string | null
          name: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          college?: string | null
          created_at?: string | null
          email?: never
          gender?: string | null
          hobbies?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          college?: string | null
          created_at?: string | null
          email?: never
          gender?: string | null
          hobbies?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      can_create_conversation: {
        Args: { parts: string[]; tdate: string; train: string }
        Returns: boolean
      }
      can_view_journey: {
        Args: { journey_train_number: string; journey_travel_date: string }
        Returns: boolean
      }
      can_view_profile: { Args: { profile_id: string }; Returns: boolean }
      is_blocked: { Args: { user_a: string; user_b: string }; Returns: boolean }
      is_blocked_in_conversation: {
        Args: { conv_id: string; uid: string }
        Returns: boolean
      }
      is_conversation_participant: {
        Args: { conv_id: string }
        Returns: boolean
      }
      soft_delete_conversation: {
        Args: { conv_id: string; user_id_to_add: string }
        Returns: undefined
      }
      users_share_journey: {
        Args: { a: string; b: string; tdate: string; train: string }
        Returns: boolean
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
    Enums: {},
  },
} as const
