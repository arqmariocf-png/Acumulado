import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { ETIQUETA_CRITERIO, usePerfilesJornada, type PerfilJornada } from "./PerfilesJornada";

interface FilaNomina {
  personal_id: string;
  personal_nombre: string;
  profile_id: string | null;
  contratacion_id: string | null;
  empresa_id: string | null;
  sueldo_semanal: number | null;
  perfil_jornada_id: string | null;
  perfil_nombre: string | null;
  criterio_pago: PerfilJornada["criterio_pago"] | null;
  horas_semana: number | null;
  dias_semana: number | null;
  hora_entrada: string | null;
  tolerancia_min: number | null;
  dias_checados: number;
  horas_trabajadas: number;
  horas_extra: number;
  retardos: number;
  monto_sugerido: number | null;
}

function dinero(n: number | null | undefined): string {
  return n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
}

/** Lista de nómina semanal a partir del checador y el perfil de jornada de
 * cada persona. Solo lectura del cálculo; RH cambia el perfil por persona. */
export function NominaChecador({ semanaInicio, nombreEmpresa }: { semanaInicio: string; nombreEmpresa: Map<string, string> }) {
  const queryClient = useQueryClient();
  const { data: perfiles } = usePerfilesJornada();
  const { data: filas, isLoading, error } = useQuery({
    queryKey: ["nomina-checador", semanaInicio],
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc("fn_nomina_semanal_checador", { p_semana: semanaInicio });
      if (err) throw err;
      return (data ?? []) as FilaNomina[];
    },
  });

  const cambiarPerfil = useMutation({
    mutationFn: async (p: { personalId: string; perfilId: string | null }) => {
      const { error: err } = await supabase.from("personal").update({ perfil_jornada_id: p.perfilId }).eq("id", p.personalId);
      if (err) throw err;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nomina-checador"] });
      queryClient.invalidateQueries({ queryKey: ["rh-personal"] });
    },
  });

  const conDatos = (filas ?? []).filter((f) => f.sueldo_semanal != null || f.dias_checados > 0);
  const total = conDatos.reduce((s, f) => s + Number(f.monto_sugerido ?? 0), 0);
  const totalSueldo = conDatos.reduce((s, f) => s + Number(f.sueldo_semanal ?? 0), 0);

  return (
    <div className="mb-6">
      {isLoading && <p className="text-sm text-slate-500">Calculando…</p>}
      {error && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Perfil de jornada</th>
              <th className="px-3 py-2 text-right">Días</th>
              <th className="px-3 py-2 text-right">Horas</th>
              <th className="px-3 py-2 text-right">Retardos</th>
              <th className="px-3 py-2 text-right">Sueldo semanal</th>
              <th className="px-3 py-2 text-right">Pago sugerido</th>
            </tr>
          </thead>
          <tbody>
            {conDatos.map((f) => {
              const pct = f.horas_semana ? Math.round((Number(f.horas_trabajadas) / Number(f.horas_semana)) * 100) : null;
              const diferencia = f.sueldo_semanal != null && f.monto_sugerido != null ? Number(f.monto_sugerido) - Number(f.sueldo_semanal) : 0;
              return (
                <tr key={f.personal_id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    {f.personal_nombre}
                    {!f.profile_id && <div className="text-[11px] text-amber-700">sin cuenta ligada: no hay checador</div>}
                    {!f.contratacion_id && <div className="text-[11px] text-amber-700">sin contratación vigente</div>}
                  </td>
                  <td className="px-3 py-2 text-slate-500">{f.empresa_id ? (nombreEmpresa.get(f.empresa_id) ?? "—") : "—"}</td>
                  <td className="px-3 py-2">
                    <select
                      value={f.perfil_jornada_id ?? ""}
                      onChange={(e) => cambiarPerfil.mutate({ personalId: f.personal_id, perfilId: e.target.value || null })}
                      className="max-w-[220px] rounded border border-slate-300 px-1 py-0.5 text-xs"
                      title={f.criterio_pago ? ETIQUETA_CRITERIO[f.criterio_pago] : ""}
                    >
                      <option value="">(perfil base)</option>
                      {perfiles?.filter((p) => p.activo || p.id === f.perfil_jornada_id).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre}
                        </option>
                      ))}
                    </select>
                    {f.criterio_pago && <div className="text-[10px] text-slate-400">{ETIQUETA_CRITERIO[f.criterio_pago]}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {f.dias_checados}
                    <span className="text-slate-400">/{f.dias_semana ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(f.horas_trabajadas).toFixed(1)}
                    <span className="text-slate-400">/{f.horas_semana ?? "—"}</span>
                    {pct != null && <div className={`text-[10px] ${pct >= 100 ? "text-emerald-700" : pct >= 80 ? "text-slate-500" : "text-amber-700"}`}>{pct}%{Number(f.horas_extra) > 0 ? ` · +${Number(f.horas_extra).toFixed(1)} extra` : ""}</div>}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${f.retardos > 0 ? "text-amber-700" : ""}`}>{f.retardos}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{dinero(f.sueldo_semanal)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {dinero(f.monto_sugerido)}
                    {diferencia !== 0 && <div className={`text-[10px] ${diferencia < 0 ? "text-red-600" : "text-emerald-700"}`}>{diferencia < 0 ? "" : "+"}{dinero(diferencia)}</div>}
                  </td>
                </tr>
              );
            })}
            {!isLoading && conDatos.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  Sin personas con contratación vigente ni marcas esta semana.
                </td>
              </tr>
            )}
          </tbody>
          {conDatos.length > 0 && (
            <tfoot className="bg-slate-50 text-sm font-medium">
              <tr>
                <td colSpan={6} className="px-3 py-2">
                  Total ({conDatos.length} persona{conDatos.length === 1 ? "" : "s"})
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{dinero(totalSueldo)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{dinero(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Horas = tramos entrada→salida menos la comida, redondeadas según el perfil. Retardos = entradas después de la hora de entrada más la tolerancia. El pago sugerido es una referencia: sueldo fijo, proporcional a días con entrada o a horas trabajadas (con extra si el perfil lo paga). Las marcas anuladas no cuentan.
      </p>
    </div>
  );
}
