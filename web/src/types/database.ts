// Tipos escritos a mano reflejando supabase/migrations/*.sql. Lo ideal en un
// proyecto Supabase real es generarlos con `supabase gen types typescript`
// contra el proyecto vinculado -- no se pudo hacer aquí porque este entorno
// no tiene credenciales de un proyecto Supabase real. Mantener sincronizado
// a mano con las migraciones mientras tanto.

export type AppRol = "pendiente" | "corporativo" | "empresa" | "direccion" | "admin" | "rh" | "produccion";

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

// Módulo de Producción y Costeo (ver supabase/migrations/20260824090001-6_produccion_*.sql).
// Planta de Mallas y Clavos Clavicón: malla armex y clavos de dos calibres.

export interface MateriaPrima {
  id: string;
  nombre: string;
  unidad_medida: string;
  activo: boolean;
}

export type TipoProducto = "malla_armex" | "clavo";

export interface Producto {
  id: string;
  tipo: TipoProducto;
  nombre: string;
  calibre: string | null;
  presentacion: string | null;
  unidad_medida: string;
  activo: boolean;
}

export interface RecetaItem {
  id: string;
  producto_id: string;
  materia_prima_id: string;
  cantidad_por_unidad: number;
}

export type EstadoOrdenProduccion = "planeada" | "en_proceso" | "terminada" | "cancelada";

export interface OrdenProduccion {
  id: string;
  folio: string;
  producto_id: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  cantidad_planeada: number;
  cantidad_producida: number;
  cantidad_merma: number;
  estado: EstadoOrdenProduccion;
  notas: string | null;
  created_at: string;
}

export interface ManoDeObraProduccion {
  id: string;
  orden_produccion_id: string;
  personal_id: string | null;
  descripcion: string | null;
  horas: number;
  costo_hora: number;
  costo_total: number;
}

export interface CostoIndirectoProduccion {
  id: string;
  orden_produccion_id: string;
  concepto: string;
  monto: number;
}

export type TipoMovimientoInventario = "entrada" | "salida";

export interface MovimientoMateriaPrima {
  id: string;
  materia_prima_id: string;
  tipo: TipoMovimientoInventario;
  cantidad: number;
  costo_unitario: number;
  fecha: string;
  orden_compra_id: string | null;
  orden_produccion_id: string | null;
  motivo: string | null;
}

export interface MovimientoProductoTerminado {
  id: string;
  producto_id: string;
  tipo: TipoMovimientoInventario;
  cantidad: number;
  costo_unitario: number;
  fecha: string;
  orden_produccion_id: string | null;
  orden_venta_id: string | null;
  motivo: string | null;
}

export interface StockMateriaPrima {
  materia_prima_id: string;
  nombre: string;
  unidad_medida: string;
  stock_actual: number;
  costo_promedio_ponderado: number | null;
}

export interface StockProductoTerminado {
  producto_id: string;
  nombre: string;
  tipo: TipoProducto;
  calibre: string | null;
  unidad_medida: string;
  stock_actual: number;
  costo_promedio_ponderado: number | null;
}

export interface CosteoOrdenProduccion {
  orden_produccion_id: string;
  folio: string;
  producto_id: string;
  estado: EstadoOrdenProduccion;
  fecha_inicio: string;
  fecha_fin: string | null;
  cantidad_planeada: number;
  cantidad_producida: number;
  cantidad_merma: number;
  costo_materia_prima: number;
  costo_mano_obra: number;
  costo_indirectos: number;
  costo_total: number;
  costo_unitario: number | null;
}

export interface CosteoMensualClavicon {
  producto_id: string;
  producto_nombre: string;
  producto_tipo: TipoProducto;
  anio: number;
  mes: number;
  lotes: number;
  cantidad_producida: number;
  costo_total: number;
  costo_unitario_promedio: number | null;
}
