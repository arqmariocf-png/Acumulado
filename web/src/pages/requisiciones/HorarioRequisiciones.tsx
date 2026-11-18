import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { HORARIO_POR_DEFECTO, horarioAbierto, revisarHorario, textoHorario, type HorarioRequisiciones } from "../../lib/horarioRequisiciones";

// Horario para pedir requisiciones (18-nov-2026, Mario: "hay que agregar
// los horarios de requerimiento"). Uno por organización; lo cambian admin,
// corporativo y dirección. Fuera del horario quien pide en obra no puede
// mandar ni editar (la base lo exige; aquí solo se avisa y se esconde).

export function useHorarioRequisiciones() {
  const { perfil } = useAuth();
  return useQuery({
    queryKey: ["requisiciones-horario", perfil?.grupo_id],
    enabled: !!perfil?.grupo_id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("requisiciones_horario").select("activo, dias_semana, hora_desde, hora_hasta, nota").eq("grupo_id", perfil!.grupo_id!).maybeSingle();
      if (error) throw error;
      return (data as HorarioRequisiciones | null) ?? null;
    },
  });
}

const DIAS: { n: number; t: string }[] = [
  { n: 1, t: "Lun" },
  { n: 2, t: "Mar" },
  { n: 3, t: "Mié" },
  { n: 4, t: "Jue" },
  { n: 5, t: "Vie" },
  { n: 6, t: "Sáb" },
  { n: 7, t: "Dom" },
];

/** Aviso corto para quien pide: horario y si ahora está abierto. */
export function AvisoHorario({ horario, aplica }: { horario: HorarioRequisiciones | null | undefined; aplica: boolean }) {
  if (!horario || !horario.activo) return null;
  const abierto = horarioAbierto(horario, new Date());
  return (
    <p className={`mb-2 rounded px-3 py-1.5 text-xs ${abierto || !aplica ? "border border-slate-200 bg-slate-50 text-slate-600" : "border border-amber-300 bg-amber-50 text-amber-800"}`}>
      Las requisiciones se reciben <span className="font-medium">{textoHorario(horario)}</span> (hora de México)
      {aplica && !abierto ? ". Ahora está cerrado: no se pueden mandar ni editar requisiciones hasta el siguiente horario." : "."}
      {horario.nota ? ` ${horario.nota}` : ""}
      {aplica && " Las de días anteriores ya no se editan."}
    </p>
  );
}

/** Configuración del horario (admin, corporativo, dirección). */
export function HorarioRequisicionesPanel() {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const { data: horario } = useHorarioRequisiciones();
  const puede = ["admin", "corporativo", "direccion"].includes(perfil?.rol ?? "");
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<HorarioRequisiciones>(HORARIO_POR_DEFECTO);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (horario) setForm({ ...horario, hora_desde: horario.hora_desde.slice(0, 5), hora_hasta: horario.hora_hasta.slice(0, 5) });
  }, [horario]);
  const guardar = useMutation({
    mutationFn: async () => {
      const falta = revisarHorario(form);
      if (falta) throw new Error(falta);
      const { error: err } = await supabase.from("requisiciones_horario").upsert({ grupo_id: perfil!.grupo_id, activo: form.activo, dias_semana: [...form.dias_semana].sort((a, b) => a - b), hora_desde: form.hora_desde, hora_hasta: form.hora_hasta, nota: form.nota?.trim() || null }, { onConflict: "grupo_id" });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      setAbierto(false);
      qc.invalidateQueries({ queryKey: ["requisiciones-horario"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  if (!puede) return null;
  return (
    <div className="mb-3 text-xs">
      <button type="button" onClick={() => setAbierto((v) => !v)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50">
        {abierto ? "Cerrar" : "Horario para pedir"} · {textoHorario(horario)}
      </button>
      {abierto && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            guardar.mutate();
          }}
          className="mt-2 flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-3"
          data-sin-borrador
        >
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} /> Aplicar horario
          </label>
          <div className="flex items-center gap-2">
            {DIAS.map((d) => (
              <label key={d.n} className="flex items-center gap-0.5">
                <input
                  type="checkbox"
                  checked={form.dias_semana.includes(d.n)}
                  onChange={(e) => setForm({ ...form, dias_semana: e.target.checked ? [...form.dias_semana, d.n] : form.dias_semana.filter((x) => x !== d.n) })}
                />
                {d.t}
              </label>
            ))}
          </div>
          <label>
            De <input type="time" value={form.hora_desde} onChange={(e) => setForm({ ...form, hora_desde: e.target.value })} className="rounded border border-slate-300 px-1 py-0.5" />
          </label>
          <label>
            a <input type="time" value={form.hora_hasta} onChange={(e) => setForm({ ...form, hora_hasta: e.target.value })} className="rounded border border-slate-300 px-1 py-0.5" />
          </label>
          <input value={form.nota ?? ""} onChange={(e) => setForm({ ...form, nota: e.target.value })} placeholder="Nota para quien pide (opcional)" className="min-w-[14rem] rounded border border-slate-300 px-2 py-0.5" />
          <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1 font-medium text-white disabled:opacity-50">
            Guardar
          </button>
          <span className="text-slate-500">Fuera del horario, supervisores, responsables y producción no pueden mandar ni editar; las requisiciones de días anteriores quedan cerradas para quien las pidió.</span>
          {error && <span className="text-red-600">{error}</span>}
        </form>
      )}
    </div>
  );
}
