import { supabase } from "./supabase";
import { esRolBasico } from "./modulos";
import type { Profile } from "../types/database";

/** Indicadores del inicio por rol. Cada uno es una consulta ligera (conteo
 * o última fila) sobre vistas que RLS ya acota a lo que le toca a quien
 * consulta. `visible` decide quién lo ve; el resultado trae el valor y si
 * merece atención (alerta). */
export interface ResultadoIndicador {
  valor: string | number;
  detalle?: string;
  alerta?: boolean;
}

export interface Indicador {
  clave: string;
  etiqueta: string;
  ruta: string;
  visible: (p: Profile, ctx: { tienePersonal: boolean }) => boolean;
  consulta: (p: Profile) => Promise<ResultadoIndicador>;
}

const esAdmin = (p: Profile) => p.rol === "admin";
const veEquipo = (p: Profile) => p.rol === "supervisor" || p.rol === "directivo" || p.rol === "rh" || esAdmin(p) || !!p.bbva_mantenimiento;
const rh = (p: Profile) => p.rol === "rh" || esAdmin(p);
const produccion = (p: Profile) => p.rol === "produccion" || esAdmin(p) || (esRolBasico(p.rol) && (p.modulos ?? []).includes("produccion"));
const inventario = (p: Profile) =>
  ["almacen", "direccion", "corporativo", "empresa", "admin"].includes(p.rol) || (esRolBasico(p.rol) && (p.modulos ?? []).includes("inventario"));

function inicioDeHoy(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function enDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function contar(consulta: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
  const { count, error } = await consulta;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

const ETIQUETA_MARCA: Record<string, string> = { entrada: "Entrada", comida: "Comida", regreso: "Regreso", salida: "Salida" };

export const INDICADORES: Indicador[] = [
  {
    clave: "mi_asistencia",
    etiqueta: "Mi asistencia hoy",
    ruta: "/checador",
    visible: (_p, ctx) => ctx.tienePersonal,
    consulta: async (p) => {
      const { data, error } = await supabase
        .from("checador_registros")
        .select("tipo, created_at")
        .eq("profile_id", p.id)
        .gte("created_at", inicioDeHoy())
        .order("created_at", { ascending: false })
        .limit(1);
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
    visible: (p) => veEquipo(p),
    consulta: async () => {
      const { data, error } = await supabase.from("v_checador_marcas").select("profile_id").eq("tipo", "entrada").eq("anulada", false).gte("created_at", inicioDeHoy());
      if (error) throw error;
      const n = new Set((data ?? []).map((r) => r.profile_id)).size;
      return { valor: n, detalle: "personas con entrada marcada" };
    },
  },
  {
    clave: "rh_accesos",
    etiqueta: "Accesos por crear",
    ruta: "/rh",
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
    visible: rh,
    consulta: async () => {
      const n = await contar(supabase.from("contrataciones").select("*", { count: "exact", head: true }).eq("estatus", "vigente").lte("fecha_fin", enDias(15)).gte("fecha_fin", enDias(0)));
      return { valor: n, alerta: n > 0, detalle: "por renovar o dar de baja" };
    },
  },
  {
    clave: "produccion_ordenes",
    etiqueta: "Órdenes de producción abiertas",
    ruta: "/produccion/clavicon",
    visible: produccion,
    consulta: async () => {
      const n = await contar(supabase.from("ordenes_produccion").select("*", { count: "exact", head: true }).in("estado", ["planeada", "en_proceso"]));
      return { valor: n, detalle: "planeadas o en proceso" };
    },
  },
  {
    clave: "produccion_remisiones",
    etiqueta: "Remisiones de planta por confirmar",
    ruta: "/produccion/clavicon",
    visible: produccion,
    consulta: async () => {
      const n = await contar(supabase.from("remisiones_produccion").select("*", { count: "exact", head: true }).eq("estatus", "emitida"));
      return { valor: n, alerta: n > 0, detalle: "entregadas sin confirmar con el QR" };
    },
  },
  {
    clave: "inventario_remisiones",
    etiqueta: "Remisiones de salida por confirmar",
    ruta: "/inventario/remisiones",
    visible: inventario,
    consulta: async () => {
      const n = await contar(supabase.from("remisiones_salida").select("*", { count: "exact", head: true }).eq("estatus", "emitida"));
      return { valor: n, alerta: n > 0, detalle: "sin confirmar entrega" };
    },
  },
  {
    clave: "inventario_oc",
    etiqueta: "OC recibidas a medias",
    ruta: "/inventario/match",
    visible: inventario,
    consulta: async () => {
      const n = await contar(supabase.from("avance_recepcion_oc").select("*", { count: "exact", head: true }).eq("estado_recepcion", "parcial"));
      return { valor: n, alerta: n > 0, detalle: "el proveedor aún debe producto" };
    },
  },
];

// ---- Indicadores numéricos adicionales para los KPIs del organigrama ----
INDICADORES.push(
  {
    clave: "movimientos_revisar",
    etiqueta: "Movimientos por revisar",
    ruta: "/movimientos",
    visible: (p) => ["corporativo", "direccion", "empresa", "admin"].includes(p.rol),
    consulta: async () => {
      const { data, error } = await supabase.from("v_pendientes_por_empresa").select("ambiguos, duplicados, faltantes");
      if (error) throw error;
      const n = (data ?? []).reduce((s: number, f: Record<string, number>) => s + Number(f.ambiguos ?? 0) + Number(f.duplicados ?? 0) + Number(f.faltantes ?? 0), 0);
      return { valor: n, alerta: n > 0, detalle: "ambiguos, duplicados o sin factura" };
    },
  },
  {
    clave: "carga_sin_estado",
    etiqueta: "Empresas sin estado de cuenta",
    ruta: "/carga",
    visible: (p) => ["corporativo", "direccion", "empresa", "admin"].includes(p.rol),
    consulta: async () => {
      const n = await contar(supabase.from("v_estado_carga_empresa").select("*", { count: "exact", head: true }).is("ultima_carga_estado_cuenta", null));
      return { valor: n, alerta: n > 0, detalle: "sin carga del banco" };
    },
  },
  {
    clave: "rh_expedientes",
    etiqueta: "Documentos faltantes en expedientes",
    ruta: "/rh",
    visible: rh,
    consulta: async () => {
      const n = await contar(supabase.from("v_documentos_faltantes_personal").select("*", { count: "exact", head: true }));
      return { valor: n, alerta: n > 0, detalle: "documentos por entregar" };
    },
  },
  {
    clave: "bbva_folios",
    etiqueta: "Folios BBVA sin atender",
    ruta: "/bbva/folios",
    visible: (p) => ["supervisor_bbva", "corporativo", "direccion", "admin"].includes(p.rol) || !!p.bbva_mantenimiento,
    consulta: async () => {
      const n = await contar(supabase.from("bbva_folios_cuadrilla").select("*", { count: "exact", head: true }).neq("estatus", "atendido"));
      return { valor: n, alerta: n > 0, detalle: "folios abiertos" };
    },
  },
  {
    clave: "precios_pendientes",
    etiqueta: "PU esperando autorización",
    ruta: "/precios",
    visible: (p) => ["direccion", "admin", "corporativo"].includes(p.rol),
    consulta: async () => {
      const n = await contar(supabase.from("v_pu_analisis_costeo").select("*", { count: "exact", head: true }).in("estado", ["material_confirmado", "autorizado"]));
      return { valor: n, alerta: n > 0, detalle: "análisis por firmar o publicar" };
    },
  },
  {
    clave: "cuentas_pendientes",
    etiqueta: "Cuentas sin rol",
    ruta: "/admin",
    visible: esAdmin,
    consulta: async () => {
      const n = await contar(supabase.from("profiles").select("*", { count: "exact", head: true }).eq("rol", "pendiente"));
      return { valor: n, alerta: n > 0, detalle: "registradas solas, sin acceso" };
    },
  },
);

/** Indicadores con valor numérico: son los que pueden ir como punto de
 * color en el organigrama. */
export function indicadorPorClave(clave: string): Indicador | undefined {
  return INDICADORES.find((i) => i.clave === clave);
}

export const INDICADORES_NUMERICOS = () => INDICADORES.filter((i) => i.clave !== "mi_asistencia");

export function indicadoresPara(perfil: Profile | null | undefined, ctx: { tienePersonal: boolean }): Indicador[] {
  if (!perfil || perfil.rol === "pendiente") return [];
  return INDICADORES.filter((i) => i.visible(perfil, ctx));
}
