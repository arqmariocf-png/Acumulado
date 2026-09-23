import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { AvanceResolucionLinea, Existencia } from "../../types/database";

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

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
        .select("id, requisicion_id, cantidad_solicitada, unidad_medida, productos(id, nombre, sku), requisiciones(folio, fecha, empresa_id, proyectos(nombre))")
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
  const { perfil, veTodasLasEmpresas } = useAuth();
  const queryClient = useQueryClient();
  const { data: empresas } = useEmpresas();
  const [empresaFiltro, setEmpresaFiltro] = useState(veTodasLasEmpresas ? "" : (perfil?.empresa_id ?? ""));

  const { data: lineas, isLoading: cargandoLineas } = useLineasPendientes(empresaFiltro);
  const { data: avances } = useAvanceLineas();
  const { data: existencias } = useExistencias(empresaFiltro);

  const [abierta, setAbierta] = useState<string | null>(null);
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
        Por cada línea, decide cuánto se entrega directo del almacén (existencia real) y cuánto se manda a comprar. La
        suma no puede exceder lo solicitado -- se puede resolver en partes (parcialidades) conforme llegan más
        compras.
      </p>

      {veTodasLasEmpresas && (
        <div className="mb-4">
          <select value={empresaFiltro} onChange={(e) => setEmpresaFiltro(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Selecciona una empresa…</option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      {!empresaFiltro && veTodasLasEmpresas && <p className="text-sm text-slate-500">Selecciona una empresa para ver sus pendientes.</p>}
      {cargandoLineas && <p className="text-sm text-slate-500">Cargando…</p>}

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
                      {l.productos?.nombre} <span className="text-xs text-slate-400">({l.productos?.sku})</span>
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
                  {abierta !== l.id && (
                    <button
                      onClick={() => abrirResolucion(l.id, avance.cantidad_sin_resolver, existencia)}
                      className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                    >
                      Resolver
                    </button>
                  )}
                </div>

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
    </div>
  );
}
