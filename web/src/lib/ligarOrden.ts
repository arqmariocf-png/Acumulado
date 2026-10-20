// Ligar un movimiento bancario en revisión a su OC / OS / OV (20-oct-2026,
// Mario: "una vez que el estatus está en revisión tendría que abrir la lista
// de OC/OV por número para hacerlo en automático"). Orden de la lista: la que
// el concepto del banco nombra ("SPEI ENVIADO … OC 41492 CSC"), luego las del
// mismo monto (total o saldo) y luego la fecha más cercana al pago. Puro, con
// pruebas.

export interface OrdenCandidata {
  id: string;
  numero: string;
  tipo: "OC" | "OS" | "OV";
  contraparte: string | null;
  proyecto: string | null;
  total: number | null;
  saldo: number | null;
  fecha: string | null;
}

export interface CandidataOrdenada extends OrdenCandidata {
  enConcepto: boolean;
  mismoMonto: boolean;
}

const TOLERANCIA = 1;

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Números de 4 a 6 dígitos que siguen a OC/OS/OV en el concepto del banco. */
export function numerosEnConcepto(concepto: string | null | undefined): string[] {
  if (!concepto) return [];
  const encontrados = new Set<string>();
  for (const m of concepto.matchAll(/(?<![A-Z])(?:O\.?\s?[CSV]\.?|ORDEN)\s*[-#:]?\s*(\d{4,6})(?!\d)/gi)) {
    encontrados.add(m[1]);
  }
  return [...encontrados];
}

function diasEntre(a: string | null, b: string | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86_400_000;
}

export function ordenarCandidatas(
  ordenes: OrdenCandidata[],
  mov: { monto: number | null; fecha: string | null; concepto: string | null },
): CandidataOrdenada[] {
  const enConcepto = new Set(numerosEnConcepto(mov.concepto));
  const conMarcas = ordenes.map((o) => ({
    ...o,
    enConcepto: enConcepto.has(o.numero),
    mismoMonto:
      mov.monto != null &&
      [o.total, o.saldo].some((v) => v != null && Math.abs(v - (mov.monto as number)) <= TOLERANCIA),
  }));
  return conMarcas.sort(
    (a, b) =>
      Number(b.enConcepto) - Number(a.enConcepto) ||
      Number(b.mismoMonto) - Number(a.mismoMonto) ||
      diasEntre(a.fecha, mov.fecha) - diasEntre(b.fecha, mov.fecha) ||
      b.numero.localeCompare(a.numero, "es", { numeric: true }),
  );
}

/** Filtro de texto: número, proveedor/cliente o proyecto, sin acentos y por palabras. */
export function filtrarCandidatas<T extends OrdenCandidata>(ordenes: T[], texto: string): T[] {
  const palabras = sinAcentos(texto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return ordenes;
  return ordenes.filter((o) => {
    const campo = sinAcentos(`${o.tipo} ${o.numero} ${o.contraparte ?? ""} ${o.proyecto ?? ""}`);
    return palabras.every((p) => campo.includes(p));
  });
}

/** Se ofrece ligar mientras el movimiento no esté conciliado. */
export function puedeLigarOrden(estado: string | null | undefined): boolean {
  return estado === "pendiente_revision" || estado === "ambiguo" || estado === "pendiente_esperado";
}
