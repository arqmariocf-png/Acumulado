// Lee la hoja "DB" del maestro de folios BBVA (mantenimiento Puebla-
// Tlaxcala) y calcula los mismos agregados que ya muestra el dashboard
// (web/src/pages/bbva/plantillaDashboard.ts). Validado fila por fila contra
// el Excel real: total de folios, monto total, sucursales, top sucursales y
// ciclo promedio de cobro coinciden exactamente con el corte ya publicado.

import { XLSX } from "./ingesta/xlsx-cargador.ts";

interface Registro {
  folio: unknown;
  fecha: Date | null;
  supervisor: string;
  sucursal: string | null;
  descripcion: string;
  monto: number;
  proceso: "Mantenimiento" | "Obra Menor";
  pedido: unknown;
  factura: unknown;
  fechaPago: Date | null;
  enRevision: boolean;
}

const MESES_ABREV: Record<number, string> = { 1: "01", 2: "02", 3: "03", 4: "04", 5: "05", 6: "06", 7: "07", 8: "08", 9: "09", 10: "10", 11: "11", 12: "12" };

function normalizarNombre(s: unknown): string {
  const t = String(s ?? "").trim();
  if (!t) return "Sin Asignar";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

// Nombres de sucursal vienen con mayúsculas/minúsculas mezcladas en el
// maestro (ej. "PLAZA TOLIN" y "Plaza Tolin" son la misma sucursal) -- sin
// normalizar, se duplican al contar cuántas sucursales hay.
function normalizarSucursal(s: unknown): string | null {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t
    .toLowerCase()
    .split(" ")
    .map((p) => (p.length ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(" ");
}

function normalizarProceso(s: unknown): "Mantenimiento" | "Obra Menor" | null {
  const t = String(s ?? "").trim().toUpperCase();
  if (t === "OBRA MENOR") return "Obra Menor";
  if (t === "MANTENIMIENTO") return "Mantenimiento";
  return null;
}

function esEstatusExcluido(s: unknown): boolean {
  const t = String(s ?? "").trim().toUpperCase();
  return t === "CANCELADO" || t === "DUPLICADO";
}

function esRevision(estado: unknown, fechaPago: unknown): boolean {
  if (fechaPago) return false;
  const t = String(estado ?? "").trim().toLowerCase();
  return t.startsWith("soportes enviado") || t.startsWith("soporte enviado");
}

function anioValido(a: number): boolean {
  return a >= 2000 && a <= new Date().getFullYear() + 1;
}

function claveMes(fecha: Date | null): string {
  if (fecha) return `${fecha.getFullYear()}-${MESES_ABREV[fecha.getMonth() + 1]}`;
  return "Sin fecha";
}

const REGLAS_ESPECIALIDAD: [RegExp, string][] = [
  [/pintura|pintar|berel|sherwin/i, "Pintura"],
  [/piso|podotactil|loseta|azulejo/i, "Pisos"],
  [/plaf[oó]n|muro|pared|resane|emplastecid/i, "Muros y plafones"],
  [/cristal|pel[ií]cula|cancel|herraje|chapa|cerradura|vidrio|ventanilla/i, "Cancelería, cristales y herrajes"],
  [/el[eé]ctric|il+uminaci|l[aá]mpara|contacto el[eé]ctrico|cableado/i, "Eléctrico"],
  [/herrer[ií]a|reja|malla cicl[oó]nica|bolard|estructura met[aá]lica|barandal/i, "Herrería y estructuras metálicas"],
  [/carpinter[ií]a|formaica|mobiliario|caj[oó]n|escritorio|archivero|closet/i, "Carpintería y mobiliario fijo"],
  [/demolici[oó]n|desmantel/i, "Demolición y desmantelamiento"],
  [/impermeabiliz/i, "Impermeabilización y protecciones"],
  [/sanitario|mingitorio|ovalin|wc\b/i, "Accesorios sanitarios"],
  [/limpieza.*[aá]reas? verdes|[aá]reas? verdes/i, "Limpieza y áreas verdes"],
  [/cuadrilla|movilizaci[oó]n/i, "Cuadrillas especializadas / movilización"],
  [/limpieza/i, "Limpieza general y logística"],
  [/material|insumo|suministro/i, "Materiales e insumos varios"],
];

function clasificarEspecialidad(descripcion: string): string {
  for (const [regex, categoria] of REGLAS_ESPECIALIDAD) {
    if (regex.test(descripcion)) return categoria;
  }
  return "Otros / sin clasificar";
}

function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function procesarLibroFoliosBbva(bytes: Uint8Array, nombreArchivo: string, fechaCorte: string, kpiAntes: unknown) {
  const libro = XLSX.read(bytes, { type: "array", cellDates: true });
  const nombreHoja = libro.SheetNames.find((n: string) => n.trim().toUpperCase() === "DB") ?? libro.SheetNames[0];
  const hoja = libro.Sheets[nombreHoja];
  const filas: unknown[][] = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });

  const idxEncabezado = filas.findIndex((f) => f.some((c) => String(c ?? "").trim().toUpperCase() === "FOLIO"));
  if (idxEncabezado < 0) throw new Error('No se encontró el encabezado "FOLIO" en la hoja -- ¿es el maestro de folios BBVA correcto?');
  const encabezados = filas[idxEncabezado];
  const col = (nombre: string) => encabezados.findIndex((h) => String(h ?? "").trim().toUpperCase() === nombre);

  const iN = col("N°"), iFecha = col("FECHA"), iSup = col("SUPERVISOR"), iSuc = col("SUCURSAL"), iFolio = col("FOLIO"),
    iDesc = col("ACCIÓN EJECUTADA"), iEstatus = col("ESTATUS FOLIO"), iMonto = col("MONTO TOTAL"),
    iAccion = col("ACCIÓN"), iEstado = col("ESTADO"), iPedido = col("NUMERO DE PEDIDO"),
    iFactura = col("FOLIO DE FACTURA"), iFPago = col("FECHA DE PAGO");

  if ([iN, iFecha, iSup, iSuc, iFolio, iMonto, iAccion].some((i) => i < 0)) {
    throw new Error("Faltan columnas esperadas en el maestro (N°, FECHA, Supervisor, SUCURSAL, FOLIO, MONTO TOTAL o ACCIÓN).");
  }

  const registros: Registro[] = [];
  for (let r = idxEncabezado + 1; r < filas.length; r++) {
    const fila = filas[r];
    if (!fila) continue;
    const n = fila[iN];
    // Sólo cuenta como folio real una fila con N° numérico -- las filas sin
    // N° son renglones de detalle/código (claves del catálogo de conceptos)
    // pegados debajo del folio al que pertenecen, no folios nuevos.
    if (typeof n !== "number") continue;
    if (esEstatusExcluido(fila[iEstatus])) continue;

    const fechaCruda = fila[iFecha];
    const fecha = fechaCruda instanceof Date && !isNaN(fechaCruda.getTime()) && anioValido(fechaCruda.getFullYear()) ? fechaCruda : null;
    const fechaPagoCruda = fila[iFPago];
    const fechaPago = fechaPagoCruda instanceof Date && !isNaN(fechaPagoCruda.getTime()) ? fechaPagoCruda : null;

    registros.push({
      folio: fila[iFolio],
      fecha,
      supervisor: normalizarNombre(fila[iSup]),
      sucursal: normalizarSucursal(fila[iSuc]),
      descripcion: fila[iDesc] ? String(fila[iDesc]).trim() : "",
      monto: typeof fila[iMonto] === "number" ? fila[iMonto] : 0,
      proceso: normalizarProceso(fila[iAccion]) ?? "Mantenimiento",
      pedido: fila[iPedido] ?? null,
      factura: fila[iFactura] ?? null,
      fechaPago,
      enRevision: esRevision(fila[iEstado], fechaPagoCruda),
    });
  }

  if (registros.length === 0) throw new Error("No se encontró ningún folio (fila con N° numérico) en la hoja.");

  const fechaRef = new Date(fechaCorte + "T00:00:00");

  const kpi = {
    total_folios: registros.length,
    monto_total: 0,
    folios_pagados: 0,
    monto_pagado: 0,
    folios_pendientes: 0,
    monto_pendiente: 0,
    folios_en_revision_supervisor: 0,
    n_sucursales: new Set(registros.filter((r) => r.sucursal).map((r) => r.sucursal)).size,
    n_supervisores: new Set(registros.filter((r) => r.supervisor !== "Sin Asignar").map((r) => r.supervisor)).size,
    ciclo_promedio_dias: 0,
    ciclo_objetivo_dias: 49,
  };

  const by_proceso: Record<string, { folios: number; monto: number; pagados: number; monto_pagado: number; pendientes: number; monto_pendiente: number; en_revision_supervisor: number }> = {
    Mantenimiento: { folios: 0, monto: 0, pagados: 0, monto_pagado: 0, pendientes: 0, monto_pendiente: 0, en_revision_supervisor: 0 },
    "Obra Menor": { folios: 0, monto: 0, pagados: 0, monto_pagado: 0, pendientes: 0, monto_pendiente: 0, en_revision_supervisor: 0 },
  };
  const by_month: Record<string, { folios: number; monto: number }> = {};
  const by_month_proceso: Record<string, Record<string, { folios: number; monto: number }>> = {};
  const by_especialidad: Record<string, { folios: number; monto: number }> = {};
  const by_supervisor: Record<string, { folios: number; monto: number; pagados: number; en_revision: number }> = {};
  const por_sucursal: Record<string, { folios: number; monto: number }> = {};
  const pendientes_detalle: { folio: unknown; sucursal: string | null; supervisor: string; monto: number; dias: number; en_revision: boolean; descripcion: string; proceso: string }[] = [];
  let sumaDiasPagados = 0, nPagadosConFecha = 0, nFechaPagoInconsistente = 0, sinFecha = 0;

  const pedidosMap = new Map<string, number>();
  const pedidosConFactura = new Set<string>();
  let folioConFactura = 0, folioSinPedido = 0, folioConPedidoSinFactura = 0;

  for (const r of registros) {
    kpi.monto_total += r.monto;
    const pagado = !!r.fechaPago;
    const mesKey = claveMes(r.fecha);
    if (mesKey === "Sin fecha") sinFecha++;

    if (pagado) {
      kpi.folios_pagados++;
      kpi.monto_pagado += r.monto;
      if (r.fecha) {
        const dias = Math.round((r.fechaPago!.getTime() - r.fecha.getTime()) / 86400000);
        // Algunos folios traen fecha de pago ANTERIOR a la fecha de
        // apertura -- inconsistencia real del maestro (ver qa_notas), se
        // excluyen del promedio en vez de contaminarlo con días negativos.
        if (dias >= 0) { sumaDiasPagados += dias; nPagadosConFecha++; } else nFechaPagoInconsistente++;
      }
    } else {
      kpi.folios_pendientes++;
      kpi.monto_pendiente += r.monto;
      if (r.fecha) {
        pendientes_detalle.push({
          folio: r.folio, sucursal: r.sucursal, supervisor: r.supervisor, monto: r.monto,
          dias: Math.round((fechaRef.getTime() - r.fecha.getTime()) / 86400000),
          en_revision: r.enRevision, descripcion: r.descripcion, proceso: r.proceso,
        });
      }
    }
    if (r.enRevision) kpi.folios_en_revision_supervisor++;

    const bp = by_proceso[r.proceso];
    bp.folios++; bp.monto += r.monto;
    if (pagado) { bp.pagados++; bp.monto_pagado += r.monto; } else { bp.pendientes++; bp.monto_pendiente += r.monto; }
    if (r.enRevision) bp.en_revision_supervisor++;

    by_month[mesKey] ??= { folios: 0, monto: 0 };
    by_month[mesKey].folios++; by_month[mesKey].monto += r.monto;
    by_month_proceso[mesKey] ??= {};
    by_month_proceso[mesKey][r.proceso] ??= { folios: 0, monto: 0 };
    by_month_proceso[mesKey][r.proceso].folios++; by_month_proceso[mesKey][r.proceso].monto += r.monto;

    const espKey = clasificarEspecialidad(r.descripcion);
    by_especialidad[espKey] ??= { folios: 0, monto: 0 };
    by_especialidad[espKey].folios++; by_especialidad[espKey].monto += r.monto;

    by_supervisor[r.supervisor] ??= { folios: 0, monto: 0, pagados: 0, en_revision: 0 };
    by_supervisor[r.supervisor].folios++; by_supervisor[r.supervisor].monto += r.monto;
    if (pagado) by_supervisor[r.supervisor].pagados++;
    if (r.enRevision) by_supervisor[r.supervisor].en_revision++;

    if (r.sucursal) {
      por_sucursal[r.sucursal] ??= { folios: 0, monto: 0 };
      por_sucursal[r.sucursal].folios++; por_sucursal[r.sucursal].monto += r.monto;
    }

    if (r.factura) folioConFactura++;
    if (!r.pedido) folioSinPedido++;
    else if (!r.factura) folioConPedidoSinFactura++;

    if (r.pedido) {
      const key = String(r.pedido);
      pedidosMap.set(key, (pedidosMap.get(key) ?? 0) + r.monto);
      if (r.factura) pedidosConFactura.add(key);
    }
  }

  kpi.ciclo_promedio_dias = nPagadosConFecha ? Math.round((sumaDiasPagados / nPagadosConFecha) * 10) / 10 : 0;

  const redondearMapa = <T extends { monto: number }>(obj: Record<string, T>) => {
    for (const k in obj) obj[k].monto = redondear2(obj[k].monto);
    return obj;
  };

  const top_sucursales = Object.entries(por_sucursal)
    .map(([sucursal, v]) => ({ sucursal, folios: v.folios, monto: redondear2(v.monto) }))
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 8);

  const top_pendientes = pendientes_detalle
    .sort((a, b) => b.dias - a.dias)
    .slice(0, 15)
    .map((p) => ({ ...p, monto: redondear2(p.monto) }));

  const qa_notas: string[] = [
    'Especialidad clasificada por heurística de palabras clave sobre la descripción de cada folio (columna "ACCIÓN EJECUTADA") -- ningún folio la trae capturada hoy, valídala con tu equipo antes de repartir cuadrillas.',
    `${folioSinPedido} folios todavía sin número de pedido (no han llegado a Adquira).`,
  ];
  if (sinFecha > 0) qa_notas.push(`${sinFecha} folios sin fecha de apertura capturada en el maestro -- se agrupan en "Sin fecha" y no entran al detalle de "más antiguos esperando".`);
  if (nFechaPagoInconsistente > 0) {
    qa_notas.push(
      `${nFechaPagoInconsistente} folios traen fecha de pago ANTERIOR a la fecha de apertura del folio -- inconsistencia del maestro, se excluyeron del cálculo del ciclo promedio de cobro (n=${nPagadosConFecha} folios usados). Pendiente de conciliar contra los movimientos reales de la cuenta BBVA.`,
    );
  }

  return {
    meta: { fuente: nombreArchivo, fecha_corte: fechaCorte, region: "Puebla-Tlaxcala" },
    kpi,
    kpi_antes: kpiAntes ?? undefined,
    by_proceso,
    by_month,
    by_month_proceso,
    by_especialidad: redondearMapa(by_especialidad),
    by_supervisor: redondearMapa(by_supervisor),
    top_sucursales,
    top_pendientes,
    adquira: { folios_con_factura: folioConFactura, folios_sin_pedido: folioSinPedido, folios_con_pedido_sin_factura: folioConPedidoSinFactura },
    conciliacion: {
      total_pedidos: pedidosMap.size,
      pedidos_con_factura: pedidosConFactura.size,
      suma_folios_puebla: redondear2([...pedidosMap.values()].reduce((a, b) => a + b, 0)),
    },
    qa_notas,
  };
}
