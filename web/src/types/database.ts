// Tipos escritos a mano reflejando supabase/migrations/*.sql. Lo ideal en un
// proyecto Supabase real es generarlos con `supabase gen types typescript`
// contra el proyecto vinculado -- no se pudo hacer aquí porque este entorno
// no tiene credenciales de un proyecto Supabase real. Mantener sincronizado
// a mano con las migraciones mientras tanto.

export type AppRol = "pendiente" | "corporativo" | "empresa" | "direccion" | "admin" | "rh" | "responsable";

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
  /** Solo aplica a préstamos entre empresas del grupo (factura = "N/A -
   * PRESTAMO INTERCOMPAÑIA"): la otra empresa involucrada, capturada a mano
   * en Reportes Especiales. */
  empresa_contraparte_id: string | null;
  estado_clasificacion: EstadoClasificacion;
  posible_duplicado: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PerfilFiscalParametros {
  id: string;
  empresa_id: string;
  anio: number;
  coeficiente_utilidad: number;
  tasa_isr: number;
  tasa_iva: number;
  perdidas_fiscales_inicio_anio: number;
  updated_at: string;
  updated_by: string | null;
}

/** Fila calculada de v_perfil_fiscal_mensual (ver
 * supabase/migrations/20260825030000_perfil_fiscal.sql para las fórmulas). */
export interface PerfilFiscalMensual {
  empresa_id: string;
  anio: number;
  mes: number;
  periodo: string;
  ingresos_nominales_mes: number;
  ingresos_nominales_acumulado: number;
  coeficiente_utilidad: number;
  utilidad_fiscal_estimada_acumulada: number;
  perdidas_fiscales_inicio_anio: number;
  base_gravable_isr_acumulada: number;
  tasa_isr: number;
  isr_causado_acumulado: number;
  isr_a_cargo_mes: number;
  ingresos_cobrados_mes: number;
  tasa_iva: number;
  iva_trasladado_mes: number;
  gastos_mes: number;
  iva_acreditable_mes: number;
  saldo_iva_mes: number;
  saldo_iva_acumulado: number;
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

// Módulo de Recursos Humanos (ver supabase/migrations/20260821090003-5_rh_*.sql).

export interface Personal {
  id: string;
  nombre: string;
  puesto: string | null;
  fecha_nacimiento: string | null;
  sexo: "M" | "F" | null;
  estado_civil: string | null;
  nacionalidad: string;
  telefono: string | null;
  correo: string | null;
  curp: string | null;
  rfc: string | null;
  domicilio_particular: string | null;
  domicilio_notificaciones: string | null;
  ine_numero_identificacion: string | null;
  ine_clave_elector: string | null;
  infonavit_tiene_credito: boolean;
  infonavit_numero_credito: string | null;
  contacto_emergencia_nombre: string | null;
  contacto_emergencia_telefono: string | null;
  contacto_emergencia_parentesco: string | null;
  beneficiario_nombre: string | null;
  beneficiario_parentesco: string | null;
  fecha_ingreso: string;
  activo: boolean;
  created_at: string;
}

export interface AsignacionDiaria {
  id: string;
  personal_id: string;
  empresa_id: string;
  proyecto: string | null;
  fecha: string;
}

export interface Contratacion {
  id: string;
  personal_id: string;
  empresa_id: string;
  puesto: string;
  sueldo_semanal: number;
  fecha_inicio: string;
  duracion_dias: number;
  fecha_fin: string;
  estatus: "vigente" | "vencido" | "rescindido" | "renovado";
  contrato_storage_path: string | null;
  contrato_generado_at: string | null;
}

export interface TipoDocumentoPersonal {
  id: string;
  nombre: string;
  vigencia_meses: number | null;
  aplica_a: "todos" | "chofer";
  orden: number;
  activo: boolean;
}

export interface DocumentoPersonal {
  id: string;
  personal_id: string;
  tipo_documento_id: string;
  fecha_entrega: string;
  fecha_vigencia: string | null;
  storage_path: string | null;
  verificado: boolean;
}

export interface DocumentoFaltante {
  personal_id: string;
  personal_nombre: string;
  tipo_documento_id: string;
  tipo_documento_nombre: string;
}

// Módulo de Requisiciones (ver supabase/migrations/20260827193332-193730_requisiciones_*.sql).
// El "catálogo de conceptos" reutiliza public.productos del módulo de Inventario -- ver Producto en
// este mismo archivo.

export type EstadoRequisicion = "enviada" | "en_revision" | "resuelta" | "cancelada";
export type EstadoNecesidadCompra = "pendiente" | "vinculada" | "cancelada";
export type EstadoNecesidadEntrega = "pendiente" | "entregada" | "cancelada";

export interface Proyecto {
  id: string;
  id_backoffice: number | null;
  nombre: string;
  empresa_id: string;
  tipo: string | null;
  responsable_nombre: string | null;
  responsable_id: string | null;
  comprador_nombre: string | null;
  comprador_id: string | null;
  activo: boolean;
}

export interface Requisicion {
  id: string;
  folio: number;
  proyecto_id: string;
  empresa_id: string;
  solicitado_por: string;
  fecha: string;
  estado: EstadoRequisicion;
  comentario: string | null;
  created_at: string;
}

export interface RequisicionLinea {
  id: string;
  requisicion_id: string;
  concepto_id: string;
  cantidad_solicitada: number;
  unidad_medida: string;
  comentario: string | null;
}

export interface NecesidadCompra {
  id: string;
  requisicion_linea_id: string;
  cantidad: number;
  proveedor_sugerido: string | null;
  estado: EstadoNecesidadCompra;
  orden_compra_id: string | null;
}

export interface NecesidadEntrega {
  id: string;
  requisicion_linea_id: string;
  cantidad: number;
  estado: EstadoNecesidadEntrega;
  movimiento_inventario_id: string | null;
  orden_venta_id: string | null;
}

export interface AvanceResolucionLinea {
  requisicion_linea_id: string;
  requisicion_id: string;
  concepto_id: string;
  cantidad_solicitada: number;
  unidad_medida: string;
  cantidad_a_compra: number;
  cantidad_a_entrega: number;
  cantidad_sin_resolver: number;
}
