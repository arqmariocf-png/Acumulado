import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { CLASE_SEMAFORO_PU, PASOS_PU, contarSemaforoPu, semaforoPu, type ColorSemaforoPu } from "../../lib/puSemaforo";
import { ETIQUETA_ESTADO } from "../precios/comun";
import type { Proyecto, PuCosteo, PuEstado } from "../../types/database";

// Precios unitarios del proyecto con su semáforo (Mario, 26-sep-2026): qué
// está detenido adentro (elaboración, almacén, dirección, publicación) y qué
// espera al cliente. La autorización del cliente se registra aquí mismo.

interface AutorizacionCliente {
  id: string;
  cliente_autorizado_en: string | null;
  cliente_referencia: string | null;
}

function useAnalisisConSemaforo(proyectoId: string) {
  return useQuery({
    queryKey: ["pu-semaforo-proyecto", proyectoId],
    queryFn: async () => {
      const [{ data: costeo, error: e1 }, { data: cliente, error: e2 }] = await Promise.all([
        supabase.from("v_pu_analisis_costeo").select("*").eq("proyecto_id", proyectoId).order("codigo"),
        supabase.from("pu_analisis").select("id, cliente_autorizado_en, cliente_referencia").eq("proyecto_id", proyectoId),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      const porId = new Map(((cliente ?? []) as AutorizacionCliente[]).map((c) => [c.id, c]));
      return ((costeo ?? []) as PuCosteo[]).map((a) => ({ ...a, cliente: porId.get(a.analisis_id) ?? { id: a.analisis_id, cliente_autorizado_en: null, cliente_referencia: null } }));
    },
  });
}

const ETIQUETA_COLOR: Record<ColorSemaforoPu, string> = {
  rojo: "En elaboración / almacén",
  ambar: "Dirección / publicación",
  azul: "Esperando al cliente",
  verde: "Autorizado por el cliente",
  gris: "Obsoleto",
};

export function SemaforoPreciosUnitarios({ proyecto, compacto = false }: { proyecto: Proyecto; compacto?: boolean }) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const q = useAnalisisConSemaforo(proyecto.id);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<ColorSemaforoPu | "">("");

  const puedeAutorizarCliente =
    !!perfil && (["admin", "direccion", "corporativo", "empresa"].includes(perfil.rol) || perfil.id === proyecto.responsable_id || perfil.id === proyecto.comprador_id);

  const autorizar = useMutation({
    mutationFn: async ({ analisisId, autorizado, referencia }: { analisisId: string; autorizado: boolean; referencia?: string }) => {
      const { error: err } = await supabase.rpc("fn_pu_autorizar_cliente", { p_analisis_id: analisisId, p_autorizado: autorizado, p_referencia: referencia ?? null });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["pu-semaforo-proyecto", proyecto.id] });
      queryClient.invalidateQueries({ queryKey: ["pu-semaforo-proyectos"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const filas = q.data ?? [];
  const conteo = contarSemaforoPu(filas.map((f) => ({ estado: f.estado, cliente_autorizado_en: f.cliente.cliente_autorizado_en })));
  const visibles = filas.filter((f) => !filtro || semaforoPu(f.estado, f.cliente.cliente_autorizado_en).color === filtro);

  return (
    <section className="mb-4 rounded border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium text-slate-900">Precios unitarios · semáforo de autorización</h3>
          <p className="text-xs text-slate-500">Rojo y ámbar: pendiente interno. Azul: publicado, pendiente del cliente. Verde: autorizado por el cliente.</p>
        </div>
        <Link to={`/precios?proyecto=${proyecto.id}`} className="text-xs text-slate-600 hover:underline">
          + Nuevo análisis
        </Link>
      </div>

      {q.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {q.error && <p className="text-sm text-red-600">{(q.error as Error).message}</p>}

      {q.data && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Conteo etiqueta="Avance" valor={`${conteo.avance_pct}%`} detalle={`${conteo.total} análisis`} />
            <ConteoColor color="rojo" n={filas.filter((f) => semaforoPu(f.estado, f.cliente.cliente_autorizado_en).color === "rojo").length} activo={filtro === "rojo"} onClick={() => setFiltro(filtro === "rojo" ? "" : "rojo")} />
            <ConteoColor color="ambar" n={filas.filter((f) => semaforoPu(f.estado, f.cliente.cliente_autorizado_en).color === "ambar").length} activo={filtro === "ambar"} onClick={() => setFiltro(filtro === "ambar" ? "" : "ambar")} />
            <ConteoColor color="azul" n={conteo.cliente} activo={filtro === "azul"} onClick={() => setFiltro(filtro === "azul" ? "" : "azul")} />
            <ConteoColor color="verde" n={conteo.autorizado} activo={filtro === "verde"} onClick={() => setFiltro(filtro === "verde" ? "" : "verde")} />
          </div>

          {error && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          {visibles.length === 0 ? (
            <p className="text-sm text-slate-400">{filas.length === 0 ? "Sin análisis de precio unitario todavía." : "Nada en ese color."}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {visibles.slice(0, compacto ? 6 : undefined).map((a) => {
                const s = semaforoPu(a.estado, a.cliente.cliente_autorizado_en);
                const clase = CLASE_SEMAFORO_PU[s.color];
                return (
                  <li key={a.analisis_id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                    <span className={`h-3 w-3 shrink-0 rounded-full ${clase.punto}`} title={s.etiqueta} />
                    <div className="min-w-0 flex-1">
                      <Link to={`/precios/${a.analisis_id}`} className="font-medium text-slate-900 hover:underline">
                        {a.codigo} · {a.concepto}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {s.etiqueta}
                        {a.cliente.cliente_referencia && <> · ref. {a.cliente.cliente_referencia}</>}
                        {a.insumos_sin_precio > 0 && <span className="text-amber-700"> · {a.insumos_sin_precio} insumo(s) sin precio</span>}
                      </div>
                    </div>
                    <div className="w-40" title={`${s.paso} de ${PASOS_PU} pasos`}>
                      <div className="flex gap-0.5">
                        {Array.from({ length: PASOS_PU }, (_, i) => (
                          <span key={i} className={`h-1.5 flex-1 rounded-sm ${i < s.paso ? clase.barra : "bg-slate-100"}`} />
                        ))}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400">
                        {ETIQUETA_ESTADO[a.estado as PuEstado]} · {s.pct}%
                      </div>
                    </div>
                    <div className="w-24 text-right tabular-nums text-slate-700">${a.precio_unitario.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</div>
                    {puedeAutorizarCliente && a.estado === "publicado" && (
                      <button
                        onClick={() => {
                          if (a.cliente.cliente_autorizado_en) {
                            if (window.confirm("¿Quitar la autorización del cliente?")) autorizar.mutate({ analisisId: a.analisis_id, autorizado: false });
                            return;
                          }
                          const referencia = window.prompt("Referencia de la autorización del cliente (OC, folio, correo). Puede ir vacía:") ?? null;
                          if (referencia === null) return;
                          autorizar.mutate({ analisisId: a.analisis_id, autorizado: true, referencia });
                        }}
                        disabled={autorizar.isPending}
                        className={`shrink-0 rounded border px-2 py-1 text-xs ${a.cliente.cliente_autorizado_en ? "border-slate-300 text-slate-500 hover:bg-slate-50" : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"} disabled:opacity-50`}
                      >
                        {a.cliente.cliente_autorizado_en ? "Quitar autorización" : "Cliente autorizó"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {compacto && visibles.length > 6 && <p className="mt-2 text-xs text-slate-400">y {visibles.length - 6} más en la pestaña Cotización.</p>}
        </>
      )}
    </section>
  );
}

function Conteo({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle: string }) {
  return (
    <div className="rounded bg-slate-50 px-3 py-2">
      <div className="text-[11px] uppercase text-slate-500">{etiqueta}</div>
      <div className="text-lg font-semibold tabular-nums text-slate-900">{valor}</div>
      <div className="text-[11px] text-slate-400">{detalle}</div>
    </div>
  );
}

function ConteoColor({ color, n, activo, onClick }: { color: ColorSemaforoPu; n: number; activo: boolean; onClick: () => void }) {
  const clase = CLASE_SEMAFORO_PU[color];
  return (
    <button onClick={onClick} className={`rounded border px-3 py-2 text-left ${activo ? "border-slate-900" : "border-transparent bg-slate-50 hover:border-slate-300"}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase text-slate-500">
        <span className={`h-2.5 w-2.5 rounded-full ${clase.punto}`} /> {ETIQUETA_COLOR[color]}
      </div>
      <div className="text-lg font-semibold tabular-nums text-slate-900">{n}</div>
    </button>
  );
}

/** Puntos con conteo por color para la tarjeta de un proyecto en la lista. */
export function PuntosSemaforoPu({ filas }: { filas: { estado: PuEstado; cliente_autorizado_en: string | null }[] }) {
  if (filas.length === 0) return <p className="mt-2 text-xs text-slate-400">Sin precios unitarios.</p>;
  const porColor: Record<ColorSemaforoPu, number> = { rojo: 0, ambar: 0, azul: 0, verde: 0, gris: 0 };
  for (const f of filas) porColor[semaforoPu(f.estado, f.cliente_autorizado_en).color]++;
  const conteo = contarSemaforoPu(filas);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
      <span className="text-slate-500">PU {conteo.avance_pct}%</span>
      {(["rojo", "ambar", "azul", "verde", "gris"] as ColorSemaforoPu[])
        .filter((c) => porColor[c] > 0)
        .map((c) => (
          <span key={c} className="flex items-center gap-1" title={ETIQUETA_COLOR[c]}>
            <span className={`h-2.5 w-2.5 rounded-full ${CLASE_SEMAFORO_PU[c].punto}`} />
            {porColor[c]}
          </span>
        ))}
    </div>
  );
}
