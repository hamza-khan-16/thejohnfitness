export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" }
  public: {
    Tables: {
      otp_verifications: {
        Row: { id: string; user_id: string; otp: string; verified: boolean; expires_at: string; created_at: string }
        Insert: { id?: string; user_id: string; otp: string; verified?: boolean; expires_at?: string; created_at?: string }
        Update: { id?: string; user_id?: string; otp?: string; verified?: boolean; expires_at?: string; created_at?: string }
        Relationships: []
      }
      sms_reminders: {
        Row: { id: string; user_id: string; type: string; sent_at: string; membership_valid_till: string | null }
        Insert: { id?: string; user_id: string; type: string; sent_at?: string; membership_valid_till?: string | null }
        Update: { id?: string; user_id?: string; type?: string; sent_at?: string; membership_valid_till?: string | null }
        Relationships: []
      }
      membership_requests: {
        Row: { id: string; user_id: string; status: string; plan_id: string | null; created_at: string; reviewed_at?: string | null; full_name?: string | null; email?: string | null; phone?: string | null; role?: string | null; reject_reason?: string | null }
        Insert: { id?: string; user_id: string; status?: string; plan_id?: string | null; created_at?: string; reviewed_at?: string | null; reject_reason?: string | null }
        Update: { id?: string; user_id?: string; status?: string; plan_id?: string | null; created_at?: string; reviewed_at?: string | null; reject_reason?: string | null }
        Relationships: []
      }
      trainer_profiles: {
        Row: { id: string; user_id: string; name: string; specialisation: string; experience: string; certification: string; bio: string; display_order: number; is_visible: boolean; updated_at: string; created_at: string }
        Insert: { id?: string; user_id: string; name: string; specialisation?: string; experience?: string; certification?: string; bio?: string; display_order?: number; is_visible?: boolean; updated_at?: string; created_at?: string }
        Update: { id?: string; user_id?: string; name?: string; specialisation?: string; experience?: string; certification?: string; bio?: string; display_order?: number; is_visible?: boolean; updated_at?: string; created_at?: string }
        Relationships: []
      }
      trainer_assignments: {
        Row: { id: string; trainer_id: string; member_id: string; created_at: string }
        Insert: { id?: string; trainer_id: string; member_id: string; created_at?: string }
        Update: { id?: string; trainer_id?: string; member_id?: string; created_at?: string }
        Relationships: []
      }
      user_goals: {
        Row: { id: string; user_id: string; goal_type: string; title: string; target_value: number; current_value: number; unit: string | null; deadline: string | null; notes: string | null; completed: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; user_id: string; goal_type: string; title: string; target_value: number; current_value?: number; unit?: string | null; deadline?: string | null; notes?: string | null; completed?: boolean; created_at?: string; updated_at?: string }
        Update: { id?: string; user_id?: string; goal_type?: string; title?: string; target_value?: number; current_value?: number; unit?: string | null; deadline?: string | null; notes?: string | null; completed?: boolean; created_at?: string; updated_at?: string }
        Relationships: []
      }
      admin_promotions: {
        Row: { created_at: string; flow: string; id: string; reason: string; user_email: string | null; user_id: string }
        Insert: { created_at?: string; flow: string; id?: string; reason: string; user_email?: string | null; user_id: string }
        Update: { created_at?: string; flow?: string; id?: string; reason?: string; user_email?: string | null; user_id?: string }
        Relationships: []
      }
      attendance: {
        Row: { created_at: string; date: string; id: string; status: string; user_id: string; check_in_time?: string | null }
        Insert: { created_at?: string; date?: string; id?: string; status?: string; user_id: string; check_in_time?: string | null }
        Update: { created_at?: string; date?: string; id?: string; status?: string; user_id?: string; check_in_time?: string | null }
        Relationships: []
      }
      fees: {
        Row: { amount: number; created_at: string; id: string; method: string | null; paid_at: string | null; plan_id: string | null; razorpay_payment_id: string | null; status: string; user_id: string }
        Insert: { amount: number; created_at?: string; id?: string; method?: string | null; paid_at?: string | null; plan_id?: string | null; razorpay_payment_id?: string | null; status?: string; user_id: string }
        Update: { amount?: number; created_at?: string; id?: string; method?: string | null; paid_at?: string | null; plan_id?: string | null; razorpay_payment_id?: string | null; status?: string; user_id?: string }
        Relationships: [{ foreignKeyName: "fees_plan_id_fkey"; columns: ["plan_id"]; isOneToOne: false; referencedRelation: "plans"; referencedColumns: ["id"] }]
      }
      memberships: {
        Row: { amount: number | null; created_at: string; id: string; plan_id: string | null; status: string; user_id: string; valid_till: string | null }
        Insert: { amount?: number | null; created_at?: string; id?: string; plan_id?: string | null; status?: string; user_id: string; valid_till?: string | null }
        Update: { amount?: number | null; created_at?: string; id?: string; plan_id?: string | null; status?: string; user_id?: string; valid_till?: string | null }
        Relationships: [{ foreignKeyName: "memberships_plan_id_fkey"; columns: ["plan_id"]; isOneToOne: false; referencedRelation: "plans"; referencedColumns: ["id"] }]
      }
      notifications: {
        Row: { created_at: string; id: string; is_read: boolean; message: string; title: string; type: string; user_id: string }
        Insert: { created_at?: string; id?: string; is_read?: boolean; message: string; title: string; type?: string; user_id: string }
        Update: { created_at?: string; id?: string; is_read?: boolean; message?: string; title?: string; type?: string; user_id?: string }
        Relationships: []
      }
      plans: {
        Row: { created_at: string; duration_days: number; features: string[] | null; id: string; is_active: boolean; name: string; price: number; updated_at: string; has_trainer?: boolean }
        Insert: { created_at?: string; duration_days?: number; features?: string[] | null; id?: string; is_active?: boolean; name: string; price: number; updated_at?: string; has_trainer?: boolean }
        Update: { created_at?: string; duration_days?: number; features?: string[] | null; id?: string; is_active?: boolean; name?: string; price?: number; updated_at?: string; has_trainer?: boolean }
        Relationships: []
      }
      profiles: {
        Row: { avatar_url: string | null; created_at: string; full_name: string | null; id: string; phone: string | null; updated_at: string }
        Insert: { avatar_url?: string | null; created_at?: string; full_name?: string | null; id: string; phone?: string | null; updated_at?: string }
        Update: { avatar_url?: string | null; created_at?: string; full_name?: string | null; id?: string; phone?: string | null; updated_at?: string }
        Relationships: []
      }
      user_roles: {
        Row: { created_at: string; id: string; role: Database["public"]["Enums"]["app_role"]; user_id: string }
        Insert: { created_at?: string; id?: string; role: Database["public"]["Enums"]["app_role"]; user_id: string }
        Update: { created_at?: string; id?: string; role?: Database["public"]["Enums"]["app_role"]; user_id?: string }
        Relationships: []
      }
      workouts: {
        Row: { created_at: string; description: string | null; id: string; name: string; trainer_id: string | null }
        Insert: { created_at?: string; description?: string | null; id?: string; name: string; trainer_id?: string | null }
        Update: { created_at?: string; description?: string | null; id?: string; name?: string; trainer_id?: string | null }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      get_primary_role: { Args: { _user_id: string }; Returns: Database["public"]["Enums"]["app_role"] }
      has_role: { Args: { _role: Database["public"]["Enums"]["app_role"]; _user_id: string }; Returns: boolean }
    }
    Enums: { app_role: "admin" | "trainer" | "user" }
    CompositeTypes: { [_ in never]: never }
  }
}

type DefaultSchema = Database["public"]
export type Tables<T extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])> =
  (DefaultSchema["Tables"] & DefaultSchema["Views"])[T] extends { Row: infer R } ? R : never
export type TablesInsert<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Insert: infer I } ? I : never
export type TablesUpdate<T extends keyof DefaultSchema["Tables"]> =
  DefaultSchema["Tables"][T] extends { Update: infer U } ? U : never
export type Enums<T extends keyof DefaultSchema["Enums"]> = DefaultSchema["Enums"][T]
export const Constants = { public: { Enums: { app_role: ["admin","trainer","user"] } } } as const
