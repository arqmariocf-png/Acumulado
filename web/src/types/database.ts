// Tipos escritos a mano reflejando supabase/migrations/*.sql. Lo ideal en un
// proyecto Supabase real es generarlos con `supabase gen types typescript`
// contra el proyecto vinculado -- no se pudo hacer aquí porque este entorno
// no tiene credenciales de un proyecto Supabase real. Mantener sincronizado
// a mano con las migraciones mientras tanto.

export type AppRol =
  | "pendiente"
  | "corporativo"
  | "empresa"
  | "direccion"
  | "admin"
  | "rh"
  | "almacen"
  | "responsable"
  | "rh_documentos"
  | "produccion"
  | "supervisor_bbva"
  | "operativo"
  | "administrativo"
  | "supervisor"
  | "directivo";

export type EstadoClasificacion = "resuelto" | "pendiente_esperado" | "pendiente_revision" | "ambiguo";

export interface Empresa {
  id: string;
  grupo_id: string;
  nombre: string;
  codigo: string;
  rfc: string | null;
  activo: boolean;
}

// Organizaciones (tenants). Acumulado es la plataforma maestra: cada cliente
// es un `grupo` con sus entidades, usuarios y datos aislados, y con los
// módulos que se le van abriendo. Ver supabase/migrations/20260923090001.

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

// Suscripción: se cobra por usuario, con escalones de volumen. Los datos de la
// tarjeta NO viven en esta base -- metodo_pago_* es solo lo que la pasarela
// devuelve para que el cliente reconozca la suya.

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

export interface Profile {
  id: string;
  nombre: string;
  rol: AppRol;
  grupo_id: string | null;
  empresa_id: string | null;
  activo: boolean;
  telefono: string | null;
  bbva_mantenimiento: boolean;
  /** Módulos asignados uno por uno (permisos_modulo); solo aplican a los
   * roles básicos (operativo, administrativo, supervisor, directivo). */
  modulos: string[];
}

export interface CuentaBancaria {
  id: string;
  empresa_id: string;
  banco: "BBVA" | "Banorte" | "Santander" | "BanBajio";
  ultimos_4: string;
  alias: string | null;
  activo: boolean;
  /** Corrección manual fija (puede ser negativa) que se suma al saldo que
   * arrastra el sistema para llegar al saldo real del banco -- ver Admin ->
   * Cuentas y el reporte de saldos. NO se recalcula sola. */
  ajuste_saldo: number;
  /** De dónde viene el ajuste_saldo (ej. "comisión no capturada, jul-ago 2026"). */
  ajuste_nota: string | null;
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
  /** Baja: cuándo y por qué (renuncia | termino_contrato | despido | abandono | otro[: nota]). NULL si está activo. */
  fecha_baja: string | null;
  motivo_baja: string | null;
  /** Carta finiquito de la baja vigente: NULL = pendiente mientras activo=false. */
  finiquito_entregado_en: string | null;
  finiquito_nota: string | null;
  /** Área operativa para el punto de equilibrio (bbva_puebla) -- la marca RH. */
  area: "bbva_puebla" | null;
  created_at: string;
  /** Datos que llegan del expediente (extraídos de los documentos). */
  nss: string | null;
  licencia_chofer_numero: string | null;
  licencia_chofer_vigencia: string | null;
  /** Cuenta de acceso vinculada -- una vez que la tiene, puede checar
   * entrada/salida desde su celular (ver v_asistencia_semanal_personal). */
  profile_id: string | null;
}

/** Fila de v_asistencia_semanal_personal: días con marca de entrada en el
 * checador por semana, cruzados con el sueldo de la contratación vigente
 * -- informativo para armar la lista de nómina, no calcula el monto final. */
export interface AsistenciaSemanalPersonal {
  personal_id: string;
  personal_nombre: string;
  contratacion_id: string;
  empresa_id: string;
  semana_inicio: string;
  dias_checados: number;
  sueldo_semanal: number;
}

/** Fila de v_proyeccion_nomina_semanal: gasto de nómina esperado por
 * empresa y semana, sumando sueldo_semanal de contrataciones vigentes. */
export interface ProyeccionNominaSemanal {
  empresa_id: string;
  semana_inicio: string;
  monto_proyectado: number;
}

export interface AsignacionDiaria {
  id: string;
  personal_id: string;
  empresa_id: string;
  proyecto: string | null;
  fecha: string;
}

export type TipoContrato = "confidencialidad" | "laboral_determinado" | "laboral_indeterminado" | "prestacion_servicios";

export type FrecuenciaPago = "semanal" | "quincenal";

export interface Contratacion {
  id: string;
  personal_id: string;
  empresa_id: string;
  puesto: string;
  sueldo_semanal: number;
  /** Semanal o quincenal; sueldo_periodo es lo que se paga en cada periodo. */
  frecuencia_pago: FrecuenciaPago;
  sueldo_periodo: number | null;
  fecha_inicio: string;
  duracion_dias: number;
  fecha_fin: string;
  estatus: "vigente" | "vencido" | "rescindido" | "renovado";
  tipo_contrato: TipoContrato;
  contrato_storage_path: string | null;
  contrato_generado_at: string | null;
}

export interface EmpresaPerfilLegal {
  empresa_id: string;
  razon_social: string;
  representante_legal_nombre: string;
  representante_legal_puesto: string;
  escritura_constitucion_numero: string | null;
  escritura_constitucion_fecha: string | null;
  escritura_constitucion_notario: string | null;
  escritura_constitucion_notaria_numero: string | null;
  escritura_constitucion_distrito_judicial: string | null;
  escritura_poderes_numero: string | null;
  escritura_poderes_fecha: string | null;
  escritura_poderes_notario: string | null;
  domicilio_legal: string;
  ciudad_firma: string;
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
  nombre_original: string | null;
  mime_type: string | null;
  datos_extraidos: ExtraccionDocumento | null;
  extraido_en: string | null;
  error_extraccion: string | null;
  aplicado_en: string | null;
}

/** Lo que Claude leyó de un documento del expediente (edge function
 * rh-documentos). Es una sugerencia: RH decide qué aplicar a `personal`. */
export interface ExtraccionDocumento {
  tipo_detectado: string;
  campos: Record<string, string | null>;
  coincide_con_persona: boolean | null;
  observaciones: string;
  confianza: "alta" | "media" | "baja";
}

/** Fila de v_expediente_personal: persona × tipo de documento aplicable,
 * con el documento vigente (el más reciente) y su estado. */
export interface ExpedienteFila {
  personal_id: string;
  personal_nombre: string;
  personal_activo: boolean;
  tipo_documento_id: string;
  tipo_documento_nombre: string;
  vigencia_meses: number | null;
  orden: number;
  documento_id: string | null;
  fecha_entrega: string | null;
  fecha_vigencia: string | null;
  storage_path: string | null;
  nombre_original: string | null;
  mime_type: string | null;
  verificado: boolean | null;
  datos_extraidos: ExtraccionDocumento | null;
  extraido_en: string | null;
  error_extraccion: string | null;
  aplicado_en: string | null;
  estado: "falta" | "vencido" | "vigente";
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
  /** A qué cliente pertenece este proyecto -- alimenta el catálogo de
   * precios por cliente (pu_precios_cliente) en la ventana de Proyectos. */
  cliente: string | null;
}

export interface ProyectoPlano {
  id: string;
  proyecto_id: string;
  nombre_original: string;
  storage_path: string;
  tipo_archivo: "pdf" | "dwg";
  subido_por: string;
  created_at: string;
}

/** Catálogo de referencia de precios ya negociados por cliente -- apoyo
 * para cotizar rápido, no sustituye el costeo por insumo de Precios
 * Unitarios (pu_analisis). */
export interface PuPrecioCliente {
  id: string;
  empresa_id: string;
  cliente: string;
  concepto: string;
  unidad: string;
  precio_unitario: number;
  vigente_desde: string;
  activo: boolean;
  created_by: string;
  created_at: string;
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
  /** Descripción del insumo en el catálogo (la de arriba puede estar
   * personalizada por renglón: medidas, lado, acabado). */
  descripcion_catalogo: string | null;
  descripcion_personalizada: boolean;
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

/** Fila de la vista v_directorio: nombre/rol de cualquier usuario con acceso
 * al sistema, visible para cualquier perfil no-pendiente (no expone
 * empresa_id ni datos financieros) -- se usa para mostrar/asignar personas
 * en Tareas sin necesitar permiso de Admin sobre profiles. */
export interface DirectorioPerfil {
  id: string;
  nombre: string;
  rol: AppRol;
  activo: boolean;
}

// ── Tareas (tablero estilo Trello) ──────────────────────────────────────

export interface Tablero {
  id: string;
  /** NULL = tablero "corporativo", visible desde cualquier empresa. */
  empresa_id: string | null;
  nombre: string;
  descripcion: string | null;
  archivado: boolean;
  creado_por: string;
  /** Proyecto al que da seguimiento este tablero (avance en Proyectos). */
  proyecto_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TableroColumna {
  id: string;
  tablero_id: string;
  nombre: string;
  orden: number;
  created_at: string;
}

export interface Tarjeta {
  id: string;
  tablero_id: string;
  columna_id: string;
  titulo: string;
  descripcion: string | null;
  orden_venta_id: string | null;
  asignado_a: string | null;
  creado_por: string;
  fecha_limite: string | null;
  orden: number;
  archivada: boolean;
  created_at: string;
  updated_at: string;
}

export interface TarjetaComentario {
  id: string;
  tarjeta_id: string;
  autor_id: string;
  texto: string;
  created_at: string;
}

export interface TarjetaArchivo {
  id: string;
  tarjeta_id: string;
  storage_path: string;
  nombre_original: string;
  subido_por: string;
  created_at: string;
}

export type TarjetaActividadTipo = "creada" | "movida" | "asignada" | "archivada" | "reabierta" | "editada";

export interface TarjetaActividad {
  id: string;
  tarjeta_id: string;
  tipo: TarjetaActividadTipo;
  detalle: Record<string, unknown> | null;
  actor_id: string;
  created_at: string;
}

// ============================================================
// Nómina externa (APIs de Grupo Loma: mano de obra + nómina fija)
// ============================================================
// El renglón se guarda tal cual llega de la API (`datos`, jsonb) porque su
// forma puede cambiar; qué columna es cuál se captura en
// NominaExternaMapeo y se corrige desde la página si hace falta.

export type NominaExternaOrigenKey = "mano_obra" | "nomina_semanal" | "nomina_quincenal";
export type NominaExternaEstado = "programado" | "pagado";
export type MetodoPagoNomina = "efectivo" | "transferencia" | "otro";

export interface NominaExternaOrigen {
  origen: NominaExternaOrigenKey;
  nombre: string;
  url: string;
  activo: boolean;
  columnas: string[];
  ultima_sincronizacion: string | null;
  ultimo_estado: "ok" | "error" | null;
  ultimo_error: string | null;
  ultimo_total_renglones: number | null;
  ultimo_total_centavos: number | null;
  /** A partir de cuántos minutos se considera vieja la información. */
  sincronizar_cada_minutos: number;
  updated_at: string;
}

export interface NominaExternaMapeo {
  origen: NominaExternaOrigenKey;
  campo_id: string | null;
  campo_empleado: string | null;
  campo_importe: string | null;
  campo_periodo: string | null;
  campo_centro_costos: string | null;
  actualizado_por: string | null;
  updated_at: string;
}

export interface NominaExternaRenglon {
  id: string;
  origen: NominaExternaOrigenKey;
  llave: string;
  datos: Record<string, unknown>;
  sincronizado_en: string;
}

export interface NominaExternaPago {
  id: string;
  origen: NominaExternaOrigenKey;
  llave: string;
  estado: NominaExternaEstado;
  programado_para: string | null;
  metodo_pago: MetodoPagoNomina;
  importe_centavos: number | null;
  pagado_en: string | null;
  referencia_pago: string | null;
  notas: string | null;
  creado_por: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Producción y Costeo (planta Mallas y Clavos Clavicón, empresa MCC)
// ============================================================
// "ProductoProduccion" (tabla productos_produccion) para no chocar con el
// `Producto` del módulo de inventario genérico (tabla productos, sku por
// empresa) -- son catálogos distintos, sin relación entre sí.

export interface MateriaPrima {
  id: string;
  empresa_id: string;
  nombre: string;
  unidad_medida: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

/** malla_armex/clavo = Clavicón (MCC); vigueta/bovedilla/bloque = Balken (VBB). */
export type ProductoProduccionTipo =
  | "malla_armex"
  | "clavo" // Clavicón
  | "vigueta"
  | "bovedilla"
  | "bloque" // Balken
  | "puerta"
  | "closet"
  | "cocina"
  | "mueble"; // Carpintería (CSC)

export interface ProductoProduccion {
  id: string;
  empresa_id: string;
  tipo: ProductoProduccionTipo;
  nombre: string;
  calibre: string | null;
  presentacion: string | null;
  unidad_medida: string;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecetaItem {
  id: string;
  producto_id: string;
  materia_prima_id: string;
  cantidad_por_unidad: number;
  created_at: string;
  updated_at: string;
}

export type EstadoOrdenProduccion = "planeada" | "en_proceso" | "terminada" | "cancelada";

export interface OrdenProduccion {
  id: string;
  empresa_id: string;
  folio: string;
  producto_id: string;
  fecha_inicio: string;
  fecha_fin: string | null;
  cantidad_planeada: number;
  cantidad_producida: number;
  cantidad_merma: number;
  estado: EstadoOrdenProduccion;
  notas: string | null;
  /** Proyecto (catálogo de proyectos de la empresa) al que se destina el lote. */
  proyecto_id: string | null;
  /** Tiempo planeado de entrega en días hábiles (lunes a sábado). */
  dias_planeados: number | null;
  /** fecha_inicio + dias_planeados, calculada en la base. */
  fecha_estimada_embarque: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ManoDeObraProduccion {
  id: string;
  orden_produccion_id: string;
  personal_id: string | null;
  descripcion: string | null;
  horas: number;
  costo_hora: number;
  costo_total: number;
  created_by: string | null;
  created_at: string;
}

export interface CostoIndirectoProduccion {
  id: string;
  orden_produccion_id: string;
  concepto: string;
  monto: number;
  created_by: string | null;
  created_at: string;
}

export type TipoMovimientoProduccion = "entrada" | "salida";

export interface MovimientoMateriaPrima {
  id: string;
  materia_prima_id: string;
  tipo: TipoMovimientoProduccion;
  cantidad: number;
  costo_unitario: number;
  fecha: string;
  orden_compra_id: string | null;
  orden_produccion_id: string | null;
  motivo: string | null;
  created_by: string | null;
  created_at: string;
}

export interface MovimientoProductoTerminado {
  id: string;
  producto_id: string;
  tipo: TipoMovimientoProduccion;
  cantidad: number;
  costo_unitario: number;
  fecha: string;
  orden_produccion_id: string | null;
  orden_venta_id: string | null;
  motivo: string | null;
  created_by: string | null;
  created_at: string;
}

export interface StockMateriaPrima {
  materia_prima_id: string;
  nombre: string;
  unidad_medida: string;
  stock_actual: number;
  costo_promedio_ponderado: number | null;
  empresa_id: string;
}

export interface StockProductoTerminado {
  producto_id: string;
  nombre: string;
  tipo: ProductoProduccionTipo;
  calibre: string | null;
  unidad_medida: string;
  stock_actual: number;
  costo_promedio_ponderado: number | null;
  empresa_id: string;
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
  empresa_id: string;
}

export interface CosteoEstandarOrdenProduccion {
  orden_produccion_id: string;
  costo_materia_prima_estandar: number;
}

export interface CosteoMensualPlanta {
  empresa_id: string;
  empresa_codigo: string;
  empresa_nombre: string;
  producto_id: string;
  producto_nombre: string;
  producto_tipo: ProductoProduccionTipo;
  anio: number;
  mes: number;
  lotes: number;
  cantidad_producida: number;
  costo_total: number;
  costo_unitario_promedio: number | null;
}

// ── Control de obra por especialidad (Proyectos → Control de obra) ──────────

export type ProyectoControlEstatus = "en_curso" | "cierre" | "cerrado";

/** Un trabajo acotado dentro de un proyecto (ej. la carpintería de Portamar)
 * con su propio contrato, compras y nómina; el cierre sale de ahí. */
export interface ProyectoControl {
  id: string;
  proyecto_id: string;
  especialidad: string;
  presupuesto: number;
  fecha_inicio: string | null;
  estatus: ProyectoControlEstatus;
  semana_cierre: string | null;
  /** Subpartida con la que llega la mano de obra en la API de Grupo Loma. */
  subpartida_nomina: string | null;
  notas: string | null;
}

export interface ProyectoControlCompra {
  id: string;
  control_id: string;
  orden_compra_id: string | null;
  fecha: string;
  proveedor: string;
  folio: string | null;
  descripcion: string | null;
  categoria: string | null;
  estatus: "pagado" | "pendiente";
  importe: number;
}

export interface ProyectoControlNomina {
  id: string;
  control_id: string;
  semana: number;
  fecha_inicio: string;
  fecha_fin: string;
  puesto: string;
  sueldo: number;
}

/** Renglón de nomina_api_control_obra(): lo cargado al proyecto en la API. */
export interface NominaApiControlObra {
  semana: number;
  fecha_inicio: string;
  fecha_fin: string;
  nombre: string;
  monto: number;
}

/** Fila del control BBVA nuevo (bbva_folios_control) -- una por trabajo. */
export interface BbvaFolioControl {
  id_interno: string;
  folio: string | null;
  cr: string | null;
  sucursal: string | null;
  solicitud: string | null;
  fecha_recepcion: string | null;
  fecha_primera_atencion: string | null;
  prioridad: string | null;
  fecha_compromiso_cliente: string | null;
  supervisor: string | null;
  equipo: string | null;
  fecha_programada: string | null;
  ventana_acceso: string | null;
  estatus_operativo: string | null;
  motivo_bloqueo: string | null;
  siguiente_accion: string | null;
  responsable_siguiente: string | null;
  fecha_compromiso_siguiente: string | null;
  fecha_ultima_actualizacion: string | null;
  alerta_siguiente_paso: string | null;
  fecha_finalizacion: string | null;
  fecha_aceptacion_cliente: string | null;
  generadores: string | null;
  reporte_fotografico: string | null;
  caratula: string | null;
  presupuesto: string | null;
  soportes_completos: string | null;
  fecha_envio_soportes: string | null;
  autorizacion: string | null;
  fecha_autorizacion: string | null;
  accion_fichero: string | null;
  fecha_fichero: string | null;
  etapa_seguimiento: string | null;
  enlace_evidencia: string | null;
  monto_a_cobrar: number | null;
  pedido: string | null;
  factura: string | null;
  observaciones: string | null;
  revision_registro: string | null;
  fecha_recepcion_pedido: string | null;
  fecha_recepcion_factura: string | null;
  estado_pago: string | null;
  monto_cobrado: number | null;
  monto_solicitado: number | null;
  pago_aplicado: number | null;
  saldo_por_cobrar: number | null;
  revision_cobranza: string | null;
  corte_id: string | null;
  actualizado_en: string;
}

// Remisión de salida de almacén (tabla remisiones_salida / vista
// v_remisiones_salida): agrupa las líneas de una salida bajo un folio con QR.
export type EstatusRemision = "emitida" | "entregada";

export interface RemisionSalida {
  id: string;
  empresa_id: string;
  empresa_nombre: string;
  almacen_id: string;
  almacen_nombre: string;
  numero: number;
  folio: string;
  fecha: string;
  entregar_a: string;
  destino: string | null;
  orden_venta_id: string | null;
  observaciones: string | null;
  estatus: EstatusRemision;
  emitida_por: string;
  emitida_por_nombre: string | null;
  entregada_en: string | null;
  entregada_por: string | null;
  entregada_por_nombre: string | null;
  recibio_nombre: string | null;
  created_at: string;
  lineas: number;
  cantidad_total: number;
}


// Solicitud de firma electrónica (tabla solicitudes_firma): hoy solo NDA.
export interface SolicitudFirma {
  id: string;
  personal_id: string;
  empresa_id: string;
  tipo: "nda";
  puesto: string | null;
  fecha_convenio: string;
  mensaje: string | null;
  estatus: "pendiente" | "firmado" | "cancelado";
  solicitado_por: string | null;
  solicitado_en: string;
  firmado_en: string | null;
  firma_nombre: string | null;
  firma_imagen: string | null;
  firma_dispositivo: string | null;
  cancelado_en: string | null;
  created_at: string;
}
