/** KPIs calculados POR EMPRESA en la base (fn_kpis_empresa / fn_socio_resumen).
 * Mismas claves que el catálogo de lib/indicadores.ts: la clave que exista en
 * este mapa se puede mostrar filtrada por empresa; la que no, solo a nivel
 * grupo. Módulo puro (sin supabase) para poder probarlo con node --test. */
export type KpisEmpresa = Record<string, number | null>;

export interface EmpresaSocio {
  id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
  kpis: KpisEmpresa;
}

export interface GrupoSocio {
  id: string;
  codigo: string;
  nombre: string;
  marca_comercial: string | null;
  es_maestro: boolean;
  activo: boolean;
  empresas: EmpresaSocio[];
}

export interface ResumenSocio {
  grupos: GrupoSocio[];
  calculado_en: string;
}

const CLAVES_DINERO = new Set(["fin_saldo_consolidado", "fin_pagos_semana"]);
const CLAVES_PORCENTAJE = new Set(["rh_asistencia_hoy"]);
const CLAVES_DIAS = new Set(["cont_dias_ultima_carga", "log_dias_entrega"]);

export function dineroMx(n: number): string {
  return n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
}

export function tieneKpiEmpresa(kpis: KpisEmpresa | undefined, clave: string): boolean {
  return !!kpis && Object.prototype.hasOwnProperty.call(kpis, clave);
}

/** Presenta el valor crudo de un KPI por empresa igual que lo haría el
 * indicador global (dinero, %, días o conteo). null = sin dato. */
export function formatearKpiEmpresa(clave: string, valor: number | null | undefined): { valor: string | number; detalle?: string } {
  if (valor === null || valor === undefined) return { valor: "—", detalle: "sin dato" };
  if (CLAVES_DINERO.has(clave)) return { valor: dineroMx(Number(valor)) };
  if (CLAVES_PORCENTAJE.has(clave)) return { valor: Number(valor), detalle: "% con entrada hoy" };
  if (CLAVES_DIAS.has(clave)) return { valor: Number(valor), detalle: "días" };
  return { valor: Number(valor) };
}

export function empresaDeResumen(resumen: ResumenSocio | undefined, empresaId: string | null | undefined): EmpresaSocio | undefined {
  if (!resumen || !empresaId) return undefined;
  for (const g of resumen.grupos) {
    const e = g.empresas.find((x) => x.id === empresaId);
    if (e) return e;
  }
  return undefined;
}

export function grupoDeEmpresa(resumen: ResumenSocio | undefined, empresaId: string | null | undefined): GrupoSocio | undefined {
  if (!resumen || !empresaId) return undefined;
  return resumen.grupos.find((g) => g.empresas.some((x) => x.id === empresaId));
}

/** Cifras de cabecera de la tarjeta de una empresa en la pantalla de socio. */
export interface CifraTarjeta {
  etiqueta: string;
  valor: string;
  alerta: boolean;
}

export function cifrasTarjeta(k: KpisEmpresa): CifraTarjeta[] {
  const n = (c: string) => Number(k[c] ?? 0);
  return [
    { etiqueta: "Saldo en bancos", valor: dineroMx(n("fin_saldo_consolidado")), alerta: n("fin_saldo_consolidado") < 0 },
    { etiqueta: "Pagos vencidos", valor: String(n("fin_pagos_vencidos")), alerta: n("fin_pagos_vencidos") > 0 },
    { etiqueta: "Por revisar (bancos)", valor: String(n("movimientos_revisar")), alerta: n("movimientos_revisar") > 0 },
    { etiqueta: "Personal activo", valor: String(n("rh_personal_activo")), alerta: false },
    { etiqueta: "OC a medias", valor: String(n("inventario_oc")), alerta: n("inventario_oc") > 0 },
    { etiqueta: "Proyectos activos", valor: String(n("op_proyectos_activos")), alerta: false },
  ];
}

/** Saldo sumado de todas las empresas de un grupo. */
export function saldoGrupo(g: GrupoSocio): number {
  return g.empresas.reduce((s, e) => s + Number(e.kpis.fin_saldo_consolidado ?? 0), 0);
}
