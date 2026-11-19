// Racks y niveles de la bodega (19-nov-2026, Mario: "poner una opción de
// racks y niveles de rack para darle forma"). Reglas puras de
// pages/inventario/RacksNiveles.tsx y del selector de lugar en el conteo:
// código del lugar (mismo cálculo que fn_ubicacion_codigo en la base),
// generación de los renglones de un rack, agrupado para pintar y etiquetas.

export interface Ubicacion {
  id: string;
  empresa_id: string;
  bodega: string;
  rack: string;
  nivel: number | null;
  posicion: number | null;
  codigo: string;
  descripcion: string | null;
  activo: boolean;
}

export interface UbicacionNueva {
  bodega: string;
  rack: string;
  nivel: number | null;
  posicion: number | null;
  codigo: string;
}

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/** 3 letras de la bodega + R<rack> + N<nivel> + P<posición> (igual que la base). */
export function codigoUbicacion(bodega: string, rack: string, nivel: number | null, posicion: number | null): string {
  const bod = sinAcentos(bodega.trim()).replace(/[^A-Z0-9]/g, "").slice(0, 3) || "BOD";
  const r = rack.trim();
  const rr = /^[0-9]+$/.test(r) ? r.padStart(2, "0") : sinAcentos(r).replace(/[^A-Z0-9]/g, "");
  return `${bod}-R${rr}${nivel == null ? "" : `-N${nivel}`}${posicion == null ? "" : `-P${posicion}`}`;
}

/** Qué le falta al rack antes de generarlo; null = listo. */
export function revisarRack(x: { bodega: string; rack: string; niveles: number; posiciones: number }): string | null {
  if (!x.rack.trim()) return "Escribe el nombre o número del rack.";
  if (!Number.isInteger(x.niveles) || x.niveles < 0 || x.niveles > 99) return "Los niveles van de 0 a 99.";
  if (!Number.isInteger(x.posiciones) || x.posiciones < 0 || x.posiciones > 999) return "Las posiciones por nivel van de 0 a 999.";
  if (x.posiciones > 0 && x.niveles === 0) return "Para tener posiciones el rack necesita al menos un nivel.";
  if (x.niveles * Math.max(1, x.posiciones) > 2000) return "Son demasiados lugares para un solo rack (máximo 2,000).";
  return null;
}

/** Renglones que forman un rack: el rack mismo, cada nivel y, si se pide, cada posición. */
export function generarUbicaciones(bodega: string, rack: string, niveles: number, posiciones: number): UbicacionNueva[] {
  const b = bodega.trim() || "Bodega";
  const r = rack.trim();
  const filas: UbicacionNueva[] = [{ bodega: b, rack: r, nivel: null, posicion: null, codigo: codigoUbicacion(b, r, null, null) }];
  for (let n = 1; n <= niveles; n++) {
    filas.push({ bodega: b, rack: r, nivel: n, posicion: null, codigo: codigoUbicacion(b, r, n, null) });
    for (let p = 1; p <= posiciones; p++) filas.push({ bodega: b, rack: r, nivel: n, posicion: p, codigo: codigoUbicacion(b, r, n, p) });
  }
  return filas;
}

export interface RackAgrupado {
  bodega: string;
  rack: string;
  cabecera: Ubicacion | null;
  niveles: { nivel: number; lugar: Ubicacion | null; posiciones: Ubicacion[] }[];
}

/** Lista plana → bodega › rack › nivel › posiciones, en orden natural. */
export function agruparUbicaciones(lista: Ubicacion[]): RackAgrupado[] {
  const mapa = new Map<string, RackAgrupado>();
  const orden = [...lista].sort((a, b) => a.bodega.localeCompare(b.bodega, "es") || a.rack.localeCompare(b.rack, "es", { numeric: true }) || (a.nivel ?? 0) - (b.nivel ?? 0) || (a.posicion ?? 0) - (b.posicion ?? 0));
  for (const u of orden) {
    const k = `${u.bodega}|${u.rack}`;
    let g = mapa.get(k);
    if (!g) {
      g = { bodega: u.bodega, rack: u.rack, cabecera: null, niveles: [] };
      mapa.set(k, g);
    }
    if (u.nivel == null) {
      g.cabecera = u;
      continue;
    }
    let n = g.niveles.find((x) => x.nivel === u.nivel);
    if (!n) {
      n = { nivel: u.nivel, lugar: null, posiciones: [] };
      g.niveles.push(n);
    }
    if (u.posicion == null) n.lugar = u;
    else n.posiciones.push(u);
  }
  return [...mapa.values()];
}

/** Texto para el selector: "Bodega · Rack 3 · Nivel 2 · Pos. 4". */
export function nombreUbicacion(u: Pick<Ubicacion, "bodega" | "rack" | "nivel" | "posicion">): string {
  const partes = [u.bodega, `Rack ${u.rack}`];
  if (u.nivel != null) partes.push(`Nivel ${u.nivel}`);
  if (u.posicion != null) partes.push(`Pos. ${u.posicion}`);
  return partes.join(" · ");
}

/** Lo que va en el QR pegado en el rack: abre el conteo con ese lugar elegido. */
export function urlEtiquetaLugar(codigo: string, origen = ""): string {
  return `${origen}/inventario/conteo?lugar=${encodeURIComponent(codigo)}`;
}

/** Los lugares donde se cuenta (niveles, o posiciones si el nivel las tiene; el rack solo si no tiene niveles). */
export function lugaresParaContar(lista: Ubicacion[]): Ubicacion[] {
  const activos = lista.filter((u) => u.activo);
  const tieneNiveles = new Set(activos.filter((u) => u.nivel != null).map((u) => `${u.empresa_id}|${u.bodega}|${u.rack}`));
  const tienePosiciones = new Set(activos.filter((u) => u.posicion != null).map((u) => `${u.empresa_id}|${u.bodega}|${u.rack}|${u.nivel}`));
  return activos.filter((u) => {
    if (u.nivel == null) return !tieneNiveles.has(`${u.empresa_id}|${u.bodega}|${u.rack}`);
    if (u.posicion == null) return !tienePosiciones.has(`${u.empresa_id}|${u.bodega}|${u.rack}|${u.nivel}`);
    return true;
  });
}
