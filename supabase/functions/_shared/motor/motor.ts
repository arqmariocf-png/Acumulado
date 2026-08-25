// Motor de conciliación — implementa las fases 4.1 a 4.6 de SPEC.md.
// Puro: no hace I/O. Recibe un movimiento ya normalizado y el contexto de
// catálogos (cargado una sola vez por lote) y devuelve el resultado de
// clasificación. Así se puede probar exhaustivamente sin una base de datos.

import type {
  ContextoConciliacion,
  MovimientoEntrada,
  ResultadoClasificacion,
  ClaveDedupe,
} from "./types.ts";
import { contieneTexto, textoIgual, periodoDeFecha, periodoEsAnterior } from "./normalizar.ts";

const TOLERANCIA_CENTAVOS = 0.01;

function montoYTipoCfdi(mov: MovimientoEntrada): { monto: number; tipo: "recibido" | "emitido" } | null {
  if (mov.cargoTotal != null) return { monto: mov.cargoTotal, tipo: "recibido" };
  if (mov.abonoTotal != null) return { monto: mov.abonoTotal, tipo: "emitido" };
  return null;
}

/** Fase 4.1 — cruce de Proyecto/Nombre contra el catálogo de OC/OS/OV, con
 * detección de "orden de mes anterior" (sección 4.5). No lanza estado final:
 * solo aporta proyecto/nombre/observaciones; el estado se decide al final. */
function cruzarProyectoNombre(
  mov: MovimientoEntrada,
  contexto: ContextoConciliacion,
): { proyecto: string | null; nombre: string | null; observaciones: string[]; ordenEncontrada: boolean; esMesAnterior: boolean } {
  const observaciones: string[] = [];
  let proyecto = mov.proyecto;
  let nombre = mov.nombreRazonSocial;
  let ordenEncontrada = false;
  let esMesAnterior = false;

  if (!mov.referenciaTipo || !mov.referenciaNumero) {
    return { proyecto, nombre, observaciones, ordenEncontrada, esMesAnterior };
  }

  const periodoMovimiento = periodoDeFecha(mov.fechaPago);

  if (mov.referenciaTipo === "OC" || mov.referenciaTipo === "OS") {
    const orden = contexto.ordenesCompra.find(
      (o) => o.tipo === mov.referenciaTipo && textoIgual(o.idOrden, mov.referenciaNumero) && o.empresaId === mov.empresaId,
    );
    if (orden) {
      ordenEncontrada = true;
      if (!proyecto) proyecto = orden.proyecto;
      if (!nombre) nombre = orden.proveedor;
      if (periodoEsAnterior(orden.periodo, periodoMovimiento)) {
        esMesAnterior = true;
        observaciones.push("OC/OS/OV de mes anterior, pagado en este mes");
      }
    }
  } else if (mov.referenciaTipo === "OV") {
    const venta = contexto.ordenesVenta.find(
      (o) => textoIgual(o.idOv, mov.referenciaNumero) && o.empresaId === mov.empresaId,
    );
    if (venta) {
      ordenEncontrada = true;
      if (!proyecto) proyecto = venta.proyecto;
      if (!nombre) nombre = venta.cliente;
      if (periodoEsAnterior(venta.periodo, periodoMovimiento)) {
        esMesAnterior = true;
        observaciones.push("OC/OS/OV de mes anterior, pagado en este mes");
      }
    }
  }

  // No se encontró en catálogo: si el propio movimiento trae Fecha OC/OS/OV
  // de un mes anterior al de pago, es casi seguro una orden vieja que el
  // catálogo cargado (snapshot del mes) no incluye — no penalizar como dato
  // faltante sin explicación.
  if (!ordenEncontrada && mov.fechaOrden && periodoEsAnterior(periodoDeFecha(mov.fechaOrden), periodoMovimiento)) {
    esMesAnterior = true;
    observaciones.push("OC/OS/OV de mes anterior, pagado en este mes");
  }

  return { proyecto, nombre, observaciones, ordenEncontrada, esMesAnterior };
}

/** Fase 4.3 — clasificación por palabra clave. Reglas ordenadas por
 * `orden` ascendente para que las más específicas (ej. "DEVOLUCION ERROR")
 * se evalúen antes que las genéricas (ej. "DEVOLUCION"). */
function clasificarPorPalabraClave(mov: MovimientoEntrada, contexto: ContextoConciliacion): string | null {
  const textoBuscable = `${mov.comentarios ?? ""} ${mov.referenciaNumero ?? ""}`;
  const reglasOrdenadas = [...contexto.reglas].sort((a, b) => a.orden - b.orden);
  for (const regla of reglasOrdenadas) {
    if (contieneTexto(textoBuscable, regla.palabraClave)) {
      return regla.etiqueta;
    }
  }
  return null;
}

/** Fase 4.2 — cruce de FACTURA contra CFDI por monto (tolerancia de
 * centavos), dentro de la empresa y el tipo correspondiente (cargo->recibido,
 * abono->emitido). Devuelve null si no hay candidatos, el folio si hay
 * exactamente uno, o 'AMBIGUO' si hay 2+. */
function cruzarFactura(
  mov: MovimientoEntrada,
  contexto: ContextoConciliacion,
): { resultado: string | null | "AMBIGUO"; candidatos: number } {
  const montoTipo = montoYTipoCfdi(mov);
  if (!montoTipo) return { resultado: null, candidatos: 0 };

  const candidatos = contexto.cfdi.filter(
    (c) =>
      c.empresaId === mov.empresaId &&
      c.tipo === montoTipo.tipo &&
      Math.abs(c.total - montoTipo.monto) <= TOLERANCIA_CENTAVOS,
  );

  if (candidatos.length === 0) return { resultado: null, candidatos: 0 };
  if (candidatos.length === 1) return { resultado: `F- ${candidatos[0].folio}`, candidatos: 1 };
  return { resultado: "AMBIGUO", candidatos: candidatos.length };
}

/** Fase 4.4 — excepción de proveedor con crédito. Solo aplica si a estas
 * alturas el movimiento todavía no tiene FACTURA resuelta. */
function excepcionProveedor(mov: MovimientoEntrada, nombreResuelto: string | null, contexto: ContextoConciliacion): string | null {
  if (!nombreResuelto) return null;
  const excepcion = contexto.excepciones.find((e) => textoIgual(e.proveedor, nombreResuelto));
  return excepcion ? excepcion.descripcionRegla : null;
}

/** Fase 4.6 — deduplicación: mismo Cuenta + Fecha + Monto + Referencia. */
function esDuplicado(mov: MovimientoEntrada, clavesPrevias: ClaveDedupe[]): boolean {
  const monto = mov.cargoTotal ?? mov.abonoTotal ?? null;
  if (monto == null) return false;
  return clavesPrevias.some(
    (k) =>
      k.cuentaId === mov.cuentaId &&
      k.fechaPago === mov.fechaPago &&
      Math.abs(k.monto - monto) <= TOLERANCIA_CENTAVOS &&
      k.referenciaNumero === mov.referenciaNumero,
  );
}

function claveDedupeDe(mov: MovimientoEntrada): ClaveDedupe | null {
  const monto = mov.cargoTotal ?? mov.abonoTotal ?? null;
  if (monto == null) return null;
  return { cuentaId: mov.cuentaId, fechaPago: mov.fechaPago, monto, referenciaNumero: mov.referenciaNumero };
}

/** Clasifica un único movimiento. No decide dedupe (eso es responsabilidad de
 * clasificarLote, porque depende de otros movimientos del mismo lote). */
export function clasificarMovimiento(mov: MovimientoEntrada, contexto: ContextoConciliacion): ResultadoClasificacion {
  const observaciones: string[] = [];

  // 4.1
  const cruce = cruzarProyectoNombre(mov, contexto);
  observaciones.push(...cruce.observaciones);

  // 4.3 — si matchea una palabra clave, el movimiento queda resuelto sin
  // necesidad de factura real; no tiene sentido seguir buscando CFDI.
  const etiquetaNA = clasificarPorPalabraClave(mov, contexto);
  if (etiquetaNA) {
    return {
      proyecto: cruce.proyecto,
      nombreRazonSocial: cruce.nombre,
      factura: etiquetaNA,
      observaciones: [...observaciones, `Clasificado automáticamente: ${etiquetaNA}`],
      estadoClasificacion: "resuelto",
      posibleDuplicado: false,
    };
  }

  // Si ya venía con FACTURA capturada manualmente, se respeta.
  if (mov.factura) {
    return {
      proyecto: cruce.proyecto,
      nombreRazonSocial: cruce.nombre,
      factura: mov.factura,
      observaciones,
      estadoClasificacion: cruce.proyecto && cruce.nombre ? "resuelto" : "pendiente_revision",
      posibleDuplicado: false,
    };
  }

  // 4.2
  const { resultado: factura, candidatos } = cruzarFactura(mov, contexto);

  if (factura === "AMBIGUO") {
    return {
      proyecto: cruce.proyecto,
      nombreRazonSocial: cruce.nombre,
      factura: null,
      observaciones: [...observaciones, `FACTURA ambigua: ${candidatos} candidatos con el mismo monto, requiere revisión`],
      estadoClasificacion: "ambiguo",
      posibleDuplicado: false,
    };
  }

  if (factura) {
    const faltaProyectoONombre = !cruce.proyecto || !cruce.nombre;
    return {
      proyecto: cruce.proyecto,
      nombreRazonSocial: cruce.nombre,
      factura,
      observaciones,
      estadoClasificacion: faltaProyectoONombre ? "pendiente_revision" : "resuelto",
      posibleDuplicado: false,
    };
  }

  // No hay FACTURA resuelta: revisar excepción de proveedor con crédito (4.4)
  const regla = excepcionProveedor(mov, cruce.nombre, contexto);
  if (regla) {
    return {
      proyecto: cruce.proyecto,
      nombreRazonSocial: cruce.nombre,
      factura: null,
      observaciones: [...observaciones, `Proveedor con crédito: ${regla}`],
      estadoClasificacion: "pendiente_esperado",
      posibleDuplicado: false,
    };
  }

  // Nada resolvió la FACTURA. Si al menos sabemos que es "mes anterior" ya
  // quedó marcado como pendiente_esperado por proyecto/nombre; si no, es
  // un vacío sin explicación conocida -> revisión humana.
  return {
    proyecto: cruce.proyecto,
    nombreRazonSocial: cruce.nombre,
    factura: null,
    observaciones,
    estadoClasificacion: cruce.esMesAnterior ? "pendiente_esperado" : "pendiente_revision",
    posibleDuplicado: false,
  };
}

/** Clasifica un lote completo, agregando la deduplicación (4.6) contra el
 * resto del lote y contra `contexto.movimientosExistentes` (movimientos ya
 * en la base para esa cuenta, de corridas anteriores). */
export function clasificarLote(
  movimientos: MovimientoEntrada[],
  contexto: ContextoConciliacion,
): Map<string, ResultadoClasificacion> {
  const resultados = new Map<string, ResultadoClasificacion>();
  const clavesVistas: ClaveDedupe[] = [...(contexto.movimientosExistentes ?? [])];

  for (const mov of movimientos) {
    const resultado = clasificarMovimiento(mov, contexto);

    const clave = claveDedupeDe(mov);
    if (clave) {
      resultado.posibleDuplicado = esDuplicado(mov, clavesVistas);
      clavesVistas.push(clave);
    }

    resultados.set(mov.idLote, resultado);
  }

  return resultados;
}
