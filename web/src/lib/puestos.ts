// Puesto por persona dentro de un mismo rol (Mario, 6-oct-2026: "no existe
// rol de Belén que sea el de contabilidad"; "a Belén no le sirve ver la
// tesorería"). Belén y Delia son 'corporativo' (ven los mismos datos); el
// permiso por persona (permisos_modulo) dice qué inicio les toca:
// 'contabilidad' = acumulado, cargas, CFDI, Adquira; 'tesoreria' = pagos del día.
// Puro, sin DOM, con pruebas.

interface PerfilPuesto {
  rol: string;
  modulos?: string[] | null;
}

export function esContabilidad(p: PerfilPuesto | null | undefined): boolean {
  return !!p && (p.modulos ?? []).includes("contabilidad");
}

/** Tesorería en el inicio: dirección, admin o quien tenga el permiso. */
export function veTesoreriaEnInicio(p: PerfilPuesto | null | undefined): boolean {
  if (!p) return false;
  return p.rol === "direccion" || p.rol === "admin" || (p.modulos ?? []).includes("tesoreria");
}

/** Indicadores del inicio de contabilidad (lo que Mario dejó sin cruz el
 * 6-oct-2026, más los dos propios de contabilidad). */
export const INDICADORES_CONTABILIDAD: string[] = [
  "cont_cfdi_atrasados",
  "cont_adquira_semana",
  "fin_oc_por_autorizar",
  "fin_prestamos_abiertos",
  "movimientos_revisar",
  "fin_pagos_sin_comprobante",
  "legal_fechas_vencidas",
  "legal_documentos_vencidos",
  "legal_creditos_por_autorizar",
  "carga_sin_estado",
  "cont_sin_cfdi",
  "cont_dias_ultima_carga",
  "cont_cargas_error",
  "alm_movimientos_hoy",
  "bbva_folios",
  "mant_folios_viejos",
  "mant_folios_en_ejecucion",
  "mant_folios_atendidos_semana",
];

/** Lunes (ISO) de la semana de `hoy` (yyyy-mm-dd). */
export function lunesDeSemana(hoy: string): string {
  const [a, m, d] = hoy.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  const dow = (f.getUTCDay() + 6) % 7;
  f.setUTCDate(f.getUTCDate() - dow);
  return f.toISOString().slice(0, 10);
}

/** Días entre una fecha (yyyy-mm-dd…) y hoy; null sin fecha. */
export function diasDesde(fecha: string | null | undefined, hoy: string): number | null {
  if (!fecha) return null;
  const a = Date.UTC(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)) - 1, Number(fecha.slice(8, 10)));
  const b = Date.UTC(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)) - 1, Number(hoy.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}
