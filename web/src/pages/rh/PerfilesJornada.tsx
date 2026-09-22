import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";

export interface PerfilJornada {
  id: string;
  nombre: string;
  horas_semana: number;
  dias_semana: number;
  criterio_pago: "fijo" | "por_dias" | "por_horas";
  hora_entrada: string | null;
  tolerancia_min: number;
  redondeo_min: number;
  pagar_extra: boolean;
  factor_extra: number;
  tope_extra_horas: number;
  es_base: boolean;
  notas: string | null;
  activo: boolean;
}

export const ETIQUETA_CRITERIO: Record<PerfilJornada["criterio_pago"], string> = {
  fijo: "Sueldo fijo",
  por_dias: "Por días con entrada",
  por_horas: "Por horas trabajadas",
};

export function usePerfilesJornada() {
  return useQuery({
    queryKey: ["perfiles-jornada"],
    queryFn: async () => {
      const { data, error } = await supabase.from("perfiles_jornada").select("*").order("es_base", { ascending: false }).order("nombre");
      if (error) throw error;
      return data as PerfilJornada[];
    },
  });
}

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";

function leerForm(fd: FormData) {
  return {
    nombre: String(fd.get("nombre") ?? "").trim(),
    horas_semana: Number(fd.get("horas_semana")),
    dias_semana: Number(fd.get("dias_semana")),
    criterio_pago: String(fd.get("criterio_pago")) as PerfilJornada["criterio_pago"],
    hora_entrada: String(fd.get("hora_entrada") ?? "") || null,
    tolerancia_min: Number(fd.get("tolerancia_min")) || 0,
    redondeo_min: Number(fd.get("redondeo_min")) || 0,
    pagar_extra: fd.get("pagar_extra") === "on",
    factor_extra: Number(fd.get("factor_extra")) || 2,
    tope_extra_horas: Number(fd.get("tope_extra_horas")) || 0,
    notas: String(fd.get("notas") ?? "").trim() || null,
  };
}

function FormPerfil({ inicial, onGuardar, onCancelar, guardando }: { inicial?: PerfilJornada; onGuardar: (v: ReturnType<typeof leerForm>) => void; onCancelar: () => void; guardando: boolean }) {
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onGuardar(leerForm(new FormData(e.currentTarget)));
  }
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-2 gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-6">
      <div className="col-span-2">
        <label className={etiqueta}>Nombre *</label>
        <input name="nombre" required defaultValue={inicial?.nombre} className={campo} />
      </div>
      <div>
        <label className={etiqueta}>Horas / semana *</label>
        <input name="horas_semana" type="number" step="0.5" min="1" max="84" required defaultValue={inicial?.horas_semana ?? 48} className={campo} />
      </div>
      <div>
        <label className={etiqueta}>Días / semana *</label>
        <input name="dias_semana" type="number" min="1" max="7" required defaultValue={inicial?.dias_semana ?? 6} className={campo} />
      </div>
      <div className="col-span-2">
        <label className={etiqueta}>Criterio de pago</label>
        <select name="criterio_pago" defaultValue={inicial?.criterio_pago ?? "por_dias"} className={campo}>
          {(Object.keys(ETIQUETA_CRITERIO) as PerfilJornada["criterio_pago"][]).map((c) => (
            <option key={c} value={c}>
              {ETIQUETA_CRITERIO[c]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={etiqueta}>Hora de entrada</label>
        <input name="hora_entrada" type="time" defaultValue={inicial?.hora_entrada?.slice(0, 5) ?? ""} className={campo} />
      </div>
      <div>
        <label className={etiqueta}>Tolerancia (min)</label>
        <input name="tolerancia_min" type="number" min="0" max="120" defaultValue={inicial?.tolerancia_min ?? 15} className={campo} />
      </div>
      <div>
        <label className={etiqueta}>Redondeo horas (min)</label>
        <select name="redondeo_min" defaultValue={inicial?.redondeo_min ?? 15} className={campo}>
          {[0, 5, 10, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m === 0 ? "Sin redondeo" : `${m} min`}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end">
        <label className="flex items-center gap-1 text-xs text-slate-700">
          <input name="pagar_extra" type="checkbox" defaultChecked={inicial?.pagar_extra ?? false} /> Paga horas extra
        </label>
      </div>
      <div>
        <label className={etiqueta}>Factor extra</label>
        <input name="factor_extra" type="number" step="0.5" min="1" defaultValue={inicial?.factor_extra ?? 2} className={campo} />
      </div>
      <div>
        <label className={etiqueta}>Tope extra (h/sem)</label>
        <input name="tope_extra_horas" type="number" step="0.5" min="0" defaultValue={inicial?.tope_extra_horas ?? 9} className={campo} />
      </div>
      <div className="col-span-2 sm:col-span-4">
        <label className={etiqueta}>Notas</label>
        <input name="notas" defaultValue={inicial?.notas ?? ""} className={campo} />
      </div>
      <div className="col-span-2 flex items-end gap-2">
        <button disabled={guardando} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {guardando ? "Guardando…" : "Guardar perfil"}
        </button>
        <button type="button" onClick={onCancelar} className="text-xs text-slate-500 underline">
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Perfiles de jornada: horas y días por semana y criterio de pago que la
 * nómina semanal aplica sobre el checador. */
export function PerfilesJornada() {
  const queryClient = useQueryClient();
  const { data: perfiles } = usePerfilesJornada();
  const [nuevo, setNuevo] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["perfiles-jornada"] });
    queryClient.invalidateQueries({ queryKey: ["nomina-checador"] });
  };
  const guardar = useMutation({
    mutationFn: async (p: { id?: string; valores: ReturnType<typeof leerForm> & { activo?: boolean; es_base?: boolean } }) => {
      const { error: err } = p.id ? await supabase.from("perfiles_jornada").update(p.valores).eq("id", p.id) : await supabase.from("perfiles_jornada").insert(p.valores);
      if (err) throw err;
    },
    onSuccess: () => {
      setNuevo(false);
      setEditando(null);
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });
  const cambiar = useMutation({
    mutationFn: async (p: { id: string; cambios: Partial<PerfilJornada> }) => {
      if (p.cambios.es_base) {
        const { error: e1 } = await supabase.from("perfiles_jornada").update({ es_base: false }).eq("es_base", true);
        if (e1) throw e1;
      }
      const { error: err } = await supabase.from("perfiles_jornada").update(p.cambios).eq("id", p.id);
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Perfiles de jornada (conteo de horas por semana)</h3>
          <p className="text-xs text-slate-500">Cada persona tiene un perfil; el perfil base aplica a quien no tenga uno asignado. El criterio decide cómo se calcula el pago sugerido.</p>
        </div>
        <button onClick={() => setNuevo((v) => !v)} className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white">
          {nuevo ? "Cancelar" : "+ Nuevo perfil"}
        </button>
      </div>
      {nuevo && <div className="mb-3"><FormPerfil onGuardar={(v) => guardar.mutate({ valores: v })} onCancelar={() => setNuevo(false)} guardando={guardar.isPending} /></div>}
      {error && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Perfil</th>
              <th className="px-3 py-2 text-right">Horas/sem</th>
              <th className="px-3 py-2 text-right">Días/sem</th>
              <th className="px-3 py-2">Criterio</th>
              <th className="px-3 py-2">Entrada · tolerancia</th>
              <th className="px-3 py-2">Extra</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {perfiles?.map((p) =>
              editando === p.id ? (
                <tr key={p.id} className="border-t border-slate-100">
                  <td colSpan={7} className="p-2">
                    <FormPerfil inicial={p} onGuardar={(v) => guardar.mutate({ id: p.id, valores: v })} onCancelar={() => setEditando(null)} guardando={guardar.isPending} />
                  </td>
                </tr>
              ) : (
                <tr key={p.id} className={`border-t border-slate-100 ${p.activo ? "" : "text-slate-400"}`}>
                  <td className="px-3 py-2">
                    {p.nombre}
                    {p.es_base && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-700">base</span>}
                    {p.notas && <div className="text-[11px] text-slate-400">{p.notas}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.horas_semana}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.dias_semana}</td>
                  <td className="px-3 py-2">{ETIQUETA_CRITERIO[p.criterio_pago]}</td>
                  <td className="px-3 py-2">{p.hora_entrada ? `${p.hora_entrada.slice(0, 5)} · ${p.tolerancia_min} min` : "—"}</td>
                  <td className="px-3 py-2">{p.pagar_extra ? `×${p.factor_extra} hasta ${p.tope_extra_horas} h` : "no"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                    <button onClick={() => setEditando(p.id)} className="mr-2 text-slate-700 underline">
                      Editar
                    </button>
                    {!p.es_base && p.activo && (
                      <button onClick={() => cambiar.mutate({ id: p.id, cambios: { es_base: true } })} className="mr-2 text-slate-500 underline">
                        Hacer base
                      </button>
                    )}
                    {!p.es_base && (
                      <button onClick={() => cambiar.mutate({ id: p.id, cambios: { activo: !p.activo } })} className="text-slate-500 underline">
                        {p.activo ? "Desactivar" : "Activar"}
                      </button>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
