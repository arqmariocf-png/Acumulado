import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type {
  CosteoMensualClavicon,
  CosteoOrdenProduccion,
  ManoDeObraProduccion,
  MateriaPrima,
  MovimientoMateriaPrima,
  OrdenProduccion,
  Producto,
  RecetaItem,
  StockMateriaPrima,
  StockProductoTerminado,
} from "../types/database";

type Pestana = "catalogo" | "inventario" | "ordenes" | "costeo";

const PESTANAS: { valor: Pestana; etiqueta: string }[] = [
  { valor: "catalogo", etiqueta: "Catálogo" },
  { valor: "inventario", etiqueta: "Inventario" },
  { valor: "ordenes", etiqueta: "Órdenes de producción" },
  { valor: "costeo", etiqueta: "Costeo" },
];

const campoTexto = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiquetaCampo = "mb-1 block text-xs font-medium text-slate-700";
const botonPrimario = "rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";

function oVacio(fd: FormData, campo: string): string | null {
  const v = (fd.get(campo) as string | null)?.trim();
  return v ? v : null;
}

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatoMoneda(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
}

function formatoNumero(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

/** Todo lo de este módulo se ancla a la empresa Clavicón (MCC) -- la
 * integración con OC/OV (20260824090005_produccion_integra_oc_ov.sql) solo
 * aplica ahí. */
function useEmpresaClavicon() {
  return useQuery({
    queryKey: ["empresa-mcc"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").eq("codigo", "MCC").single();
      if (error) throw error;
      return data as { id: string; nombre: string };
    },
  });
}

export function Produccion() {
  const [pestana, setPestana] = useState<Pestana>("ordenes");

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Producción y Costeo — Clavicón</h1>

      <div className="mb-4 flex flex-wrap gap-2">
        {PESTANAS.map((p) => (
          <button
            key={p.valor}
            onClick={() => setPestana(p.valor)}
            className={`rounded px-3 py-1.5 text-sm ${pestana === p.valor ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"} border border-slate-200`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {pestana === "catalogo" && <PestanaCatalogo />}
      {pestana === "inventario" && <PestanaInventario />}
      {pestana === "ordenes" && <PestanaOrdenes />}
      {pestana === "costeo" && <PestanaCosteo />}
    </div>
  );
}

// ── Catálogo (materias primas, productos, receta) ───────────────────────

function useMateriasPrimas() {
  return useQuery({
    queryKey: ["materias-primas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materias_primas").select("*").order("nombre");
      if (error) throw error;
      return data as MateriaPrima[];
    },
  });
}

function useProductos() {
  return useQuery({
    queryKey: ["productos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("productos_produccion").select("*").order("nombre");
      if (error) throw error;
      return data as Producto[];
    },
  });
}

function PestanaCatalogo() {
  const { data: materias } = useMateriasPrimas();
  const { data: productos } = useProductos();
  const queryClient = useQueryClient();
  const [errorMp, setErrorMp] = useState<string | null>(null);
  const [errorProd, setErrorProd] = useState<string | null>(null);
  const [productoRecetaId, setProductoRecetaId] = useState<string>("");

  const crearMateriaPrima = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await supabase.from("materias_primas").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["materias-primas"] }),
    onError: (err) => setErrorMp((err as Error).message),
  });

  const crearProducto = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await supabase.from("productos_produccion").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["productos"] }),
    onError: (err) => setErrorProd((err as Error).message),
  });

  function onSubmitMateriaPrima(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMp(null);
    const fd = new FormData(e.currentTarget);
    crearMateriaPrima.mutate({ nombre: fd.get("nombre"), unidad_medida: fd.get("unidad_medida") });
    e.currentTarget.reset();
  }

  function onSubmitProducto(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorProd(null);
    const fd = new FormData(e.currentTarget);
    crearProducto.mutate({
      tipo: fd.get("tipo"),
      nombre: fd.get("nombre"),
      calibre: oVacio(fd, "calibre"),
      presentacion: oVacio(fd, "presentacion"),
      unidad_medida: fd.get("unidad_medida"),
    });
    e.currentTarget.reset();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Materias primas</h2>
          <form onSubmit={onSubmitMateriaPrima} className="mb-3 flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-3">
            <div className="flex-1">
              <label className={etiquetaCampo}>Nombre *</label>
              <input name="nombre" required className={campoTexto} placeholder="Alambrón calibre 12" />
            </div>
            <div className="w-32">
              <label className={etiquetaCampo}>Unidad *</label>
              <input name="unidad_medida" required className={campoTexto} placeholder="kg" />
            </div>
            <button disabled={crearMateriaPrima.isPending} className={botonPrimario}>
              + Agregar
            </button>
          </form>
          {errorMp && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMp}</p>}
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Unidad</th>
                </tr>
              </thead>
              <tbody>
                {materias?.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{m.nombre}</td>
                    <td className="px-3 py-2">{m.unidad_medida}</td>
                  </tr>
                ))}
                {materias?.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-3 py-6 text-center text-slate-400">
                      Sin materias primas todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Productos (malla armex / clavos)</h2>
          <form onSubmit={onSubmitProducto} className="mb-3 space-y-2 rounded border border-slate-200 bg-white p-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={etiquetaCampo}>Tipo *</label>
                <select name="tipo" required className={campoTexto} defaultValue="clavo">
                  <option value="clavo">Clavo</option>
                  <option value="malla_armex">Malla armex</option>
                </select>
              </div>
              <div>
                <label className={etiquetaCampo}>Calibre</label>
                <input name="calibre" className={campoTexto} placeholder="12" />
              </div>
              <div>
                <label className={etiquetaCampo}>Nombre *</label>
                <input name="nombre" required className={campoTexto} placeholder="Clavo cal. 12" />
              </div>
              <div>
                <label className={etiquetaCampo}>Presentación</label>
                <input name="presentacion" className={campoTexto} placeholder="Caja 25kg" />
              </div>
              <div>
                <label className={etiquetaCampo}>Unidad *</label>
                <input name="unidad_medida" required className={campoTexto} placeholder="caja" />
              </div>
            </div>
            <button disabled={crearProducto.isPending} className={botonPrimario}>
              + Agregar
            </button>
          </form>
          {errorProd && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorProd}</p>}
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Calibre</th>
                  <th className="px-3 py-2">Unidad</th>
                </tr>
              </thead>
              <tbody>
                {productos?.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{p.nombre}</td>
                    <td className="px-3 py-2">{p.tipo === "malla_armex" ? "Malla armex" : "Clavo"}</td>
                    <td className="px-3 py-2">{p.calibre ?? "—"}</td>
                    <td className="px-3 py-2">{p.unidad_medida}</td>
                  </tr>
                ))}
                {productos?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                      Sin productos todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Receta / BOM estándar</h2>
        <p className="mb-2 text-xs text-slate-500">
          Cuánta materia prima lleva 1 unidad de producto. Es el costo planeado para comparar contra el costo real de
          cada lote (pestaña Costeo) — el costo real siempre se calcula del consumo efectivo, no de aquí.
        </p>
        <div className="mb-3 max-w-xs">
          <label className={etiquetaCampo}>Producto</label>
          <select value={productoRecetaId} onChange={(e) => setProductoRecetaId(e.target.value)} className={campoTexto}>
            <option value="">Selecciona un producto…</option>
            {productos?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
        {productoRecetaId && <RecetaDelProducto productoId={productoRecetaId} materias={materias ?? []} />}
      </div>
    </div>
  );
}

function RecetaDelProducto({ productoId, materias }: { productoId: string; materias: MateriaPrima[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: items } = useQuery({
    queryKey: ["receta-items", productoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("receta_items")
        .select("*, materias_primas(nombre, unidad_medida)")
        .eq("producto_id", productoId);
      if (error) throw error;
      return data as (RecetaItem & { materias_primas: { nombre: string; unidad_medida: string } })[];
    },
  });

  const agregar = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await supabase.from("receta_items").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["receta-items", productoId] }),
    onError: (err) => setError((err as Error).message),
  });

  const eliminar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("receta_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["receta-items", productoId] }),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    agregar.mutate({
      producto_id: productoId,
      materia_prima_id: fd.get("materia_prima_id"),
      cantidad_por_unidad: fd.get("cantidad_por_unidad"),
    });
    e.currentTarget.reset();
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="mb-3 flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-3">
        <div className="flex-1">
          <label className={etiquetaCampo}>Materia prima</label>
          <select name="materia_prima_id" required className={campoTexto} defaultValue="">
            <option value="" disabled>
              Selecciona…
            </option>
            {materias.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <label className={etiquetaCampo}>Cantidad por unidad *</label>
          <input type="number" step="0.0001" min="0.0001" name="cantidad_por_unidad" required className={campoTexto} />
        </div>
        <button disabled={agregar.isPending} className={botonPrimario}>
          + Agregar
        </button>
      </form>
      {error && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Materia prima</th>
              <th className="px-3 py-2 text-right">Cantidad / unidad</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items?.map((it) => (
              <tr key={it.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{it.materias_primas?.nombre}</td>
                <td className="px-3 py-2 text-right">
                  {formatoNumero(it.cantidad_por_unidad)} {it.materias_primas?.unidad_medida}
                </td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => eliminar.mutate(it.id)} className="text-xs text-red-600 hover:underline">
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
            {items?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                  Sin receta capturada todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Inventario ───────────────────────────────────────────────────────────

function PestanaInventario() {
  const { data: empresa } = useEmpresaClavicon();
  const { data: materias } = useMateriasPrimas();
  const { data: productos } = useProductos();

  const { data: stockMp } = useQuery({
    queryKey: ["stock-materia-prima"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_stock_materia_prima").select("*").order("nombre");
      if (error) throw error;
      return data as StockMateriaPrima[];
    },
  });

  const { data: stockProd } = useQuery({
    queryKey: ["stock-producto-terminado"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_stock_producto_terminado").select("*").order("nombre");
      if (error) throw error;
      return data as StockProductoTerminado[];
    },
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Stock de materia prima</h2>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Materia prima</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                  <th className="px-3 py-2 text-right">Costo prom.</th>
                </tr>
              </thead>
              <tbody>
                {stockMp?.map((s) => (
                  <tr key={s.materia_prima_id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{s.nombre}</td>
                    <td className="px-3 py-2 text-right">
                      {formatoNumero(s.stock_actual)} {s.unidad_medida}
                    </td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(s.costo_promedio_ponderado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Stock de producto terminado</h2>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                  <th className="px-3 py-2 text-right">Costo prom.</th>
                </tr>
              </thead>
              <tbody>
                {stockProd?.map((s) => (
                  <tr key={s.producto_id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{s.nombre}</td>
                    <td className="px-3 py-2 text-right">
                      {formatoNumero(s.stock_actual)} {s.unidad_medida}
                    </td>
                    <td className="px-3 py-2 text-right">{formatoMoneda(s.costo_promedio_ponderado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {empresa && <EntradaMateriaPrima empresaId={empresa.id} materias={materias ?? []} />}
      {empresa && <SalidaProductoTerminado empresaId={empresa.id} productos={productos ?? []} />}
    </div>
  );
}

/** Entrada de materia prima -- SIEMPRE ligada a una OC real (existente o
 * de alta manual) para no capturar la compra dos veces (integración
 * "OC/OV compartidas" del plan). */
function EntradaMateriaPrima({ empresaId, materias }: { empresaId: string; materias: MateriaPrima[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [ocId, setOcId] = useState<string>("__nueva__");

  const { data: ordenesCompra } = useQuery({
    queryKey: ["ordenes-compra-mcc", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordenes_compra")
        .select("id, id_orden, proveedor, total")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as { id: string; id_orden: string; proveedor: string | null; total: number | null }[];
    },
  });

  const registrar = useMutation({
    mutationFn: async (fd: FormData) => {
      let orden_compra_id = ocId;
      if (ocId === "__nueva__") {
        const { data, error } = await supabase
          .from("ordenes_compra")
          .insert({
            id_orden: fd.get("nueva_oc_folio"),
            tipo: "OC",
            empresa_id: empresaId,
            proveedor: oVacio(fd, "nueva_oc_proveedor"),
            total: fd.get("cantidad") && fd.get("costo_unitario") ? Number(fd.get("cantidad")) * Number(fd.get("costo_unitario")) : null,
            fecha_creacion: fd.get("fecha"),
            fuente: "excel",
          })
          .select("id")
          .single();
        if (error) throw error;
        orden_compra_id = data.id;
      }
      const { error } = await supabase.from("movimientos_materia_prima").insert({
        materia_prima_id: fd.get("materia_prima_id"),
        tipo: "entrada",
        cantidad: fd.get("cantidad"),
        costo_unitario: fd.get("costo_unitario"),
        fecha: fd.get("fecha"),
        orden_compra_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-materia-prima"] });
      queryClient.invalidateQueries({ queryKey: ["ordenes-compra-mcc", empresaId] });
      setOcId("__nueva__");
    },
    onError: (err) => setError((err as Error).message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    registrar.mutate(new FormData(e.currentTarget));
    e.currentTarget.reset();
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Registrar entrada de materia prima (compra)</h2>
      <form onSubmit={onSubmit} className="space-y-3 rounded border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className={etiquetaCampo}>Materia prima *</label>
            <select name="materia_prima_id" required className={campoTexto} defaultValue="">
              <option value="" disabled>
                Selecciona…
              </option>
              {materias.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiquetaCampo}>Cantidad *</label>
            <input type="number" step="0.0001" min="0.0001" name="cantidad" required className={campoTexto} />
          </div>
          <div>
            <label className={etiquetaCampo}>Costo unitario *</label>
            <input type="number" step="0.0001" min="0" name="costo_unitario" required className={campoTexto} />
          </div>
          <div>
            <label className={etiquetaCampo}>Fecha *</label>
            <input type="date" name="fecha" required defaultValue={hoyIso()} className={campoTexto} />
          </div>
        </div>
        <div>
          <label className={etiquetaCampo}>Orden de compra (OC) *</label>
          <select value={ocId} onChange={(e) => setOcId(e.target.value)} className={campoTexto}>
            <option value="__nueva__">+ Dar de alta una OC nueva (manual)</option>
            {ordenesCompra?.map((oc) => (
              <option key={oc.id} value={oc.id}>
                OC {oc.id_orden} — {oc.proveedor ?? "sin proveedor"} {oc.total ? `(${formatoMoneda(oc.total)})` : ""}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            Usa una OC ya cargada por tesorería cuando exista — así el mismo folio que concilia el motor de bancos
            queda ligado a esta entrada de inventario, sin capturarla dos veces.
          </p>
        </div>
        {ocId === "__nueva__" && (
          <div className="grid grid-cols-1 gap-3 rounded border border-dashed border-slate-300 p-3 sm:grid-cols-2">
            <div>
              <label className={etiquetaCampo}>Folio de la OC nueva *</label>
              <input name="nueva_oc_folio" required={ocId === "__nueva__"} className={campoTexto} placeholder="39501" />
            </div>
            <div>
              <label className={etiquetaCampo}>Proveedor</label>
              <input name="nueva_oc_proveedor" className={campoTexto} />
            </div>
          </div>
        )}
        {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={registrar.isPending} className={botonPrimario}>
          {registrar.isPending ? "Guardando…" : "Registrar entrada"}
        </button>
      </form>
    </div>
  );
}

/** Salida de producto terminado por venta -- ligada a una OV real (misma
 * lógica que la entrada de materia prima, del otro lado del ciclo). */
function SalidaProductoTerminado({ empresaId, productos }: { empresaId: string; productos: Producto[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [ovId, setOvId] = useState<string>("__nueva__");

  const { data: ordenesVenta } = useQuery({
    queryKey: ["ordenes-venta-mcc", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordenes_venta")
        .select("id, id_ov, cliente, total")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as { id: string; id_ov: string; cliente: string | null; total: number | null }[];
    },
  });

  const { data: stockProd } = useQuery({
    queryKey: ["stock-producto-terminado"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_stock_producto_terminado").select("*");
      if (error) throw error;
      return data as StockProductoTerminado[];
    },
  });

  const registrar = useMutation({
    mutationFn: async (fd: FormData) => {
      let orden_venta_id = ovId;
      if (ovId === "__nueva__") {
        const { data, error } = await supabase
          .from("ordenes_venta")
          .insert({
            id_ov: fd.get("nueva_ov_folio"),
            empresa_id: empresaId,
            cliente: oVacio(fd, "nueva_ov_cliente"),
            total: fd.get("cantidad") && fd.get("costo_unitario") ? Number(fd.get("cantidad")) * Number(fd.get("costo_unitario")) : null,
            fecha_ov: fd.get("fecha"),
            fuente: "excel",
          })
          .select("id")
          .single();
        if (error) throw error;
        orden_venta_id = data.id;
      }
      const productoId = fd.get("producto_id") as string;
      const costoPromedio = stockProd?.find((s) => s.producto_id === productoId)?.costo_promedio_ponderado ?? 0;
      const { error } = await supabase.from("movimientos_producto_terminado").insert({
        producto_id: productoId,
        tipo: "salida",
        cantidad: fd.get("cantidad"),
        costo_unitario: costoPromedio,
        fecha: fd.get("fecha"),
        orden_venta_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-producto-terminado"] });
      queryClient.invalidateQueries({ queryKey: ["ordenes-venta-mcc", empresaId] });
      setOvId("__nueva__");
    },
    onError: (err) => setError((err as Error).message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    registrar.mutate(new FormData(e.currentTarget));
    e.currentTarget.reset();
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Registrar salida de producto terminado (venta)</h2>
      <form onSubmit={onSubmit} className="space-y-3 rounded border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className={etiquetaCampo}>Producto *</label>
            <select name="producto_id" required className={campoTexto} defaultValue="">
              <option value="" disabled>
                Selecciona…
              </option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiquetaCampo}>Cantidad *</label>
            <input type="number" step="0.0001" min="0.0001" name="cantidad" required className={campoTexto} />
          </div>
          <div>
            <label className={etiquetaCampo}>Fecha *</label>
            <input type="date" name="fecha" required defaultValue={hoyIso()} className={campoTexto} />
          </div>
        </div>
        <p className="text-xs text-slate-500">El costo de salida se valúa automático al costo promedio ponderado actual del producto.</p>
        <div>
          <label className={etiquetaCampo}>Orden de venta (OV) *</label>
          <select value={ovId} onChange={(e) => setOvId(e.target.value)} className={campoTexto}>
            <option value="__nueva__">+ Dar de alta una OV nueva (manual)</option>
            {ordenesVenta?.map((ov) => (
              <option key={ov.id} value={ov.id}>
                OV {ov.id_ov} — {ov.cliente ?? "sin cliente"} {ov.total ? `(${formatoMoneda(ov.total)})` : ""}
              </option>
            ))}
          </select>
        </div>
        {ovId === "__nueva__" && (
          <div className="grid grid-cols-1 gap-3 rounded border border-dashed border-slate-300 p-3 sm:grid-cols-2">
            <div>
              <label className={etiquetaCampo}>Folio de la OV nueva *</label>
              <input name="nueva_ov_folio" required={ovId === "__nueva__"} className={campoTexto} placeholder="14701" />
            </div>
            <div>
              <label className={etiquetaCampo}>Cliente</label>
              <input name="nueva_ov_cliente" className={campoTexto} />
            </div>
          </div>
        )}
        {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={registrar.isPending} className={botonPrimario}>
          {registrar.isPending ? "Guardando…" : "Registrar salida"}
        </button>
      </form>
    </div>
  );
}

// ── Órdenes de producción (costeo por lote) ─────────────────────────────

function useOrdenesProduccion() {
  return useQuery({
    queryKey: ["ordenes-produccion"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordenes_produccion")
        .select("*, productos_produccion(nombre)")
        .order("fecha_inicio", { ascending: false });
      if (error) throw error;
      return data as (OrdenProduccion & { productos_produccion: { nombre: string } })[];
    },
  });
}

function PestanaOrdenes() {
  const { data: ordenes } = useOrdenesProduccion();
  const { data: productos } = useProductos();
  const queryClient = useQueryClient();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seleccionada, setSeleccionada] = useState<string | null>(null);

  const crear = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { error } = await supabase.from("ordenes_produccion").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ordenes-produccion"] });
      setMostrarForm(false);
    },
    onError: (err) => setError((err as Error).message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    crear.mutate({
      folio: fd.get("folio"),
      producto_id: fd.get("producto_id"),
      fecha_inicio: fd.get("fecha_inicio"),
      cantidad_planeada: fd.get("cantidad_planeada"),
      notas: oVacio(fd, "notas"),
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">{ordenes?.length ?? 0} lote(s) de producción.</p>
        <button onClick={() => setMostrarForm((v) => !v)} className={botonPrimario}>
          {mostrarForm ? "Cancelar" : "+ Nuevo lote"}
        </button>
      </div>

      {mostrarForm && (
        <form onSubmit={onSubmit} className="mb-6 max-w-2xl space-y-3 rounded border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={etiquetaCampo}>Folio *</label>
              <input name="folio" required className={campoTexto} placeholder="Lote 0142" />
            </div>
            <div>
              <label className={etiquetaCampo}>Producto *</label>
              <select name="producto_id" required className={campoTexto} defaultValue="">
                <option value="" disabled>
                  Selecciona…
                </option>
                {productos?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiquetaCampo}>Fecha de inicio *</label>
              <input type="date" name="fecha_inicio" required defaultValue={hoyIso()} className={campoTexto} />
            </div>
            <div>
              <label className={etiquetaCampo}>Cantidad planeada *</label>
              <input type="number" step="0.0001" min="0.0001" name="cantidad_planeada" required className={campoTexto} />
            </div>
          </div>
          <div>
            <label className={etiquetaCampo}>Notas</label>
            <input name="notas" className={campoTexto} />
          </div>
          {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={crear.isPending} className={botonPrimario}>
            {crear.isPending ? "Guardando…" : "Crear lote"}
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Folio</th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Inicio</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Planeada</th>
              <th className="px-3 py-2 text-right">Producida</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {ordenes?.map((o) => (
              <tr key={o.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{o.folio}</td>
                <td className="px-3 py-2">{o.productos_produccion?.nombre}</td>
                <td className="px-3 py-2">{o.fecha_inicio}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      o.estado === "terminada"
                        ? "bg-green-100 text-green-700"
                        : o.estado === "cancelada"
                          ? "bg-slate-100 text-slate-500"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {o.estado}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{formatoNumero(o.cantidad_planeada)}</td>
                <td className="px-3 py-2 text-right">{formatoNumero(o.cantidad_producida)}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setSeleccionada(o.id)} className="text-xs text-slate-700 underline hover:text-slate-900">
                    Ver / capturar
                  </button>
                </td>
              </tr>
            ))}
            {ordenes?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  Sin lotes de producción todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {seleccionada && (
        <OrdenDetalle
          orden={ordenes!.find((o) => o.id === seleccionada)!}
          onClose={() => setSeleccionada(null)}
        />
      )}
    </div>
  );
}

function useCosteoOrden(ordenId: string) {
  return useQuery({
    queryKey: ["costeo-orden", ordenId],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_costeo_orden_produccion").select("*").eq("orden_produccion_id", ordenId).single();
      if (error) throw error;
      return data as CosteoOrdenProduccion;
    },
  });
}

function OrdenDetalle({ orden, onClose }: { orden: OrdenProduccion & { productos_produccion: { nombre: string } }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: materias } = useMateriasPrimas();
  const { data: costeo } = useCosteoOrden(orden.id);
  const [error, setError] = useState<string | null>(null);

  const { data: consumo } = useQuery({
    queryKey: ["consumo-materia-prima", orden.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movimientos_materia_prima")
        .select("*, materias_primas(nombre, unidad_medida)")
        .eq("orden_produccion_id", orden.id)
        .eq("tipo", "salida");
      if (error) throw error;
      return data as (MovimientoMateriaPrima & { materias_primas: { nombre: string; unidad_medida: string } })[];
    },
  });

  const { data: manoObra } = useQuery({
    queryKey: ["mano-de-obra", orden.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("mano_de_obra_produccion").select("*").eq("orden_produccion_id", orden.id);
      if (error) throw error;
      return data as ManoDeObraProduccion[];
    },
  });

  const { data: indirectos } = useQuery({
    queryKey: ["costos-indirectos", orden.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("costos_indirectos_produccion").select("*").eq("orden_produccion_id", orden.id);
      if (error) throw error;
      return data as { id: string; concepto: string; monto: number }[];
    },
  });

  const invalidarCosteo = () => {
    queryClient.invalidateQueries({ queryKey: ["costeo-orden", orden.id] });
    queryClient.invalidateQueries({ queryKey: ["stock-materia-prima"] });
  };

  const agregarConsumo = useMutation({
    mutationFn: async (fd: FormData) => {
      const { error } = await supabase.from("movimientos_materia_prima").insert({
        materia_prima_id: fd.get("materia_prima_id"),
        tipo: "salida",
        cantidad: fd.get("cantidad"),
        costo_unitario: fd.get("costo_unitario"),
        orden_produccion_id: orden.id,
        fecha: hoyIso(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumo-materia-prima", orden.id] });
      invalidarCosteo();
    },
    onError: (err) => setError((err as Error).message),
  });

  const agregarManoObra = useMutation({
    mutationFn: async (fd: FormData) => {
      const { error } = await supabase.from("mano_de_obra_produccion").insert({
        orden_produccion_id: orden.id,
        descripcion: oVacio(fd, "descripcion"),
        horas: fd.get("horas"),
        costo_hora: fd.get("costo_hora"),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mano-de-obra", orden.id] });
      invalidarCosteo();
    },
    onError: (err) => setError((err as Error).message),
  });

  const agregarIndirecto = useMutation({
    mutationFn: async (fd: FormData) => {
      const { error } = await supabase.from("costos_indirectos_produccion").insert({
        orden_produccion_id: orden.id,
        concepto: fd.get("concepto"),
        monto: fd.get("monto"),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["costos-indirectos", orden.id] });
      invalidarCosteo();
    },
    onError: (err) => setError((err as Error).message),
  });

  /** Cierra el lote: fija cantidad_producida/merma, marca 'terminada', y
   * registra la ENTRADA a producto terminado valuada al costo_unitario del
   * lote (v_costeo_orden_produccion) -- el paso que valúa el inventario de
   * producto terminado al costo REAL, no a un estándar fijo. */
  const cerrarLote = useMutation({
    mutationFn: async (fd: FormData) => {
      const cantidad_producida = Number(fd.get("cantidad_producida"));
      const cantidad_merma = Number(fd.get("cantidad_merma") || 0);

      const { error: errUpdate } = await supabase
        .from("ordenes_produccion")
        .update({ cantidad_producida, cantidad_merma, estado: "terminada", fecha_fin: hoyIso() })
        .eq("id", orden.id);
      if (errUpdate) throw errUpdate;

      const { data: costeoFinal, error: errCosteo } = await supabase
        .from("v_costeo_orden_produccion")
        .select("costo_unitario")
        .eq("orden_produccion_id", orden.id)
        .single();
      if (errCosteo) throw errCosteo;

      const { error: errEntrada } = await supabase.from("movimientos_producto_terminado").insert({
        producto_id: orden.producto_id,
        tipo: "entrada",
        cantidad: cantidad_producida,
        costo_unitario: costeoFinal.costo_unitario ?? 0,
        orden_produccion_id: orden.id,
        fecha: hoyIso(),
      });
      if (errEntrada) throw errEntrada;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ordenes-produccion"] });
      queryClient.invalidateQueries({ queryKey: ["stock-producto-terminado"] });
      invalidarCosteo();
      onClose();
    },
    onError: (err) => setError((err as Error).message),
  });

  const cerrada = orden.estado === "terminada" || orden.estado === "cancelada";

  return (
    <div className="mt-6 rounded border border-slate-300 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800">
          {orden.folio} — {orden.productos_produccion?.nombre}
        </h2>
        <button onClick={onClose} className="text-xs text-slate-500 hover:underline">
          Cerrar panel
        </button>
      </div>

      {costeo && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <MiniTarjeta titulo="Materia prima" valor={formatoMoneda(costeo.costo_materia_prima)} />
          <MiniTarjeta titulo="Mano de obra" valor={formatoMoneda(costeo.costo_mano_obra)} />
          <MiniTarjeta titulo="Indirectos" valor={formatoMoneda(costeo.costo_indirectos)} />
          <MiniTarjeta titulo="Costo total del lote" valor={formatoMoneda(costeo.costo_total)} destacado />
          <MiniTarjeta titulo="Costo unitario" valor={formatoMoneda(costeo.costo_unitario)} destacado />
        </div>
      )}

      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SeccionConsumo consumo={consumo ?? []} materias={materias ?? []} disabled={cerrada} onSubmit={(fd) => agregarConsumo.mutate(fd)} />
        <SeccionManoObra manoObra={manoObra ?? []} disabled={cerrada} onSubmit={(fd) => agregarManoObra.mutate(fd)} />
        <SeccionIndirectos indirectos={indirectos ?? []} disabled={cerrada} onSubmit={(fd) => agregarIndirecto.mutate(fd)} />
      </div>

      {!cerrada && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            cerrarLote.mutate(new FormData(e.currentTarget));
          }}
          className="mt-4 flex flex-wrap items-end gap-3 rounded border border-dashed border-slate-300 p-3"
        >
          <div>
            <label className={etiquetaCampo}>Cantidad producida *</label>
            <input type="number" step="0.0001" min="0.0001" name="cantidad_producida" required defaultValue={orden.cantidad_planeada} className={campoTexto} />
          </div>
          <div>
            <label className={etiquetaCampo}>Merma</label>
            <input type="number" step="0.0001" min="0" name="cantidad_merma" defaultValue={0} className={campoTexto} />
          </div>
          <button disabled={cerrarLote.isPending} className="rounded bg-green-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {cerrarLote.isPending ? "Cerrando…" : "Marcar terminada y valuar inventario"}
          </button>
        </form>
      )}
    </div>
  );
}

function MiniTarjeta({ titulo, valor, destacado }: { titulo: string; valor: string; destacado?: boolean }) {
  return (
    <div className={`rounded border p-3 ${destacado ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] uppercase text-slate-500">{titulo}</p>
      <p className={`mt-1 font-semibold ${destacado ? "text-slate-900" : "text-slate-700"}`}>{valor}</p>
    </div>
  );
}

function SeccionConsumo({
  consumo,
  materias,
  disabled,
  onSubmit,
}: {
  consumo: (MovimientoMateriaPrima & { materias_primas: { nombre: string; unidad_medida: string } })[];
  materias: MateriaPrima[];
  disabled: boolean;
  onSubmit: (fd: FormData) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-600">Consumo de materia prima</h3>
      <ul className="mb-2 space-y-1 text-sm">
        {consumo.map((c) => (
          <li key={c.id} className="flex justify-between border-b border-slate-100 pb-1">
            <span>
              {c.materias_primas?.nombre} — {formatoNumero(c.cantidad)} {c.materias_primas?.unidad_medida}
            </span>
            <span className="text-slate-500">{formatoMoneda(c.cantidad * c.costo_unitario)}</span>
          </li>
        ))}
        {consumo.length === 0 && <li className="text-slate-400">Sin consumo capturado.</li>}
      </ul>
      {!disabled && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
            e.currentTarget.reset();
          }}
          className="space-y-2 rounded border border-slate-200 p-2"
        >
          <select name="materia_prima_id" required className={campoTexto} defaultValue="">
            <option value="" disabled>
              Materia prima…
            </option>
            {materias.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input type="number" step="0.0001" min="0.0001" name="cantidad" placeholder="Cantidad" required className={campoTexto} />
            <input type="number" step="0.0001" min="0" name="costo_unitario" placeholder="Costo unit." required className={campoTexto} />
          </div>
          <button className="w-full rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white">+ Agregar consumo</button>
        </form>
      )}
    </div>
  );
}

function SeccionManoObra({
  manoObra,
  disabled,
  onSubmit,
}: {
  manoObra: ManoDeObraProduccion[];
  disabled: boolean;
  onSubmit: (fd: FormData) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-600">Mano de obra</h3>
      <ul className="mb-2 space-y-1 text-sm">
        {manoObra.map((m) => (
          <li key={m.id} className="flex justify-between border-b border-slate-100 pb-1">
            <span>
              {m.descripcion ?? "Operador"} — {formatoNumero(m.horas)} h
            </span>
            <span className="text-slate-500">{formatoMoneda(m.costo_total)}</span>
          </li>
        ))}
        {manoObra.length === 0 && <li className="text-slate-400">Sin mano de obra capturada.</li>}
      </ul>
      {!disabled && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
            e.currentTarget.reset();
          }}
          className="space-y-2 rounded border border-slate-200 p-2"
        >
          <input name="descripcion" placeholder="Descripción / operador" className={campoTexto} />
          <div className="flex gap-2">
            <input type="number" step="0.01" min="0.01" name="horas" placeholder="Horas" required className={campoTexto} />
            <input type="number" step="0.01" min="0" name="costo_hora" placeholder="Costo/hora" required className={campoTexto} />
          </div>
          <button className="w-full rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white">+ Agregar mano de obra</button>
        </form>
      )}
    </div>
  );
}

function SeccionIndirectos({
  indirectos,
  disabled,
  onSubmit,
}: {
  indirectos: { id: string; concepto: string; monto: number }[];
  disabled: boolean;
  onSubmit: (fd: FormData) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-600">Costos indirectos</h3>
      <ul className="mb-2 space-y-1 text-sm">
        {indirectos.map((i) => (
          <li key={i.id} className="flex justify-between border-b border-slate-100 pb-1">
            <span>{i.concepto}</span>
            <span className="text-slate-500">{formatoMoneda(i.monto)}</span>
          </li>
        ))}
        {indirectos.length === 0 && <li className="text-slate-400">Sin indirectos capturados.</li>}
      </ul>
      {!disabled && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
            e.currentTarget.reset();
          }}
          className="space-y-2 rounded border border-slate-200 p-2"
        >
          <input name="concepto" placeholder="Concepto (energía, mantenimiento…)" required className={campoTexto} />
          <input type="number" step="0.01" min="0" name="monto" placeholder="Monto" required className={campoTexto} />
          <button className="w-full rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white">+ Agregar indirecto</button>
        </form>
      )}
    </div>
  );
}

// ── Costeo consolidado ───────────────────────────────────────────────────

function PestanaCosteo() {
  const { data: mensual } = useQuery({
    queryKey: ["costeo-mensual-clavicon"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_costeo_mensual_clavicon").select("*").order("anio").order("mes");
      if (error) throw error;
      return data as CosteoMensualClavicon[];
    },
  });

  const { data: porOrden } = useQuery({
    queryKey: ["costeo-por-orden"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_costeo_orden_produccion")
        .select("*, ordenes_produccion(productos_produccion(nombre))")
        .order("fecha_inicio", { ascending: false });
      if (error) throw error;
      return data as (CosteoOrdenProduccion & { ordenes_produccion: { productos_produccion: { nombre: string } } })[];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Costo mensual por producto (lotes terminados)</h2>
        <p className="mb-2 text-xs text-slate-500">
          Esta misma tabla se muestra en el Dashboard general junto a los KPIs financieros de las 8 empresas.
        </p>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Periodo</th>
                <th className="px-3 py-2 text-right">Lotes</th>
                <th className="px-3 py-2 text-right">Cant. producida</th>
                <th className="px-3 py-2 text-right">Costo total</th>
                <th className="px-3 py-2 text-right">Costo unitario prom.</th>
              </tr>
            </thead>
            <tbody>
              {mensual?.map((m) => (
                <tr key={`${m.producto_id}-${m.anio}-${m.mes}`} className="border-t border-slate-100">
                  <td className="px-3 py-2">{m.producto_nombre}</td>
                  <td className="px-3 py-2">
                    {m.mes}/{m.anio}
                  </td>
                  <td className="px-3 py-2 text-right">{m.lotes}</td>
                  <td className="px-3 py-2 text-right">{formatoNumero(m.cantidad_producida)}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(m.costo_total)}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(m.costo_unitario_promedio)}</td>
                </tr>
              ))}
              {mensual?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    Sin lotes terminados todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Costo por lote</h2>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Folio</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Materia prima</th>
                <th className="px-3 py-2 text-right">Mano de obra</th>
                <th className="px-3 py-2 text-right">Indirectos</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Unitario</th>
              </tr>
            </thead>
            <tbody>
              {porOrden?.map((o) => (
                <tr key={o.orden_produccion_id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{o.folio}</td>
                  <td className="px-3 py-2">{o.ordenes_produccion?.productos_produccion?.nombre}</td>
                  <td className="px-3 py-2">{o.estado}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(o.costo_materia_prima)}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(o.costo_mano_obra)}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(o.costo_indirectos)}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatoMoneda(o.costo_total)}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(o.costo_unitario)}</td>
                </tr>
              ))}
              {porOrden?.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    Sin lotes todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
