import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { Producto, Proyecto } from "../../types/database";

interface FilaCarrito {
  producto: Producto;
  cantidad: number;
}

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

// Para 'responsable': solo los proyectos donde él/ella está asignado. Para
// admin/corporativo: cualquier proyecto activo (pueden capturar a nombre de
// alguien mientras no todos los responsables tengan cuenta todavía).
function useProyectosDisponibles(rol: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ["proyectos-disponibles", rol, userId],
    enabled: !!rol,
    queryFn: async () => {
      let query = supabase.from("proyectos").select("*").eq("activo", true).order("nombre");
      if (rol === "responsable") query = query.eq("responsable_id", userId);
      const { data, error } = await query;
      if (error) throw error;
      return data as Proyecto[];
    },
  });
}

function useProductosEmpresa(empresaId: string) {
  return useQuery({
    queryKey: ["productos-catalogo", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("productos").select("*").eq("empresa_id", empresaId).eq("activo", true).order("nombre");
      if (error) throw error;
      return data as Producto[];
    },
  });
}

function useRequisiciones(empresaId: string) {
  return useQuery({
    queryKey: ["requisiciones", empresaId],
    queryFn: async () => {
      let query = supabase
        .from("requisiciones")
        .select("id, folio, fecha, estado, comentario, proyectos(nombre), profiles(nombre)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (empresaId) query = query.eq("empresa_id", empresaId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

const ESTADO_ESTILO: Record<string, string> = {
  enviada: "bg-amber-100 text-amber-800",
  en_revision: "bg-blue-100 text-blue-800",
  resuelta: "bg-emerald-100 text-emerald-800",
  cancelada: "bg-slate-100 text-slate-600",
};

export function MisRequisiciones() {
  const { perfil, veTodasLasEmpresas } = useAuth();
  const queryClient = useQueryClient();
  const { data: empresas } = useEmpresas();
  const { data: proyectosDisponibles } = useProyectosDisponibles(perfil?.rol, perfil?.id);

  const puedeCrear = perfil?.rol === "responsable" || perfil?.rol === "admin" || perfil?.rol === "corporativo";

  const [proyectoId, setProyectoId] = useState("");
  const [comentario, setComentario] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [carrito, setCarrito] = useState<FilaCarrito[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [empresaFiltro, setEmpresaFiltro] = useState(veTodasLasEmpresas ? "" : (perfil?.empresa_id ?? ""));

  const proyectoSeleccionado = proyectosDisponibles?.find((p) => p.id === proyectoId);
  const { data: productos } = useProductosEmpresa(proyectoSeleccionado?.empresa_id ?? "");
  const { data: requisiciones, isLoading: cargandoRequisiciones } = useRequisiciones(empresaFiltro);

  useEffect(() => {
    if (proyectosDisponibles?.length === 1) setProyectoId(proyectosDisponibles[0].id);
  }, [proyectosDisponibles]);

  const productosFiltrados = useMemo(() => {
    if (!productos) return [];
    const q = busqueda.trim().toLowerCase();
    if (!q) return productos.slice(0, 20);
    return productos.filter((p) => p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 20);
  }, [productos, busqueda]);

  function agregarAlCarrito(producto: Producto) {
    setCarrito((prev) => {
      const existente = prev.find((f) => f.producto.id === producto.id);
      if (existente) return prev.map((f) => (f.producto.id === producto.id ? { ...f, cantidad: f.cantidad + 1 } : f));
      return [...prev, { producto, cantidad: 1 }];
    });
  }

  function actualizarCantidad(productoId: string, cantidad: number) {
    setCarrito((prev) => prev.map((f) => (f.producto.id === productoId ? { ...f, cantidad } : f)));
  }

  function quitarFila(productoId: string) {
    setCarrito((prev) => prev.filter((f) => f.producto.id !== productoId));
  }

  async function onEnviar() {
    if (!proyectoId || carrito.length === 0) return;
    setEnviando(true);
    setError(null);
    setMensaje(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Sesión expirada, vuelve a iniciar sesión.");

      const { data: requisicion, error: errReq } = await supabase
        .from("requisiciones")
        .insert({
          proyecto_id: proyectoId,
          empresa_id: proyectoSeleccionado!.empresa_id,
          solicitado_por: userId,
          comentario: comentario || null,
        })
        .select("id")
        .single();
      if (errReq) throw errReq;

      const lineas = carrito.map((f) => ({
        requisicion_id: requisicion.id,
        concepto_id: f.producto.id,
        cantidad_solicitada: f.cantidad,
        unidad_medida: f.producto.unidad_medida,
      }));
      const { error: errLineas } = await supabase.from("requisicion_lineas").insert(lineas);
      if (errLineas) throw errLineas;

      setMensaje(`Requisición enviada con ${carrito.length} línea(s).`);
      setCarrito([]);
      setComentario("");
      queryClient.invalidateQueries({ queryKey: ["requisiciones"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      {puedeCrear && (
        <div className="mb-6 max-w-2xl rounded border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Nueva requisición</h2>

          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-slate-600">Proyecto</label>
            <select value={proyectoId} onChange={(e) => setProyectoId(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Selecciona un proyecto…</option>
              {proyectosDisponibles?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            {proyectosDisponibles?.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">No tienes proyectos asignados todavía -- pide a un admin que te asigne uno.</p>
            )}
          </div>

          {proyectoId && (
            <>
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-slate-600">Buscar concepto</label>
                <input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Nombre o SKU del material…"
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                {busqueda && (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded border border-slate-200 bg-white">
                    {productosFiltrados.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          agregarAlCarrito(p);
                          setBusqueda("");
                        }}
                        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100"
                      >
                        {p.nombre} <span className="text-xs text-slate-400">({p.sku} · {p.unidad_medida})</span>
                      </button>
                    ))}
                    {productosFiltrados.length === 0 && <p className="px-3 py-2 text-sm text-slate-400">Sin resultados.</p>}
                  </div>
                )}
              </div>

              {carrito.length > 0 && (
                <div className="mb-3 overflow-x-auto rounded border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Concepto</th>
                        <th className="px-3 py-2">Cantidad</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {carrito.map((f) => (
                        <tr key={f.producto.id} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            {f.producto.nombre} <span className="text-xs text-slate-400">({f.producto.unidad_medida})</span>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={f.cantidad}
                              onChange={(e) => actualizarCantidad(f.producto.id, Number(e.target.value))}
                              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={() => quitarFila(f.producto.id)} className="text-xs text-red-600 hover:underline">
                              Quitar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-slate-600">Comentario (opcional)</label>
                <input
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>

              <button
                onClick={onEnviar}
                disabled={enviando || carrito.length === 0}
                className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {enviando ? "Enviando…" : `Enviar requisición (${carrito.length} línea(s))`}
              </button>
            </>
          )}

          {error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {mensaje && <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>}
        </div>
      )}

      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-700">Requisiciones</h2>
        {veTodasLasEmpresas && (
          <select value={empresaFiltro} onChange={(e) => setEmpresaFiltro(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
            <option value="">Todas las empresas</option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      {cargandoRequisiciones && <p className="text-sm text-slate-500">Cargando…</p>}
      {requisiciones && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Folio</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Proyecto</th>
                <th className="px-3 py-2">Solicitado por</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {requisiciones.map((r: any) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">#{r.folio}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.fecha}</td>
                  <td className="px-3 py-2">{r.proyectos?.nombre}</td>
                  <td className="px-3 py-2">{r.profiles?.nombre}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_ESTILO[r.estado] ?? ""}`}>{r.estado}</span>
                  </td>
                </tr>
              ))}
              {requisiciones.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                    Sin requisiciones todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
