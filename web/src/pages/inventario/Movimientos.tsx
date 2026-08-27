import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { BarcodeScanner } from "../../components/BarcodeScanner";
import type { Producto, TipoMovimientoInventario } from "../../types/database";

interface FilaCarrito {
  producto: Producto;
  cantidad: number;
  costoUnitario: number | null;
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
  const [codigo, setCodigo] = useState("");
  const [mostrarCamara, setMostrarCamara] = useState(false);
  const [codigoSinProducto, setCodigoSinProducto] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const inputCodigoRef = useRef<HTMLInputElement>(null);

  const { data: almacen } = useAlmacen(empresaId);
  const { data: ordenes } = useOrdenes(empresaId, tipo);
  const { data: recientes, isLoading: cargandoRecientes } = useMovimientosRecientes(empresaId);

  useEffect(() => {
    setOrdenId("");
  }, [tipo, empresaId]);

  function agregarAlCarrito(producto: Producto) {
    setCarrito((prev) => {
      const existente = prev.find((f) => f.producto.id === producto.id);
      if (existente) {
        return prev.map((f) => (f.producto.id === producto.id ? { ...f, cantidad: f.cantidad + 1 } : f));
      }
      return [...prev, { producto, cantidad: 1, costoUnitario: producto.costo_referencia }];
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
        registrado_por: userId,
      }));

      const { error: errInsert } = await supabase.from("movimientos_inventario").insert(filas);
      if (errInsert) throw errInsert;

      setMensaje(`Guardado: ${filas.length} línea(s) de ${tipo === "entrada" ? "entrada" : "salida"}.`);
      setCarrito([]);
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
            Vincular a {tipo === "entrada" ? "orden de compra/servicio (match con Acumulado)" : "orden de venta (match con Acumulado)"}
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
                No hay ningún producto con el código <code>{codigoSinProducto}</code> en esta empresa. Créalo para continuar:
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
