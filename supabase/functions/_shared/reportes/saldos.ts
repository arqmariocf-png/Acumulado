// Shaping puro para el reporte de saldos diarios (PDF que tesorería genera
// para Delia/Jaime -- entradas/salidas del día y saldo por cuenta bancaria,
// para poder programar los pagos/compras (OS/OV) cargados en el backoffice).
//
// Sin imports externos a propósito, para poder probarse con `node --test`
// igual que el resto de _shared. La generación real del PDF (que sí depende
// de npm:pdf-lib, Deno-only) vive en pdf-saldos.ts y consume el resultado de
// construirReporteSaldosDia -- no se prueba con node porque pdf-lib no
// resuelve bajo Node con especificadores `npm:`.

export interface FilaSaldoCuenta {
  cuentaId: string;
  empresaId: string;
  empresaNombre: string;
  banco: string;
  ultimos4: string;
  alias: string | null;
  saldoInicial: number;
  entradas: number;
  salidas: number;
  saldoFinal: number;
  /** Corrección manual fija (puede ser negativa) que se guarda en
   * cuentas_bancarias.ajuste_saldo -- NO se recalcula sola, solo cambia si
   * alguien la edita a mano en Admin -> Cuentas. Existe para no tener que
   * reinvestigar cada vez de dónde viene una diferencia contra el saldo real
   * del banco (ver migración ajuste_saldo_cuentas). */
  ajusteSaldo: number;
  /** De dónde viene el ajuste (ej. "comisión no capturada, jul-ago 2026"). */
  ajusteNota: string | null;
  tieneMovimientos: boolean;
  /** Hasta qué día llega el último estado de cuenta subido de la cuenta
   * (`cuentas_bancarias.estado_cuenta_al`; la carga lo registra aunque no
   * traiga movimientos nuevos). 20-nov-2026, Delia: "si no tienen movimiento
   * se quedan con el estado de cuenta del último movimiento, no se actualiza
   * la fecha". Opcional: las filas de "ayer"/"hoy" no lo traen. */
  estadoCuentaAl?: string | null;
  /** Fecha del último movimiento cargado de la cuenta. */
  ultimoMovimiento?: string | null;
}

export interface SubtotalSaldos {
  saldoInicial: number;
  entradas: number;
  salidas: number;
  saldoFinal: number;
  ajusteSaldo: number;
}

/** saldoFinal (el que arrastra el sistema, 100% de movimientos cargados) +
 * ajusteSaldo (la corrección manual fija) = el saldo real del banco. Sirve
 * igual para una FilaSaldoCuenta que para un SubtotalSaldos, porque ambos
 * traen los mismos dos campos. Redondeado a centavos para no arrastrar
 * ruido de punto flotante en la suma. */
export function saldoAjustado(f: Pick<FilaSaldoCuenta, "saldoFinal" | "ajusteSaldo">): number {
  return Math.round((f.saldoFinal + f.ajusteSaldo) * 100) / 100;
}

export interface GrupoEmpresaSaldos {
  empresaNombre: string;
  filas: FilaSaldoCuenta[];
  subtotal: SubtotalSaldos;
}

export interface ReporteSaldosDia {
  grupos: GrupoEmpresaSaldos[];
  total: SubtotalSaldos;
}

/** Etiqueta legible de una cuenta para las tablas del PDF, ej.
 * "BBVA ····1226" o "BanBajio ····9403 (Del Excel maestro)" si tiene alias. */
export function etiquetaCuenta(fila: Pick<FilaSaldoCuenta, "banco" | "ultimos4" | "alias">): string {
  const base = `${fila.banco} ····${fila.ultimos4}`;
  return fila.alias ? `${base} (${fila.alias})` : base;
}

function sumarSubtotal(filas: FilaSaldoCuenta[]): SubtotalSaldos {
  return filas.reduce<SubtotalSaldos>(
    (acc, f) => ({
      saldoInicial: acc.saldoInicial + f.saldoInicial,
      entradas: acc.entradas + f.entradas,
      salidas: acc.salidas + f.salidas,
      saldoFinal: acc.saldoFinal + f.saldoFinal,
      ajusteSaldo: acc.ajusteSaldo + f.ajusteSaldo,
    }),
    { saldoInicial: 0, entradas: 0, salidas: 0, saldoFinal: 0, ajusteSaldo: 0 },
  );
}

/** Agrupa las filas (una por cuenta) por empresa, con subtotal por empresa y
 * total general -- empresas y cuentas ordenadas alfabéticamente para que el
 * PDF salga en un orden estable y predecible. */
export function construirReporteSaldosDia(filas: FilaSaldoCuenta[]): ReporteSaldosDia {
  const porEmpresa = new Map<string, FilaSaldoCuenta[]>();
  for (const fila of filas) {
    const lista = porEmpresa.get(fila.empresaNombre) ?? [];
    lista.push(fila);
    porEmpresa.set(fila.empresaNombre, lista);
  }

  const grupos: GrupoEmpresaSaldos[] = [...porEmpresa.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([empresaNombre, filasEmpresa]) => {
      const filasOrdenadas = [...filasEmpresa].sort((a, b) =>
        etiquetaCuenta(a).localeCompare(etiquetaCuenta(b), "es"),
      );
      return { empresaNombre, filas: filasOrdenadas, subtotal: sumarSubtotal(filasOrdenadas) };
    });

  return { grupos, total: sumarSubtotal(filas) };
}

/** saldoInicial + entradas - salidas - saldoFinal, a centavos. Cero cuando el
 * día cuadra. Distinto de cero significa que entre la última carga y este
 * día faltan movimientos, o que algún movimiento quedó registrado con otra
 * fecha (caso real 17-sep-2026: Banorte 1273 de Aceros, pago de préstamo
 * con fecha de aplicación 15-sep cargado el 17-sep). Se muestra en el PDF
 * para que tesorería no tenga que descubrirlo comparando a mano. */
export function descuadreFila(f: Pick<FilaSaldoCuenta, "saldoInicial" | "entradas" | "salidas" | "saldoFinal">): number {
  return Math.round((f.saldoInicial + f.entradas - f.salidas - f.saldoFinal) * 100) / 100;
}

export function tieneDescuadre(f: FilaSaldoCuenta): boolean {
  return f.tieneMovimientos && Math.abs(descuadreFila(f)) > 0.01;
}

export function filasConDescuadre(reporte: ReporteSaldosDia): FilaSaldoCuenta[] {
  return reporte.grupos.flatMap((g) => g.filas).filter(tieneDescuadre);
}

/** dd/mm de una fecha ISO. */
export function ddmm(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Día hábil anterior (lunes → viernes): los bancos no mueven en fin de semana. */
export function diaHabilAnterior(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** Texto corto de la columna "AL DÍA" de la posición global: hasta qué día
 * llega el estado de cuenta de la cuenta ("19/11"), o "—" si nunca se ha
 * cargado uno. */
export function textoAlDia(f: Pick<FilaSaldoCuenta, "estadoCuentaAl" | "ultimoMovimiento">): string {
  const al = f.estadoCuentaAl ?? f.ultimoMovimiento ?? null;
  return al ? ddmm(al) : "—";
}

/** ¿El estado de cuenta está atrasado respecto a la fecha del reporte
 * (anterior al día hábil previo, o nunca cargado)? */
export function estadoCuentaViejo(f: Pick<FilaSaldoCuenta, "estadoCuentaAl" | "ultimoMovimiento">, fechaHoy: string): boolean {
  const al = f.estadoCuentaAl ?? f.ultimoMovimiento ?? null;
  return !al || al < diaHabilAnterior(fechaHoy);
}

export interface NotaAlDia {
  fila: FilaSaldoCuenta;
  texto: string;
  /** true = falta subir el estado de cuenta; false = al día, solo sin movimientos nuevos. */
  atrasada: boolean;
}

/** Notas al pie de la posición global: cuentas cuyo estado de cuenta está
 * atrasado (o nunca se cargó) y cuentas al día que no han tenido
 * movimientos desde antes (el saldo no cambia pero sí está actualizado). */
export function notasAlDia(reporte: ReporteSaldosDia, fechaHoy: string): NotaAlDia[] {
  const notas: NotaAlDia[] = [];
  for (const f of reporte.grupos.flatMap((g) => g.filas)) {
    if (f.estadoCuentaAl === undefined && f.ultimoMovimiento === undefined) continue;
    const al = f.estadoCuentaAl ?? f.ultimoMovimiento ?? null;
    if (!al) {
      notas.push({ fila: f, texto: `${etiquetaCuenta(f)} (${f.empresaNombre}): nunca se ha cargado un estado de cuenta.`, atrasada: true });
    } else if (al < diaHabilAnterior(fechaHoy)) {
      notas.push({ fila: f, texto: `${etiquetaCuenta(f)} (${f.empresaNombre}): estado de cuenta al ${ddmm(al)}, falta subir lo más reciente.`, atrasada: true });
    } else if (f.ultimoMovimiento && f.ultimoMovimiento < al) {
      notas.push({ fila: f, texto: `${etiquetaCuenta(f)} (${f.empresaNombre}): estado de cuenta al ${ddmm(al)}, sin movimientos desde el ${ddmm(f.ultimoMovimiento)} (el saldo no cambia, pero sí está al día).`, atrasada: false });
    }
  }
  return notas.sort((a, b) => Number(b.atrasada) - Number(a.atrasada));
}
