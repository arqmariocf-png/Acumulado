import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import { administraProyectosDe, esRolBasico } from "../../lib/modulos";
import { CLASE_ETAPA, ETAPAS_REQUISICION, ETIQUETA_ETAPA, puedeMarcarEtapa, semaforoEtapa, siguienteEtapa, type EtapaRequisicion } from "../../lib/requisicionEtapa";
import type { AppRol, Producto, Proyecto } from "../../types/database";
import { DetalleRequisicion } from "./DetalleRequisicion";
import { BotonImprimirRequisicion } from "./ImprimirRequisicion";
import { AvisoFiltro, useVer } from "../../components/FiltroDesdeTablero";
import { Link } from "react-router-dom";
import { CLASE_SOLICITUD, ETIQUETA_SOLICITUD, type EstadoSolicitudHerramienta } from "../../lib/herramientas";
import { CampoBuscador } from "../../components/CampoBuscador";
import { etiquetaCategoria, sugerirItems } from "../../lib/catalogoItems";
import { useItemsCompra } from "../compras/useItemsCompra";

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
      // Rol básico (supervisor, administrativo…): la base ya le deja ver solo
      // sus obras (asignadas, con requisiciones suyas o de su empresa extra,
      // como Timoteo con MCF); no se acota por empresa.
      else if (!esRolBasico(rol as AppRol) && rol !== "admin" && rol !== "corporativo" && empresaId) query = query.eq("empresa_id", empresaId);
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
        .select("id, folio, fecha, estado, etapa, comentario, solicitado_por, solicitante_nombre, empresa_id, empresas(codigo), proyectos(nombre, responsable_id, comprador_id)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (empresaId) query = query.eq("empresa_id", empresaId);
      const { data, error } = await query;
      if (error) throw error;
      // Avance real por partidas (pedido · bodega · en camino · en obra).
      const ids = (data ?? []).map((r) => r.id as string);
      const { data: av } = ids.length
        ? await supabase.from("v_requisicion_avance").select("requisicion_id, partidas, avance_pct, en_bodega, en_transito, en_obra").in("requisicion_id", ids)
        : { data: [] };
      const porId = new Map((av ?? []).map((a) => [a.requisicion_id as string, a]));
      // Renglones sin resolver (lo que cuenta el mosaico de Inicio).
      const { data: sinResolver } = ids.length
        ? await supabase.from("avance_resolucion_linea").select("requisicion_id").in("requisicion_id", ids).gt("cantidad_sin_resolver", 0)
        : { data: [] };
      const pendientes = new Map<string, number>();
      for (const x of sinResolver ?? []) pendientes.set(x.requisicion_id as string, (pendientes.get(x.requisicion_id as string) ?? 0) + 1);
      return (data ?? []).map((r) => ({ ...r, avance: porId.get(r.id as string) ?? null, sin_resolver: pendientes.get(r.id as string) ?? 0 }));
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
  const { perfil, eligeEmpresa } = useAuth();
  const queryClient = useQueryClient();
  const { data: proyectosDisponibles } = useProyectosDisponibles(perfil?.rol, perfil?.id, perfil?.empresa_id);

  // Con el permiso por persona 'requisiciones' (Jaime, producción en
  // Clavicón, 22-oct-2026) también pide, en obras de su empresa principal.
  const puedeCrear =
    perfil?.rol === "responsable" ||
    perfil?.rol === "admin" ||
    perfil?.rol === "corporativo" ||
    administraProyectosDe(perfil, perfil?.empresa_id) ||
    (!!perfil?.empresa_id && (perfil?.modulos ?? []).includes("requisiciones"));
  const puedeComprarAqui = perfil?.rol === "admin" || perfil?.rol === "corporativo" || perfil?.rol === "almacen";

  const [proyectoId, setProyectoId] = useState("");
  const [comentario, setComentario] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [carrito, setCarrito] = useState<FilaCarrito[]>([]);
  const [libreDescripcion, setLibreDescripcion] = useState("");
  const [libreUnidad, setLibreUnidad] = useState("pza");
  const [libreCantidad, setLibreCantidad] = useState("1");
  const descripcionRef = useRef<HTMLInputElement>(null);
  // Catálogo propio de items (21-oct-2026): sugiere al escribir; el texto libre sigue valiendo.
  const { data: catalogoItems } = useItemsCompra();
  const sugeridosCatalogo = useMemo(() => sugerirItems(catalogoItems ?? [], libreDescripcion, 8), [catalogoItems, libreDescripcion]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [empresaFiltro, setEmpresaFiltro] = useEmpresaFiltro();
  const [abierta, setAbierta] = useState<string | null>(null);
  // Herramienta y equipo (17-oct-2026, Mario: "en las requisiciones agrega
  // la opción de herramienta y equipo"): no se compra, se presta del
  // almacén; se envía como solicitud SH-… del módulo Herramienta y equipo.
  const [tipo, setTipo] = useState<"material" | "herramienta">("material");
  const esHerramienta = tipo === "herramienta";
  const [fechaRequerida, setFechaRequerida] = useState("");
  const [devolverEl, setDevolverEl] = useState("");

  const proyectoSeleccionado = proyectosDisponibles?.find((p) => p.id === proyectoId);
  const { data: productos } = useProductosEmpresa(proyectoSeleccionado?.empresa_id ?? "");
  const { data: todas, isLoading: cargandoRequisiciones, error: errorRequisiciones } = useRequisiciones(empresaFiltro);
  // Desde Inicio / indicadores: ?ver=sin_resolver (renglones por comprar o
  // surtir) o ?ver=pendientes (todo lo que no está completo en obra).
  const [ver, quitarVer] = useVer();
  const FILTROS: Record<string, { texto: string; f: (r: any) => boolean }> = {
    sin_resolver: { texto: "requisiciones con renglones sin resolver (por comprar o surtir)", f: (r) => r.estado !== "cancelada" && r.sin_resolver > 0 },
    pendientes: { texto: "requisiciones sin completar en obra", f: (r) => r.estado !== "cancelada" && r.etapa !== "recibida" },
    en_bodega: { texto: "requisiciones con material en bodega por llevar a obra", f: (r) => r.estado !== "cancelada" && (r.avance?.en_bodega ?? 0) > 0 },
    en_transito: { texto: "requisiciones con material en camino a obra", f: (r) => r.estado !== "cancelada" && (r.avance?.en_transito ?? 0) > 0 },
  };
  const filtro = ver ? FILTROS[ver] : undefined;
  // Cada quien ve solo las que pidió (17-oct-2026, Mario: "cada quien
  // debería poder ver únicamente las suyas, para no confundirlos"). Quienes
  // las procesan (almacén, dirección, empresa, admin, corporativo) siguen
  // viendo todas, con la opción de ver solo las suyas. Es filtro de pantalla:
  // el responsable de la obra todavía puede abrir las de otros para
  // confirmar lo recibido.
  const procesa = ["admin", "corporativo", "almacen", "direccion", "empresa"].includes(perfil?.rol ?? "");
  const [soloMias, setSoloMias] = useState(!procesa);
  const conFiltro = filtro && todas ? todas.filter(filtro.f) : todas;
  const requisiciones = soloMias && conFiltro ? conFiltro.filter((r: any) => r.solicitado_por === perfil?.id) : conFiltro;

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

  // Lo que está escrito en los campos de texto libre y todavía no se agregó
  // a la lista. Se toma en cuenta al enviar: Maria Fernanda escribió el
  // segundo material, dio "Enviar" y solo se guardó el primero (29-sep-2026).
  const filaPendiente = useMemo((): FilaCarrito | null => {
    const descripcion = libreDescripcion.trim();
    const cantidad = Number(libreCantidad);
    if (!descripcion || !(cantidad > 0)) return null;
    return { clave: `t:pendiente`, descripcion, unidad: libreUnidad, cantidad };
  }, [libreDescripcion, libreCantidad, libreUnidad]);

  function agregarLibre() {
    if (!filaPendiente) {
      setError(libreDescripcion.trim() ? "La cantidad debe ser mayor a 0." : esHerramienta ? "Escribe qué herramienta o equipo necesitas." : "Escribe qué material o servicio necesitas.");
      return;
    }
    setError(null);
    setCarrito((prev) => [...prev, { ...filaPendiente, clave: `t:${Date.now()}:${prev.length}` }]);
    setLibreDescripcion("");
    setLibreCantidad("1");
    descripcionRef.current?.focus();
  }

  // Enter en cualquiera de los tres campos agrega el renglón (antes solo en
  // la descripción; en la cantidad no hacía nada).
  function enterAgrega(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      agregarLibre();
    }
  }

  function actualizarCantidad(clave: string, cantidad: number) {
    setCarrito((prev) => prev.map((f) => (f.clave === clave ? { ...f, cantidad } : f)));
  }

  function quitarFila(clave: string) {
    setCarrito((prev) => prev.filter((f) => f.clave !== clave));
  }

  async function onEnviar() {
    const filas = filaPendiente ? [...carrito, filaPendiente] : carrito;
    if (!proyectoId || filas.length === 0) return;
    setEnviando(true);
    setError(null);
    setMensaje(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Sesión expirada, vuelve a iniciar sesión.");

      if (esHerramienta) {
        const { data: id, error: errSol } = await supabase.rpc("fn_herramienta_solicitar", {
          p_proyecto: proyectoId,
          p_lineas: filas.map((f) => ({ descripcion: f.producto ? f.producto.nombre : f.descripcion, cantidad: Math.max(1, Math.ceil(f.cantidad)) })),
          p_fecha_requerida: fechaRequerida || null,
          p_devolver_el: devolverEl || null,
          p_nota: comentario,
        });
        if (errSol) throw errSol;
        const { data: sol } = await supabase.from("herramienta_solicitudes").select("folio").eq("id", id as string).single();
        setMensaje(`Solicitud de herramienta ${sol?.folio ?? ""} enviada al almacén con ${filas.length} renglón(es). Te la asignan desde Herramienta y equipo y firmas el resguardo al recibirla.`);
        setCarrito([]);
        setLibreDescripcion("");
        setLibreCantidad("1");
        setComentario("");
        setFechaRequerida("");
        setDevolverEl("");
        queryClient.invalidateQueries({ queryKey: ["herramienta-solicitudes"] });
        return;
      }

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

      const lineas = filas.map((f) => ({
        requisicion_id: requisicion.id,
        concepto_id: f.producto?.id ?? null,
        descripcion: f.producto ? null : (f.descripcion ?? null),
        cantidad_solicitada: f.cantidad,
        unidad_medida: f.unidad,
      }));
      const { error: errLineas } = await supabase.from("requisicion_lineas").insert(lineas);
      if (errLineas) throw errLineas;

      setMensaje(`Requisición enviada con ${filas.length} línea(s).`);
      setCarrito([]);
      setLibreDescripcion("");
      setLibreCantidad("1");
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

          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-slate-600">¿Qué necesitas?</label>
            <div className="inline-flex overflow-hidden rounded border border-slate-300 text-sm">
              {(
                [
                  ["material", "Material o servicio"],
                  ["herramienta", "Herramienta y equipo"],
                ] as const
              ).map(([clave, etiqueta]) => (
                <button
                  key={clave}
                  type="button"
                  onClick={() => {
                    setTipo(clave);
                    setCarrito([]);
                    setError(null);
                    setMensaje(null);
                  }}
                  className={`px-3 py-1.5 ${tipo === clave ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
            {esHerramienta && <p className="mt-1 text-xs text-slate-500">Se presta del almacén para la obra y se regresa: no se compra. Almacén te la asigna y firmas el resguardo al recibirla.</p>}
          </div>

          {proyectoId && (
            <>
              <div className="mb-3">
                <label className="mb-1 block text-xs font-medium text-slate-600">{esHerramienta ? "Herramienta o equipo que necesitas" : "Material o servicio que necesitas"}</label>
                <div className="flex flex-wrap gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <CampoBuscador
                      inputRef={descripcionRef}
                      value={libreDescripcion}
                      onChange={setLibreDescripcion}
                      onKeyDown={enterAgrega}
                      enterKeyHint="enter"
                      opciones={sugeridosCatalogo.map((i) => ({
                        clave: i.id,
                        titulo: i.descripcion,
                        detalle: `${i.clave} · ${etiquetaCategoria(i.categoria)}${i.unidad ? ` · ${i.unidad}` : ""}`,
                      }))}
                      onElegir={(id) => {
                        const i = (catalogoItems ?? []).find((x) => x.id === id);
                        if (!i) return;
                        setLibreDescripcion(i.descripcion);
                        const u = (i.unidad ?? "").toLowerCase();
                        if (UNIDADES_LIBRES.includes(u)) setLibreUnidad(u);
                      }}
                      placeholder={esHerramienta ? "Ej. Rotomartillo, andamio tubular, nivel láser…" : "Ej. Cemento gris 50 kg, varilla 3/8, flete…"}
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <input type="number" min={esHerramienta ? "1" : "0.001"} step={esHerramienta ? "1" : "0.001"} value={libreCantidad} onChange={(e) => setLibreCantidad(e.target.value)} onKeyDown={enterAgrega} enterKeyHint="enter" className="w-20 rounded border border-slate-300 px-2 py-1.5 text-sm" aria-label="Cantidad" />
                  {esHerramienta ? (
                    <span className="self-center text-sm text-slate-500">pza</span>
                  ) : (
                    <select value={libreUnidad} onChange={(e) => setLibreUnidad(e.target.value)} onKeyDown={enterAgrega} className="rounded border border-slate-300 px-2 py-1.5 text-sm" aria-label="Unidad">
                      {UNIDADES_LIBRES.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  )}
                  <button type="button" onClick={agregarLibre} className="rounded border border-slate-900 px-3 py-1.5 text-sm font-medium text-slate-900">
                    Agregar
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-400">Escribe cada material y da Enter o "Agregar"; se van juntando abajo. Lo que quede escrito sin agregar también se envía.</p>
              </div>

              {!esHerramienta && (productos?.length ?? 0) > 0 && (
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

              {esHerramienta && (
                <div className="mb-3 flex flex-wrap gap-3">
                  <label className="text-xs font-medium text-slate-600">
                    La necesito el
                    <input type="date" value={fechaRequerida} onChange={(e) => setFechaRequerida(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    La regreso el (estimado)
                    <input type="date" value={devolverEl} onChange={(e) => setDevolverEl(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  </label>
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
                disabled={enviando || (carrito.length === 0 && !filaPendiente)}
                className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {enviando ? "Enviando…" : `${esHerramienta ? "Pedir herramienta al almacén" : "Enviar requisición"} (${carrito.length + (filaPendiente ? 1 : 0)} línea(s))`}
              </button>
            </>
          )}

          {error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {mensaje && <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-700">Requisiciones</h2>
        {eligeEmpresa && <SelectorEmpresa value={empresaFiltro} onChange={setEmpresaFiltro} className="rounded border border-slate-300 px-2 py-1 text-sm" />}
        <p className="text-xs text-slate-500">Abre una requisición para ver sus renglones{puedeComprarAqui ? ", comprar en un paso y ver la orden de compra" : " y sus órdenes de compra"}.</p>
      </div>

      {cargandoRequisiciones && <p className="text-sm text-slate-500">Cargando…</p>}
      {errorRequisiciones && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">No se pudo cargar la lista: {(errorRequisiciones as Error).message}</p>}
      <label className="mb-2 flex items-center gap-1 text-xs text-slate-600">
        {procesa ? (
          <>
            <input type="checkbox" checked={soloMias} onChange={(e) => setSoloMias(e.target.checked)} /> solo las que yo pedí
          </>
        ) : (
          <>
            <input type="checkbox" checked={!soloMias} onChange={(e) => setSoloMias(!e.target.checked)} /> ver también las que pidieron otras personas en mis obras
          </>
        )}
      </label>
      {filtro && <AvisoFiltro texto={filtro.texto} total={requisiciones?.length} onQuitar={quitarVer} />}
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
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {requisiciones.map((r: any) => (
                <Fragment key={r.id}>
                  <tr className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-2">
                      #{r.folio} <span className="text-xs text-slate-400">{r.empresas?.codigo ?? ""}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{r.fecha}</td>
                    <td className="px-3 py-2">{r.proyectos?.nombre}</td>
                    <td className="px-3 py-2">{r.solicitante_nombre ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTADO_ESTILO[r.estado] ?? ""}`}>{r.estado}</span>
                    </td>
                    <td className="px-3 py-2">
                      <CeldaEtapa r={r} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <BotonImprimirRequisicion requisicionId={r.id} modo="requisicion" etiqueta="PDF" className="mr-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50" />
                      <button type="button" onClick={() => setAbierta(abierta === r.id ? null : r.id)} className={`rounded px-2.5 py-1 text-xs font-medium ${abierta === r.id ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-100"}`}>
                        {abierta === r.id ? "Cerrar" : puedeComprarAqui ? "Abrir / comprar" : "Abrir"}
                      </button>
                    </td>
                  </tr>
                  {abierta === r.id && (
                    <tr>
                      <td colSpan={7} className="p-0">
                        <DetalleRequisicion
                          requisicionId={r.id}
                          solicitadoPor={r.solicitado_por}
                          estado={r.estado}
                          esDeLaObra={!!perfil && (perfil.id === r.proyectos?.responsable_id || perfil.id === r.proyectos?.comprador_id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {requisiciones.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    {soloMias ? "No has pedido requisiciones todavía." : "Sin requisiciones todavía."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <SolicitudesHerramienta soloDe={soloMias ? perfil?.id ?? null : null} />
    </div>
  );
}

interface SolicitudHerramientaFila {
  id: string;
  folio: string;
  solicitado_por: string;
  estado: EstadoSolicitudHerramienta;
  solicitante_nombre: string | null;
  created_at: string;
  devolver_el: string | null;
  respuesta: string | null;
  proyectos: { nombre: string } | null;
  herramienta_solicitud_lineas: { descripcion: string; cantidad: number; surtido: number }[];
}

/** Herramienta y equipo pedida desde aquí: lo abierto y lo de los últimos
 * 30 días, con liga a la pantalla del almacén. */
function SolicitudesHerramienta({ soloDe }: { soloDe: string | null }) {
  const desde = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const { data } = useQuery({
    queryKey: ["herramienta-solicitudes", "requisiciones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("herramienta_solicitudes")
        .select("id, folio, estado, solicitado_por, solicitante_nombre, created_at, devolver_el, respuesta, proyectos(nombre), herramienta_solicitud_lineas(descripcion, cantidad, surtido)")
        .or(`estado.in.(pendiente,parcial),created_at.gte.${desde}`)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as SolicitudHerramientaFila[];
    },
  });
  const lista = soloDe ? (data ?? []).filter((s) => s.solicitado_por === soloDe) : data ?? [];
  if (!lista.length) return null;
  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-700">Herramienta y equipo pedida</h2>
        <Link to="/almacen/herramienta" className="text-xs text-sky-700 underline">
          ir a Herramienta y equipo
        </Link>
      </div>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Proyecto</th>
              <th className="px-3 py-2">Solicitado por</th>
              <th className="px-3 py-2">Pide</th>
              <th className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{s.folio}</td>
                <td className="whitespace-nowrap px-3 py-2">{new Date(s.created_at).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" })}</td>
                <td className="px-3 py-2">{s.proyectos?.nombre}</td>
                <td className="px-3 py-2">{s.solicitante_nombre ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {s.herramienta_solicitud_lineas.map((l) => `${l.descripcion} (${l.surtido}/${l.cantidad})`).join(" · ")}
                  {s.respuesta && <div className="text-red-700">Almacén: {s.respuesta}</div>}
                </td>
                <td className="px-3 py-2">
                  <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASE_SOLICITUD[s.estado]}`}>{ETIQUETA_SOLICITUD[s.estado]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  const s = semaforoEtapa(etapa, cancelada, r.avance?.avance_pct);
  const clase = CLASE_ETAPA[s.color];
  // De "en bodega" en adelante la etapa la ponen las partidas (recibí en
  // bodega, enviar a obra, recibido en obra), no un botón (5-oct-2026).
  const sigEtapa = cancelada ? null : siguienteEtapa(etapa);
  const sig = sigEtapa && ["en_bodega", "en_transito", "recibida"].includes(sigEtapa) ? null : sigEtapa;
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
      {r.avance && r.avance.partidas > 0 && !cancelada && (
        <div className="text-[10px] text-slate-500">
          {r.avance.en_obra}/{r.avance.partidas} partidas en obra
          {r.avance.en_transito > 0 ? ` · ${r.avance.en_transito} en camino` : ""}
          {r.avance.en_bodega > 0 ? ` · ${r.avance.en_bodega} en bodega` : ""}
        </div>
      )}
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
