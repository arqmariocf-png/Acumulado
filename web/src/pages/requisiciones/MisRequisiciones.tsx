import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { administraProyectosDe } from "../../lib/modulos";
import { CLASE_ETAPA, ETAPAS_REQUISICION, ETIQUETA_ETAPA, puedeMarcarEtapa, semaforoEtapa, siguienteEtapa, type EtapaRequisicion } from "../../lib/requisicionEtapa";
import type { Producto, Proyecto } from "../../types/database";

/** Un renglón trae producto del catálogo o descripción libre (empresas sin
 * catálogo, como Ergodinova, 28-sep-2026). */
interface FilaCarrito {
  clave: string;
  producto?: Producto;
  descripcion?: string;
  unidad: string;
  cantidad: number;
}

const UNIDADES_LIBRES = ["pza", "m", "m2", "m3", "kg", "ton", "lt", "bulto", "rollo", "caja", "juego", "lote", "servicio"];

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
// alguien mientras no todos los responsables tengan cuenta todavía). Para
// empresa y los básicos con módulo proyectos (Jonathan): los de su empresa,
// igual que en los tableros (policy requisiciones_insert, 28-sep-2026).
function useProyectosDisponibles(rol: string | undefined, userId: string | undefined, empresaId: string | null | undefined) {
  return useQuery({
    queryKey: ["proyectos-disponibles", rol, userId, empresaId],
    enabled: !!rol,
    queryFn: async () => {
      let query = supabase.from("proyectos").select("*").eq("activo", true).order("nombre");
      if (rol === "responsable") query = query.eq("responsable_id", userId);
      else if (rol !== "admin" && rol !== "corporativo" && empresaId) query = query.eq("empresa_id", empresaId);
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
        .select("id, folio, fecha, estado, etapa, comentario, solicitado_por, proyectos(nombre, responsable_id, comprador_id), profiles(nombre)")
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
  const { data: proyectosDisponibles } = useProyectosDisponibles(perfil?.rol, perfil?.id, perfil?.empresa_id);

  const puedeCrear = perfil?.rol === "responsable" || perfil?.rol === "admin" || perfil?.rol === "corporativo" || administraProyectosDe(perfil, perfil?.empresa_id);

  const [proyectoId, setProyectoId] = useState("");
  const [comentario, setComentario] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [carrito, setCarrito] = useState<FilaCarrito[]>([]);
  const [libreDescripcion, setLibreDescripcion] = useState("");
  const [libreUnidad, setLibreUnidad] = useState("pza");
  const [libreCantidad, setLibreCantidad] = useState("1");
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
      const existente = prev.find((f) => f.producto?.id === producto.id);
      if (existente) return prev.map((f) => (f.producto?.id === producto.id ? { ...f, cantidad: f.cantidad + 1 } : f));
      return [...prev, { clave: `p:${producto.id}`, producto, unidad: producto.unidad_medida, cantidad: 1 }];
    });
  }

  function agregarLibre() {
    const descripcion = libreDescripcion.trim();
    const cantidad = Number(libreCantidad);
    if (!descripcion || !(cantidad > 0)) return;
    setCarrito((prev) => [...prev, { clave: `t:${Date.now()}:${prev.length}`, descripcion, unidad: libreUnidad, cantidad }]);
    setLibreDescripcion("");
    setLibreCantidad("1");
  }

  function actualizarCantidad(clave: string, cantidad: number) {
    setCarrito((prev) => prev.map((f) => (f.clave === clave ? { ...f, cantidad } : f)));
  }

  function quitarFila(clave: string) {
    setCarrito((prev) => prev.filter((f) => f.clave !== clave));
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
        concepto_id: f.producto?.id ?? null,
        descripcion: f.producto ? null : (f.descripcion ?? null),
        cantidad_solicitada: f.cantidad,
        unidad_medida: f.unidad,
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
              <p className="mt-1 text-xs text-amber-600">
                {perfil?.rol === "responsable" ? "No tienes proyectos asignados todavía -- pide a un admin que te asigne uno." : "Tu empresa no tiene proyectos activos todavía."}
              </p>
            )}
          </div>

          {proyectoId && (
            <>
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-slate-600">Material o servicio que necesitas</label>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={libreDescripcion}
                    onChange={(e) => setLibreDescripcion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        agregarLibre();
                      }
                    }}
                    placeholder="Ej. Cemento gris 50 kg, varilla 3/8, flete…"
                    className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input type="number" min="0.001" step="0.001" value={libreCantidad} onChange={(e) => setLibreCantidad(e.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1.5 text-sm" aria-label="Cantidad" />
                  <select value={libreUnidad} onChange={(e) => setLibreUnidad(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" aria-label="Unidad">
                    {UNIDADES_LIBRES.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={agregarLibre} disabled={!libreDescripcion.trim() || !(Number(libreCantidad) > 0)} className="rounded border border-slate-900 px-3 py-1.5 text-sm font-medium text-slate-900 disabled:opacity-40">
                    Agregar
                  </button>
                </div>
              </div>

              {(productos?.length ?? 0) > 0 && (
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-slate-600">O busca en el catálogo de productos</label>
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
              )}

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
                        <tr key={f.clave} className="border-t border-slate-100">
                          <td className="px-3 py-2">
                            {f.producto ? f.producto.nombre : f.descripcion} <span className="text-xs text-slate-400">({f.unidad})</span>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={f.cantidad}
                              onChange={(e) => actualizarCantidad(f.clave, Number(e.target.value))}
                              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <button onClick={() => quitarFila(f.clave)} className="text-xs text-red-600 hover:underline">
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
                <th className="px-3 py-2">Suministro</th>
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
                  <td className="px-3 py-2">
                    <CeldaEtapa r={r} />
                  </td>
                </tr>
              ))}
              {requisiciones.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
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

/** Semáforo de suministro de una requisición y el botón de la siguiente
 * etapa para quien le toca (misma regla que fn_requisicion_etapa). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CeldaEtapa({ r }: { r: any }) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const cancelada = r.estado === "cancelada";
  const etapa = (r.etapa ?? "solicitada") as EtapaRequisicion;
  const s = semaforoEtapa(etapa, cancelada);
  const clase = CLASE_ETAPA[s.color];
  const sig = cancelada ? null : siguienteEtapa(etapa);
  const esDelProyecto = !!perfil && (perfil.id === r.solicitado_por || perfil.id === r.proyectos?.responsable_id || perfil.id === r.proyectos?.comprador_id);
  const puede = !!perfil && !!sig && puedeMarcarEtapa(perfil.rol, sig, esDelProyecto);
  const marcar = useMutation({
    mutationFn: async () => {
      if (!sig) return;
      const nota = window.prompt(`Marcar "${ETIQUETA_ETAPA[sig]}". Nota (opcional):`);
      if (nota === null) return;
      const { error: err } = await supabase.rpc("fn_requisicion_etapa", { p_requisicion_id: r.id, p_etapa: sig, p_nota: nota || null });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["requisiciones"] });
      queryClient.invalidateQueries({ queryKey: ["requisiciones-proyecto"] });
    },
    onError: (err) => setError((err as Error).message),
  });
  return (
    <div className="min-w-[11rem]">
      <div className="flex items-center gap-1.5">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${clase.punto}`} />
        <span className="text-xs text-slate-700">{cancelada ? "Cancelada" : ETIQUETA_ETAPA[etapa]}</span>
        <span className="text-[10px] text-slate-400">{s.pct}%</span>
      </div>
      <div className="mt-1 flex gap-0.5">
        {ETAPAS_REQUISICION.map((e, i) => (
          <span key={e} className={`h-1 flex-1 rounded-sm ${i < s.paso ? clase.barra : "bg-slate-100"}`} title={ETIQUETA_ETAPA[e]} />
        ))}
      </div>
      {sig && puede && (
        <button onClick={() => marcar.mutate()} disabled={marcar.isPending} className="mt-1 text-[11px] text-slate-700 underline disabled:opacity-50">
          marcar {ETIQUETA_ETAPA[sig].toLowerCase()}
        </button>
      )}
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
