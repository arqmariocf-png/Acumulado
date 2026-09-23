// Tipos escritos a mano reflejando supabase/migrations/*.sql. Lo ideal en un
// proyecto Supabase real es generarlos con `supabase gen types typescript`
// contra el proyecto vinculado -- no se pudo hacer aquí porque este entorno
// no tiene credenciales de un proyecto Supabase real. Mantener sincronizado
// a mano con las migraciones mientras tanto.

export type AppRol = "pendiente" | "corporativo" | "empresa" | "direccion" | "admin" | "rh";

// Organizaciones (tenants). Acumulado es la plataforma maestra: cada cliente
// es un `grupo` con sus propias empresas, usuarios y módulos abiertos.
// Ver supabase/migrations/20260923090001_grupos_modulos.sql.

export type ModuloClave = "conciliacion" | "inventario" | "rh" | "proyectos";

export interface Grupo {
  id: string;
  nombre: string;
  codigo: string;
  marca_comercial: string | null;
  /** Ruta dentro del bucket público `branding`; el frontend arma la URL con ella. */
  logo_path: string | null;
  es_maestro: boolean;
  activo: boolean;
}

// Suscripción (ver supabase/migrations/20260923090003_suscripciones.sql).
// Los datos de la tarjeta NO viven en esta base: metodo_pago_* es solo lo que
// la pasarela devuelve para que el cliente reconozca su tarjeta en pantalla.

export type EstadoSuscripcion = "prueba" | "activa" | "periodo_gracia" | "suspendida" | "cancelada";

export interface PlanEscalon {
  plan_clave: string;
  desde_usuarios: number;
  precio_unitario_centavos: number;
}

export interface Suscripcion {
  grupo_id: string;
  plan_clave: string;
  plan_nombre: string;
  moneda: string;
  /** Usuarios activos con rol asignado: los que se cobran. */
  usuarios_facturables: number;
  precio_unitario_centavos: number;
  total_mensual_centavos: number;
  estado: EstadoSuscripcion;
  periodo_fin: string | null;
  gracia_hasta: string | null;
  dias_gracia: number;
  pasarela: string | null;
  metodo_pago_marca: string | null;
  metodo_pago_ultimos4: string | null;
  puede_escribir: boolean;
  escribe_hasta: string | null;
}

export interface Pago {
  id: string;
  grupo_id: string;
  monto_centavos: number;
  moneda: string;
  estado: "pendiente" | "pagado" | "fallido" | "reembolsado";
  periodo_inicio: string | null;
  periodo_fin: string | null;
  pagado_at: string | null;
  detalle_error: string | null;
  created_at: string;
}

// Módulo de Proyectos (ver supabase/migrations/20260923090005_modulo_proyectos.sql).

export type EstatusProyecto =
  | "prospecto"
  | "en_diseno"
  | "en_revision"
  | "aprobado"
  | "en_obra"
  | "terminado"
  | "cancelado";

export type DisciplinaPlano =
  | "arquitectonico"
  | "estructural"
  | "instalaciones"
  | "acabados"
  | "topografia"
  | "otro";

export type EstatusPlano = "en_diseno" | "en_revision" | "aprobado" | "para_obra" | "obsoleto";

export type EstatusCotizacion = "borrador" | "enviada" | "aceptada" | "rechazada" | "vencida";

export interface Proyecto {
  id: string;
  grupo_id: string;
  empresa_id: string | null;
  clave: string;
  nombre: string;
  cliente: string | null;
  responsable: string | null;
  ubicacion: string | null;
  descripcion: string | null;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  estatus: EstatusProyecto;
  activo: boolean;
  created_at: string;
}

export interface Plano {
  id: string;
  proyecto_id: string;
  clave: string;
  nombre: string;
  disciplina: DisciplinaPlano;
  revision: string;
  estatus: EstatusPlano;
  escala: string | null;
  fecha: string;
  storage_path: string | null;
  notas: string | null;
  created_at: string;
}

export interface Cotizacion {
  id: string;
  proyecto_id: string;
  folio: string;
  cliente: string | null;
  fecha: string;
  vigencia_dias: number;
  moneda: string;
  iva_tasa: number;
  estatus: EstatusCotizacion;
  notas: string | null;
  created_at: string;
}

export interface CotizacionPartida {
  id: string;
  cotizacion_id: string;
  orden: number;
  concepto: string;
  unidad: string;
  cantidad: number;
  precio_unitario: number;
  importe: number;
}

export interface CotizacionTotales {
  cotizacion_id: string;
  proyecto_id: string;
  folio: string;
  estatus: EstatusCotizacion;
  moneda: string;
  fecha: string;
  vigente_hasta: string;
  partidas: number;
  subtotal: number;
  iva: number;
  total: number;
}

export interface Modulo {
  clave: ModuloClave;
  nombre: string;
  descripcion: string | null;
  orden: number;
}

export interface GrupoModulo {
  grupo_id: string;
  modulo_clave: ModuloClave;
  habilitado: boolean;
  habilitado_at: string | null;
  habilitado_por: string | null;
}

export type EstadoClasificacion = "resuelto" | "pendiente_esperado" | "pendiente_revision" | "ambiguo";

export interface Empresa {
  id: string;
  grupo_id: string;
  nombre: string;
  codigo: string;
  rfc: string | null;
  activo: boolean;
}

export interface Profile {
  id: string;
  nombre: string;
  rol: AppRol;
  grupo_id: string | null;
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
  registrado_por: string;
  created_at: string;
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
