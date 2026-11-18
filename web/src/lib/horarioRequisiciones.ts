// Horario para pedir requisiciones y candado de "requerimientos pasados"
// (18-nov-2026, Mario: "hay que quitar que se pueda modificar los
// requerimientos pasados"; "hay que agregar los horarios de requerimiento").
// La base manda (trigger requisiciones_horario_guard y
// auth_requisiciones_editables); aquí la misma regla para pintar avisos y
// esconder botones. Todo en hora de México.

export interface HorarioRequisiciones {
  activo: boolean;
  dias_semana: number[]; // ISO: 1 lunes … 7 domingo
  hora_desde: string; // "08:00" o "08:00:00"
  hora_hasta: string;
  nota?: string | null;
}

export const HORARIO_POR_DEFECTO: HorarioRequisiciones = { activo: true, dias_semana: [1, 2, 3, 4, 5, 6], hora_desde: "08:00", hora_hasta: "18:00", nota: null };

const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** Roles que piden en obra y se sujetan al horario (misma lista que
 * fn_requisiciones_horario_aplica). */
export function horarioAplicaA(rol: string | null | undefined): boolean {
  return ["operativo", "administrativo", "supervisor", "directivo", "responsable", "produccion"].includes(rol ?? "");
}

/** Fecha y hora en México como { dia ISO, minutos del día, fecha yyyy-mm-dd }. */
export function momentoMx(d: Date): { dia: number; minutos: number; fecha: string } {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  const dias: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const hora = Number(v("hour")) % 24;
  return { dia: dias[v("weekday")] ?? 0, minutos: hora * 60 + Number(v("minute")), fecha: `${v("year")}-${v("month")}-${v("day")}` };
}

function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** ¿Está abierto el horario en ese momento? Sin horario o inactivo → sí. */
export function horarioAbierto(h: HorarioRequisiciones | null | undefined, ahora: Date): boolean {
  if (!h || !h.activo) return true;
  const m = momentoMx(ahora);
  return h.dias_semana.includes(m.dia) && m.minutos >= minutosDe(h.hora_desde) && m.minutos < minutosDe(h.hora_hasta);
}

/** "lun, mar, mié, jue, vie, sáb de 08:00 a 18:00". */
export function textoHorario(h: HorarioRequisiciones | null | undefined): string {
  if (!h || !h.activo) return "sin horario: se reciben a cualquier hora";
  const dias = [...h.dias_semana].sort((a, b) => a - b).map((d) => DIAS[d - 1]).join(", ");
  return `${dias} de ${h.hora_desde.slice(0, 5)} a ${h.hora_hasta.slice(0, 5)}`;
}

/** ¿Quien la pidió todavía la puede editar? Mismo día MX, enviada, sin
 * avanzar y con el horario abierto. Admin y corporativo siempre. */
export function requisicionEditable(
  perfil: { id: string; rol: string } | null | undefined,
  req: { solicitado_por?: string | null; estado?: string | null; etapa?: string | null; created_at?: string | null },
  h: HorarioRequisiciones | null | undefined,
  ahora: Date,
): boolean {
  if (!perfil) return false;
  if (perfil.rol === "admin" || perfil.rol === "corporativo") return true;
  if (req.solicitado_por !== perfil.id || req.estado !== "enviada" || (req.etapa ?? "solicitada") !== "solicitada") return false;
  if (!req.created_at) return false;
  if (momentoMx(new Date(req.created_at)).fecha !== momentoMx(ahora).fecha) return false;
  return horarioAbierto(h, ahora);
}

/** Qué decir cuando no se puede mandar o editar. */
export function motivoCerrado(h: HorarioRequisiciones | null | undefined): string {
  return `Las requisiciones se reciben ${textoHorario(h)} (hora de México).`;
}

/** Validación del formulario de horario. */
export function revisarHorario(h: HorarioRequisiciones): string | null {
  if (!h.dias_semana.length) return "Elige al menos un día.";
  if (minutosDe(h.hora_hasta) <= minutosDe(h.hora_desde)) return "La hora de cierre debe ser después de la de apertura.";
  return null;
}
