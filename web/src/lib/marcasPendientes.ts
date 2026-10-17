// Reglas puras de la cola de marcas del checador (sin IndexedDB, para
// probarlas en node). La cola vive en colaOffline.ts.

/** ¿Esta marca del teléfono ya está en el servidor? (mismo tipo y la misma
 * hora con 2 minutos de tolerancia). Pasa cuando el envío sí llegó pero la
 * respuesta no: la copia local se quedaba atorada y se reenviaba siempre
 * (Maria Fernanda, 17-oct-2026: su entrada del 9-oct, ya registrada, se
 * rechazaba "por más de 7 días" cada vez que abría el checador). */
export function yaRegistrada(m: { tipo: string; marcadaEn: string }, registros: { tipo: string; created_at: string }[]): boolean {
  const t = Date.parse(m.marcadaEn);
  return registros.some((r) => r.tipo === m.tipo && Math.abs(Date.parse(r.created_at) - t) <= 120_000);
}

/** Las marcas rechazadas por el servidor ya no esperan turno: no obligan a
 * guardar en el teléfono las nuevas ni se reenvían solas. */
export function pendientesPorEnviar<T extends { error?: string | null }>(lista: T[]): T[] {
  return lista.filter((m) => !m.error);
}
