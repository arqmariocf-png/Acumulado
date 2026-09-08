export type Semaforo = "rojo" | "amarillo" | "verde";

// Rojo: ya venció. Amarillo: vence hoy o en los próximos 3 días. Verde: más
// tiempo que eso. El mismo criterio se usa en la tarjeta y en el calendario.
const DIAS_ALERTA_AMARILLA = 3;

export function isoDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDias(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function semaforoFecha(fechaLimite: string, hoyIso: string = isoDia(new Date())): Semaforo {
  if (fechaLimite < hoyIso) return "rojo";
  const limiteAmarillo = isoDia(addDias(new Date(hoyIso + "T00:00:00"), DIAS_ALERTA_AMARILLA));
  if (fechaLimite <= limiteAmarillo) return "amarillo";
  return "verde";
}

export const COLOR_SEMAFORO: Record<Semaforo, string> = {
  rojo: "bg-red-100 text-red-700",
  amarillo: "bg-amber-100 text-amber-700",
  verde: "bg-emerald-50 text-emerald-700",
};

export const BORDE_SEMAFORO: Record<Semaforo, string> = {
  rojo: "border-l-red-500",
  amarillo: "border-l-amber-500",
  verde: "border-l-emerald-500",
};
