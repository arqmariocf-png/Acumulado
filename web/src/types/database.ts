// Tipos escritos a mano reflejando supabase/migrations/*.sql. Lo ideal en un
// proyecto Supabase real es generarlos con `supabase gen types typescript`
// contra el proyecto vinculado -- no se pudo hacer aquí porque este entorno
// no tiene credenciales de un proyecto Supabase real. Mantener sincronizado
// a mano con las migraciones mientras tanto.

export type AppRol = "pendiente" | "corporativo" | "empresa" | "direccion" | "admin" | "rh" | "almacen" | "responsable" | "rh_documentos" | "produccion";

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

export type TipoContrato = "confidencialidad" | "laboral_determinado" | "laboral_indeterminado" | "prestacion_servicios";

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
  tipo_contrato: TipoContrato;
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

// Módulo de Inventario (ver supabase/migrations/20260824090001-5_inventario_*.sql).

export type TipoMovimientoInventario = "entrada" | "salida";
export type EstadoRecepcion = "sin_total" | "sin_recibir" | "parcial" | "completo";
export type EstadoEmbarque = "sin_total" | "sin_embarcar" | "parcial" | "completo";

export interface Almacen {
  id: string;
  empresa_id: string;
  nombre: string;
  activo: boolean;
}

export interface Producto {
  id: string;
  empresa_id: string;
  sku: string;
  codigo_barras: string | null;
  nombre: string;
  descripcion: string | null;
  unidad_medida: string;
  costo_referencia: number | null;
  activo: boolean;
  created_at: string;
}

export interface MovimientoInventario {
  id: string;
  empresa_id: string;
  almacen_id: string;
  producto_id: string;
  tipo: TipoMovimientoInventario;
  cantidad: number;
  costo_unitario: number | null;
  fecha: string;
  orden_compra_id: string | null;
  orden_venta_id: string | null;
  es_ajuste: boolean;
  codigo_escaneado: string | null;
  comentario: string | null;
  nota_entrega_id: string | null;
  registrado_por: string;
  created_at: string;
}

/** Foto de una nota/remisión de entrega en papel, para proveedores sin QR ni
 * código de barras (ver supabase/functions/ocr-nota-entrega y
 * supabase/migrations/20260828150006_inventario_notas_entrega.sql). Los
 * items sugeridos por OCR viven en texto_extraido -- no tienen su propia
 * tabla porque son solo una sugerencia editable, no un registro definitivo. */
export interface NotaEntrega {
  id: string;
  empresa_id: string;
  storage_path: string;
  proveedor_sugerido: string | null;
  fecha_sugerida: string | null;
  texto_extraido: { items: ItemSugeridoNota[]; error: string | null } | null;
  subido_por: string;
  created_at: string;
}

export interface ItemSugeridoNota {
  descripcion: string;
  cantidad: number | null;
  unidad: string | null;
}

export interface Existencia {
  producto_id: string;
  empresa_id: string;
  sku: string;
  producto_nombre: string;
  unidad_medida: string;
  almacen_id: string;
  almacen_nombre: string;
  existencia: number;
}

export interface AvanceRecepcionOc {
  orden_compra_id: string;
  id_orden: string;
  tipo: "OC" | "OS";
  empresa_id: string;
  proyecto: string | null;
  proveedor: string | null;
  total_oc: number | null;
  total_recibido: number;
  movimientos_vinculados: number;
  fecha_ultima_recepcion: string | null;
  estado_recepcion: EstadoRecepcion;
}

export interface AvanceEmbarqueOv {
  orden_venta_id: string;
  id_ov: string;
  empresa_id: string;
  proyecto: string | null;
  cliente: string | null;
  total_ov: number | null;
  total_embarcado: number;
  movimientos_vinculados: number;
  fecha_ultimo_embarque: string | null;
  estado_embarque: EstadoEmbarque;
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

// Módulo de Precios Unitarios (ver supabase/migrations/*_pu_*.sql).
//
// El precio NUNCA se guarda: v_pu_analisis_costeo lo recalcula de la explosión
// de insumos cada vez que se consulta, y el costo de cada insumo sale de su
// historial. Por eso ajustar un rendimiento o cotizar un material vuelve a
// costear solos todos los análisis en borrador.

export type PuTipoInsumo = "material" | "mano_obra" | "herramienta" | "equipo" | "auxiliar";

export type PuBaseCalculo = "cantidad" | "pct_mano_obra";

export type PuEstado =
  | "borrador"
  | "en_revision_material"
  | "material_confirmado"
  | "autorizado"
  | "publicado"
  | "obsoleto";

export interface PuInsumo {
  id: string;
  codigo: string;
  descripcion: string;
  unidad: string;
  tipo: PuTipoInsumo;
  activo: boolean;
}

export interface PuFactor {
  id: string;
  empresa_id: string;
  nombre: string;
  // Fracción, no porcentaje: 18% se guarda como 0.18.
  indirectos_pct: number;
  financiamiento_pct: number;
  utilidad_pct: number;
  cargos_adicionales_pct: number;
  vigente_desde: string;
  activo: boolean;
}

/** Fila de v_pu_analisis_costeo: la tarjeta con su precio ya calculado. */
export interface PuCosteo {
  analisis_id: string;
  empresa_id: string;
  empresa_codigo: string;
  empresa_nombre: string;
  proyecto_id: string | null;
  proyecto_nombre: string | null;
  codigo: string;
  concepto: string;
  unidad: string;
  es_auxiliar: boolean;
  estado: PuEstado;
  creado_por: string | null;
  creado_por_nombre: string | null;
  factor_nombre: string | null;
  indirectos_pct: number;
  financiamiento_pct: number;
  utilidad_pct: number;
  cargos_adicionales_pct: number;
  costo_directo: number;
  importe_material: number;
  importe_mano_obra: number;
  importe_equipo: number;
  importe_indirectos: number;
  importe_financiamiento: number;
  importe_utilidad: number;
  importe_cargos_adicionales: number;
  precio_unitario: number;
  insumos_sin_precio: number;
  updated_at: string;
}

/** Fila de v_pu_analisis_detalle: un renglón de la tarjeta, ya costeado. */
export interface PuRenglon {
  item_id: string;
  analisis_id: string;
  orden: number;
  base_calculo: PuBaseCalculo;
  codigo: string | null;
  descripcion: string | null;
  unidad: string | null;
  tipo: PuTipoInsumo;
  cantidad: number;
  rendimiento: number;
  /** cantidad / rendimiento, o la fracción cuando base_calculo es pct_mano_obra. */
  aportacion: number;
  costo_unitario: number;
  importe: number;
  costo_cerrado: boolean;
  /** El insumo nunca se ha cotizado: cuenta como cero y hay que avisarlo. */
  sin_precio: boolean;
  proveedor: string | null;
  precio_autorizado_en: string | null;
}

export interface PuAprobacion {
  id: string;
  analisis_id: string;
  estado_anterior: PuEstado;
  estado_nuevo: PuEstado;
  actor_id: string | null;
  actor_rol: AppRol | null;
  /** Congelado al firmar: el documento conserva quién firmó ese día. */
  actor_nombre: string | null;
  comentario: string | null;
  created_at: string;
}
