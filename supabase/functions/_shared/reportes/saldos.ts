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
