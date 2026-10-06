import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { DIAS_CORTOS, proximaFecha, textoFrecuencia, type Frecuencia, type Recurrente } from "../../lib/recurrentes";

// Actividades recurrentes y programadas del tablero (Mario, 6-oct-2026:
// "dentro de las tareas y tableros poder dejar actividades recurrentes y
// programaciones"). Cada día a las 7:30 (Puebla) se crea la tarjeta con fecha
// límite ese día y a las 8:00 le llega el aviso a quien la tiene.

interface Fila extends Recurrente {
  id: string;
  empresa_id: string;
  tablero_id: string;
  titulo: string;
  descripcion: string | null;
  asignado_a: string;
  supervisor_id: string | null;
  creado_por: string | null;
}

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

function hoyMx(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

export function Recurrentes({ tableroId, empresaId, directorio }: { tableroId: string; empresaId: string | null; directorio: { id: string; nombre: string }[] }) {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [frecuencia, setFrecuencia] = useState<Frecuencia>("semanal");
  const [dias, setDias] = useState<number[]>([5]);
  const [error, setError] = useState<string | null>(null);
  const nombre = new Map(directorio.map((d) => [d.id, d.nombre]));
  const hoy = hoyMx();

  const { data: filas } = useQuery({
    queryKey: ["recurrentes", tableroId],
    queryFn: async () => {
      const { data, error } = await supabase.from("actividades_recurrentes").select("*").eq("tablero_id", tableroId).order("created_at");
      if (error) throw error;
      return (data ?? []) as Fila[];
    },
  });
  // Empresa para la frontera: la del tablero; si es corporativo, la principal de quien la crea.
  const { data: empresaDefecto } = useQuery({
    queryKey: ["empresa-defecto-recurrente", perfil?.id],
    enabled: !empresaId,
    queryFn: async () => {
      if (perfil?.empresa_id) return perfil.empresa_id;
      const { data } = await supabase.from("empresas").select("id").eq("activo", true).order("codigo").limit(1);
      return (data?.[0]?.id as string | undefined) ?? null;
    },
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["recurrentes", tableroId] });

  const crear = useMutation({
    mutationFn: async (fd: FormData) => {
      const titulo = String(fd.get("titulo") ?? "").trim();
      const asignado = String(fd.get("asignado_a") ?? "");
      if (!titulo) throw new Error("Escribe la actividad.");
      if (!asignado) throw new Error("Elige al responsable.");
      const empresa = empresaId ?? empresaDefecto;
      if (!empresa) throw new Error("No se encontró la empresa del tablero.");
      const fila = {
        tablero_id: tableroId,
        empresa_id: empresa,
        titulo,
        descripcion: String(fd.get("descripcion") ?? "").trim() || null,
        asignado_a: asignado,
        supervisor_id: String(fd.get("supervisor_id") ?? "") || null,
        frecuencia,
        dias_semana: frecuencia === "semanal" ? dias : [],
        dia_mes: frecuencia === "mensual" ? Number(fd.get("dia_mes") || 1) : null,
        fecha_unica: frecuencia === "unica" ? String(fd.get("fecha_unica") ?? "") || null : null,
        creado_por: perfil?.id,
      };
      if (frecuencia === "semanal" && dias.length === 0) throw new Error("Elige al menos un día.");
      if (frecuencia === "unica" && !fila.fecha_unica) throw new Error("Elige la fecha.");
      const { error } = await supabase.from("actividades_recurrentes").insert(fila);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: (e: Error) => setError(e.message),
  });

  const alternar = useMutation({
    mutationFn: async (f: Fila) => {
      const { error } = await supabase.from("actividades_recurrentes").update({ activa: !f.activa }).eq("id", f.id);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: (e: Error) => setError(e.message),
  });

  const borrar = useMutation({
    mutationFn: async (f: Fila) => {
      const { error } = await supabase.from("actividades_recurrentes").delete().eq("id", f.id);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    crear.mutate(new FormData(form), { onSuccess: () => form.reset() });
  }

  const lista = filas ?? [];
  return (
    <div className="mb-3">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="text-xs text-slate-600 underline">
        {abierto ? "Ocultar actividades recurrentes y programadas" : `Actividades recurrentes y programadas (${lista.filter((f) => f.activa).length})`}
      </button>
      {abierto && (
        <div className="mt-2 rounded border border-slate-200 bg-white p-3">
          <p className="mb-2 text-xs text-slate-500">Se crean solas en la primera columna a las 7:30 del día que toca, con fecha límite ese día; a las 8:00 le llega el aviso a quien la tiene.</p>
          {lista.length > 0 && (
            <ul className="mb-3 divide-y divide-slate-100 text-sm">
              {lista.map((f) => {
                const propia = perfil?.rol === "admin" || perfil?.id === f.creado_por;
                const prox = proximaFecha(f, hoy);
                return (
                  <li key={f.id} className={`flex flex-wrap items-center gap-2 py-1.5 ${f.activa ? "" : "opacity-60"}`}>
                    <span className="flex-1">
                      <span className="font-medium text-slate-900">{f.titulo}</span>
                      <span className="text-xs text-slate-500">
                        {" "}
                        · {textoFrecuencia(f)} · {nombre.get(f.asignado_a) ?? "?"}
                        {prox ? ` · próxima: ${prox.split("-").reverse().join("/")}` : f.activa ? "" : " · pausada"}
                      </span>
                    </span>
                    {propia && (
                      <>
                        <button type="button" onClick={() => alternar.mutate(f)} className="text-xs underline">
                          {f.activa ? "Pausar" : "Reanudar"}
                        </button>
                        <button type="button" onClick={() => confirm(`¿Borrar la programación "${f.titulo}"? Las tarjetas ya creadas se quedan.`) && borrar.mutate(f)} className="text-xs text-red-600 underline">
                          Borrar
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 sm:grid-cols-6">
            <input name="titulo" placeholder="Actividad (ej. Subir estados de cuenta)" className={`${campo} sm:col-span-2`} />
            <select name="asignado_a" defaultValue="" className={campo}>
              <option value="">Responsable…</option>
              {directorio.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
            <select name="supervisor_id" defaultValue="" className={campo}>
              <option value="">Sin supervisor</option>
              {directorio.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.nombre}
                </option>
              ))}
            </select>
            <select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as Frecuencia)} className={campo}>
              <option value="semanal">Por días de la semana</option>
              <option value="mensual">Cada mes</option>
              <option value="unica">Una sola vez (programada)</option>
            </select>
            <div className="flex items-center">
              {frecuencia === "mensual" && (
                <label className="text-xs text-slate-600">
                  Día <input name="dia_mes" type="number" min={1} max={31} defaultValue={1} className="w-16 rounded border border-slate-300 px-1 py-1 text-sm" />
                </label>
              )}
              {frecuencia === "unica" && <input name="fecha_unica" type="date" min={hoy} className={campo} />}
            </div>
            {frecuencia === "semanal" && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700 sm:col-span-6">
                {DIAS_CORTOS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1">
                    <input type="checkbox" checked={dias.includes(i + 1)} onChange={(e) => setDias((x) => (e.target.checked ? [...x, i + 1] : x.filter((y) => y !== i + 1)))} />
                    {d}
                  </label>
                ))}
                <button type="button" onClick={() => setDias([1, 2, 3, 4, 5])} className="underline">
                  lunes a viernes
                </button>
                <button type="button" onClick={() => setDias([1, 2, 3, 4, 5, 6, 7])} className="underline">
                  diario
                </button>
              </div>
            )}
            <input name="descripcion" placeholder="Detalle (opcional)" className={`${campo} sm:col-span-5`} />
            <button disabled={crear.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {crear.isPending ? "Guardando…" : "Programar"}
            </button>
          </form>
          {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}
