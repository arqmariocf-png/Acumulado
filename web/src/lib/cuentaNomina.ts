// Cuenta de nómina y financiamiento a trabajadores (18-oct-2026, Mario:
// "por antigüedad y por buen comportamiento y pago daremos financiamiento
// estilo Mercado Pago"). Estudio por persona: puntaje 0-100, nivel (como los
// niveles de Mercado Pago: la línea crece con antigüedad, buen
// comportamiento y pagos a tiempo) y línea sugerida dentro de la ley:
//   * LFT art. 111: sin intereses.
//   * LFT art. 110-I: la deuda no pasa del salario de un mes y cada descuento
//     no pasa del 30 % del excedente del salario mínimo.
// Los datos los da fn_estudio_financiamiento; los topes también se validan
// en la base (cuentas_nomina_antes y fn_nomina_crear_cargo).

export type NivelClave = "sin_acceso" | "bronce" | "plata" | "oro" | "diamante";

export interface Nivel {
  clave: NivelClave;
  nombre: string;
  icono: string;
  /** Puntaje mínimo para alcanzarlo. */
  minimo: number;
  /** Parte del tope legal (un mes de sueldo) que se presta. */
  pctTope: number;
  /** Plazo máximo en pagos semanales. */
  plazo: number;
  clase: string;
}

export const NIVELES: Nivel[] = [
  { clave: "sin_acceso", nombre: "Sin acceso", icono: "🔒", minimo: 0, pctTope: 0, plazo: 1, clase: "bg-slate-100 text-slate-500" },
  { clave: "bronce", nombre: "Bronce", icono: "🥉", minimo: 40, pctTope: 0.25, plazo: 2, clase: "bg-orange-100 text-orange-800" },
  { clave: "plata", nombre: "Plata", icono: "🥈", minimo: 55, pctTope: 0.5, plazo: 4, clase: "bg-slate-200 text-slate-800" },
  { clave: "oro", nombre: "Oro", icono: "🥇", minimo: 70, pctTope: 0.75, plazo: 8, clase: "bg-amber-100 text-amber-800" },
  { clave: "diamante", nombre: "Diamante", icono: "💎", minimo: 85, pctTope: 1, plazo: 12, clase: "bg-sky-100 text-sky-800" },
];

export function nivelPorClave(clave: string | null | undefined): Nivel {
  return NIVELES.find((n) => n.clave === clave) ?? NIVELES[0];
}

export interface ConfigFinanciamiento {
  salario_minimo_diario: number;
  pct_excedente: number;
  antiguedad_minima_meses: number;
}

export const CONFIG_LEY_2026: ConfigFinanciamiento = { salario_minimo_diario: 315.04, pct_excedente: 30, antiguedad_minima_meses: 3 };

/** Topes de ley con el sueldo semanal. */
export function topesLegales(sueldoSemanal: number | null | undefined, c: ConfigFinanciamiento = CONFIG_LEY_2026) {
  const s = Math.max(0, Number(sueldoSemanal) || 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    deudaMaxima: r2((s * 30) / 7),
    descuentoMaximo: r2((Math.max(s - c.salario_minimo_diario * 7, 0) * c.pct_excedente) / 100),
  };
}

export interface FactoresEstudio {
  meses_antiguedad: number;
  sueldo_semanal: number | null;
  checa: boolean;
  constancia_30: number | null;
  cumplimiento_30: number | null;
  activos_perdidos: number;
  herramienta_vencida: number;
  cargos_liquidados: number;
  cargos_liquidados_tarde: number;
  atraso: number;
}

export interface ParteDelPuntaje {
  clave: string;
  nombre: string;
  puntos: number;
  maximo: number;
  nota: string;
}

function puntosAntiguedad(meses: number): number {
  if (meses >= 24) return 30;
  if (meses >= 12) return 24;
  if (meses >= 6) return 18;
  if (meses >= 3) return 10;
  return 0;
}

/** Puntaje 0-100: antigüedad 30, puntualidad 15, cumplimiento 15, cuidado
 * de lo que se le presta 10, historial de pago 30. Sin dato = la mitad. */
export function puntaje(f: FactoresEstudio): { total: number; partes: ParteDelPuntaje[] } {
  const partes: ParteDelPuntaje[] = [];
  partes.push({ clave: "antiguedad", nombre: "Antigüedad", maximo: 30, puntos: puntosAntiguedad(f.meses_antiguedad), nota: `${f.meses_antiguedad} meses` });
  partes.push({
    clave: "puntualidad",
    nombre: "Asistencia",
    maximo: 15,
    puntos: f.checa && f.constancia_30 != null ? Math.round((f.constancia_30 / 100) * 15) : 7.5,
    nota: f.checa && f.constancia_30 != null ? `checó ${f.constancia_30}% de los días hábiles` : "no usa el checador: neutro",
  });
  partes.push({
    clave: "cumplimiento",
    nombre: "Cumplimiento de tareas",
    maximo: 15,
    puntos: f.cumplimiento_30 != null ? Math.round((f.cumplimiento_30 / 100) * 15) : 7.5,
    nota: f.cumplimiento_30 != null ? `${f.cumplimiento_30}% a tiempo` : "sin tareas con fecha: neutro",
  });
  const cuidado = Math.max(0, 10 - f.activos_perdidos * 5 - (f.herramienta_vencida > 0 ? 3 : 0));
  partes.push({
    clave: "cuidado",
    nombre: "Cuidado de herramienta y EPP",
    maximo: 10,
    puntos: cuidado,
    nota: f.activos_perdidos || f.herramienta_vencida ? `${f.activos_perdidos} perdido(s), ${f.herramienta_vencida} sin regresar` : "sin faltas",
  });
  const historial = f.atraso > 0 ? 0 : Math.min(30, 12 + f.cargos_liquidados * 6 - f.cargos_liquidados_tarde * 6);
  partes.push({
    clave: "pago",
    nombre: "Historial de pago",
    maximo: 30,
    puntos: Math.max(0, historial),
    nota: f.atraso > 0 ? "tiene descuentos atrasados" : f.cargos_liquidados ? `${f.cargos_liquidados} liquidado(s), ${f.cargos_liquidados_tarde} tarde` : "sin historial: empieza en 12",
  });
  return { total: Math.round(partes.reduce((s, p) => s + p.puntos, 0)), partes };
}

/** Lo que impide prestar aunque el puntaje alcance. */
export function bloqueos(f: FactoresEstudio, c: ConfigFinanciamiento = CONFIG_LEY_2026): string[] {
  const b: string[] = [];
  if (f.meses_antiguedad < c.antiguedad_minima_meses) b.push(`Menos de ${c.antiguedad_minima_meses} meses de antigüedad`);
  if (f.atraso > 0) b.push("Tiene descuentos atrasados");
  if (!f.sueldo_semanal) b.push("Falta el sueldo semanal");
  else if (topesLegales(f.sueldo_semanal, c).descuentoMaximo <= 0) b.push("Gana el mínimo: la ley no permite descontarle");
  return b;
}

export interface Dictamen {
  puntaje: number;
  partes: ParteDelPuntaje[];
  nivel: Nivel;
  bloqueos: string[];
  deudaMaxima: number;
  descuentoMaximo: number;
  lineaSugerida: number;
  plazo: number;
  /** Lo que le falta para el siguiente nivel. */
  siguiente: { nivel: Nivel; faltan: number } | null;
}

/** Línea = la parte del mes de sueldo que da su nivel, sin pasar de lo que
 * se puede descontar en su plazo; redondeada hacia abajo a $50. */
export function dictamen(f: FactoresEstudio, c: ConfigFinanciamiento = CONFIG_LEY_2026): Dictamen {
  const { total, partes } = puntaje(f);
  const b = bloqueos(f, c);
  let nivel = NIVELES[0];
  for (const n of NIVELES) if (total >= n.minimo) nivel = n;
  if (b.length) nivel = NIVELES[0];
  const t = topesLegales(f.sueldo_semanal, c);
  const linea = nivel.clave === "sin_acceso" ? 0 : Math.floor(Math.min(t.deudaMaxima * nivel.pctTope, t.descuentoMaximo * nivel.plazo) / 50) * 50;
  const idx = NIVELES.findIndex((n) => n.clave === (b.length ? "sin_acceso" : nivel.clave));
  const sig = NIVELES[idx + 1];
  return {
    puntaje: total,
    partes,
    nivel,
    bloqueos: b,
    deudaMaxima: t.deudaMaxima,
    descuentoMaximo: t.descuentoMaximo,
    lineaSugerida: linea,
    plazo: nivel.plazo,
    siguiente: sig ? { nivel: sig, faltan: Math.max(0, sig.minimo - total) } : null,
  };
}

/** Pagos para un monto: el mínimo de pagos que respeta el tope semanal. */
export function pagosMinimos(monto: number, descuentoMaximo: number): number {
  if (descuentoMaximo <= 0) return Infinity;
  return Math.max(1, Math.ceil(monto / descuentoMaximo - 1e-9));
}

export function descuentoPorPago(monto: number, pagos: number): number {
  return Math.ceil((monto / Math.max(1, pagos)) * 100) / 100;
}

/** Calendario de descuentos (viernes) para mostrar al trabajador. */
export function calendarioDescuentos(monto: number, pagos: number, primerViernes: string): { fecha: string; monto: number }[] {
  const por = descuentoPorPago(monto, pagos);
  const salida: { fecha: string; monto: number }[] = [];
  let resta = Math.round(monto * 100) / 100;
  const [a, m, d] = primerViernes.split("-").map(Number);
  for (let i = 0; i < pagos && resta > 0.004; i++) {
    const f = new Date(Date.UTC(a, m - 1, d + i * 7));
    const cuota = Math.min(por, Math.round(resta * 100) / 100);
    salida.push({ fecha: f.toISOString().slice(0, 10), monto: cuota });
    resta = Math.round((resta - cuota) * 100) / 100;
  }
  return salida;
}

/** El viernes de esta semana (o el siguiente si ya pasó). */
export function proximoViernes(hoy: string): string {
  const [a, m, d] = hoy.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  const dia = f.getUTCDay(); // 5 = viernes
  f.setUTCDate(f.getUTCDate() + ((5 - dia + 7) % 7));
  return f.toISOString().slice(0, 10);
}
