import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { useAuth } from "../../lib/auth";
import { BarcodeScanner } from "../../components/BarcodeScanner";
import { idRemisionDesdeCodigo } from "../../lib/remision";
import { imprimirRemision } from "./remisionQr";
import { imprimirComprobanteEntrada } from "./comprobanteEntradaQr";
import { cantidadTexto } from "../../lib/remision";
import { sincronizarCatalogoOcOv } from "../../lib/sincronizarOcOv";
import type { ItemSugeridoNota, Producto, TipoMovimientoInventario } from "../../types/database";

interface FilaCarrito {
  producto: Producto;
  cantidad: number;
  costoUnitario: number | null;
  /** Partida de la OC/OV del backoffice que esta fila recibe/embarca (null
   * cuando se capturó suelta). Dos partidas distintas pueden mapear al mismo
   * producto, por eso la fila se identifica por partida cuando la hay. */
  lineaId?: string | null;
  /** Datos de la partida (pedido, avance) para mostrar faltante/excedente. */
  linea?: LineaAvance | null;
}

function claveFila(f: FilaCarrito): string {
  return f.lineaId ?? f.producto.id;
}

/** Partida de una OC (entrada) u OV (salida) con su avance por cantidad --
 * viene de v_oc_lineas_avance / v_ov_lineas_avance, normalizada a un solo
 * tipo para que el checklist sea el mismo en los dos sentidos. */
interface LineaAvance {
  linea_id: string;
  numero: number;
  descripcion: string;
  unidad: string | null;
  cantidad: number | null;
  costo: number | null;
  avanzado: number;
  pendiente: number;
  estado: string;
  producto_id: string | null;
}

function useLineasOrden(ordenId: string, tipo: TipoMovimientoInventario) {
  return useQuery({
    queryKey: ["lineas-orden", ordenId, tipo],
    enabled: !!ordenId && ordenId !== "__nueva__",
    queryFn: async (): Promise<LineaAvance[]> => {
      if (tipo === "entrada") {
        const { data, error } = await supabase.from("v_oc_lineas_avance").select("*").eq("orden_compra_id", ordenId).order("numero");
        if (error) throw error;
        return (data ?? []).map((l) => ({
          linea_id: String(l.linea_id),
          numero: Number(l.numero),
          descripcion: String(l.item),
          unidad: l.unidad ?? null,
          cantidad: l.cantidad == null ? null : Number(l.cantidad),
          costo: l.costo == null ? null : Number(l.costo),
          avanzado: Number(l.recibido ?? 0),
          pendiente: Number(l.pendiente ?? 0),
          estado: String(l.estado),
          producto_id: l.producto_id ?? null,
        }));
      }
      const { data, error } = await supabase.from("v_ov_lineas_avance").select("*").eq("orden_venta_id", ordenId).order("numero");
      if (error) throw error;
      return (data ?? []).map((l) => ({
        linea_id: String(l.linea_id),
        numero: Number(l.numero),
        descripcion: String(l.concepto),
        unidad: l.unidad ?? null,
        cantidad: l.cantidad == null ? null : Number(l.cantidad),
        costo: l.precio_base == null ? null : Number(l.precio_base),
        avanzado: Number(l.embarcado ?? 0),
        pendiente: Number(l.pendiente ?? 0),
        estado: String(l.estado),
        producto_id: l.producto_id ?? null,
      }));
    },
  });
}

// Tres formas de decidir qué producto va al carrito: escanear (físico o
// cámara), buscar por nombre a mano (proveedores sin QR/código), o subir la
// foto de la nota/remisión de papel y dejar que la IA sugiera los conceptos
// -- las tres terminan agregando filas al mismo `carrito` de abajo.
type ModoCaptura = "codigo" | "nombre" | "foto";

const MODOS_CAPTURA: { valor: ModoCaptura; etiqueta: string }[] = [
  { valor: "nombre", etiqueta: "Buscar por nombre" },
  { valor: "codigo", etiqueta: "Código de barras" },
];

/** Convierte cualquier imagen (incluida HEIC del iPhone cuando el navegador
 * la decodifica) a JPEG de máximo 1600 px, para que la lectura por IA no la
 * rechace por formato ni por peso. Si no se puede decodificar, se manda tal
 * cual. */
async function aJpeg(archivo: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(archivo);
    const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(bitmap.width * escala);
    lienzo.height = Math.round(bitmap.height * escala);
    const ctx = lienzo.getContext("2d");
    if (!ctx) return archivo;
    ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return archivo;
    return new File([blob], archivo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return archivo;
  }
}

/** Campo numérico que respeta lo que la persona va tecleando. Con un
 * <input type="number"> controlado por Number(value), al borrar para escribir
 * otra cantidad el valor se vuelve 0 y el campo "no se deja modificar" (Alma,
 * 25-sep-2026). Aquí el texto vive aparte y solo se emite el número cuando es
 * válido; vacío = null. */
function InputNumero({
  valor,
  onCambio,
  className,
  min,
  step,
  placeholder,
}: {
  valor: number | null;
  onCambio: (n: number | null) => void;
  className?: string;
  min?: string;
  step?: string;
  placeholder?: string;
}) {
  const [texto, setTexto] = useState(valor == null ? "" : String(valor));
  const [enfocado, setEnfocado] = useState(false);
  useEffect(() => {
    if (!enfocado) setTexto(valor == null ? "" : String(valor));
  }, [valor, enfocado]);
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      placeholder={placeholder}
      value={texto}
      onFocus={() => setEnfocado(true)}
      onBlur={() => setEnfocado(false)}
      onChange={(e) => {
        const t = e.target.value;
        setTexto(t);
        if (t === "") onCambio(null);
        else {
          const n = Number(t);
          if (Number.isFinite(n)) onCambio(n);
        }
      }}
      className={className}
    />
  );
}

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
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<Producto[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [errorCrear, setErrorCrear] = useState<string | null>(null);

  // Sin resultados: se da de alta el producto ahí mismo (no todo trae
  // código de barras ni está todavía en el catálogo).
  async function crearDesdeBusqueda(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const nombre = String(fd.get("nombre") ?? "").trim();
    const sku = String(fd.get("sku") ?? "").trim();
    const unidad = String(fd.get("unidad") ?? "PZA").trim() || "PZA";
    if (!nombre || !sku) return;
    setErrorCrear(null);
    try {
      const { data, error } = await supabase.from("productos").insert({ empresa_id: empresaId, sku, nombre, unidad_medida: unidad }).select("*").single();
      if (error) throw error;
      onSeleccionar(data as Producto);
      setResultados(null);
      setQuery("");
      setCreando(false);
      queryClient.invalidateQueries({ queryKey: ["productos"] });
    } catch (err) {
      setErrorCrear((err as Error).message);
    }
  }

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
          {resultados.length === 0 && (
            <li className="px-2 py-1 text-slate-500">
              Sin resultados.{" "}
              <button type="button" onClick={() => setCreando(true)} className="text-slate-800 underline">
                Dar de alta "{query}"
              </button>
            </li>
          )}
        </ul>
      )}
      {creando && (
        <form onSubmit={crearDesdeBusqueda} className="mt-2 grid grid-cols-2 gap-2 rounded border border-dashed border-slate-300 bg-slate-50 p-2 sm:grid-cols-4">
          <input name="nombre" required defaultValue={query} placeholder="Nombre del producto" className="col-span-2 rounded border border-slate-300 px-2 py-1 text-sm" />
          <input name="sku" required placeholder="Clave / SKU" className="rounded border border-slate-300 px-2 py-1 text-sm" />
          <input name="unidad" defaultValue="PZA" placeholder="Unidad" className="rounded border border-slate-300 px-2 py-1 text-sm" />
          {errorCrear && <p className="col-span-2 text-xs text-red-600 sm:col-span-4">{errorCrear}</p>}
          <div className="col-span-2 flex gap-2 sm:col-span-4">
            <button className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white">Crear y agregar al carrito</button>
            <button type="button" onClick={() => setCreando(false)} className="text-xs text-slate-500 underline">
              Cancelar
            </button>
          </div>
        </form>
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

  async function crearProducto(nombre: string, sku: string, unidad: string) {
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

  async function onCrear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const nombre = String(form.get("nombre") ?? "").trim();
    const sku = String(form.get("sku") ?? "").trim();
    const unidad = String(form.get("unidad") ?? "PZA").trim() || "PZA";
    if (!nombre || !sku) return;
    await crearProducto(nombre, sku, unidad);
  }

  // Un clic: el concepto leído de la foto se da de alta tal cual (SKU
  // generado) y se agrega al carrito; el formulario queda para corregir datos.
  async function onCrearAutomatico() {
    const nombre = item.descripcion.trim();
    if (!nombre) {
      setCreando(true);
      return;
    }
    await crearProducto(nombre, `AUTO-${Date.now().toString(36).toUpperCase()}`, (item.unidad ?? "PZA").trim() || "PZA");
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
          <div className="mt-1 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onCrearAutomatico}
              className="rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-800"
            >
              Crear en automático y agregar
            </button>
            <button type="button" onClick={() => setCreando(true)} className="text-xs text-blue-700 hover:underline">
              Crear con datos específicos…
            </button>
          </div>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
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
/** "24 sep · " para que en el selector se vea de un vistazo cuál es la
 * orden más reciente (van de la más nueva a la más vieja). */
function fechaSelector(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return "";
  const mes = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][m - 1];
  return `${String(d).padStart(2, "0")} ${mes} · `;
}

const dineroCorto = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }));

function useOrdenes(empresaId: string, tipo: TipoMovimientoInventario) {
  return useQuery({
    queryKey: ["ordenes-para-match", empresaId, tipo],
    enabled: !!empresaId,
    queryFn: async () => {
      if (tipo === "entrada") {
        const { data, error } = await supabase
          .from("ordenes_compra")
          .select("id, id_orden, tipo, proveedor, total, fecha_creacion")
          .eq("empresa_id", empresaId)
          .order("fecha_creacion", { ascending: false, nullsFirst: false })
          .order("id_orden", { ascending: false })
          .limit(150);
        if (error) throw error;
        return data.map((o) => ({ id: o.id, etiqueta: `${fechaSelector(o.fecha_creacion)}${o.tipo} ${o.id_orden} — ${o.proveedor ?? "sin proveedor"} (${dineroCorto(o.total)})` }));
      }
      const { data, error } = await supabase
        .from("ordenes_venta")
        .select("id, id_ov, cliente, total, fecha_ov")
        .eq("empresa_id", empresaId)
        .order("fecha_ov", { ascending: false, nullsFirst: false })
        .order("id_ov", { ascending: false })
        .limit(150);
      if (error) throw error;
      return data.map((o) => ({ id: o.id, etiqueta: `${fechaSelector(o.fecha_ov)}OV ${o.id_ov} — ${o.cliente ?? "sin cliente"} (${dineroCorto(o.total)})` }));
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
        .select("id, tipo, cantidad, costo_unitario, fecha, comentario, orden_compra_id, orden_venta_id, remision_id, productos(nombre, sku), remisiones_salida(folio)")
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
  // "__nueva__": OC que todavía no llega del backoffice (por ejemplo,
  // pendiente de autorización). Se da de alta con su folio y cuando la
  // sincronización la traiga, se completa sola (mismo folio y tipo).
  const [nuevaOcFolio, setNuevaOcFolio] = useState("");
  const [nuevaOcProveedor, setNuevaOcProveedor] = useState("");
  const [esAjuste, setEsAjuste] = useState(false);
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [carrito, setCarrito] = useState<FilaCarrito[]>([]);
  const [modo, setModo] = useState<ModoCaptura>("nombre");
  const [codigo, setCodigo] = useState("");
  const [mostrarCamara, setMostrarCamara] = useState(false);
  const [codigoSinProducto, setCodigoSinProducto] = useState<string | null>(null);
  const [sincronizandoOc, setSincronizandoOc] = useState(false);
  const [avisoSyncOc, setAvisoSyncOc] = useState<string | null>(null);
  // checklist de partidas de la OC/OV seleccionada: lineaId -> cantidad ahora
  const [seleccion, setSeleccion] = useState<Record<string, number>>({});
  const [agregandoLineas, setAgregandoLineas] = useState(false);
  // la foto normalmente es evidencia (las partidas ya vienen del backoffice);
  // la lectura por IA queda como opción para notas sin OC
  const [soloEvidencia, setSoloEvidencia] = useState(true);
  // ids de productos creados en automático en esta sesión (nombre editable en el carrito)
  const [productosNuevos, setProductosNuevos] = useState<Set<string>>(new Set());
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [subiendoFoto, setSubiendoFoto] = useState(false);
  const [notaEntregaId, setNotaEntregaId] = useState<string | null>(null);
  // Remisión de salida con QR (pedido de Mario, 21-sep-2026): por omisión
  // toda salida real genera su remisión; se puede apagar para salidas
  // internas que no necesitan documento.
  const [generarRemision, setGenerarRemision] = useState(true);
  const [entregarA, setEntregarA] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [ultimaRemision, setUltimaRemision] = useState<{ id: string; folio: string } | null>(null);
  // ids de los movimientos de la última entrada guardada (para el comprobante PDF con QR)
  const [ultimaEntrada, setUltimaEntrada] = useState<{ ids: string[]; ordenCompraId: string | null } | null>(null);
  // orden cuyas partidas pendientes ya se precargaron al carrito (una vez por orden elegida)
  const autoCargadoRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const [itemsSugeridos, setItemsSugeridos] = useState<ItemSugeridoNota[]>([]);
  const [errorLecturaFoto, setErrorLecturaFoto] = useState<string | null>(null);
  const inputCodigoRef = useRef<HTMLInputElement>(null);

  const { data: almacen } = useAlmacen(empresaId);
  const { data: ordenes } = useOrdenes(empresaId, tipo);
  const [filtroOrden, setFiltroOrden] = useState("");
  const ordenesFiltradas = (ordenes ?? []).filter((o) => o.etiqueta.toLowerCase().includes(filtroOrden.trim().toLowerCase()));
  // Llegada desde "Match OC/OV" con la orden ya elegida.
  const [params] = useSearchParams();
  useEffect(() => {
    const emp = params.get("empresa");
    const oc = params.get("oc");
    const ov = params.get("ov");
    const t = params.get("tipo");
    if (emp) setEmpresaId(emp);
    if (t === "entrada" || t === "salida") setTipo(t);
    if (oc) {
      setTipo("entrada");
      setOrdenId(oc);
    } else if (ov) {
      setTipo("salida");
      setOrdenId(ov);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { data: lineas } = useLineasOrden(ordenId, tipo);
  const { data: recientes, isLoading: cargandoRecientes } = useMovimientosRecientes(empresaId);
  const { data: pendientesOrden } = usePendientesAsignarOrden(empresaId, tipo);

  useEffect(() => {
    setOrdenId("");
  }, [tipo, empresaId]);

  useEffect(() => {
    setSeleccion({});
    autoCargadoRef.current = null;
  }, [ordenId]);

  // Al elegir una orden, sus partidas pendientes pasan solas al carrito con la
  // cantidad que falta (Mario, 24-sep-2026): el almacén solo confirma o corrige
  // si llegó más o menos. Solo la primera vez por orden y con el carrito vacío.
  useEffect(() => {
    if (!lineas || lineas.length === 0 || !ordenId || ordenId === "__nueva__" || esAjuste) return;
    if (autoCargadoRef.current === ordenId || carrito.length > 0) return;
    const mapa: Record<string, number> = {};
    for (const l of lineas) if (l.pendiente > 0) mapa[l.linea_id] = l.pendiente;
    autoCargadoRef.current = ordenId;
    if (Object.keys(mapa).length === 0) return;
    void agregarLineasAlCarrito(mapa);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineas, ordenId, esAjuste]);

  function agregarAlCarrito(
    producto: Producto,
    cantidadSugerida?: number,
    extra?: { costoUnitario?: number | null; lineaId?: string | null; linea?: LineaAvance | null },
  ) {
    setCarrito((prev) => {
      const lineaId = extra?.lineaId ?? extra?.linea?.linea_id ?? null;
      const existente = prev.find((f) => f.producto.id === producto.id && (f.lineaId ?? null) === lineaId);
      if (existente) {
        return prev.map((f) =>
          f.producto.id === producto.id && (f.lineaId ?? null) === lineaId ? { ...f, cantidad: f.cantidad + (cantidadSugerida ?? 1) } : f,
        );
      }
      return [
        ...prev,
        {
          producto,
          cantidad: cantidadSugerida ?? 1,
          costoUnitario: extra?.costoUnitario !== undefined ? extra.costoUnitario : producto.costo_referencia,
          lineaId,
          linea: extra?.linea ?? null,
        },
      ];
    });
  }

  async function buscarPorCodigo(valor: string) {
    const limpio = valor.trim();
    // El QR de una remisión impresa abre la remisión (consulta / confirmar
    // entrega) en vez de buscar un producto.
    const remisionEscaneada = idRemisionDesdeCodigo(limpio);
    if (remisionEscaneada) {
      navigate(`/inventario/remisiones/${remisionEscaneada}`);
      return;
    }
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
        await crearProductoAutomatico(limpio);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBuscando(false);
      inputCodigoRef.current?.focus();
    }
  }

  // Alta automática (Laura, 23-sep-2026): un código que no existe en el
  // catálogo ya no detiene la captura -- se crea el producto al vuelo con el
  // código como SKU y un nombre provisional que se puede corregir desde el
  // carrito. Si el insert falla (permisos, duplicado) se cae al formulario
  // manual de siempre.
  async function crearProductoAutomatico(codigoBarras: string) {
    const ordenSel = ordenes?.find((o) => o.id === ordenId) as { proveedor?: string | null } | undefined;
    const nombre = ordenSel?.proveedor ? `Producto ${codigoBarras} · ${ordenSel.proveedor}` : `Producto ${codigoBarras}`;
    const { data, error: errInsert } = await supabase
      .from("productos")
      .insert({ empresa_id: empresaId, sku: codigoBarras, codigo_barras: codigoBarras, nombre, unidad_medida: "PZA" })
      .select("*")
      .single();
    if (errInsert || !data) {
      setCodigoSinProducto(codigoBarras);
      if (errInsert) setError(`No se pudo crear el producto en automático: ${errInsert.message}`);
      return;
    }
    const creado = data as Producto;
    agregarAlCarrito(creado);
    setProductosNuevos((prev) => new Set(prev).add(creado.id));
    setCodigo("");
    queryClient.invalidateQueries({ queryKey: ["productos"] });
  }

  // "Actualizar OCs": trae del backoffice las OC/OV autorizadas sin salir de
  // inventario (antes solo desde Carga, que Laura no ve). Corre en segundo
  // plano y al terminar refresca el selector.
  async function onActualizarOcs() {
    setAvisoSyncOc(null);
    setSincronizandoOc(true);
    try {
      const res = await sincronizarCatalogoOcOv();
      queryClient.invalidateQueries({ queryKey: ["ordenes-para-match"] });
      setAvisoSyncOc(`Catálogo actualizado: ${res.oc_guardadas ?? 0} OC/OS y ${res.ov_guardadas ?? 0} OV del backoffice (solo las ya autorizadas).`);
    } catch (err) {
      setAvisoSyncOc(`No se pudo actualizar: ${(err as Error).message}`);
    } finally {
      setSincronizandoOc(false);
    }
  }

  function toggleLinea(l: LineaAvance, marcada: boolean) {
    setSeleccion((prev) => {
      const sig = { ...prev };
      if (marcada) sig[l.linea_id] = l.pendiente > 0 ? l.pendiente : (l.cantidad ?? 1);
      else delete sig[l.linea_id];
      return sig;
    });
  }

  function seleccionarPendientes() {
    const sig: Record<string, number> = {};
    for (const l of lineas ?? []) if (l.pendiente > 0) sig[l.linea_id] = l.pendiente;
    setSeleccion(sig);
  }

  // Cada partida marcada se vuelve una fila del carrito. El producto se busca
  // por el que ya se usó para esa partida, luego por nombre exacto en la
  // empresa, y si no existe se crea (mismo criterio de alta automática).
  async function agregarLineasAlCarrito(mapa?: Record<string, number>) {
    if (!lineas || !empresaId) return;
    const sel = mapa ?? seleccion;
    setAgregandoLineas(true);
    setError(null);
    try {
      let creados = 0;
      for (const l of lineas) {
        const cantidad = sel[l.linea_id];
        if (!cantidad || cantidad <= 0) continue;
        let producto: Producto | null = null;
        if (l.producto_id) {
          const { data } = await supabase.from("productos").select("*").eq("id", l.producto_id).maybeSingle();
          producto = (data as Producto | null) ?? null;
        }
        if (!producto) {
          const patron = l.descripcion.replace(/[%_\\]/g, "\\$&");
          const { data } = await supabase.from("productos").select("*").eq("empresa_id", empresaId).eq("activo", true).ilike("nombre", patron).limit(1);
          producto = ((data ?? [])[0] as Producto | undefined) ?? null;
        }
        if (!producto) {
          const sku = `${tipo === "entrada" ? "OC" : "OV"}-${Date.now().toString(36).toUpperCase()}-${l.numero}`;
          const { data, error: errInsert } = await supabase
            .from("productos")
            .insert({ empresa_id: empresaId, sku, nombre: l.descripcion, unidad_medida: l.unidad ?? "PZA", costo_referencia: l.costo })
            .select("*")
            .single();
          if (errInsert) throw errInsert;
          producto = data as Producto;
          creados += 1;
          const nuevoId = producto.id;
          setProductosNuevos((prev) => new Set(prev).add(nuevoId));
        }
        agregarAlCarrito(producto, cantidad, { costoUnitario: l.costo, lineaId: l.linea_id, linea: l });
      }
      setSeleccion({});
      if (creados > 0) queryClient.invalidateQueries({ queryKey: ["productos"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAgregandoLineas(false);
    }
  }

  async function renombrarProducto(productoId: string, nombre: string) {
    const limpio = nombre.trim();
    if (!limpio) return;
    const { error: errUpd } = await supabase.from("productos").update({ nombre: limpio }).eq("id", productoId);
    if (errUpd) {
      setError(errUpd.message);
      return;
    }
    setCarrito((prev) => prev.map((f) => (f.producto.id === productoId ? { ...f, producto: { ...f.producto, nombre: limpio } } : f)));
    queryClient.invalidateQueries({ queryKey: ["productos"] });
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
      const original = form.get("file");
      if (original instanceof File && original.size > 0) form.set("file", await aJpeg(original));
      form.set("soloEvidencia", soloEvidencia ? "1" : "0");
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(urlFuncion("ocr-nota-entrega"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
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

  function actualizarFila(clave: string, campo: "cantidad" | "costoUnitario", valor: number) {
    setCarrito((prev) => prev.map((f) => (claveFila(f) === clave ? { ...f, [campo]: valor } : f)));
  }

  function quitarFila(clave: string) {
    setCarrito((prev) => prev.filter((f) => claveFila(f) !== clave));
  }

  async function onGuardarMovimiento() {
    if (!empresaId || !almacen || carrito.length === 0) return;
    if (!esAjuste && ordenId && carrito.some((f) => f.costoUnitario == null)) {
      setError("Todas las líneas necesitan costo unitario para poder vincularse a una orden.");
      return;
    }
    const conRemision = tipo === "salida" && !esAjuste && generarRemision;
    if (conRemision && !entregarA.trim()) {
      setError("Indica a quién se entrega el material para generar la remisión.");
      return;
    }
    if (carrito.some((f) => !(Number(f.cantidad) > 0))) {
      setError("Hay líneas con cantidad 0: corrige la cantidad o quita la línea. No se guardan movimientos ni remisiones en cero.");
      return;
    }
    setEnviando(true);
    setError(null);
    setMensaje(null);
    setUltimaRemision(null);
    setUltimaEntrada(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Sesión expirada, vuelve a iniciar sesión.");

      let remision: { id: string; folio: string } | null = null;
      if (conRemision) {
        const { data: rem, error: errRem } = await supabase
          .from("remisiones_salida")
          .insert({
            empresa_id: empresaId,
            almacen_id: almacen.id,
            fecha,
            entregar_a: entregarA.trim(),
            observaciones: observaciones.trim() || null,
            orden_venta_id: ordenId || null,
            emitida_por: userId,
          })
          .select("id, folio")
          .single();
        if (errRem) throw errRem;
        remision = rem as { id: string; folio: string };
      }

      let ordenIdFinal = ordenId;
      if (!esAjuste && tipo === "entrada" && ordenId === "__nueva__") {
        const folio = nuevaOcFolio.trim();
        if (!folio) throw new Error("Escribe el folio de la orden de compra.");
        const { data: existente } = await supabase.from("ordenes_compra").select("id").eq("empresa_id", empresaId).eq("id_orden", folio).eq("tipo", "OC").maybeSingle();
        if (existente) ordenIdFinal = existente.id;
        else {
          const total = carrito.reduce((s, f) => s + f.cantidad * (f.costoUnitario ?? 0), 0);
          const { data: creada, error: errOc } = await supabase
            .from("ordenes_compra")
            .insert({ id_orden: folio, tipo: "OC", empresa_id: empresaId, proveedor: nuevaOcProveedor.trim() || null, total: total || null, fecha_creacion: fecha, fuente: "excel" })
            .select("id")
            .single();
          if (errOc) throw errOc;
          ordenIdFinal = creada.id;
        }
        queryClient.invalidateQueries({ queryKey: ["ordenes-para-match"] });
      }

      const filas = carrito.map((f) => ({
        empresa_id: empresaId,
        almacen_id: almacen.id,
        producto_id: f.producto.id,
        tipo,
        cantidad: f.cantidad,
        costo_unitario: f.costoUnitario,
        fecha,
        orden_compra_id: !esAjuste && tipo === "entrada" && ordenIdFinal ? ordenIdFinal : null,
        orden_venta_id: !esAjuste && tipo === "salida" && ordenId ? ordenId : null,
        es_ajuste: esAjuste,
        codigo_escaneado: f.producto.codigo_barras,
        nota_entrega_id: notaEntregaId,
        remision_id: remision?.id ?? null,
        linea_orden_compra_id: !esAjuste && tipo === "entrada" ? (f.lineaId ?? null) : null,
        linea_orden_venta_id: !esAjuste && tipo === "salida" ? (f.lineaId ?? null) : null,
        registrado_por: userId,
      }));

      const { data: insertados, error: errInsert } = await supabase.from("movimientos_inventario").insert(filas).select("id");
      if (errInsert) throw errInsert;
      const idsGuardados = (insertados ?? []).map((m: { id: string }) => m.id);

      setMensaje(
        remision
          ? `Guardado: ${filas.length} línea(s) de salida en la remisión ${remision.folio}.`
          : `Guardado: ${filas.length} línea(s) de ${tipo === "entrada" ? "entrada" : "salida"}.`,
      );
      setCarrito([]);
      limpiarFoto();
      if (tipo === "entrada" && idsGuardados.length > 0) {
        const entrada = { ids: idsGuardados, ordenCompraId: !esAjuste && ordenIdFinal && ordenIdFinal !== "__nueva__" ? ordenIdFinal : null };
        setUltimaEntrada(entrada);
        // Abre el comprobante con QR listo para guardar como PDF; si el
        // navegador bloquea la ventana, el botón de abajo lo reabre.
        imprimirComprobanteEntrada(entrada.ids).catch(() => undefined);
      }
      if (remision) {
        setUltimaRemision(remision);
        setEntregarA("");
        setObservaciones("");
        queryClient.invalidateQueries({ queryKey: ["remisiones-salida"] });
        // Abre la remisión lista para imprimir con su QR; si el navegador
        // bloquea la ventana, el botón "Imprimir" de abajo la reabre.
        imprimirRemision(remision.id).catch(() => undefined);
      }
      queryClient.invalidateQueries({ queryKey: ["movimientos-inventario-recientes"] });
      queryClient.invalidateQueries({ queryKey: ["existencias"] });
      queryClient.invalidateQueries({ queryKey: ["avance-recepcion-oc"] });
      queryClient.invalidateQueries({ queryKey: ["avance-embarque-ov"] });
      queryClient.invalidateQueries({ queryKey: ["lineas-orden"] });
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
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-xs font-medium text-slate-600">
              Vincular a {tipo === "entrada" ? "orden de compra/servicio (match con Grupo Loma)" : "orden de venta (match con Grupo Loma)"}
            </label>
            <button
              type="button"
              onClick={onActualizarOcs}
              disabled={sincronizandoOc}
              title="Trae del backoffice las OC/OV autorizadas (tarda 30-60 s)"
              className="shrink-0 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
            >
              {sincronizandoOc ? "Actualizando… (30–60 s)" : "Actualizar OCs del backoffice"}
            </button>
          </div>
          {avisoSyncOc && (
            <p className={`mb-1 text-xs ${avisoSyncOc.startsWith("No se pudo") ? "text-red-600" : "text-emerald-700"}`}>{avisoSyncOc}</p>
          )}
          <input
            value={filtroOrden}
            onChange={(e) => setFiltroOrden(e.target.value)}
            placeholder={tipo === "entrada" ? "Filtrar OC por folio, proveedor o fecha (ej. 40983, ACEROS, 24 sep)…" : "Filtrar OV por folio, cliente o fecha…"}
            className="mb-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
          {filtroOrden && (
            <p className="mb-1 text-[11px] text-slate-500">
              {ordenesFiltradas.length} de {ordenes?.length ?? 0} órdenes coinciden · de la más reciente a la más vieja
            </p>
          )}
          <select value={ordenId} onChange={(e) => setOrdenId(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Sin vincular (ligar después)</option>
            {tipo === "entrada" && <option value="__nueva__">+ OC que todavía no aparece (pendiente de autorización)</option>}
            {ordenesFiltradas.map((o) => (
              <option key={o.id} value={o.id}>
                {o.etiqueta}
              </option>
            ))}
          </select>
          {ordenId === "__nueva__" && (
            <div className="mt-2 grid grid-cols-2 gap-2 rounded border border-dashed border-slate-300 p-2">
              <input value={nuevaOcFolio} onChange={(e) => setNuevaOcFolio(e.target.value)} placeholder="Folio de la OC (ej. 40921)" className="rounded border border-slate-300 px-2 py-1 text-sm" />
              <input value={nuevaOcProveedor} onChange={(e) => setNuevaOcProveedor(e.target.value)} placeholder="Proveedor" className="rounded border border-slate-300 px-2 py-1 text-sm" />
              <p className="col-span-2 text-xs text-slate-500">Las OC llegan del backoffice cada hora, pero solo las ya autorizadas. Con el folio la ligas desde ahora y se completa sola cuando la autoricen.</p>
            </div>
          )}
          {lineas && lineas.length > 0 && ordenId !== "__nueva__" && (
            <div className="mt-2 overflow-x-auto rounded border border-emerald-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 bg-emerald-50 px-3 py-2">
                <p className="text-sm font-medium text-emerald-900">
                  Partidas de la orden -- marca lo que {tipo === "entrada" ? "llegó" : "sale"} y corrige la cantidad si es distinta
                </p>
                <div className="flex gap-3 text-xs text-emerald-800">
                  <button type="button" onClick={seleccionarPendientes} className="underline">
                    Marcar todo lo pendiente
                  </button>
                  <button type="button" onClick={() => setSeleccion({})} className="underline">
                    Limpiar
                  </button>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5"></th>
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">Partida</th>
                    <th className="px-2 py-1.5">Unidad</th>
                    <th className="px-2 py-1.5 text-right">Pedido</th>
                    <th className="px-2 py-1.5 text-right">{tipo === "entrada" ? "Recibido" : "Embarcado"}</th>
                    <th className="px-2 py-1.5 text-right">Pendiente</th>
                    <th className="px-2 py-1.5 text-right" title="Escribe la cantidad que llega o sale; al escribir se marca la partida">Cantidad ahora</th>
                  </tr>
                </thead>
                <tbody>
                  {lineas.map((l) => {
                    const marcada = l.linea_id in seleccion;
                    return (
                      <tr key={l.linea_id} className={`border-t border-slate-100 ${l.estado === "completo" ? "text-slate-400" : ""}`}>
                        <td className="px-2 py-1.5">
                          <input type="checkbox" checked={marcada} onChange={(e) => toggleLinea(l, e.target.checked)} />
                        </td>
                        <td className="px-2 py-1.5 text-xs text-slate-500">{l.numero}</td>
                        <td className="px-2 py-1.5">{l.descripcion}</td>
                        <td className="px-2 py-1.5 text-xs">{l.unidad ?? ""}</td>
                        <td className="px-2 py-1.5 text-right">{l.cantidad ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right">{l.avanzado}</td>
                        <td className={`px-2 py-1.5 text-right ${l.pendiente > 0 ? "font-medium text-amber-700" : ""}`}>{l.pendiente}</td>
                        <td className="px-2 py-1.5 text-right">
                          <InputNumero
                            valor={marcada ? seleccion[l.linea_id] : null}
                            min="0.001"
                            step="0.001"
                            placeholder={l.pendiente > 0 ? String(l.pendiente) : "0"}
                            onCambio={(n) =>
                              setSeleccion((prev) => {
                                const sig = { ...prev };
                                if (n === null) delete sig[l.linea_id];
                                else sig[l.linea_id] = n;
                                return sig;
                              })
                            }
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2">
                <button
                  type="button"
                  disabled={agregandoLineas || Object.keys(seleccion).length === 0}
                  onClick={() => agregarLineasAlCarrito()}
                  className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {agregandoLineas ? "Agregando…" : `Agregar ${Object.keys(seleccion).length} partida(s) al carrito`}
                </button>
                <span className="text-xs text-slate-500">Si la partida aún no existe como producto, se da de alta sola con ese nombre.</span>
              </div>
            </div>
          )}
          {tipo === "entrada" && ordenId === "" && (
            <p className="mt-1 text-xs text-amber-700">Sin OC la entrada queda pendiente de vincular; puedes ligarla después desde "Pendientes por asignar orden de compra".</p>
          )}
        </div>
      )}

      {tipo === "salida" && !esAjuste && empresaId && (
        <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3">
          <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={generarRemision} onChange={(e) => setGenerarRemision(e.target.checked)} />
            Generar remisión de salida con código QR
          </label>
          {generarRemision && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Entregar a *</label>
                <input
                  value={entregarA}
                  onChange={(e) => setEntregarA(e.target.value)}
                  placeholder="Cliente o persona que recibe"
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Observaciones</label>
                <input
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Al guardar se abre la remisión lista para imprimir. El QR abre la remisión en la app para consultarla o confirmar la entrega.
          </p>
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
                    empresa y no se pudo crear en automático. Dalo de alta aquí:
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

          {empresaId && (
            <div className="mb-4 max-w-xl space-y-3 rounded border border-slate-200 bg-white p-3">
              <p className="text-sm font-semibold text-slate-800">Evidencia: foto de la nota o remisión ({tipo === "entrada" ? "entrada" : "salida"})</p>
              <p className="text-xs text-slate-500">
                Sube la foto del papel del proveedor o del cliente: queda vinculada a todas las líneas que guardes y se consulta después desde el
                movimiento. Si la entrada no tiene OC, puedes pedir además que la IA intente leer los conceptos.
              </p>
              <form onSubmit={onSubirFoto} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="empresaId" value={empresaId} />
                <input type="file" name="file" accept="image/*" required disabled={subiendoFoto} className="flex-1 text-sm" />
                <button
                  disabled={subiendoFoto}
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {subiendoFoto ? (soloEvidencia ? "Subiendo…" : "Leyendo…") : soloEvidencia ? "Subir como evidencia" : "Subir y leer"}
                </button>
                <label className="flex w-full items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" checked={!soloEvidencia} onChange={(e) => setSoloEvidencia(!e.target.checked)} />
                  Intentar leer los conceptos con IA (solo para notas sin OC/OV)
                </label>
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
                    Conceptos detectados -- búscalos en el catálogo o créalos en automático para agregarlos al carrito:
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
                    <tr key={claveFila(f)} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        {productosNuevos.has(f.producto.id) ? (
                          <div>
                            <input
                              defaultValue={f.producto.nombre}
                              onBlur={(e) => renombrarProducto(f.producto.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              className="w-full min-w-[12rem] rounded border border-blue-300 px-2 py-1 text-sm"
                            />
                            <p className="mt-0.5 text-xs text-blue-700">Producto nuevo creado en automático ({f.producto.sku}) -- puedes corregirle el nombre.</p>
                          </div>
                        ) : (
                          <>
                            {f.producto.nombre} <span className="text-xs text-slate-400">({f.producto.sku})</span>
                          </>
                        )}
                        {f.lineaId && <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-700">partida de la orden</span>}
                        {f.linea && f.linea.cantidad != null && (() => {
                          const restante = Number(f.linea.cantidad) - Number(f.linea.avanzado) - Number(f.cantidad || 0);
                          const u = f.linea.unidad ?? "";
                          const base = `Pedido ${cantidadTexto(Number(f.linea.cantidad))} ${u}` + (f.linea.avanzado > 0 ? ` · ya ${tipo === "entrada" ? "recibido" : "embarcado"} ${cantidadTexto(f.linea.avanzado)}` : "");
                          if (restante > 0.0005) {
                            return (
                              <p className="mt-0.5 text-xs text-amber-700">
                                {base} · quedarán {cantidadTexto(restante)} {u} pendientes: {tipo === "entrada" ? "el proveedor aún debe producto" : "falta por embarcar"}
                              </p>
                            );
                          }
                          if (restante < -0.0005) {
                            return (
                              <p className="mt-0.5 text-xs text-red-700">
                                {base} · excede por {cantidadTexto(-restante)} {u}: {tipo === "entrada" ? "ajuste o reclamación posterior" : "revisa la cantidad"}
                              </p>
                            );
                          }
                          return <p className="mt-0.5 text-xs text-emerald-700">{base} · completa la partida</p>;
                        })()}
                      </td>
                      <td className="px-3 py-2">
                        <InputNumero
                          valor={f.cantidad}
                          min="0.001"
                          step="0.001"
                          onCambio={(n) => actualizarFila(claveFila(f), "cantidad", n ?? 0)}
                          className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <InputNumero
                          valor={f.costoUnitario}
                          min="0"
                          step="0.01"
                          onCambio={(n) => actualizarFila(claveFila(f), "costoUnitario", n as unknown as number)}
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => quitarFila(claveFila(f))} className="text-xs text-red-600 hover:underline">
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              onClick={onGuardarMovimiento}
              disabled={enviando || carrito.length === 0 || !almacen}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {enviando ? "Guardando…" : `Guardar ${tipo === "entrada" ? "entrada" : "salida"} (${carrito.length} línea(s))`}
            </button>
            {carrito.length > 0 && (
              <button type="button" onClick={() => setCarrito([])} className="text-xs text-slate-500 underline">
                Vaciar carrito
              </button>
            )}
            {carrito.length === 0 && (
              <span className="text-xs text-slate-500">
                {ordenId && ordenId !== "__nueva__" ? "Marca partidas de la orden o agrega productos para poder guardar." : "Agrega productos al carrito para poder guardar."}
              </span>
            )}
            <span className="text-xs text-slate-500">Al guardar se genera el PDF con código QR{tipo === "salida" ? " (remisión)" : " (comprobante de entrada)"}.</span>
          </div>
        </>
      )}

      {error && <p className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {mensaje && (
        <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {mensaje}
          {ultimaRemision && (
            <span className="ml-2">
              <button onClick={() => imprimirRemision(ultimaRemision.id).catch((err) => setError((err as Error).message))} className="underline">
                PDF con QR
              </button>
              {" · "}
              <Link to={`/inventario/remisiones/${ultimaRemision.id}`} className="underline">
                Ver remisión
              </Link>
            </span>
          )}
          {ultimaEntrada && (
            <span className="ml-2">
              <button onClick={() => imprimirComprobanteEntrada(ultimaEntrada.ids).catch((err) => setError((err as Error).message))} className="underline">
                PDF con QR (comprobante de entrada)
              </button>
              {ultimaEntrada.ordenCompraId && (
                <>
                  {" · "}
                  <Link to={`/inventario/match?oc=${ultimaEntrada.ordenCompraId}`} className="underline">
                    Ver avance de la OC
                  </Link>
                </>
              )}
            </span>
          )}
        </div>
      )}

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
      queryClient.invalidateQueries({ queryKey: ["lineas-orden"] });
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
                    <th className="px-3 py-2">Remisión</th>
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
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                        {m.remision_id ? (
                          <Link to={`/inventario/remisiones/${m.remision_id}`} className="underline">
                            {m.remisiones_salida?.folio ?? "Ver"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                  {recientes.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
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
