import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { notificarTarjeta } from "../../lib/tareasNotificar";
import type { Profile } from "../../types/database";

/** Misma regla que auth_opera_cumplimiento(): admin o permiso 'legal' o 'cumplimiento'. */
export function operaCumplimiento(perfil: Profile | null | undefined): boolean {
  if (!perfil) return false;
  const m = perfil.modulos ?? [];
  return perfil.rol === "admin" || m.includes("legal") || m.includes("cumplimiento");
}

/** auth_ve_cumplimiento(): lo anterior o dirección. */
export function veCumplimiento(perfil: Profile | null | undefined): boolean {
  return operaCumplimiento(perfil) || perfil?.rol === "direccion";
}

export const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
export const boton = "rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
export const botonSuave = "rounded border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50";

export interface Persona {
  id: string;
  nombre: string;
}

export function useDirectorio() {
  return useQuery({
    queryKey: ["directorio"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_directorio").select("id, nombre").eq("activo", true).order("nombre");
      if (error) throw error;
      return (data ?? []) as Persona[];
    },
  });
}

export function useTablerosVisibles() {
  return useQuery({
    queryKey: ["tableros-para-mi"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tableros").select("id, nombre, archivado").order("nombre");
      if (error) throw error;
      return ((data ?? []) as { id: string; nombre: string; archivado: boolean }[]).filter((t) => !t.archivado);
    },
  });
}

const CLAVE_TABLERO = "cumplimiento:tablero";

export function tableroRecordado(): string {
  try {
    return localStorage.getItem(CLAVE_TABLERO) ?? "";
  } catch {
    return "";
  }
}

export function recordarTablero(id: string): void {
  try {
    localStorage.setItem(CLAVE_TABLERO, id);
  } catch {
    // Solo es comodidad.
  }
}

export interface AccionParaTarea {
  texto: string;
  responsable_id: string | null;
  fecha: string | null;
}

/** Crea una tarjeta por acción en la primera columna del tablero (con su
 * responsable, fecha y aviso push) y la registra en cumplimiento_acciones. */
export async function crearTareas(opts: {
  acciones: AccionParaTarea[];
  tableroId: string;
  creadorId: string;
  origen: { norma_id?: string; incidencia_id?: string };
  prefijo: string;
  descripcion: string;
}): Promise<number> {
  const { data: col, error: e1 } = await supabase.from("tablero_columnas").select("id").eq("tablero_id", opts.tableroId).order("orden").limit(1).maybeSingle();
  if (e1) throw e1;
  if (!col) throw new Error("Ese tablero no tiene columnas.");
  const { count } = await supabase.from("tarjetas").select("id", { count: "exact", head: true }).eq("columna_id", col.id);
  let orden = count ?? 0;
  let hechas = 0;
  for (const a of opts.acciones) {
    if (!a.texto.trim()) continue;
    const { data: t, error } = await supabase
      .from("tarjetas")
      .insert({
        tablero_id: opts.tableroId,
        columna_id: col.id,
        titulo: `${opts.prefijo}: ${a.texto.trim()}`.slice(0, 300),
        descripcion: opts.descripcion,
        creado_por: opts.creadorId,
        asignado_a: a.responsable_id || opts.creadorId,
        fecha_limite: a.fecha || null,
        orden: orden++,
      })
      .select("id")
      .single();
    if (error) throw error;
    await supabase.from("tarjeta_actividad").insert({ tarjeta_id: t.id, tipo: "creada", actor_id: opts.creadorId });
    const { error: e2 } = await supabase.from("cumplimiento_acciones").insert({
      ...opts.origen,
      texto: a.texto.trim(),
      responsable_id: a.responsable_id || opts.creadorId,
      fecha: a.fecha || null,
      tarjeta_id: t.id,
    });
    if (e2) throw e2;
    if (a.responsable_id && a.responsable_id !== opts.creadorId) notificarTarjeta(t.id, "asignada");
    hechas++;
  }
  return hechas;
}

export interface AccionRegistrada {
  id: string;
  texto: string;
  responsable_nombre: string | null;
  fecha: string | null;
  tarjeta_id: string | null;
  tablero_id: string | null;
  terminada: boolean | null;
  tarjeta_cerrada: boolean | null;
}

export function useAcciones(filtro: { norma_id?: string; incidencia_id?: string }) {
  const clave = filtro.norma_id ?? filtro.incidencia_id ?? "";
  return useQuery({
    queryKey: ["cumplimiento-acciones", clave],
    enabled: !!clave,
    queryFn: async () => {
      let q = supabase
        .from("v_cumplimiento_acciones")
        .select("id, texto, responsable_nombre, fecha, tarjeta_id, tablero_id, terminada, tarjeta_cerrada")
        .order("fecha", { nullsFirst: false });
      q = filtro.norma_id ? q.eq("norma_id", filtro.norma_id) : q.eq("incidencia_id", filtro.incidencia_id!);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AccionRegistrada[];
    },
  });
}

export function hoyMexico(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
