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
  tieneMovimientos: boolean;
}

export interface SubtotalSaldos {
  saldoInicial: number;
  entradas: number;
  salidas: number;
  saldoFinal: number;
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
    }),
    { saldoInicial: 0, entradas: 0, salidas: 0, saldoFinal: 0 },
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
