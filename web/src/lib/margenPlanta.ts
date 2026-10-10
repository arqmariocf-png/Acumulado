// Margen de la planta (Mario con Jaime, 10-oct-2026): el costo sale por
// PEPS de la existencia (o proyectado para un lote programado) y con él se
// calcula el margen contra el precio de venta, o el precio para lograr un
// margen. Todo sin IVA.

/** Margen sobre la venta (0.2 = 20 %); null sin precio. */
export function margenSobreVenta(precio: number | null | undefined, costo: number | null | undefined): number | null {
  if (!precio || precio <= 0 || costo == null) return null;
  return (precio - costo) / precio;
}

/** Precio sin IVA para lograr un margen sobre la venta (margen en %, p. ej. 20). */
export function precioParaMargen(costo: number | null | undefined, margenPct: number): number | null {
  if (costo == null || costo <= 0 || !(margenPct < 100)) return null;
  return Math.round((costo / (1 - margenPct / 100)) * 100) / 100;
}

/** Precio promedio ponderado de venta de partidas con precio. */
export function precioPromedio(partidas: { cantidad: number; precio_unitario: number | null }[]): number | null {
  let cant = 0;
  let venta = 0;
  for (const p of partidas) {
    if (p.precio_unitario == null) continue;
    cant += Number(p.cantidad);
    venta += Number(p.cantidad) * Number(p.precio_unitario);
  }
  return cant > 0 ? Math.round((venta / cant) * 10000) / 10000 : null;
}
