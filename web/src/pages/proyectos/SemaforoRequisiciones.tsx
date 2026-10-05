import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { CLASE_ETAPA, ETAPAS_REQUISICION, ETIQUETA_ETAPA, avanceRequisiciones, puedeMarcarEtapa, semaforoEtapa, siguienteEtapa, type EtapaRequisicion } from "../../lib/requisicionEtapa";
import type { Proyecto } from "../../types/database";

// Requisiciones (requerimientos) de un proyecto con su semáforo de
// suministro (Mario, 26-sep-2026): autorización → pago → suministro →
// bodega → tránsito → recibido. Quien tiene el paso siguiente lo marca aquí.

interface Fila {
  id: string;
  folio: number;
  fecha: string;
  estado: string;
  etapa: EtapaRequisicion;
  etapa_en: string;
  comentario: string | null;
  solicitado_por: string;
  profiles: { nombre: string } | null;
  avance_pct: number | null;
  partidas: number;
  en_obra: number;
}

export function useRequisicionesProyecto(proyectoId: string) {
  return useQuery({
    queryKey: ["requisiciones-proyecto", proyectoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("requisiciones")
        .select("id, folio, fecha, estado, etapa, etapa_en, comentario, solicitado_por, profiles!requisiciones_solicitado_por_fkey(nombre)")
        .eq("proyecto_id", proyectoId)
        .order("fecha", { ascending: false })
        .limit(200);
      if (error) throw error;
      const filas = data as unknown as Fila[];
      const ids = filas.map((f) => f.id);
      const { data: av } = ids.length
        ? await supabase.from("v_requisicion_avance").select("requisicion_id, partidas, avance_pct, en_obra").in("requisicion_id", ids)
        : { data: [] };
      const porId = new Map((av ?? []).map((a) => [a.requisicion_id as string, a]));
      return filas.map((f) => {
        const a = porId.get(f.id);
        return { ...f, avance_pct: a ? Number(a.avance_pct) : null, partidas: Number(a?.partidas ?? 0), en_obra: Number(a?.en_obra ?? 0) };
      });
    },
  });
}

export function SemaforoRequisiciones({ proyecto, compacto = false }: { proyecto: Proyecto; compacto?: boolean }) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const q = useRequisicionesProyecto(proyecto.id);
  const [error, setError] = useState<string | null>(null);
  const [verRecibidas, setVerRecibidas] = useState(false);

  const marcar = useMutation({
    mutationFn: async ({ id, etapa }: { id: string; etapa: EtapaRequisicion }) => {
      const nota = window.prompt(`Marcar "${ETIQUETA_ETAPA[etapa]}". Nota (opcional):`);
      if (nota === null) return;
      const { error: err } = await supabase.rpc("fn_requisicion_etapa", { p_requisicion_id: id, p_etapa: etapa, p_nota: nota || null });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["requisiciones-proyecto", proyecto.id] });
      queryClient.invalidateQueries({ queryKey: ["requisiciones"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const filas = q.data ?? [];
  const vivas = filas.filter((f) => f.estado !== "cancelada");
  const avance = avanceRequisiciones(filas);
  const visibles = (verRecibidas ? filas : filas.filter((f) => f.etapa !== "recibida" && f.estado !== "cancelada")).slice(0, compacto ? 6 : undefined);
  const esDelProyecto = !!perfil && (perfil.id === proyecto.responsable_id || perfil.id === proyecto.comprador_id);

  return (
    <section className="mb-4 rounded border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium text-slate-900">Requerimientos · semáforo de suministro</h3>
          <p className="text-xs text-slate-500">Rojo: falta autorizar o pagar. Ámbar: pagada, en suministro. Azul: en bodega o en tránsito. Verde: recibida en obra.</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1 text-slate-600">
            <input type="checkbox" checked={verRecibidas} onChange={(e) => setVerRecibidas(e.target.checked)} /> ver recibidas
          </label>
          <Link to="/requisiciones" className="text-slate-600 hover:underline">
            Requisiciones →
          </Link>
        </div>
      </div>

      {q.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {q.error && <p className="text-sm text-red-600">{(q.error as Error).message}</p>}
      {error && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {q.data && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Conteo etiqueta="Avance de suministro" valor={avance === null ? "—" : `${avance}%`} detalle={`${vivas.length} requerimiento(s)`} />
            <Conteo etiqueta="Por autorizar / pagar" valor={String(vivas.filter((f) => semaforoEtapa(f.etapa).color === "rojo").length)} punto="bg-red-500" />
            <Conteo etiqueta="En camino" valor={String(vivas.filter((f) => ["ambar", "azul"].includes(semaforoEtapa(f.etapa).color)).length)} punto="bg-amber-500" />
            <Conteo etiqueta="Recibidos" valor={String(vivas.filter((f) => f.etapa === "recibida").length)} punto="bg-emerald-500" />
          </div>

          {visibles.length === 0 ? (
            <p className="text-sm text-slate-400">{filas.length === 0 ? "Este proyecto no tiene requerimientos todavía." : "Nada pendiente."}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visibles.map((r) => {
                const cancelada = r.estado === "cancelada";
                const s = semaforoEtapa(r.etapa, cancelada, r.avance_pct);
                const clase = CLASE_ETAPA[s.color];
                // De "en bodega" en adelante la etapa la ponen las partidas.
                const sigEtapa = cancelada ? null : siguienteEtapa(r.etapa);
                const sig = sigEtapa && ["en_bodega", "en_transito", "recibida"].includes(sigEtapa) ? null : sigEtapa;
                const puede = !!perfil && !!sig && puedeMarcarEtapa(perfil.rol, sig, esDelProyecto || perfil.id === r.solicitado_por);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className={`h-3 w-3 shrink-0 rounded-full ${clase.punto}`} title={s.etiqueta} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-slate-900">
                        Requerimiento #{r.folio} <span className="font-normal text-slate-500">· {r.fecha}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {r.profiles?.nombre ?? "—"}
                        {r.comentario && <> · {r.comentario}</>}
                        {" · "}
                        {s.etiqueta}
                      </div>
                    </div>
                    <div className="w-44" title={`${ETIQUETA_ETAPA[r.etapa]} · paso ${s.paso} de ${ETAPAS_REQUISICION.length}`}>
                      <div className="flex gap-0.5">
                        {ETAPAS_REQUISICION.map((e, i) => (
                          <span key={e} className={`h-1.5 flex-1 rounded-sm ${i < s.paso ? clase.barra : "bg-slate-100"}`} title={ETIQUETA_ETAPA[e]} />
                        ))}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {cancelada ? "Cancelada" : ETIQUETA_ETAPA[r.etapa]} · {s.pct}%
                        {r.partidas > 0 && !cancelada ? ` · ${r.en_obra}/${r.partidas} en obra` : ""}
                      </div>
                    </div>
                    {sig && puede && (
                      <button onClick={() => marcar.mutate({ id: r.id, etapa: sig })} disabled={marcar.isPending} className="shrink-0 rounded border border-slate-900 bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800 disabled:opacity-50">
                        Marcar {ETIQUETA_ETAPA[sig].toLowerCase()}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {compacto && filas.length > 6 && <p className="mt-2 text-xs text-slate-400">y más en Requisiciones.</p>}
        </>
      )}
    </section>
  );
}

function Conteo({ etiqueta, valor, detalle, punto }: { etiqueta: string; valor: string; detalle?: string; punto?: string }) {
  return (
    <div className="rounded bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase text-slate-500">
        {punto && <span className={`h-2.5 w-2.5 rounded-full ${punto}`} />} {etiqueta}
      </div>
      <div className="text-lg font-semibold tabular-nums text-slate-900">{valor}</div>
      {detalle && <div className="text-[11px] text-slate-400">{detalle}</div>}
    </div>
  );
}
