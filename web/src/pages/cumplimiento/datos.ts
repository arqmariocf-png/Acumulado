import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { EstatusNorma, Frecuencia, Incidencia, ResultadoPrueba } from "../../lib/cumplimientoNormativo";

// Lecturas de /cumplimiento compartidas entre pestañas (normas, controles,
// revisiones e incidencias).

export interface Norma {
  id: string;
  titulo: string;
  autoridad: string;
  referencia: string | null;
  fecha_publicacion: string | null;
  fecha_vigor: string | null;
  resumen: string | null;
  que_cambia: string | null;
  areas: string[];
  estatus: EstatusNorma;
  responsable_id: string | null;
  responsable_nombre: string | null;
  created_at: string;
}

export function useNormas() {
  return useQuery({
    queryKey: ["cumplimiento-normas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cumplimiento_normas").select("*").order("fecha_vigor", { nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Norma[];
    },
  });
}

export interface Control {
  id: string;
  clave: string;
  nombre: string;
  objetivo: string | null;
  como_se_prueba: string | null;
  area: string;
  prueba: string | null;
  frecuencia: Frecuencia;
  tolerancia_pct: number;
  responsable_id: string | null;
  responsable_nombre: string | null;
  activo: boolean;
}

export interface Prueba {
  id: string;
  control_id: string;
  periodo: string;
  desde: string;
  hasta: string;
  resultado: ResultadoPrueba;
  poblacion: number | null;
  excepciones: number | null;
  detalle: { empresa?: string; ref?: string; detalle?: string }[];
  comentario: string | null;
  evidencia: string | null;
  automatica: boolean;
  probado_por_nombre: string | null;
  created_at: string;
}

export function useControles() {
  return useQuery({
    queryKey: ["cumplimiento-controles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cumplimiento_controles").select("*").order("clave");
      if (error) throw error;
      return (data ?? []) as Control[];
    },
  });
}

export function usePruebas() {
  return useQuery({
    queryKey: ["cumplimiento-pruebas"],
    queryFn: async () => {
      const desde = new Date(Date.now() - 460 * 86_400_000).toISOString();
      const { data, error } = await supabase.from("cumplimiento_pruebas").select("*").gte("created_at", desde).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Prueba[];
    },
  });
}

export interface IncidenciaFila extends Incidencia {
  id: string;
  empresa_id: string;
  responsable_id: string | null;
  control_id: string | null;
  prueba_id: string | null;
  comunicado_a: string | null;
  comunicado_en: string | null;
  cerrada_en: string | null;
  created_at: string;
  empresas?: { codigo: string; nombre: string } | null;
}

export function useIncidencias() {
  return useQuery({
    queryKey: ["cumplimiento-incidencias"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cumplimiento_incidencias").select("*, empresas(codigo, nombre)").order("detectada_el", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as IncidenciaFila[]).map((i) => ({ ...i, empresa: i.empresas?.nombre ?? null }));
    },
  });
}
