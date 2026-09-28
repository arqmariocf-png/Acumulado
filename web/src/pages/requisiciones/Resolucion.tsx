import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import type { AvanceResolucionLinea, Existencia } from "../../types/database";
import { ComprasPorOrdenar } from "./ComprasPorOrdenar";
import { CompraEnUnPaso } from "./CompraEnUnPaso";


// Detalle (proyecto, empresa, concepto) de las líneas con algo sin resolver
// -- la vista avance_resolucion_linea no trae FKs declaradas (es un view),
// así que PostgREST no puede "embeder" a través de ella; se trae aparte y
// se cruza en el cliente por requisicion_linea_id.
function useLineasPendientes(empresaId: string) {
  return useQuery({
    queryKey: ["requisicion-lineas-pendientes", empresaId],
    queryFn: async () => {
      let query = supabase
        .from("requisicion_lineas")
        .select("id, requisicion_id, cantidad_solicitada, unidad_medida, descripcion, productos(id, nombre, sku), requisiciones(folio, fecha, empresa_id, proyectos(nombre))")
        .order("created_at", { ascending: true })
        .limit(300);
      const { data, error } = await query;
      if (error) throw error;
      const filtradas = empresaId ? data.filter((l: any) => l.requisiciones?.empresa_id === empresaId) : data;
      return filtradas;
    },
  });
}

function useAvanceLineas() {
  return useQuery({
    queryKey: ["avance-resolucion-linea"],
    queryFn: async () => {
      const { data, error } = await supabase.from("avance_resolucion_linea").select("*").gt("cantidad_sin_resolver", 0.001).limit(500);
      if (error) throw error;
      return data as AvanceResolucionLinea[];
    },
  });
}

function useExistencias(empresaId: string) {
  return useQuery({
    queryKey: ["existencias", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("existencias").select("*").eq("empresa_id", empresaId);
      if (error) throw error;
      return data as Existencia[];
    },
  });
}

export function Resolucion() {
  const { veTodasLasEmpresas, eligeEmpresa } = useAuth();
  const queryClient = useQueryClient();
  const [empresaFiltro, setEmpresaFiltro] = useEmpresaFiltro();

  const { data: lineas, isLoading: cargandoLineas } = useLineasPendientes(empresaFiltro);
  const { data: avances } = useAvanceLineas();
  const { data: existencias } = useExistencias(empresaFiltro);

  const [abierta, setAbierta] = useState<string | null>(null);
  const [compraAbierta, setCompraAbierta] = useState<string | null>(null);
  const [folioGenerado, setFolioGenerado] = useState<string | null>(null);
  const [cantidadEntrega, setCantidadEntrega] = useState<number>(0);
  const [cantidadCompra, setCantidadCompra] = useState<number>(0);
  const [proveedor, setProveedor] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const avancePorLinea = useMemo(() => {
    const m = new Map<string, AvanceResolucionLinea>();
    avances?.forEach((a) => m.set(a.requisicion_linea_id, a));
    return m;
  }, [avances]);

  const existenciaPorProducto = useMemo(() => {
    const m = new Map<string, number>();
    existencias?.forEach((e) => m.set(e.producto_id, e.existencia));
    return m;
  }, [existencias]);

  const pendientes = useMemo(() => {
    if (!lineas) return [];
    return lineas.filter((l: any) => avancePorLinea.has(l.id));
  }, [lineas, avancePorLinea]);

  function abrirResolucion(lineaId: string, sinResolver: number, existencia: number) {
    setAbierta(lineaId);
    setError(null);
    const aEntrega = Math.min(existencia, sinResolver);
    setCantidadEntrega(Math.max(0, aEntrega));
    setCantidadCompra(Math.max(0, sinResolver - aEntrega));
    setProveedor("");
  }

  async function onResolver(lineaId: string) {
    setEnviando(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Sesión expirada, vuelve a iniciar sesión.");

      if (cantidadEntrega > 0) {
        const { error: errEntrega } = await supabase
          .from("necesidades_entrega")
          .insert({ requisicion_linea_id: lineaId, cantidad: cantidadEntrega, resuelto_por: userId });
        if (errEntrega) throw errEntrega;
      }
      if (cantidadCompra > 0) {
        const { error: errCompra } = await supabase
          .from("necesidades_compra")
          .insert({ requisicion_linea_id: lineaId, cantidad: cantidadCompra, proveedor_sugerido: proveedor || null, resuelto_por: userId });
        if (errCompra) throw errCompra;
      }

      setAbierta(null);
      queryClient.invalidateQueries({ queryKey: ["avance-resolucion-linea"] });
      queryClient.invalidateQueries({ queryKey: ["requisicion-lineas-pendientes"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Por cada renglón: <b>Comprar en un paso</b> (proveedor, costo y cotización, y la orden RQ sale de una vez) o <b>Entregar / resolver</b> para
        surtir de existencia y mandar el resto a compra. Se puede resolver en partes conforme llegan más compras.
      </p>

      {eligeEmpresa && (
        <div className="mb-4">
          <SelectorEmpresa value={empresaFiltro} onChange={setEmpresaFiltro} vacio="Selecciona una empresa…" />
        </div>
      )}

      {!empresaFiltro && veTodasLasEmpresas && <p className="text-sm text-slate-500">Selecciona una empresa para ver sus pendientes.</p>}
      {cargandoLineas && <p className="text-sm text-slate-500">Cargando…</p>}

      {folioGenerado && <p className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Orden de compra <b>{folioGenerado}</b> generada. Dirección la verá en sus pendientes para autorizar y programar el pago.</p>}
      {(empresaFiltro || !veTodasLasEmpresas) && lineas && (
        <div className="space-y-3">
          {pendientes.map((l: any) => {
            const avance = avancePorLinea.get(l.id)!;
            const existencia = existenciaPorProducto.get(l.productos?.id) ?? 0;
            return (
              <div key={l.id} className="rounded border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">
                      {l.productos?.nombre ?? l.descripcion} <span className="text-xs text-slate-400">({l.productos?.sku ?? "texto libre"})</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Requisición #{l.requisiciones?.folio} · {l.requisiciones?.proyectos?.nombre} · {l.requisiciones?.fecha}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>Solicitado: {avance.cantidad_solicitada} {l.unidad_medida}</p>
                    <p>Sin resolver: <span className="font-medium text-amber-700">{avance.cantidad_sin_resolver}</span></p>
                    <p>Existencia actual: {existencia}</p>
                  </div>
                  {abierta !== l.id && compraAbierta !== l.id && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setAbierta(null);
                          setCompraAbierta(l.id);
                          setFolioGenerado(null);
                        }}
                        className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white"
                        title="Proveedor, costo y cotización: la orden de compra RQ se genera de una vez"
                      >
                        Comprar en un paso
                      </button>
                      <button
                        onClick={() => {
                          setCompraAbierta(null);
                          abrirResolucion(l.id, avance.cantidad_sin_resolver, existencia);
                        }}
                        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        title="Entregar de existencia y/o mandar a compra sin generar la orden todavía"
                      >
                        Entregar / resolver
                      </button>
                    </div>
                  )}
                </div>
                {compraAbierta === l.id && (
                  <CompraEnUnPaso
                    lineaId={l.id}
                    sinResolver={Number(avance.cantidad_sin_resolver)}
                    unidad={l.unidad_medida}
                    onListo={(folio) => {
                      setCompraAbierta(null);
                      setFolioGenerado(folio);
                    }}
                    onCancelar={() => setCompraAbierta(null)}
                  />
                )}

                {abierta === l.id && (
                  <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Entrega directa (existencia)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={cantidadEntrega}
                        onChange={(e) => setCantidadEntrega(Number(e.target.value))}
                        className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Va a compra</label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={cantidadCompra}
                        onChange={(e) => setCantidadCompra(Number(e.target.value))}
                        className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Proveedor sugerido (opcional)</label>
                      <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="w-48 rounded border border-slate-300 px-2 py-1 text-sm" />
                    </div>
                    <button
                      onClick={() => onResolver(l.id)}
                      disabled={enviando || (cantidadEntrega <= 0 && cantidadCompra <= 0)}
                      className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {enviando ? "Guardando…" : "Guardar"}
                    </button>
                    <button onClick={() => setAbierta(null)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
                      Cancelar
                    </button>
                  </div>
                )}
                {abierta === l.id && error && <p className="mt-2 text-sm text-red-600">{error}</p>}
              </div>
            );
          })}
          {pendientes.length === 0 && <p className="rounded border border-dashed border-slate-300 px-3 py-8 text-center text-slate-400">Sin líneas pendientes de resolver.</p>}
        </div>
      )}

      {(empresaFiltro || !veTodasLasEmpresas) && <ComprasPorOrdenar empresaId={empresaFiltro} />}
    </div>
  );
}
