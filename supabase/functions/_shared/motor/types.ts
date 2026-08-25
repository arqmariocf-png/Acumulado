// Tipos del motor de conciliación. Módulo puro (sin dependencias de Deno ni de
// Node): se importa igual desde el edge function (Deno) y desde los tests
// (Node), y desde el futuro parser de ingesta.

export type EstadoClasificacion =
  | "resuelto"
  | "pendiente_esperado"
  | "pendiente_revision"
  | "ambiguo";

export type ReferenciaTipo = "OC" | "OS" | "OV" | "OF";

/** Un movimiento crudo, ya normalizado desde el archivo de origen (fase 1),
 * antes de pasar por el motor de clasificación. */
export interface MovimientoEntrada {
  /** Id temporal dentro del lote, usado solo para reportar resultados y dedupe. */
  idLote: string;
  cuentaId: string;
  empresaId: string;
  fechaPago: string; // ISO yyyy-mm-dd
  fechaOrden: string | null; // ISO yyyy-mm-dd
  proyecto: string | null;
  nombreRazonSocial: string | null;
  cargoTotal: number | null;
  abonoTotal: number | null;
  referenciaTipo: ReferenciaTipo | null;
  referenciaNumero: string | null;
  factura: string | null;
  comentarios: string | null;
}

/** Resultado de correr una fase o el motor completo sobre un movimiento. */
export interface ResultadoClasificacion {
  proyecto: string | null;
  nombreRazonSocial: string | null;
  factura: string | null;
  observaciones: string[];
  estadoClasificacion: EstadoClasificacion;
  posibleDuplicado: boolean;
}

export interface OrdenCatalogo {
  idOrden: string;
  tipo: "OC" | "OS";
  empresaId: string;
  proyecto: string | null;
  proveedor: string | null;
  periodo: string; // AAAAMM
}

export interface VentaCatalogo {
  idOv: string;
  empresaId: string;
  proyecto: string | null;
  cliente: string | null;
  periodo: string; // AAAAMM
}

export interface CfdiCandidato {
  id: string;
  tipo: "recibido" | "emitido";
  empresaId: string;
  folio: string;
  total: number;
  periodo: string; // AAAAMM
}

export interface ReglaClasificacion {
  palabraClave: string;
  etiqueta: string;
  orden: number;
}

export interface ExcepcionProveedor {
  proveedor: string;
  descripcionRegla: string;
  hastaMesSiguiente: boolean;
  diasTolerancia: number | null;
}

/** Todo el contexto de catálogos que el motor necesita para clasificar un lote.
 * Se carga una vez por corrida (una consulta a cada tabla) y se reutiliza para
 * todos los movimientos del lote — el motor en sí no hace I/O. */
export interface ContextoConciliacion {
  ordenesCompra: OrdenCatalogo[];
  ordenesVenta: VentaCatalogo[];
  cfdi: CfdiCandidato[];
  reglas: ReglaClasificacion[];
  excepciones: ExcepcionProveedor[];
  /** Movimientos ya existentes en la cuenta (de corridas previas), para dedupe
   * contra la base, no solo dentro del lote actual. */
  movimientosExistentes?: ClaveDedupe[];
}

export interface ClaveDedupe {
  cuentaId: string;
  fechaPago: string;
  monto: number;
  referenciaNumero: string | null;
}
