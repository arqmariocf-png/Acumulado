// Tipos escritos a mano reflejando supabase/migrations/*.sql. Lo ideal en un
// proyecto Supabase real es generarlos con `supabase gen types typescript`
// contra el proyecto vinculado -- no se pudo hacer aquí porque este entorno
// no tiene credenciales de un proyecto Supabase real. Mantener sincronizado
// a mano con las migraciones mientras tanto.

export type AppRol = "pendiente" | "corporativo" | "empresa" | "direccion" | "admin";

export type EstadoClasificacion = "resuelto" | "pendiente_esperado" | "pendiente_revision" | "ambiguo";

export interface Empresa {
  id: string;
  nombre: string;
  codigo: string;
  rfc: string | null;
  activo: boolean;
}

export interface Profile {
  id: string;
  nombre: string;
  rol: AppRol;
  empresa_id: string | null;
  activo: boolean;
}

export interface CuentaBancaria {
  id: string;
  empresa_id: string;
  banco: "BBVA" | "Banorte" | "Santander" | "BanBajio";
  ultimos_4: string;
  alias: string | null;
  activo: boolean;
}

export interface Movimiento {
  id: string;
  empresa_id: string;
  cuenta_id: string;
  archivo_id: string | null;
  tipo_movimiento: string;
  folio: string | null;
  fecha_pago: string;
  fecha_orden: string | null;
  proyecto: string | null;
  nombre_razon_social: string | null;
  cargo_total: number | null;
  abono_total: number | null;
  saldo: number;
  referencia_tipo: "OC" | "OS" | "OV" | "OF" | null;
  referencia_numero: string | null;
  factura: string | null;
  comentarios: string | null;
  observacion: string | null;
  estado_clasificacion: EstadoClasificacion;
  posible_duplicado: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ReglaClasificacion {
  id: string;
  palabra_clave: string;
  etiqueta: string;
  orden: number;
  activo: boolean;
}

export interface ExcepcionProveedor {
  id: string;
  proveedor: string;
  descripcion_regla: string;
  hasta_mes_siguiente: boolean;
  dias_tolerancia: number | null;
  activo: boolean;
}

export interface ArchivoCargado {
  id: string;
  empresa_id: string | null;
  tipo: "estado_cuenta" | "cfdi_recibidos" | "cfdi_emitidos" | "oc_excel" | "ov_excel";
  nombre_original: string;
  estado: "procesando" | "completado" | "error";
  filas_procesadas: number;
  filas_error: number;
  detalle_error: string | null;
  created_at: string;
}
