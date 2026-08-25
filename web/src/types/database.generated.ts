// Generado con `generate_typescript_types` contra el proyecto Supabase real
// (zdqahpzijkkcnfehbggs) el 2026-08-17. Es la referencia canónica del
// esquema desplegado -- si se agregan columnas/tablas, regenerar este
// archivo y comparar contra src/types/database.ts (los tipos "a mano" que
// usa el resto del frontend, más precisos en algunos campos con union
// literals en vez de `string` genérico, pero que hay que mantener
// sincronizados manualmente).
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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      archivos_cargados: {
        Row: {
          cargado_por: string
          completed_at: string | null
          created_at: string
          detalle_error: string | null
          empresa_id: string | null
          estado: string
          filas_error: number
          filas_procesadas: number
          id: string
          nombre_original: string
          storage_path: string
          tipo: string
        }
        Insert: {
          cargado_por: string
          completed_at?: string | null
          created_at?: string
          detalle_error?: string | null
          empresa_id?: string | null
          estado?: string
          filas_error?: number
          filas_procesadas?: number
          id?: string
          nombre_original: string
          storage_path: string
          tipo: string
        }
        Update: {
          cargado_por?: string
          completed_at?: string | null
          created_at?: string
          detalle_error?: string | null
          empresa_id?: string | null
          estado?: string
          filas_error?: number
          filas_procesadas?: number
          id?: string
          nombre_original?: string
          storage_path?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "archivos_cargados_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          accion: string
          created_at: string
          datos_nuevos: Json | null
          datos_previos: Json | null
          id: string
          registro_id: string
          tabla: string
          usuario_id: string | null
        }
        Insert: {
          accion: string
          created_at?: string
          datos_nuevos?: Json | null
          datos_previos?: Json | null
          id?: string
          registro_id: string
          tabla: string
          usuario_id?: string | null
        }
        Update: {
          accion?: string
          created_at?: string
          datos_nuevos?: Json | null
          datos_previos?: Json | null
          id?: string
          registro_id?: string
          tabla?: string
          usuario_id?: string | null
        }
        Relationships: []
      }
      cfdi: {
        Row: {
          archivo_id: string | null
          contraparte: string | null
          created_at: string
          empresa_id: string
          fecha: string | null
          folio: string
          id: string
          periodo: string
          rfc: string
          tipo: string
          total: number
        }
        Insert: {
          archivo_id?: string | null
          contraparte?: string | null
          created_at?: string
          empresa_id: string
          fecha?: string | null
          folio: string
          id?: string
          periodo: string
          rfc: string
          tipo: string
          total: number
        }
        Update: {
          archivo_id?: string | null
          contraparte?: string | null
          created_at?: string
          empresa_id?: string
          fecha?: string | null
          folio?: string
          id?: string
          periodo?: string
          rfc?: string
          tipo?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "cfdi_archivo_id_fkey"
            columns: ["archivo_id"]
            isOneToOne: false
            referencedRelation: "archivos_cargados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cfdi_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      cuentas_bancarias: {
        Row: {
          activo: boolean
          alias: string | null
          banco: string
          created_at: string
          empresa_id: string
          id: string
          ultimos_4: string
        }
        Insert: {
          activo?: boolean
          alias?: string | null
          banco: string
          created_at?: string
          empresa_id: string
          id?: string
          ultimos_4: string
        }
        Update: {
          activo?: boolean
          alias?: string | null
          banco?: string
          created_at?: string
          empresa_id?: string
          id?: string
          ultimos_4?: string
        }
        Relationships: [
          {
            foreignKeyName: "cuentas_bancarias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          activo: boolean
          codigo: string
          created_at: string
          id: string
          nombre: string
          rfc: string | null
        }
        Insert: {
          activo?: boolean
          codigo: string
          created_at?: string
          id?: string
          nombre: string
          rfc?: string | null
        }
        Update: {
          activo?: boolean
          codigo?: string
          created_at?: string
          id?: string
          nombre?: string
          rfc?: string | null
        }
        Relationships: []
      }
      excepciones_proveedor: {
        Row: {
          activo: boolean
          created_at: string
          descripcion_regla: string
          dias_tolerancia: number | null
          hasta_mes_siguiente: boolean
          id: string
          proveedor: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          descripcion_regla: string
          dias_tolerancia?: number | null
          hasta_mes_siguiente?: boolean
          id?: string
          proveedor: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          descripcion_regla?: string
          dias_tolerancia?: number | null
          hasta_mes_siguiente?: boolean
          id?: string
          proveedor?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      movimientos: {
        Row: {
          abono_total: number | null
          archivo_id: string | null
          cargo_total: number | null
          comentarios: string | null
          created_at: string
          created_by: string | null
          cuenta_id: string
          empresa_id: string
          estado_clasificacion: string
          factura: string | null
          fecha_orden: string | null
          fecha_pago: string
          folio: string | null
          id: string
          nombre_razon_social: string | null
          observacion: string | null
          posible_duplicado: boolean
          proyecto: string | null
          referencia_numero: string | null
          referencia_tipo: string | null
          saldo: number
          tipo_movimiento: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          abono_total?: number | null
          archivo_id?: string | null
          cargo_total?: number | null
          comentarios?: string | null
          created_at?: string
          created_by?: string | null
          cuenta_id: string
          empresa_id: string
          estado_clasificacion?: string
          factura?: string | null
          fecha_orden?: string | null
          fecha_pago: string
          folio?: string | null
          id?: string
          nombre_razon_social?: string | null
          observacion?: string | null
          posible_duplicado?: boolean
          proyecto?: string | null
          referencia_numero?: string | null
          referencia_tipo?: string | null
          saldo: number
          tipo_movimiento?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          abono_total?: number | null
          archivo_id?: string | null
          cargo_total?: number | null
          comentarios?: string | null
          created_at?: string
          created_by?: string | null
          cuenta_id?: string
          empresa_id?: string
          estado_clasificacion?: string
          factura?: string | null
          fecha_orden?: string | null
          fecha_pago?: string
          folio?: string | null
          id?: string
          nombre_razon_social?: string | null
          observacion?: string | null
          posible_duplicado?: boolean
          proyecto?: string | null
          referencia_numero?: string | null
          referencia_tipo?: string | null
          saldo?: number
          tipo_movimiento?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_archivo_id_fkey"
            columns: ["archivo_id"]
            isOneToOne: false
            referencedRelation: "archivos_cargados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas_bancarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      ordenes_compra: {
        Row: {
          archivo_id: string | null
          created_at: string
          empresa_id: string
          fecha_creacion: string | null
          fuente: string
          id: string
          id_orden: string
          periodo: string | null
          proveedor: string | null
          proyecto: string | null
          tipo: string
          total: number | null
        }
        Insert: {
          archivo_id?: string | null
          created_at?: string
          empresa_id: string
          fecha_creacion?: string | null
          fuente: string
          id?: string
          id_orden: string
          periodo?: string | null
          proveedor?: string | null
          proyecto?: string | null
          tipo: string
          total?: number | null
        }
        Update: {
          archivo_id?: string | null
          created_at?: string
          empresa_id?: string
          fecha_creacion?: string | null
          fuente?: string
          id?: string
          id_orden?: string
          periodo?: string | null
          proveedor?: string | null
          proyecto?: string | null
          tipo?: string
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_compra_archivo_id_fkey"
            columns: ["archivo_id"]
            isOneToOne: false
            referencedRelation: "archivos_cargados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_compra_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      ordenes_venta: {
        Row: {
          archivo_id: string | null
          cliente: string | null
          created_at: string
          empresa_id: string
          fecha_ov: string | null
          fuente: string
          id: string
          id_ov: string
          periodo: string | null
          proyecto: string | null
          total: number | null
        }
        Insert: {
          archivo_id?: string | null
          cliente?: string | null
          created_at?: string
          empresa_id: string
          fecha_ov?: string | null
          fuente: string
          id?: string
          id_ov: string
          periodo?: string | null
          proyecto?: string | null
          total?: number | null
        }
        Update: {
          archivo_id?: string | null
          cliente?: string | null
          created_at?: string
          empresa_id?: string
          fecha_ov?: string | null
          fuente?: string
          id?: string
          id_ov?: string
          periodo?: string | null
          proyecto?: string | null
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_venta_archivo_id_fkey"
            columns: ["archivo_id"]
            isOneToOne: false
            referencedRelation: "archivos_cargados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_venta_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          activo: boolean
          created_at: string
          empresa_id: string | null
          id: string
          nombre: string
          rol: Database["public"]["Enums"]["app_rol"]
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          empresa_id?: string | null
          id: string
          nombre: string
          rol: Database["public"]["Enums"]["app_rol"]
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          empresa_id?: string | null
          id?: string
          nombre?: string
          rol?: Database["public"]["Enums"]["app_rol"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      reglas_clasificacion: {
        Row: {
          activo: boolean
          created_at: string
          etiqueta: string
          id: string
          orden: number
          palabra_clave: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          etiqueta: string
          id?: string
          orden?: number
          palabra_clave: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          etiqueta?: string
          id?: string
          orden?: number
          palabra_clave?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_concentrado_pendientes: {
        Row: {
          empresa_id: string | null
          monto_total: number | null
          movimientos_pendientes: number | null
          nombre_razon_social: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      v_kpis_mensuales: {
        Row: {
          anio: number | null
          empresa_id: string | null
          mes: number | null
          movimientos: number | null
          pct_factura_ajustado: number | null
          pct_nombre: number | null
          pct_proyecto: number | null
          total_abono: number | null
          total_cargo: number | null
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      v_movimientos_por_empresa: {
        Row: {
          empresa_id: string | null
          movimientos: number | null
          neto: number | null
          total_abono: number | null
          total_cargo: number | null
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      v_saldo_cierre_cuenta: {
        Row: {
          cuenta_id: string | null
          empresa_id: string | null
          fecha_ultimo_movimiento: string | null
          saldo_cierre: number | null
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_cuenta_id_fkey"
            columns: ["cuenta_id"]
            isOneToOne: false
            referencedRelation: "cuentas_bancarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      auth_empresa_id: { Args: never; Returns: string }
      auth_puede_escribir: { Args: never; Returns: boolean }
      auth_rol: { Args: never; Returns: Database["public"]["Enums"]["app_rol"] }
      auth_ve_todas_empresas: { Args: never; Returns: boolean }
      periodo_aaaamm: { Args: { fecha: string }; Returns: string }
    }
    Enums: {
      app_rol: "pendiente" | "corporativo" | "empresa" | "direccion" | "admin"
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
      app_rol: ["pendiente", "corporativo", "empresa", "direccion", "admin"],
    },
  },
} as const
