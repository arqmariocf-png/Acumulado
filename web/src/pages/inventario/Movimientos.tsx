import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { BarcodeScanner } from "../../components/BarcodeScanner";
import type { ItemSugeridoNota, Producto, TipoMovimientoInventario } from "../../types/database";

interface FilaCarrito {
  producto: Producto;
  cantidad: number;
  costoUnitario: number | null;
}

// Tres formas de decidir qué producto va al carrito: escanear (físico o
// cámara), buscar por nombre a mano (proveedores sin QR/código), o subir la
// foto de la nota/remisión de papel y dejar que la IA sugiera los conceptos
// -- las tres terminan agregando filas al mismo `carrito` de abajo.
type ModoCaptura = "codigo" | "nombre" | "foto";

const MODOS_CAPTURA: { valor: ModoCaptura; etiqueta: string }[] = [
  { valor: "codigo", etiqueta: "Código de barras" },
  { valor: "nombre", etiqueta: "Buscar por nombre" },
  { valor: "foto", etiqueta: "Foto de la nota" },
];

/** Buscador reutilizable por nombre -- lo usa tanto el modo "Buscar por
 * nombre" como cada concepto sugerido por la foto (ahí sirve para mapear la
 * descripción leída por la IA a un producto real del catálogo). */
function BuscadorProducto({
  empresaId,
  placeholder,
  onSeleccionar,
}: {
  empresaId: string;
  placeholder?: string;
  onSeleccionar: (producto: Producto) => void;
}) {
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<Producto[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  async function buscar() {
    const limpio = query.trim();
    if (!limpio || !empresaId) return;
    setBuscando(true);
    try {
      const { data, error } = await supabase
        .from("productos")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("activo", true)
        .ilike("nombre", `%${limpio}%`)
        .order("nombre")
        .limit(10);
      if (error) throw error;
      setResultados(data as Producto[]);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              buscar();
            }
          }}
          placeholder={placeholder ?? "Buscar producto por nombre…"}
          className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={buscar}
          disabled={buscando}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {buscando ? "Buscando…" : "Buscar"}
        </button>
      </div>
      {resultados && (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-slate-200 bg-white text-sm">
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onSeleccionar(p);
                  setResultados(null);
                  setQuery("");
                }}
                className="block w-full px-2 py-1 text-left hover:bg-slate-100"
              >
                {p.nombre} <span className="text-xs text-slate-400">({p.sku})</span>
              </button>
            </li>
          ))}
          {resultados.length === 0 && <li className="px-2 py-1 text-slate-400">Sin resultados.</li>}
        </ul>
      )}
    </div>
  );
}

/** Tarjeta de un concepto sugerido por la foto: primero intenta que el
 * usuario lo mapee a un producto existente (BuscadorProducto); si el
 * material todavía no está dado de alta en el catálogo, ofrece crearlo ahí
 * mismo precargado con lo que ya leyó la IA (descripción/unidad), igual que
 * el modo de código de barras ya hace cuando el código no matchea nada. */
function ItemSugeridoCard({
  item,
  empresaId,
  onAgregado,
}: {
  item: ItemSugeridoNota;
  empresaId: string;
  onAgregado: (producto: Producto) => void;
}) {
  const queryClient = useQueryClient();
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCrear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const nombre = String(form.get("nombre") ?? "").trim();
    const sku = String(form.get("sku") ?? "").trim();
    const unidad = String(form.get("unidad") ?? "PZA").trim() || "PZA";
    if (!nombre || !sku) return;
    setError(null);
    try {
      const { data, error: errInsert } = await supabase
        .from("productos")
        .insert({ empresa_id: empresaId, sku, nombre, unidad_medida: unidad })
        .select("*")
        .single();
      if (errInsert) throw errInsert;
      onAgregado(data as Producto);
      queryClient.invalidateQueries({ queryKey: ["productos"] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="rounded border border-blue-100 bg-white p-2">
      <p className="mb-1 text-sm text-slate-800">
        {item.descripcion || "(sin descripción legible)"}
        {item.cantidad != null && (
          <span className="text-slate-500">
            {" "}
            — cantidad sugerida: {item.cantidad}
            {item.unidad ? ` ${item.unidad}` : ""}
          </span>
        )}
      </p>

      {!creando ? (
        <>
          <BuscadorProducto empresaId={empresaId} placeholder="Buscar el producto correspondiente…" onSeleccionar={onAgregado} />
          <button type="button" onClick={() => setCreando(true)} className="mt-1 text-xs text-blue-700 hover:underline">
            No existe en el catálogo -- crear producto nuevo
          </button>
        </>
      ) : (
        <form onSubmit={onCrear} className="mt-1 space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
          <input
            name="nombre"
            required
            defaultValue={item.descripcion}
            placeholder="Nombre del producto"
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <input name="sku" required placeholder="SKU" className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
            <input
              name="unidad"
              defaultValue={item.unidad ?? "PZA"}
              placeholder="Unidad (default PZA)"
              className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Crear y agregar</button>
            <button
              type="button"
              onClick={() => setCreando(false)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </form>
      )}
    </div>
  );
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

function useAlmacen(empresaId: string) {
  return useQuery({
    queryKey: ["almacen-principal", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("almacenes").select("id, nombre").eq("empresa_id", empresaId).eq("activo", true).limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

// Catálogo de órdenes para el selector de match -- solo trae id_orden/total,
// que es justo lo que la vista de avance necesita para acumular el monto
// recibido/embarcado (ver comentario sobre match por monto, no por línea,
// en la migración de esquema del inventario).
function useOrdenes(empresaId: string, tipo: TipoMovimientoInventario) {
  return useQuery({
    queryKey: ["ordenes-para-match", empresaId, tipo],
    enabled: !!empresaId,
    queryFn: async () => {
      if (tipo === "entrada") {
        const { data, error } = await supabase
          .from("ordenes_compra")
          .select("id, id_orden, tipo, proveedor, total")
          .eq("empresa_id", empresaId)
          .order("fecha_creacion", { ascending: false })
          .limit(100);
        if (error) throw error;
        return data.map((o) => ({ id: o.id, etiqueta: `${o.tipo} ${o.id_orden} — ${o.proveedor ?? "sin proveedor"} (${o.total ?? "—"})` }));
      }
      const { data, error } = await supabase
        .from("ordenes_venta")
        .select("id, id_ov, cliente, total")
        .eq("empresa_id", empresaId)
        .order("fecha_ov", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data.map((o) => ({ id: o.id, etiqueta: `OV ${o.id_ov} — ${o.cliente ?? "sin cliente"} (${o.total ?? "—"})` }));
    },
  });
}

function useMovimientosRecientes(empresaId: string) {
  return useQuery({
    queryKey: ["movimientos-inventario-recientes", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movimientos_inventario")
        .select("id, tipo, cantidad, costo_unitario, fecha, comentario, orden_compra_id, orden_venta_id, productos(nombre, sku)")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });
}

// Entradas/salidas que se guardaron sin orden porque todavía no se sabía a
// cuál correspondían (ver asignar_orden_movimiento_inventario()) -- se
// resuelven después sin tener que reescribir el movimiento a mano.
function usePendientesAsignarOrden(empresaId: string, tipo: TipoMovimientoInventario) {
  return useQuery({
    queryKey: ["pendientes-asignar-orden", empresaId, tipo],
    enabled: !!empresaId,
    queryFn: async () => {
      const columnaOrden = tipo === "entrada" ? "orden_compra_id" : "orden_venta_id";
      const { data, error } = await supabase
        .from("movimientos_inventario")
        .select("id, cantidad, fecha, productos(nombre, sku)")
        .eq("empresa_id", empresaId)
        .eq("tipo", tipo)
        .eq("es_ajuste", false)
        .is(columnaOrden, null)
        .order("fecha", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });
}

/** Fila de un movimiento sin orden vinculada, con su propio selector para
 * asignarla -- no reutiliza el selector de "vincular a orden" de arriba
 * porque ese aplica al movimiento que se está por CREAR, este a uno que ya
 * existe. */
function AsignarOrdenFila({
  movimiento,
  ordenes,
  onAsignado,
}: {
  movimiento: { id: string; cantidad: number; fecha: string; productos: { nombre: string; sku: string } | null };
  ordenes: { id: string; etiqueta: string }[] | undefined;
  onAsignado: () => void;
}) {
  const [ordenId, setOrdenId] = useState("");
  const [asignando, setAsignando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAsignar() {
    if (!ordenId) return;
    setAsignando(true);
    setError(null);
    try {
      const { error: errRpc } = await supabase.rpc("asignar_orden_movimiento_inventario", {
        p_movimiento_id: movimiento.id,
        p_orden_id: ordenId,
      });
      if (errRpc) throw errRpc;
      onAsignado();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAsignando(false);
    }
  }

  return (
    <tr className="border-t border-slate-100">
      <td className="whitespace-nowrap px-3 py-2">{movimiento.fecha}</td>
      <td className="px-3 py-2">
        {movimiento.productos?.nombre} <span className="text-xs text-slate-400">({movimiento.productos?.sku})</span>
      </td>
      <td className="px-3 py-2 text-right">{movimiento.cantidad}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <select value={ordenId} onChange={(e) => setOrdenId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs">
            <option value="">Selecciona la orden…</option>
            {ordenes?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.etiqueta}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onAsignar}
            disabled={!ordenId || asignando}
            className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {asignando ? "Asignando…" : "Asignar"}
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  );
}

export function Movimientos() {
  const { veTodasLasEmpresas, perfil } = useAuth();
  const queryClient = useQueryClient();
  const { data: empresas } = useEmpresas();

  const [empresaId, setEmpresaId] = useState(perfil?.empresa_id ?? "");
  const [tipo, setTipo] = useState<TipoMovimientoInventario>("entrada");
  const [ordenId, setOrdenId] = useState("");
  const [esAjuste, setEsAjuste] = useState(false);
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [carrito, setCarrito] = useState<FilaCarrito[]>([]);
  const [modo, setModo] = useState<ModoCaptura>("codigo");
  const [codigo, setCodigo] = useState("");
  const [mostrarCamara, setMostrarCamara] = useState(false);
  const [codigoSinProducto, setCodigoSinProducto] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [notaEntregaId, setNotaEntregaId] = useState<string | null>(null);
  const [itemsSugeridos, setItemsSugeridos] = useState<ItemSugeridoNota[]>([]);
  const [errorLecturaFoto, setErrorLecturaFoto] = useState<string | null>(null);
  const inputCodigoRef = useRef<HTMLInputElement>(null);

  const { data: almacen } = useAlmacen(empresaId);
  const { data: ordenes } = useOrdenes(empresaId, tipo);
  const { data: recientes, isLoading: cargandoRecientes } = useMovimientosRecientes(empresaId);
  const { data: pendientesOrden } = usePendientesAsignarOrden(empresaId, tipo);

  useEffect(() => {
    setOrdenId("");
  }, [tipo, empresaId]);

  function agregarAlCarrito(producto: Producto, cantidadSugerida?: number) {
    setCarrito((prev) => {
      const existente = prev.find((f) => f.producto.id === producto.id);
      if (existente) {
        return prev.map((f) => (f.producto.id === producto.id ? { ...f, cantidad: f.cantidad + (cantidadSugerida ?? 1) } : f));
      }
      return [...prev, { producto, cantidad: cantidadSugerida ?? 1, costoUnitario: producto.costo_referencia }];
    });
  }

  async function buscarPorCodigo(valor: string) {
    const limpio = valor.trim();
    if (!limpio || !empresaId) return;
    setBuscando(true);
    setError(null);
    try {
      const { data, error: errBusqueda } = await supabase
        .from("productos")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("codigo_barras", limpio)
        .eq("activo", true)
        .maybeSingle();
      if (errBusqueda) throw errBusqueda;
      if (data) {
        agregarAlCarrito(data as Producto);
        setCodigo("");
      } else {
        setCodigoSinProducto(limpio);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuscando(false);
      inputCodigoRef.current?.focus();
    }
  }

  function onKeyDownCodigo(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      buscarPorCodigo(codigo);
    }
  }

  async function onCrearProductoRapido(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!codigoSinProducto) return;
    const form = new FormData(e.currentTarget);
    const nombre = String(form.get("nombre") ?? "").trim();
    const sku = String(form.get("sku") ?? "").trim() || codigoSinProducto;
    const unidad = String(form.get("unidad") ?? "PZA").trim() || "PZA";
    if (!nombre) return;
    setError(null);
    try {
      const { data, error: errInsert } = await supabase
        .from("productos")
        .insert({ empresa_id: empresaId, sku, codigo_barras: codigoSinProducto, nombre, unidad_medida: unidad })
        .select("*")
        .single();
      if (errInsert) throw errInsert;
      agregarAlCarrito(data as Producto);
      setCodigoSinProducto(null);
      setCodigo("");
      queryClient.invalidateQueries({ queryKey: ["productos"] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function limpiarFoto() {
    setNotaEntregaId(null);
    setItemsSugeridos([]);
    setErrorLecturaFoto(null);
  }

  async function onSubirFoto(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!empresaId) return;
    setError(null);
    limpiarFoto();
    setSubiendoFoto(true);
    // Se guarda la referencia del <form> antes del primer await: React pone
    // en null e.currentTarget en cuanto termina la parte síncrona del
    // manejador, así que usarlo después de un await (para el .reset() de
    // abajo) revienta con "No se pueden leer las propiedades de null".
    const formEl = e.currentTarget;
    try {
      const form = new FormData(formEl);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(urlFuncion("ocr-nota-entrega"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      setNotaEntregaId(json.notaEntregaId);
      setItemsSugeridos(json.itemsSugeridos ?? []);
      setErrorLecturaFoto(json.errorLectura ?? null);
      formEl.reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendoFoto(false);
    }
  }

  function actualizarFila(productoId: string, campo: "cantidad" | "costoUnitario", valor: number) {
    setCarrito((prev) => prev.map((f) => (f.producto.id === productoId ? { ...f, [campo]: valor } : f)));
  }

  function quitarFila(productoId: string) {
    setCarrito((prev) => prev.filter((f) => f.producto.id !== productoId));
  }

  async function onGuardarMovimiento() {
    if (!empresaId || !almacen || carrito.length === 0) return;
    if (!esAjuste && ordenId && carrito.some((f) => f.costoUnitario == null)) {
      setError("Todas las líneas necesitan costo unitario para poder vincularse a una orden.");
      return;
    }
    setEnviando(true);
    setError(null);
    setMensaje(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Sesión expirada, vuelve a iniciar sesión.");

      const filas = carrito.map((f) => ({
        empresa_id: empresaId,
        almacen_id: almacen.id,
        producto_id: f.producto.id,
        tipo,
        cantidad: f.cantidad,
        costo_unitario: f.costoUnitario,
        fecha,
        orden_compra_id: !esAjuste && tipo === "entrada" && ordenId ? ordenId : null,
        orden_venta_id: !esAjuste && tipo === "salida" && ordenId ? ordenId : null,
        es_ajuste: esAjuste,
        codigo_escaneado: f.producto.codigo_barras,
        nota_entrega_id: notaEntregaId,
        registrado_por: userId,
      }));

      const { error: errInsert } = await supabase.from("movimientos_inventario").insert(filas);
      if (errInsert) throw errInsert;

      setMensaje(`Guardado: ${filas.length} línea(s) de ${tipo === "entrada" ? "entrada" : "salida"}.`);
      setCarrito([]);
      limpiarFoto();
      queryClient.invalidateQueries({ queryKey: ["movimientos-inventario-recientes"] });
      queryClient.invalidateQueries({ queryKey: ["existencias"] });
      queryClient.invalidateQueries({ queryKey: ["avance-recepcion-oc"] });
      queryClient.invalidateQueries({ queryKey: ["avance-embarque-ov"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {veTodasLasEmpresas ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Empresa</label>
            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Selecciona…</option>
              {empresas?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Empresa: la asignada a tu usuario.</p>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Tipo de movimiento</label>
          <div className="flex overflow-hidden rounded border border-slate-300">
            {(["entrada", "salida"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`px-3 py-1.5 text-sm ${tipo === t ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
              >
                {t === "entrada" ? "Entrada" : "Salida"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
        </div>

        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={esAjuste} onChange={(e) => setEsAjuste(e.target.checked)} />
          Es un ajuste (conteo/merma, sin orden)
        </label>
      </div>

      {!esAjuste && empresaId && (
        <div className="mb-4 max-w-md">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Vincular a {tipo === "entrada" ? "orden de compra/servicio (match con Grupo Loma)" : "orden de venta (match con Grupo Loma)"}
          </label>
          <select value={ordenId} onChange={(e) => setOrdenId(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Sin vincular</option>
            {ordenes?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.etiqueta}
              </option>
            ))}
          </select>
        </div>
      )}

      {!empresaId && <p className="text-sm text-slate-500">Selecciona una empresa para continuar.</p>}

      {empresaId && !almacen && <p className="text-sm text-amber-600">Esta empresa no tiene un almacén activo configurado.</p>}

      {empresaId && almacen && (
        <>
          <div className="mb-4">
            <label className="mb-1 block text-xs font-medium text-slate-600">Cómo vas a capturar</label>
            <div className="flex overflow-hidden rounded border border-slate-300">
              {MODOS_CAPTURA.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  onClick={() => setModo(m.valor)}
                  className={`px-3 py-1.5 text-sm ${modo === m.valor ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
                >
                  {m.etiqueta}
                </button>
              ))}
            </div>
          </div>

          {modo === "codigo" && (
            <>
              <div className="mb-4 flex max-w-md items-center gap-2">
                <input
                  ref={inputCodigoRef}
                  autoFocus
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={onKeyDownCodigo}
                  placeholder="Escanea o escribe el código de barras y presiona Enter"
                  disabled={buscando}
                  className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setMostrarCamara(true)}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                >
                  Usar cámara
                </button>
              </div>

              {codigoSinProducto && (
                <form onSubmit={onCrearProductoRapido} className="mb-4 max-w-md space-y-2 rounded border border-blue-200 bg-blue-50 p-3">
                  <p className="text-sm font-medium text-blue-900">
                    No hay ningún producto con el código{" "}
                    <code className="rounded bg-blue-100 px-1.5 py-0.5 font-mono text-blue-900">{codigoSinProducto}</code> en esta
                    empresa. Créalo para continuar:
                  </p>
                  <input name="nombre" required placeholder="Nombre del producto" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  <div className="flex gap-2">
                    <input name="sku" placeholder={`SKU (default: ${codigoSinProducto})`} className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                    <input name="unidad" placeholder="Unidad (default PZA)" className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <button className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">Crear y agregar</button>
                    <button
                      type="button"
                      onClick={() => {
                        setCodigoSinProducto(null);
                        setCodigo("");
                      }}
                      className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}

              {mostrarCamara && (
                <BarcodeScanner
                  onDetectado={(c) => {
                    setMostrarCamara(false);
                    buscarPorCodigo(c);
                  }}
                  onCerrar={() => setMostrarCamara(false)}
                />
              )}
            </>
          )}

          {modo === "nombre" && (
            <div className="mb-4 max-w-md">
              <p className="mb-1 text-xs text-slate-500">Para proveedores sin QR ni código de barras: busca el producto por su nombre y agrégalo al carrito.</p>
              <BuscadorProducto empresaId={empresaId} onSeleccionar={(p) => agregarAlCarrito(p)} />
            </div>
          )}

          {modo === "foto" && (
            <div className="mb-4 max-w-xl space-y-3">
              <p className="text-xs text-slate-500">
                Sube la foto de la nota o remisión de papel del proveedor -- la IA intentará leer los conceptos, cantidades y proveedor
                automáticamente. La foto aplica a todo el movimiento (todas las líneas que agregues quedan vinculadas a ella).
              </p>
              <form onSubmit={onSubirFoto} className="flex items-center gap-2">
                <input type="hidden" name="empresaId" value={empresaId} />
                <input type="file" name="file" accept="image/jpeg,image/png,image/webp" required disabled={subiendoFoto} className="flex-1 text-sm" />
                <button
                  disabled={subiendoFoto}
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {subiendoFoto ? "Leyendo…" : "Subir y leer"}
                </button>
              </form>

              {notaEntregaId && (
                <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                  Foto guardada.{" "}
                  <button type="button" onClick={limpiarFoto} className="underline">
                    Quitar y subir otra
                  </button>
                </div>
              )}

              {errorLecturaFoto && (
                <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">⚠️ {errorLecturaFoto}</p>
              )}

              {itemsSugeridos.length > 0 && (
                <div className="space-y-2 rounded border border-blue-200 bg-blue-50 p-3">
                  <p className="text-sm font-medium text-blue-900">
                    Conceptos detectados -- confírmalos buscando el producto correspondiente para agregarlos al carrito:
                  </p>
                  {itemsSugeridos.map((item, i) => (
                    <ItemSugeridoCard
                      key={i}
                      item={item}
                      empresaId={empresaId}
                      onAgregado={(p) => {
                        agregarAlCarrito(p, item.cantidad ?? 1);
                        setItemsSugeridos((prev) => prev.filter((_, idx) => idx !== i));
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {carrito.length > 0 && (
            <div className="mb-4 overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2">Cantidad</th>
                    <th className="px-3 py-2">Costo unitario</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {carrito.map((f) => (
                    <tr key={f.producto.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        {f.producto.nombre} <span className="text-xs text-slate-400">({f.producto.sku})</span>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={f.cantidad}
                          onChange={(e) => actualizarFila(f.producto.id, "cantidad", Number(e.target.value))}
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={f.costoUnitario ?? ""}
                          onChange={(e) => actualizarFila(f.producto.id, "costoUnitario", e.target.value === "" ? (null as unknown as number) : Number(e.target.value))}
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
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

          {carrito.length > 0 && (
            <button
              onClick={onGuardarMovimiento}
              disabled={enviando}
              className="mb-4 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {enviando ? "Guardando…" : `Guardar ${tipo === "entrada" ? "entrada" : "salida"} (${carrito.length} línea(s))`}
            </button>
          )}
        </>
      )}

      {error && <p className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {mensaje && <p className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>}

      {empresaId && pendientesOrden && pendientesOrden.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Pendientes por asignar {tipo === "entrada" ? "orden de compra" : "orden de venta"}
          </h2>
          <p className="mb-2 text-xs text-slate-500">
            Se guardaron sin vincular porque todavía no se sabía a qué orden correspondían -- asígnala en cuanto la confirmes.
          </p>
          <div className="overflow-x-auto rounded border border-amber-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-amber-50 text-left text-xs uppercase text-amber-800">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Cantidad</th>
                  <th className="px-3 py-2">Asignar orden</th>
                </tr>
              </thead>
              <tbody>
                {pendientesOrden.map((m) => (
                  <AsignarOrdenFila
                    key={m.id}
                    movimiento={m as any}
                    ordenes={ordenes}
                    onAsignado={() => {
                      queryClient.invalidateQueries({ queryKey: ["pendientes-asignar-orden"] });
                      queryClient.invalidateQueries({ queryKey: ["movimientos-inventario-recientes"] });
                      queryClient.invalidateQueries({ queryKey: ["avance-recepcion-oc"] });
                      queryClient.invalidateQueries({ queryKey: ["avance-embarque-ov"] });
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {empresaId && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Últimos movimientos</h2>
          {cargandoRecientes && <p className="text-sm text-slate-400">Cargando…</p>}
          {recientes && (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2 text-right">Cantidad</th>
                    <th className="px-3 py-2 text-right">Costo unit.</th>
                    <th className="px-3 py-2">Vinculado</th>
                  </tr>
                </thead>
                <tbody>
                  {recientes.map((m: any) => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-3 py-2">{m.fecha}</td>
                      <td className="px-3 py-2">{m.tipo === "entrada" ? "Entrada" : "Salida"}</td>
                      <td className="px-3 py-2">
                        {m.productos?.nombre} <span className="text-xs text-slate-400">({m.productos?.sku})</span>
                      </td>
                      <td className="px-3 py-2 text-right">{m.cantidad}</td>
                      <td className="px-3 py-2 text-right">{m.costo_unitario ?? "—"}</td>
                      <td className="px-3 py-2">{m.orden_compra_id || m.orden_venta_id ? "Sí" : "—"}</td>
                    </tr>
                  ))}
                  {recientes.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                        Todavía no hay movimientos de inventario para esta empresa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
