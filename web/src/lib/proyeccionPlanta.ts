// Proyección anual de una planta para el director general (Mario,
// 10-oct-2026: "proyección anual con la programación actual, quitando
// semanas y días de vacaciones del personal, y estimados de venta /
// producción y utilidad anual"). Todo sin IVA.
//
// Doce meses desde hoy. Por mes:
//   días productivos = hábiles (lun-sáb) − festivos de ley − cierre de planta
//                      − vacaciones del personal en días-planta equivalentes
//   piezas = lo programado en lotes (repartido en sus días hábiles) + los
//            días productivos libres × piezas por día
//   ventas = piezas × % que se vende × precio
//   utilidad = ventas − materia prima de lo vendido − nómina completa del
//              mes (se paga aunque haya vacaciones o festivos) − indirectos

export interface LoteProyeccion {
  folio: string;
  estado: string;
  inicio: string;
  fin: string | null;
  dias: number | null;
  cantidad: number;
}

export interface PersonaProyeccion {
  nombre: string;
  pago_semanal: number;
  ingreso: string | null;
}

export interface SupuestosProyeccion {
  /** Primer día de la proyección (YYYY-MM-DD). */
  desde: string;
  precioVenta: number;
  /** % de lo producido que se vende (0-100). */
  pctVenta: number;
  /** Materia prima por pieza, sin IVA. */
  mpPieza: number;
  piezasPorDia: number;
  nominaSemanal: number;
  indirectosMes: number;
  /** Semanas de cierre de planta (se toman de la última quincena de diciembre). */
  semanasCierre: number;
  /** Días de vacaciones por persona sin fecha de ingreso en RH. */
  diasVacacionesSinIngreso: number;
}

export interface MesProyeccion {
  mes: string; // YYYY-MM
  habiles: number;
  festivos: number;
  cierre: number;
  vacaciones: number;
  productivos: number;
  piezasProgramadas: number;
  piezasLibres: number;
  piezas: number;
  vendidas: number;
  ventas: number;
  costoMp: number;
  nomina: number;
  indirectos: number;
  utilidad: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fecha(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}
function sumarDias(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
const esHabil = (d: Date) => d.getUTCDay() !== 0; // lunes a sábado

/** n-ésimo lunes de un mes (mes 0-11). */
function lunes(anio: number, mes: number, n: number): string {
  const d = new Date(Date.UTC(anio, mes, 1));
  const primero = (8 - d.getUTCDay()) % 7; // días hasta el primer lunes
  return iso(new Date(Date.UTC(anio, mes, 1 + primero + (n - 1) * 7)));
}

/** Descanso obligatorio, art. 74 LFT. */
export function festivosLFT(anio: number): string[] {
  const f = [
    `${anio}-01-01`,
    lunes(anio, 1, 1),
    lunes(anio, 2, 3),
    `${anio}-05-01`,
    `${anio}-09-16`,
    lunes(anio, 10, 3),
    `${anio}-12-25`,
  ];
  if ((anio - 2024) % 6 === 0) f.push(`${anio}-10-01`); // transmisión del Poder Ejecutivo
  return f.sort();
}

/** Días de vacaciones por años cumplidos (LFT art. 76, reforma 2023). */
export function diasVacacionesLFT(anios: number): number {
  if (anios < 1) return 0;
  if (anios <= 5) return 10 + 2 * anios;
  return 20 + 2 * Math.ceil((anios - 5) / 5);
}

export function proyeccionAnual(lotes: LoteProyeccion[], personas: PersonaProyeccion[], s: SupuestosProyeccion): MesProyeccion[] {
  const inicio = fecha(s.desde);
  const fin = new Date(Date.UTC(inicio.getUTCFullYear() + 1, inicio.getUTCMonth(), inicio.getUTCDate())); // exclusivo
  const festivos = new Set<string>();
  for (let a = inicio.getUTCFullYear(); a <= fin.getUTCFullYear(); a++) festivosLFT(a).forEach((f) => festivos.add(f));

  // Cierre de planta: los últimos días hábiles de diciembre dentro del periodo.
  const cierre = new Set<string>();
  let porCerrar = Math.round(s.semanasCierre * 6);
  for (let d = sumarDias(fin, -1); porCerrar > 0 && d >= inicio; d = sumarDias(d, -1)) {
    if (d.getUTCMonth() === 11 && esHabil(d) && !festivos.has(iso(d))) {
      cierre.add(iso(d));
      porCerrar--;
    }
  }

  // Vacaciones de cada persona en días-planta: se toman en el mes de su
  // aniversario; sin fecha de ingreso, repartidas en el año.
  const n = Math.max(1, personas.length);
  const vacPorMes = new Map<string, number>();
  let vacSinIngresoMes = 0;
  for (const p of personas) {
    if (!p.ingreso) {
      vacSinIngresoMes += s.diasVacacionesSinIngreso / 12 / n;
      continue;
    }
    const ing = fecha(p.ingreso);
    for (let a = inicio.getUTCFullYear(); a <= fin.getUTCFullYear(); a++) {
      const aniv = new Date(Date.UTC(a, ing.getUTCMonth(), ing.getUTCDate()));
      if (aniv < inicio || aniv >= fin) continue;
      const dias = diasVacacionesLFT(a - ing.getUTCFullYear());
      const k = iso(aniv).slice(0, 7);
      vacPorMes.set(k, (vacPorMes.get(k) ?? 0) + dias / n);
    }
  }

  // Lotes abiertos o programados: piezas repartidas en sus días hábiles.
  const programado = new Map<string, number>(); // día → piezas
  for (const l of lotes) {
    if (l.estado !== "planeada" && l.estado !== "en_proceso") continue;
    const dias: string[] = [];
    const total = Math.max(1, Math.round(l.dias ?? 1));
    for (let d = fecha(l.inicio); dias.length < total; d = sumarDias(d, 1)) {
      if (esHabil(d) && !festivos.has(iso(d))) dias.push(iso(d));
    }
    const futuros = dias.filter((d) => d >= s.desde);
    if (futuros.length === 0) continue;
    // Lo que falta del lote se reparte en sus días que quedan por delante.
    const piezas = (l.cantidad * futuros.length) / dias.length;
    for (const d of futuros) programado.set(d, (programado.get(d) ?? 0) + piezas / futuros.length);
  }

  const meses: MesProyeccion[] = [];
  for (let m = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1)); m < fin; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const k = iso(m).slice(0, 7);
    let habiles = 0;
    let fest = 0;
    let cer = 0;
    let ocupados = 0;
    let piezasProg = 0;
    let diasCal = 0;
    const diasMes = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate();
    for (let d = m; d.getUTCMonth() === m.getUTCMonth(); d = sumarDias(d, 1)) {
      if (d < inicio || d >= fin) continue;
      diasCal++;
      if (!esHabil(d)) continue;
      habiles++;
      const di = iso(d);
      if (festivos.has(di)) fest++;
      else if (cierre.has(di)) cer++;
      else if (programado.has(di)) {
        ocupados++;
        piezasProg += programado.get(di) ?? 0;
      }
    }
    const vac = (vacPorMes.get(k) ?? 0) + vacSinIngresoMes * (diasCal / diasMes);
    const productivos = Math.max(0, habiles - fest - cer - vac);
    const libres = Math.max(0, productivos - ocupados);
    const piezasLibres = libres * s.piezasPorDia;
    const piezas = piezasProg + piezasLibres;
    const vendidas = piezas * (s.pctVenta / 100);
    const ventas = vendidas * s.precioVenta;
    const costoMp = vendidas * s.mpPieza;
    const nomina = (s.nominaSemanal * diasCal) / 7;
    const indirectos = (s.indirectosMes * diasCal) / diasMes;
    meses.push({
      mes: k,
      habiles,
      festivos: fest,
      cierre: cer,
      vacaciones: r2(vac),
      productivos: r2(productivos),
      piezasProgramadas: r2(piezasProg),
      piezasLibres: r2(piezasLibres),
      piezas: r2(piezas),
      vendidas: r2(vendidas),
      ventas: r2(ventas),
      costoMp: r2(costoMp),
      nomina: r2(nomina),
      indirectos: r2(indirectos),
      utilidad: r2(ventas - costoMp - nomina - indirectos),
    });
  }
  return meses;
}

/** Suma de los meses. */
export function totalProyeccion(meses: MesProyeccion[]) {
  const t = { habiles: 0, festivos: 0, cierre: 0, vacaciones: 0, productivos: 0, piezas: 0, vendidas: 0, ventas: 0, costoMp: 0, nomina: 0, indirectos: 0, utilidad: 0 };
  for (const m of meses) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += m[k];
  for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] = r2(t[k]);
  return { ...t, margen: t.ventas > 0 ? t.utilidad / t.ventas : null };
}

/** Piezas por día hábil de los lotes con días planeados (ritmo de la planta). */
export function ritmoPlanta(lotes: LoteProyeccion[]): number | null {
  let piezas = 0;
  let dias = 0;
  for (const l of lotes) {
    if (!l.dias || l.dias <= 0 || l.estado === "cancelada") continue;
    piezas += Number(l.cantidad);
    dias += Number(l.dias);
  }
  return dias > 0 ? Math.round((piezas / dias) * 100) / 100 : null;
}
