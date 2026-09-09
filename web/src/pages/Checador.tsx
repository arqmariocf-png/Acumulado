import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

interface RegistroChecador {
  id: string;
  profile_id: string;
  tipo: "entrada" | "salida";
  created_at: string;
}

const DIAS_HISTORIAL = 14;

function useRegistros(profileId: string) {
  return useQuery({
    queryKey: ["checador-registros", profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - DIAS_HISTORIAL);
      desde.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("checador_registros")
        .select("*")
        .eq("profile_id", profileId)
        .gte("created_at", desde.toISOString())
        .order("created_at");
      if (error) throw error;
      return data as RegistroChecador[];
    },
  });
}

/** Empareja entrada->salida en orden y suma la duración en horas. Un
 * "entrada" sin "salida" que le siga (turno abierto, ej. hoy antes de
 * salir) simplemente no cuenta todavía -- no se inventa una hora de salida. */
function horasTrabajadas(registros: RegistroChecador[]): number {
  let totalMs = 0;
  let entradaAbierta: string | null = null;
  for (const r of registros) {
    if (r.tipo === "entrada") {
      entradaAbierta = r.created_at;
    } else if (r.tipo === "salida" && entradaAbierta) {
      totalMs += new Date(r.created_at).getTime() - new Date(entradaAbierta).getTime();
      entradaAbierta = null;
    }
  }
  return totalMs / 3_600_000;
}

function agruparPorDia(registros: RegistroChecador[]): { fecha: string; registros: RegistroChecador[] }[] {
  const porDia = new Map<string, RegistroChecador[]>();
  for (const r of registros) {
    const fecha = r.created_at.slice(0, 10);
    const lista = porDia.get(fecha) ?? [];
    lista.push(r);
    porDia.set(fecha, lista);
  }
  return [...porDia.entries()].map(([fecha, registros]) => ({ fecha, registros })).sort((a, b) => b.fecha.localeCompare(a.fecha));
}

function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function fechaCorta(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });
}

export function Checador() {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const { data: registros, isLoading } = useRegistros(perfil?.id ?? "");

  const ultimoRegistro = registros?.length ? registros[registros.length - 1] : null;
  const dentro = ultimoRegistro?.tipo === "entrada";
  const proximoTipo = dentro ? "salida" : "entrada";

  const hoyIso = new Date().toISOString().slice(0, 10);
  const registrosHoy = useMemo(() => (registros ?? []).filter((r) => r.created_at.slice(0, 10) === hoyIso), [registros, hoyIso]);
  const horasHoy = useMemo(() => horasTrabajadas(registrosHoy), [registrosHoy]);
  const historial = useMemo(() => agruparPorDia(registros ?? []), [registros]);

  const marcar = useMutation({
    mutationFn: async (tipo: "entrada" | "salida") => {
      const { error } = await supabase.from("checador_registros").insert({ profile_id: perfil!.id, tipo });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["checador-registros", perfil?.id] }),
  });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Checador</h1>

      <div className="mb-6 rounded border border-slate-200 bg-white p-6 text-center">
        <p className="mb-1 text-sm text-slate-500">
          {ultimoRegistro ? `Última marca: ${ultimoRegistro.tipo} a las ${horaCorta(ultimoRegistro.created_at)}` : "Sin marcas todavía"}
        </p>
        <p className={`mb-4 text-2xl font-semibold ${dentro ? "text-emerald-700" : "text-slate-500"}`}>
          {dentro ? "Dentro" : "Fuera"}
        </p>
        <button
          onClick={() => marcar.mutate(proximoTipo)}
          disabled={marcar.isPending}
          className={`rounded px-6 py-3 text-lg font-semibold text-white disabled:opacity-50 ${proximoTipo === "entrada" ? "bg-emerald-700" : "bg-slate-900"}`}
        >
          {marcar.isPending ? "Marcando…" : proximoTipo === "entrada" ? "Marcar entrada" : "Marcar salida"}
        </button>
        <p className="mt-4 text-sm text-slate-600">
          Horas trabajadas hoy: <span className="font-medium text-slate-900">{horasHoy.toFixed(1)} h</span>
        </p>
        {marcar.isError && <p className="mt-2 text-sm text-red-600">{(marcar.error as Error).message}</p>}
      </div>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      <h2 className="mb-2 text-sm font-semibold text-slate-700">Últimos {DIAS_HISTORIAL} días</h2>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Día</th>
              <th className="px-3 py-2">Marcas</th>
              <th className="px-3 py-2 text-right">Horas</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((dia) => (
              <tr key={dia.fecha} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2">{fechaCorta(dia.fecha)}</td>
                <td className="px-3 py-2 text-slate-600">
                  {dia.registros.map((r) => `${r.tipo === "entrada" ? "→" : "←"} ${horaCorta(r.created_at)}`).join("  ")}
                </td>
                <td className="px-3 py-2 text-right font-medium">{horasTrabajadas(dia.registros).toFixed(1)} h</td>
              </tr>
            ))}
            {historial.length === 0 && !isLoading && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-slate-400">
                  Sin marcas en los últimos {DIAS_HISTORIAL} días.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
