import { supabase } from "./supabase";
import { esRolBasico } from "./modulos";
import type { Profile } from "../types/database";

/** Catálogo de indicadores / KPIs. Cada uno es una consulta ligera sobre
 * vistas que RLS ya acota a quien consulta. Los KPIs del organigrama
 * (kpis_organigrama) apuntan a estas claves. Los marcados `enDesarrollo`
 * ya existen en el catálogo para configurarlos, pero todavía no se calculan
 * (punto gris "en desarrollo") -- se van implementando uno por uno. */
export interface ResultadoIndicador {
  valor: string | number;
  detalle?: string;
  alerta?: boolean;
}

export interface Indicador {
  clave: string;
  etiqueta: string;
  ruta: string;
  /** Área del organigrama a la que pertenece por defecto. */
  area?: string;
  /** Qué mide y cómo, en una línea (se ve en el configurador). */
  descripcion?: string;
  /** "mayor_es_peor" (default): ámbar/rojo cuando el valor SUBE de los
   * umbrales. "menor_es_peor": cuando BAJA de ellos (saldos, asistencia %). */
  direccion?: "mayor_es_peor" | "menor_es_peor";
  /** Solo informa (punto azul), no se califica. */
  informativo?: boolean;
  enDesarrollo?: boolean;
  visible: (p: Profile, ctx: { tienePersonal: boolean }) => boolean;
  consulta: (p: Profile) => Promise<ResultadoIndicador>;
}

const esAdmin = (p: Profile) => p.rol === "admin";
const finanzas = (p: Profile) => ["corporativo", "direccion", "admin"].includes(p.rol);
const contab = (p: Profile) => ["corporativo", "direccion", "empresa", "admin"].includes(p.rol);
const veEquipo = (p: Profile) => p.rol === "supervisor" || p.rol === "directivo" || p.rol === "rh" || esAdmin(p) || !!p.bbva_mantenimiento;
const rh = (p: Profile) => p.rol === "rh" || esAdmin(p);
const produccion = (p: Profile) => p.rol === "produccion" || esAdmin(p) || (esRolBasico(p.rol) && (p.modulos ?? []).includes("produccion"));
const inventario = (p: Profile) =>
  ["almacen", "direccion", "corporativo", "empresa", "admin"].includes(p.rol) || (esRolBasico(p.rol) && (p.modulos ?? []).includes("inventario"));
const bbva = (p: Profile) => ["supervisor_bbva", "corporativo", "direccion", "admin"].includes(p.rol) || !!p.bbva_mantenimiento;
const operacion = (p: Profile) => ["direccion", "admin", "corporativo", "empresa", "responsable"].includes(p.rol);

function inicioDeHoy(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function enDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function haceDiasIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function dinero(n: number): string {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

async function contar(consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

const pendiente = async (): Promise<ResultadoIndicador> => ({ valor: "—", detalle: "en desarrollo" });

const ETIQUETA_MARCA: Record<string, string> = { entrada: "Entrada", comida: "Comida", regreso: "Regreso", salida: "Salida" };

export const INDICADORES: Indicador[] = [
  // ------------------------------------------------------------ personales
  {
    clave: "mi_asistencia",
    etiqueta: "Mi asistencia hoy",
    ruta: "/checador",
    visible: (_p, ctx) => ctx.tienePersonal,
    consulta: async (p) => {
      const { data, error } = await supabase.from("checador_registros").select("tipo, created_at").eq("profile_id", p.id).gte("created_at", inicioDeHoy()).order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      const ultima = data?.[0];
      if (!ultima) return { valor: "Sin marcar", alerta: new Date().getHours() >= 9 };
      const hora = new Date(ultima.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
      return { valor: `${ETIQUETA_MARCA[String(ultima.tipo)] ?? ultima.tipo} ${hora}`, detalle: "última marca" };
    },
  },
  {
    clave: "firmas_pendientes",
    etiqueta: "Documentos por firmar",
    ruta: "/mis-documentos",
    visible: (_p, ctx) => ctx.tienePersonal,
    consulta: async () => {
      const n = await contar(supabase.from("solicitudes_firma").select("*", { count: "exact", head: true }).eq("estatus", "pendiente"));
      return { valor: n, alerta: n > 0, detalle: n === 0 ? "nada pendiente" : "te esperan" };
    },
  },
  {
    clave: "equipo_entradas",
    etiqueta: "Entradas de hoy (equipo)",
    ruta: "/bbva/asistencia",
    area: "rh",
    descripcion: "Personas del equipo con entrada marcada hoy.",
    informativo: true,
    visible: veEquipo,
    consulta: async () => {
      const { data, error } = await supabase.from("v_checador_marcas").select("profile_id").eq("tipo", "entrada").eq("anulada", false).gte("created_at", inicioDeHoy());
      if (error) throw error;
      return { valor: new Set((data ?? []).map((r) => r.profile_id)).size, detalle: "personas con entrada marcada" };
    },
  },

  // ------------------------------------------------------------ finanzas
  {
    clave: "fin_saldo_consolidado",
    etiqueta: "Saldo consolidado",
    ruta: "/finanzas/saldos",
    area: "finanzas",
    descripcion: "Suma del saldo de cierre de todas las cuentas bancarias activas.",
    direccion: "menor_es_peor",
    visible: finanzas,
    consulta: async () => {
      const { data, error } = await supabase.from("v_saldo_cierre_cuenta").select("saldo_cierre");
      if (error) throw error;
      const total = (data ?? []).reduce((s, r) => s + Number(r.saldo_cierre ?? 0), 0);
      return { valor: dinero(total), detalle: "cierre de todas las cuentas" };
    },
  },
  {
    clave: "fin_pagos_vencidos",
    etiqueta: "Pagos programados vencidos",
    ruta: "/finanzas/pagos",
    area: "finanzas",
    descripcion: "Pagos pendientes cuya fecha programada ya pasó.",
    visible: finanzas,
    consulta: async () => {
      const n = await contar(supabase.from("pagos_programados").select("*", { count: "exact", head: true }).eq("estatus", "pendiente").lt("fecha_programada", hoyIso()));
      return { valor: n, alerta: n > 0, detalle: "sin pagar después de su fecha" };
    },
  },
  {
    clave: "fin_pagos_semana",
    etiqueta: "Pagos de los próximos 7 días",
    ruta: "/finanzas/pagos",
    area: "finanzas",
    descripcion: "Monto pendiente programado para los próximos 7 días.",
    informativo: true,
    visible: finanzas,
    consulta: async () => {
      const { data, error } = await supabase.from("pagos_programados").select("monto").eq("estatus", "pendiente").gte("fecha_programada", hoyIso()).lte("fecha_programada", enDias(7));
      if (error) throw error;
      const total = (data ?? []).reduce((s, r) => s + Number(r.monto ?? 0), 0);
      return { valor: dinero(total), detalle: `${(data ?? []).length} pago(s)` };
    },
  },
  {
    clave: "fin_saldos_desactualizados",
    etiqueta: "Cuentas sin movimientos en 7 días",
    ruta: "/carga",
    area: "finanzas",
    descripcion: "Cuentas cuyo último movimiento cargado tiene más de 7 días (falta estado de cuenta).",
    visible: finanzas,
    consulta: async () => {
      const n = await contar(supabase.from("v_saldo_cierre_cuenta").select("*", { count: "exact", head: true }).lt("fecha_ultimo_movimiento", enDias(-7)));
      return { valor: n, alerta: n > 0, detalle: "posible carga atrasada" };
    },
  },
  {
    clave: "fin_prestamos_abiertos",
    etiqueta: "Préstamos intercompañía con saldo",
    ruta: "/prestamos-intercompania",
    area: "finanzas",
    descripcion: "Pares de empresas con préstamo sin liquidar.",
    visible: finanzas,
    consulta: async () => {
      const { data, error } = await supabase.from("v_prestamos_intercompania").select("monto");
      if (error) throw error;
      const n = (data ?? []).filter((r) => Math.abs(Number(r.monto ?? 0)) > 0.01).length;
      return { valor: n, alerta: n > 0, detalle: "sin liquidar" };
    },
  },
  {
    clave: "movimientos_revisar",
    etiqueta: "Movimientos por revisar",
    ruta: "/movimientos",
    area: "contabilidad",
    descripcion: "Movimientos bancarios ambiguos, duplicados o sin factura.",
    visible: contab,
    consulta: async () => {
      const { data, error } = await supabase.from("v_pendientes_por_empresa").select("ambiguos, duplicados, faltantes");
      if (error) throw error;
      const n = (data ?? []).reduce((s: number, f: Record<string, number>) => s + Number(f.ambiguos ?? 0) + Number(f.duplicados ?? 0) + Number(f.faltantes ?? 0), 0);
      return { valor: n, alerta: n > 0, detalle: "ambiguos, duplicados o sin factura" };
    },
  },
  {
    clave: "fin_comprobaciones_por_revisar",
    etiqueta: "Comprobaciones de gasto por revisar",
    ruta: "/gastos",
    area: "finanzas",
    descripcion: "Facturas/notas de caja chica enviadas por supervisores que finanzas no ha aprobado ni rechazado.",
    visible: finanzas,
    consulta: async () => {
      const n = await contar(supabase.from("comprobaciones_gasto").select("*", { count: "exact", head: true }).eq("estatus", "enviada"));
      return { valor: n, alerta: n > 0, detalle: "esperan aprobación" };
    },
  },
  {
    clave: "mis_comprobaciones",
    etiqueta: "Mis comprobaciones en revisión",
    ruta: "/gastos",
    descripcion: "Gastos que enviaste y finanzas aún no resuelve.",
    informativo: true,
    visible: (p) => ["supervisor", "responsable", "directivo", "administrativo"].includes(p.rol),
    consulta: async (p) => {
      const n = await contar(supabase.from("comprobaciones_gasto").select("*", { count: "exact", head: true }).eq("supervisor_id", p.id).eq("estatus", "enviada"));
      return { valor: n, detalle: n === 0 ? "nada pendiente" : "en revisión" };
    },
  },
  { clave: "fin_flujo_30d", etiqueta: "Flujo de caja a 30 días", ruta: "/finanzas/saldos", area: "finanzas", descripcion: "Saldos + cobros esperados − pagos programados en 30 días.", direccion: "menor_es_peor", enDesarrollo: true, visible: finanzas, consulta: pendiente },

  // ------------------------------------------------------------ contabilidad
  {
    clave: "carga_sin_estado",
    etiqueta: "Empresas sin estado de cuenta",
    ruta: "/carga",
    area: "contabilidad",
    descripcion: "Empresas que nunca han cargado un estado de cuenta.",
    visible: contab,
    consulta: async () => {
      const n = await contar(supabase.from("v_estado_carga_empresa").select("*", { count: "exact", head: true }).is("ultima_carga_estado_cuenta", null));
      return { valor: n, alerta: n > 0, detalle: "sin carga del banco" };
    },
  },
  {
    clave: "cont_sin_cfdi",
    etiqueta: "Movimientos sin factura",
    ruta: "/movimientos",
    area: "contabilidad",
    descripcion: "Movimientos bancarios que no tienen CFDI relacionado.",
    visible: contab,
    consulta: async () => {
      const { data, error } = await supabase.from("v_pendientes_por_empresa").select("faltantes");
      if (error) throw error;
      const n = (data ?? []).reduce((s, f) => s + Number(f.faltantes ?? 0), 0);
      return { valor: n, alerta: n > 0, detalle: "sin CFDI" };
    },
  },
  {
    clave: "cont_dias_ultima_carga",
    etiqueta: "Días desde la última carga",
    ruta: "/carga",
    area: "contabilidad",
    descripcion: "Días transcurridos desde la última carga completada (banco o CFDI).",
    visible: contab,
    consulta: async () => {
      const { data, error } = await supabase.from("archivos_cargados").select("completed_at").eq("estado", "completado").order("completed_at", { ascending: false }).limit(1);
      if (error) throw error;
      const ultima = data?.[0]?.completed_at;
      if (!ultima) return { valor: "—", detalle: "sin cargas" };
      const dias = Math.floor((Date.now() - new Date(ultima).getTime()) / 86_400_000);
      return { valor: dias, alerta: dias > 7, detalle: new Date(ultima).toLocaleDateString("es-MX") };
    },
  },
  {
    clave: "cont_cargas_error",
    etiqueta: "Cargas con error (30 días)",
    ruta: "/carga",
    area: "contabilidad",
    descripcion: "Archivos que fallaron al procesarse en los últimos 30 días.",
    visible: contab,
    consulta: async () => {
      const n = await contar(supabase.from("archivos_cargados").select("*", { count: "exact", head: true }).eq("estado", "error").gte("created_at", haceDiasIso(30)));
      return { valor: n, alerta: n > 0, detalle: "por volver a cargar" };
    },
  },
  { clave: "cont_cfdi_sin_banco", etiqueta: "CFDI sin movimiento bancario", ruta: "/movimientos", area: "contabilidad", descripcion: "Facturas recibidas que no tienen pago identificado en bancos.", enDesarrollo: true, visible: contab, consulta: pendiente },
  { clave: "cont_conciliacion_pct", etiqueta: "% conciliado del mes", ruta: "/movimientos", area: "contabilidad", descripcion: "Movimientos del mes con CFDI o regla, sobre el total.", direccion: "menor_es_peor", enDesarrollo: true, visible: contab, consulta: pendiente },

  // ------------------------------------------------------------ recursos humanos
  {
    clave: "rh_asistencia_hoy",
    etiqueta: "% de asistencia hoy",
    ruta: "/rh",
    area: "rh",
    descripcion: "Personas con cuenta que marcaron entrada hoy, sobre el personal activo con cuenta.",
    direccion: "menor_es_peor",
    visible: rh,
    consulta: async () => {
      const [{ data: marcas, error: e1 }, total] = await Promise.all([
        supabase.from("v_checador_marcas").select("profile_id").eq("tipo", "entrada").eq("anulada", false).gte("created_at", inicioDeHoy()),
        contar(supabase.from("v_personal_con_cuenta").select("*", { count: "exact", head: true })),
      ]);
      if (e1) throw e1;
      const con = new Set((marcas ?? []).map((r) => r.profile_id)).size;
      const pct = total > 0 ? Math.round((con / total) * 100) : 0;
      return { valor: pct, alerta: pct < 80, detalle: `${con} de ${total} con entrada` };
    },
  },
  {
    clave: "rh_accesos",
    etiqueta: "Accesos por crear",
    ruta: "/rh",
    area: "rh",
    descripcion: "Personal con INE, CURP y comprobante de domicilio pero sin cuenta.",
    visible: rh,
    consulta: async () => {
      const n = await contar(supabase.from("v_personal_accesos").select("*", { count: "exact", head: true }).eq("activo", true).is("profile_id", null).gte("docs_indispensables", 3));
      return { valor: n, alerta: n > 0, detalle: "expediente completo sin cuenta" };
    },
  },
  {
    clave: "rh_contratos",
    etiqueta: "Contratos que vencen en 15 días",
    ruta: "/rh",
    area: "rh",
    descripcion: "Contrataciones vigentes con fecha de fin en los próximos 15 días.",
    visible: rh,
    consulta: async () => {
      const n = await contar(supabase.from("contrataciones").select("*", { count: "exact", head: true }).eq("estatus", "vigente").lte("fecha_fin", enDias(15)).gte("fecha_fin", hoyIso()));
      return { valor: n, alerta: n > 0, detalle: "por renovar o dar de baja" };
    },
  },
  {
    clave: "rh_expedientes",
    etiqueta: "Documentos faltantes en expedientes",
    ruta: "/rh",
    area: "rh",
    descripcion: "Documentos obligatorios que faltan o vencieron, sumando todo el personal activo.",
    visible: rh,
    consulta: async () => {
      const n = await contar(supabase.from("v_documentos_faltantes_personal").select("*", { count: "exact", head: true }));
      return { valor: n, alerta: n > 0, detalle: "documentos por entregar" };
    },
  },
  {
    clave: "rh_vacantes",
    etiqueta: "Vacantes abiertas",
    ruta: "/rh",
    area: "rh",
    descripcion: "Vacantes en estatus abierta.",
    visible: rh,
    consulta: async () => {
      const n = await contar(supabase.from("vacantes").select("*", { count: "exact", head: true }).eq("estatus", "abierta"));
      return { valor: n, alerta: n > 0, detalle: "por cubrir" };
    },
  },
  {
    clave: "rh_rotacion_mes",
    etiqueta: "Rotación del mes (%)",
    ruta: "/rh",
    area: "rh",
    descripcion: "Bajas del mes sobre la plantilla inicial, según v_rotacion_mensual.",
    visible: rh,
    consulta: async () => {
      const { data, error } = await supabase.from("v_rotacion_mensual").select("mes, bajas, rotacion_pct").order("mes", { ascending: false }).limit(1);
      if (error) throw error;
      const f = data?.[0];
      if (!f) return { valor: 0, detalle: "sin datos" };
      const pct = Number(f.rotacion_pct ?? 0);
      return { valor: Math.round(pct * 10) / 10, alerta: pct >= 5, detalle: `${f.bajas} baja(s) en ${String(f.mes).slice(0, 7)}` };
    },
  },
  {
    clave: "rh_firmas_pendientes",
    etiqueta: "Convenios NDA sin firmar",
    ruta: "/rh",
    area: "rh",
    descripcion: "Solicitudes de firma enviadas al personal que siguen pendientes.",
    visible: rh,
    consulta: async () => {
      const n = await contar(supabase.from("solicitudes_firma").select("*", { count: "exact", head: true }).eq("estatus", "pendiente"));
      return { valor: n, alerta: n > 0, detalle: "esperando firma" };
    },
  },
  { clave: "rh_retardos_semana", etiqueta: "Retardos de la semana", ruta: "/rh", area: "rh", descripcion: "Entradas después de la hora del perfil de jornada, en la semana en curso.", enDesarrollo: true, visible: rh, consulta: pendiente },
  { clave: "rh_horas_extra_semana", etiqueta: "Horas extra de la semana", ruta: "/rh", area: "rh", descripcion: "Horas por arriba de la jornada del perfil, según el checador.", enDesarrollo: true, visible: rh, consulta: pendiente },

  // ------------------------------------------------------------ almacén
  {
    clave: "inventario_oc",
    etiqueta: "OC recibidas a medias",
    ruta: "/inventario/match",
    area: "almacen",
    descripcion: "Órdenes de compra con recepción parcial.",
    visible: inventario,
    consulta: async () => {
      const n = await contar(supabase.from("avance_recepcion_oc").select("*", { count: "exact", head: true }).eq("estado_recepcion", "parcial"));
      return { valor: n, alerta: n > 0, detalle: "el proveedor aún debe producto" };
    },
  },
  {
    clave: "alm_partidas_faltantes",
    etiqueta: "Partidas con faltante",
    ruta: "/inventario/match",
    area: "almacen",
    descripcion: "Partidas de OC recibidas parcialmente: el proveedor debe producto.",
    visible: inventario,
    consulta: async () => {
      const n = await contar(supabase.from("v_oc_lineas_avance").select("*", { count: "exact", head: true }).eq("estado", "parcial"));
      return { valor: n, alerta: n > 0, detalle: "partidas por completar" };
    },
  },
  {
    clave: "alm_partidas_excedente",
    etiqueta: "Partidas con excedente",
    ruta: "/inventario/match",
    area: "almacen",
    descripcion: "Partidas donde se recibió más de lo pedido: ajuste o reclamación.",
    visible: inventario,
    consulta: async () => {
      const n = await contar(supabase.from("v_oc_lineas_avance").select("*", { count: "exact", head: true }).eq("estado", "excedido"));
      return { valor: n, alerta: n > 0, detalle: "ajuste o reclamación pendiente" };
    },
  },
  {
    clave: "alm_entradas_sin_oc",
    etiqueta: "Entradas sin OC",
    ruta: "/inventario",
    area: "almacen",
    descripcion: "Entradas de almacén guardadas sin orden de compra vinculada (no ajustes).",
    visible: inventario,
    consulta: async () => {
      const n = await contar(supabase.from("movimientos_inventario").select("*", { count: "exact", head: true }).eq("tipo", "entrada").eq("es_ajuste", false).is("orden_compra_id", null));
      return { valor: n, alerta: n > 0, detalle: "pendientes de vincular" };
    },
  },
  {
    clave: "alm_productos_sin_costo",
    etiqueta: "Productos sin costo",
    ruta: "/inventario/productos",
    area: "almacen",
    descripcion: "Productos activos sin costo de referencia.",
    visible: inventario,
    consulta: async () => {
      const n = await contar(supabase.from("productos").select("*", { count: "exact", head: true }).eq("activo", true).is("costo_referencia", null));
      return { valor: n, alerta: n > 0, detalle: "sin costo de referencia" };
    },
  },
  {
    clave: "alm_movimientos_hoy",
    etiqueta: "Movimientos de hoy",
    ruta: "/inventario",
    area: "almacen",
    descripcion: "Entradas y salidas registradas hoy.",
    informativo: true,
    visible: inventario,
    consulta: async () => {
      const n = await contar(supabase.from("movimientos_inventario").select("*", { count: "exact", head: true }).gte("created_at", inicioDeHoy()));
      return { valor: n, detalle: "registrados hoy" };
    },
  },
  { clave: "alm_valor_inventario", etiqueta: "Valor del inventario", ruta: "/inventario/existencias", area: "almacen", descripcion: "Existencias por su costo de referencia.", informativo: true, enDesarrollo: true, visible: inventario, consulta: pendiente },

  // ------------------------------------------------------------ logística
  {
    clave: "inventario_remisiones",
    etiqueta: "Remisiones de salida por confirmar",
    ruta: "/inventario/remisiones",
    area: "logistica",
    descripcion: "Remisiones emitidas que nadie ha confirmado con el QR.",
    visible: inventario,
    consulta: async () => {
      const n = await contar(supabase.from("remisiones_salida").select("*", { count: "exact", head: true }).eq("estatus", "emitida"));
      return { valor: n, alerta: n > 0, detalle: "sin confirmar entrega" };
    },
  },
  {
    clave: "produccion_remisiones",
    etiqueta: "Remisiones de planta por confirmar",
    ruta: "/produccion/clavicon",
    area: "logistica",
    descripcion: "Remisiones de Clavicón/Balken/Carpintería emitidas sin confirmación.",
    visible: (p) => produccion(p) || inventario(p),
    consulta: async () => {
      const n = await contar(supabase.from("remisiones_produccion").select("*", { count: "exact", head: true }).eq("estatus", "emitida"));
      return { valor: n, alerta: n > 0, detalle: "entregadas sin confirmar con el QR" };
    },
  },
  {
    clave: "log_ov_parciales",
    etiqueta: "OV con embarque parcial",
    ruta: "/inventario/match",
    area: "logistica",
    descripcion: "Órdenes de venta embarcadas a medias.",
    visible: inventario,
    consulta: async () => {
      const n = await contar(supabase.from("avance_embarque_ov").select("*", { count: "exact", head: true }).eq("estado_embarque", "parcial"));
      return { valor: n, alerta: n > 0, detalle: "falta por embarcar" };
    },
  },
  {
    clave: "log_requisiciones",
    etiqueta: "Renglones de requisición sin resolver",
    ruta: "/requisiciones",
    area: "logistica",
    descripcion: "Renglones pedidos por obra que compras no ha resuelto.",
    visible: (p) => operacion(p) || inventario(p),
    consulta: async () => {
      const n = await contar(supabase.from("avance_resolucion_linea").select("*", { count: "exact", head: true }).gt("cantidad_sin_resolver", 0));
      return { valor: n, alerta: n > 0, detalle: "por comprar o entregar" };
    },
  },
  {
    clave: "log_dias_entrega",
    etiqueta: "Días promedio para confirmar entrega",
    ruta: "/inventario/remisiones",
    area: "logistica",
    descripcion: "Promedio de días entre emitir una remisión y confirmarla (últimos 30 días).",
    visible: inventario,
    consulta: async () => {
      const { data, error } = await supabase.from("remisiones_salida").select("created_at, entregada_en").eq("estatus", "entregada").gte("created_at", haceDiasIso(30));
      if (error) throw error;
      const dias = (data ?? []).filter((r) => r.entregada_en).map((r) => (new Date(r.entregada_en).getTime() - new Date(r.created_at).getTime()) / 86_400_000);
      if (dias.length === 0) return { valor: 0, detalle: "sin entregas confirmadas en 30 días" };
      const prom = Math.round((dias.reduce((s, d) => s + d, 0) / dias.length) * 10) / 10;
      return { valor: prom, alerta: prom > 2, detalle: `${dias.length} entrega(s)` };
    },
  },
  {
    clave: "log_remisiones_semana",
    etiqueta: "Remisiones emitidas esta semana",
    ruta: "/inventario/remisiones",
    area: "logistica",
    descripcion: "Remisiones de salida emitidas en los últimos 7 días.",
    informativo: true,
    visible: inventario,
    consulta: async () => {
      const n = await contar(supabase.from("remisiones_salida").select("*", { count: "exact", head: true }).gte("created_at", haceDiasIso(7)));
      return { valor: n, detalle: "últimos 7 días" };
    },
  },
  { clave: "log_entregas_a_tiempo", etiqueta: "% entregas a tiempo", ruta: "/inventario/remisiones", area: "logistica", descripcion: "Entregas confirmadas antes de la fecha comprometida con el cliente.", direccion: "menor_es_peor", enDesarrollo: true, visible: inventario, consulta: pendiente },

  // ------------------------------------------------------------ mantenimiento
  {
    clave: "bbva_folios",
    etiqueta: "Folios BBVA sin atender",
    ruta: "/bbva/folios",
    area: "mantenimiento",
    descripcion: "Folios en estatus pendiente o en ejecución.",
    visible: bbva,
    consulta: async () => {
      const n = await contar(supabase.from("bbva_folios_cuadrilla").select("*", { count: "exact", head: true }).neq("estatus", "atendido"));
      return { valor: n, alerta: n > 0, detalle: "folios abiertos" };
    },
  },
  {
    clave: "mant_folios_viejos",
    etiqueta: "Folios abiertos más de 7 días",
    ruta: "/bbva/folios",
    area: "mantenimiento",
    descripcion: "Folios sin atender creados hace más de 7 días.",
    visible: bbva,
    consulta: async () => {
      const n = await contar(supabase.from("bbva_folios_cuadrilla").select("*", { count: "exact", head: true }).neq("estatus", "atendido").lt("creado_en", haceDiasIso(7)));
      return { valor: n, alerta: n > 0, detalle: "atrasados" };
    },
  },
  {
    clave: "mant_folios_en_ejecucion",
    etiqueta: "Folios en ejecución",
    ruta: "/bbva/folios",
    area: "mantenimiento",
    descripcion: "Folios que la cuadrilla ya está atendiendo.",
    informativo: true,
    visible: bbva,
    consulta: async () => {
      const n = await contar(supabase.from("bbva_folios_cuadrilla").select("*", { count: "exact", head: true }).eq("estatus", "en_ejecucion"));
      return { valor: n, detalle: "en curso" };
    },
  },
  {
    clave: "mant_folios_atendidos_semana",
    etiqueta: "Folios atendidos (7 días)",
    ruta: "/bbva/folios",
    area: "mantenimiento",
    descripcion: "Folios cerrados en los últimos 7 días.",
    informativo: true,
    visible: bbva,
    consulta: async () => {
      const n = await contar(supabase.from("bbva_folios_cuadrilla").select("*", { count: "exact", head: true }).eq("estatus", "atendido").gte("atendido_en", haceDiasIso(7)));
      return { valor: n, detalle: "cerrados esta semana" };
    },
  },
  { clave: "mant_asistencia_bbva", etiqueta: "Asistencia de la cuadrilla hoy", ruta: "/bbva/asistencia", area: "mantenimiento", descripcion: "Personal del área BBVA con entrada marcada hoy, sobre el total del área.", direccion: "menor_es_peor", enDesarrollo: true, visible: bbva, consulta: pendiente },
  { clave: "mant_equilibrio_mes", etiqueta: "% del gasto cubierto (mes)", ruta: "/bbva/equilibrio", area: "mantenimiento", descripcion: "Folios cobrados del mes sobre el gasto del equipo.", direccion: "menor_es_peor", enDesarrollo: true, visible: bbva, consulta: pendiente },

  // ------------------------------------------------------------ operación
  {
    clave: "produccion_ordenes",
    etiqueta: "Órdenes de producción abiertas",
    ruta: "/produccion/clavicon",
    area: "operacion",
    descripcion: "Órdenes planeadas o en proceso en las plantas.",
    visible: produccion,
    consulta: async () => {
      const n = await contar(supabase.from("ordenes_produccion").select("*", { count: "exact", head: true }).in("estado", ["planeada", "en_proceso"]));
      return { valor: n, detalle: "planeadas o en proceso" };
    },
  },
  {
    clave: "op_ordenes_atrasadas",
    etiqueta: "Órdenes con embarque vencido",
    ruta: "/produccion/clavicon",
    area: "operacion",
    descripcion: "Órdenes abiertas cuya fecha estimada de embarque ya pasó.",
    visible: produccion,
    consulta: async () => {
      const n = await contar(supabase.from("ordenes_produccion").select("*", { count: "exact", head: true }).in("estado", ["planeada", "en_proceso"]).lt("fecha_estimada_embarque", hoyIso()));
      return { valor: n, alerta: n > 0, detalle: "embarque atrasado" };
    },
  },
  {
    clave: "op_operaciones_retrasadas",
    etiqueta: "Operaciones de máquina retrasadas",
    ruta: "/produccion/clavicon",
    area: "operacion",
    descripcion: "Pasos programados cuyo fin ya pasó y siguen sin terminar.",
    visible: produccion,
    consulta: async () => {
      const n = await contar(supabase.from("operaciones_programadas").select("*", { count: "exact", head: true }).in("estado", ["programada", "en_proceso"]).lt("fin_programado", new Date().toISOString()));
      return { valor: n, alerta: n > 0, detalle: "fuera de calendario" };
    },
  },
  {
    clave: "precios_pendientes",
    etiqueta: "PU esperando autorización",
    ruta: "/precios",
    area: "operacion",
    descripcion: "Análisis con material confirmado o autorizados, pendientes de firma o publicación.",
    visible: (p) => ["direccion", "admin", "corporativo"].includes(p.rol),
    consulta: async () => {
      const n = await contar(supabase.from("v_pu_analisis_costeo").select("*", { count: "exact", head: true }).in("estado", ["material_confirmado", "autorizado"]));
      return { valor: n, alerta: n > 0, detalle: "análisis por firmar o publicar" };
    },
  },
  {
    clave: "op_pu_borrador_viejos",
    etiqueta: "PU en borrador más de 7 días",
    ruta: "/precios",
    area: "operacion",
    descripcion: "Análisis que llevan más de una semana sin moverse del borrador.",
    visible: operacion,
    consulta: async () => {
      const n = await contar(supabase.from("v_pu_analisis_costeo").select("*", { count: "exact", head: true }).eq("estado", "borrador").lt("updated_at", haceDiasIso(7)));
      return { valor: n, alerta: n > 0, detalle: "estancados" };
    },
  },
  {
    clave: "op_tareas_vencidas",
    etiqueta: "Tareas vencidas",
    ruta: "/tareas",
    area: "operacion",
    descripcion: "Tarjetas activas con fecha límite pasada (aunque estén en la última columna).",
    visible: operacion,
    consulta: async () => {
      const n = await contar(supabase.from("tarjetas").select("*", { count: "exact", head: true }).eq("archivada", false).lt("fecha_limite", hoyIso()));
      return { valor: n, alerta: n > 0, detalle: "con fecha límite pasada" };
    },
  },
  {
    clave: "op_proyectos_activos",
    etiqueta: "Proyectos activos",
    ruta: "/proyectos",
    area: "operacion",
    descripcion: "Obras y proyectos activos en el grupo.",
    informativo: true,
    visible: operacion,
    consulta: async () => {
      const n = await contar(supabase.from("proyectos").select("*", { count: "exact", head: true }).eq("activo", true));
      return { valor: n, detalle: "en curso" };
    },
  },
  { clave: "op_cumplimiento_produccion", etiqueta: "% cumplimiento de producción (semana)", ruta: "/produccion/clavicon", area: "operacion", descripcion: "Cantidad producida sobre la planeada en las órdenes de la semana.", direccion: "menor_es_peor", enDesarrollo: true, visible: produccion, consulta: pendiente },
  { clave: "op_eficiencia_maquinas", etiqueta: "Eficiencia de máquinas (%)", ruta: "/produccion/clavicon", area: "operacion", descripcion: "Minutos programados sobre minutos reales por equipo (con cámaras, tiempo real).", direccion: "menor_es_peor", enDesarrollo: true, visible: produccion, consulta: pendiente },

  // ------------------------------------------------------------ sistemas
  {
    clave: "cuentas_pendientes",
    etiqueta: "Cuentas sin rol",
    ruta: "/admin",
    area: "sistemas",
    descripcion: "Cuentas que se registraron solas y siguen en 'pendiente' (sin acceso).",
    visible: esAdmin,
    consulta: async () => {
      const n = await contar(supabase.from("profiles").select("*", { count: "exact", head: true }).eq("rol", "pendiente"));
      return { valor: n, alerta: n > 0, detalle: "registradas solas, sin acceso" };
    },
  },
  {
    clave: "sis_usuarios_activos_7d",
    etiqueta: "Usuarios activos (7 días)",
    ruta: "/admin",
    area: "sistemas",
    descripcion: "Personas distintas con alguna marca de checador en la última semana.",
    informativo: true,
    visible: esAdmin,
    consulta: async () => {
      const { data, error } = await supabase.from("v_checador_marcas").select("profile_id").gte("created_at", haceDiasIso(7));
      if (error) throw error;
      return { valor: new Set((data ?? []).map((r) => r.profile_id)).size, detalle: "con marcas esta semana" };
    },
  },
  {
    clave: "sis_sync_horas",
    etiqueta: "Horas desde la última sincronización OC/OV",
    ruta: "/carga",
    area: "sistemas",
    descripcion: "Tiempo desde la última OC/OV traída del backoffice (debe ser < 2 h).",
    visible: esAdmin,
    consulta: async () => {
      const { data, error } = await supabase.from("ordenes_compra").select("created_at").eq("fuente", "api").order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      const ultima = data?.[0]?.created_at;
      if (!ultima) return { valor: "—", detalle: "sin sincronizaciones" };
      const horas = Math.round((Date.now() - new Date(ultima).getTime()) / 3_600_000);
      return { valor: horas, alerta: horas > 24, detalle: "última OC nueva del backoffice" };
    },
  },
  {
    clave: "sis_fotos_error_7d",
    etiqueta: "Fotos con error de lectura (7 días)",
    ruta: "/inventario",
    area: "sistemas",
    descripcion: "Notas de entrega cuya lectura por IA falló en la última semana.",
    visible: esAdmin,
    consulta: async () => {
      const { data, error } = await supabase.from("notas_entrega").select("texto_extraido").gte("created_at", haceDiasIso(7));
      if (error) throw error;
      const n = (data ?? []).filter((r) => (r.texto_extraido as { error?: string | null } | null)?.error).length;
      return { valor: n, alerta: n > 0, detalle: "revisar ANTHROPIC_API_KEY" };
    },
  },
  { clave: "sis_accesos_sin_uso", etiqueta: "Cuentas creadas sin primer ingreso", ruta: "/admin", area: "sistemas", descripcion: "Accesos generados que nunca han iniciado sesión.", enDesarrollo: true, visible: esAdmin, consulta: pendiente },
  { clave: "sis_errores_app", etiqueta: "Errores reportados por la app (7 días)", ruta: "/admin", area: "sistemas", descripcion: "Fallas capturadas en el navegador de los usuarios.", enDesarrollo: true, visible: esAdmin, consulta: pendiente },
];

export function indicadorPorClave(clave: string): Indicador | undefined {
  return INDICADORES.find((i) => i.clave === clave);
}

/** Indicadores que pueden ir como punto de color en el organigrama. */
export const INDICADORES_NUMERICOS = () => INDICADORES.filter((i) => !["mi_asistencia", "firmas_pendientes", "mis_comprobaciones"].includes(i.clave));

export function indicadoresPara(perfil: Profile | null | undefined, ctx: { tienePersonal: boolean }): Indicador[] {
  if (!perfil || perfil.rol === "pendiente") return [];
  // En el inicio solo los ya calculables; los "en desarrollo" viven en el organigrama.
  return INDICADORES.filter((i) => !i.enDesarrollo && i.visible(perfil, ctx));
}
