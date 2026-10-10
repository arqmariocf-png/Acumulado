import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import { ETIQUETA_METODO, agregarAlCarrito, buscarPorCodigo, filtrarProductos, importeLinea, revisarPagos, totalesCarrito, type LineaCarrito, type MetodoPago, type PagoCaptura } from "../../lib/puntoVenta";
import { botonPrimario, botonSecundario, campo, dinero, imprimirTicket, useClientesEmpresa, useProductosVenta, type ProductoVenta, type Turno } from "./datos";

// Mostrador estilo Odoo (Mario, 10-oct-2026): el lector de código de barras
// escribe en el buscador y manda Enter; si el código coincide se agrega
// solo. Tocar una tarjeta también agrega. Cobrar abre las formas de pago.

export function Vender({ empresaId, turno, supervisa }: { empresaId: string; turno: Turno; supervisa: boolean }) {
  const queryClient = useQueryClient();
  const { data: productos = [], isLoading } = useProductosVenta(empresaId);
  const { data: clientes = [] } = useClientesEmpresa(empresaId);
  const [busqueda, setBusqueda] = useState("");
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [requiereFactura, setRequiereFactura] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const buscador = useRef<HTMLInputElement>(null);

  const visibles = useMemo(() => filtrarProductos(productos, busqueda).slice(0, 60), [productos, busqueda]);
  const totales = totalesCarrito(carrito);

  function agregar(p: ProductoVenta, codigo?: string) {
    if (p.precio_venta == null) {
      setAviso(`${p.nombre} no tiene precio de venta. Ponlo en la pestaña Precios.`);
      return;
    }
    setAviso(null);
    setCarrito((c) => agregarAlCarrito(c, { productoId: p.id, nombre: p.nombre, sku: p.sku, unidad: p.unidad_medida, precio: Number(p.precio_venta), ivaTasa: p.iva_tasa, codigo: codigo ?? null }));
  }

  function alEnter() {
    const exacto = buscarPorCodigo(productos, busqueda);
    if (exacto) {
      agregar(exacto, busqueda.trim());
      setBusqueda("");
      return;
    }
    if (visibles.length === 1) {
      agregar(visibles[0]);
      setBusqueda("");
      return;
    }
    setAviso(visibles.length ? "Varios productos coinciden: toca el que quieres." : `No se encontró "${busqueda}".`);
  }

  function cambiarLinea(i: number, cambios: Partial<LineaCarrito>) {
    setCarrito((c) => c.map((l, j) => (j === i ? { ...l, ...cambios } : l)));
  }

  function limpiar() {
    setCarrito([]);
    setClienteId("");
    setClienteNombre("");
    setRequiereFactura(false);
    setCobrando(false);
    setTimeout(() => buscador.current?.focus(), 50);
  }

  const existencia = new Map(productos.map((p) => [p.id, p.existencia]));
  // Lo pedido de cada producto (puede venir en varias líneas) contra lo que hay.
  const pedido = new Map<string, number>();
  for (const l of carrito) pedido.set(l.productoId, (pedido.get(l.productoId) ?? 0) + l.cantidad);
  const sinExistencia = [...pedido].filter(([id, c]) => c > (existencia.get(id) ?? 0)).length;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <input
          ref={buscador}
          autoFocus
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              alEnter();
            }
          }}
          placeholder="Escanea el código de barras o busca por nombre / SKU"
          className="w-full rounded-lg border-2 border-slate-300 px-3 py-2.5 text-base focus:border-slate-900 focus:outline-none"
        />
        {aviso && <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-800">{aviso}</p>}
        {isLoading ? (
          <p className="mt-4 text-sm text-slate-500">Cargando productos…</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {visibles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => agregar(p)}
                className={`flex min-h-[92px] flex-col justify-between rounded-lg border bg-white p-2 text-left shadow-sm hover:border-slate-900 ${p.precio_venta == null ? "border-dashed border-amber-300" : "border-slate-200"}`}
              >
                <span className="line-clamp-2 text-sm font-medium text-slate-800">{p.nombre}</span>
                <span className="mt-1 flex items-end justify-between gap-1 text-xs">
                  <span className="text-slate-400">{p.sku ?? ""}</span>
                  <span className="text-right">
                    <span className="block text-sm font-semibold text-slate-900">{p.precio_venta == null ? "sin precio" : dinero(p.precio_venta)}</span>
                    <span className={p.existencia > 0 ? "text-emerald-700" : "text-red-600"}>
                      {Number(p.existencia).toLocaleString("es-MX")} {p.unidad_medida ?? ""}
                    </span>
                  </span>
                </span>
              </button>
            ))}
            {visibles.length === 0 && <p className="col-span-full text-sm text-slate-400">Sin productos con esa búsqueda.</p>}
          </div>
        )}
      </div>

      <div className="lg:col-span-2">
        <div className="sticky top-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Venta actual</h3>
            {carrito.length > 0 && (
              <button type="button" onClick={limpiar} className="text-xs text-red-600 hover:underline">
                Vaciar
              </button>
            )}
          </div>
          <ul className="max-h-[45vh] space-y-2 overflow-y-auto">
            {carrito.map((l, i) => {
              const stock = existencia.get(l.productoId) ?? 0;
              return (
                <li key={`${l.productoId}-${i}`} className="rounded border border-slate-100 p-2">
                  <div className="flex justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-800">{l.nombre}</span>
                    <button type="button" onClick={() => setCarrito((c) => c.filter((_, j) => j !== i))} className="text-xs text-red-600">
                      quitar
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <button type="button" className="h-7 w-7 rounded border" onClick={() => cambiarLinea(i, { cantidad: Math.max(1, l.cantidad - 1) })}>
                      −
                    </button>
                    <input type="number" min="0.001" step="any" value={l.cantidad} onChange={(e) => cambiarLinea(i, { cantidad: Math.max(0, Number(e.target.value)) })} className="w-16 rounded border px-1 py-1 text-right" />
                    <button type="button" className="h-7 w-7 rounded border" onClick={() => cambiarLinea(i, { cantidad: l.cantidad + 1 })}>
                      +
                    </button>
                    <span className="text-slate-500">×</span>
                    {supervisa ? (
                      <input type="number" min="0" step="0.01" value={l.precio} onChange={(e) => cambiarLinea(i, { precio: Math.max(0, Number(e.target.value)) })} className="w-20 rounded border px-1 py-1 text-right" title="Precio con IVA" />
                    ) : (
                      <span>{dinero(l.precio)}</span>
                    )}
                    <label className="flex items-center gap-1 text-slate-500">
                      desc.
                      <input type="number" min="0" max="100" step="1" value={l.descuentoPct} onChange={(e) => cambiarLinea(i, { descuentoPct: Math.min(100, Math.max(0, Number(e.target.value))) })} className="w-12 rounded border px-1 py-1 text-right" />%
                    </label>
                    <span className="ml-auto font-semibold text-slate-900">{dinero(importeLinea(l))}</span>
                  </div>
                  {(pedido.get(l.productoId) ?? 0) > stock && <p className="mt-1 text-[11px] text-red-700">Solo hay {stock.toLocaleString("es-MX")} en el almacén. Registra la entrada o el conteo físico antes de vender.</p>}
                </li>
              );
            })}
            {carrito.length === 0 && <li className="py-6 text-center text-sm text-slate-400">Escanea o toca un producto.</li>}
          </ul>

          <div className="mt-3 space-y-2 border-t border-slate-100 pt-2 text-sm">
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className={campo}>
              <option value="">Público en general</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razon_social}
                  {c.rfc ? ` · ${c.rfc}` : ""}
                </option>
              ))}
            </select>
            {!clienteId && <input value={clienteNombre} onChange={(e) => setClienteNombre(e.target.value)} placeholder="Nombre del cliente (opcional)" className={campo} />}
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={requiereFactura} onChange={(e) => setRequiereFactura(e.target.checked)} />
              El cliente pide factura
            </label>
            <div className="flex justify-between text-xs text-slate-500">
              <span>Subtotal {dinero(totales.subtotal)}</span>
              <span>IVA {dinero(totales.iva)}</span>
            </div>
            <div className="flex items-end justify-between">
              <span className="text-slate-600">Total</span>
              <span className="text-2xl font-bold text-slate-900">{dinero(totales.total)}</span>
            </div>
            <button type="button" disabled={carrito.length === 0 || totales.total <= 0 || sinExistencia > 0} title={sinExistencia ? "Hay productos sin existencia suficiente" : undefined} onClick={() => setCobrando(true)} className="w-full rounded-lg bg-emerald-600 py-3 text-lg font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
              Cobrar
            </button>
          </div>
        </div>
      </div>

      {cobrando && (
        <Cobro
          empresaId={empresaId}
          turno={turno}
          total={totales.total}
          carrito={carrito}
          clienteId={clienteId || null}
          clienteNombre={clienteNombre}
          requiereFactura={requiereFactura}
          onCancelar={() => setCobrando(false)}
          onCobrado={() => {
            queryClient.invalidateQueries({ queryKey: ["pv-productos", empresaId] });
            queryClient.invalidateQueries({ queryKey: ["pv-turno"] });
            queryClient.invalidateQueries({ queryKey: ["pv-ventas"] });
            // La venta es una salida del inventario: refresca existencias y resumen.
            queryClient.invalidateQueries({ queryKey: ["existencias"] });
            queryClient.invalidateQueries({ queryKey: ["inv-resumen-existencias"] });
            queryClient.invalidateQueries({ queryKey: ["inv-resumen-movimientos"] });
            limpiar();
          }}
        />
      )}
    </div>
  );
}

function Cobro({
  empresaId,
  turno,
  total,
  carrito,
  clienteId,
  clienteNombre,
  requiereFactura,
  onCancelar,
  onCobrado,
}: {
  empresaId: string;
  turno: Turno;
  total: number;
  carrito: LineaCarrito[];
  clienteId: string | null;
  clienteNombre: string;
  requiereFactura: boolean;
  onCancelar: () => void;
  onCobrado: () => void;
}) {
  const [pagos, setPagos] = useState<PagoCaptura[]>([{ metodo: "efectivo", monto: total }]);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ folio: string; cambio: number } | null>(null);
  const r = revisarPagos(total, pagos);
  const metodos: MetodoPago[] = ["efectivo", "tarjeta", "transferencia", "credito"];

  const cobrar = useMutation({
    mutationFn: async (ventana: Window | null) => {
      const { data, error: e } = await supabase.rpc("fn_pv_cobrar", {
        p_empresa: empresaId,
        p_turno: turno.id,
        p_cliente: clienteId,
        p_cliente_nombre: clienteNombre || null,
        p_lineas: carrito.map((l) => ({ producto_id: l.productoId, cantidad: l.cantidad, precio: l.precio, descuento_pct: l.descuentoPct, codigo: l.codigo ?? null })),
        p_pagos: pagos.filter((p) => Number(p.monto) > 0).map((p) => ({ metodo: p.metodo, monto: Number(p.monto), referencia: p.referencia ?? null })),
        p_requiere_factura: requiereFactura,
        p_notas: null,
      });
      if (e) {
        cerrarVentanaImpresion(ventana);
        throw e;
      }
      const res = data as { id: string; folio: string; cambio: number };
      await imprimirTicket(res.id, ventana);
      return res;
    },
    onSuccess: (res) => setResultado({ folio: res.folio, cambio: Number(res.cambio) }),
    onError: (e) => setError((e as Error).message),
  });

  function ponerMonto(i: number, monto: number) {
    setPagos((ps) => ps.map((p, j) => (j === i ? { ...p, monto } : p)));
  }

  if (resultado) {
    return (
      <Modal>
        <div className="text-center">
          <p className="text-sm text-slate-500">Venta {resultado.folio}</p>
          <p className="mt-2 text-lg font-semibold text-emerald-700">¡Cobrada!</p>
          {resultado.cambio > 0 && (
            <p className="mt-3 text-3xl font-bold text-slate-900">
              Cambio <span className="text-emerald-700">{dinero(resultado.cambio)}</span>
            </p>
          )}
          <p className="mt-3 text-xs text-slate-500">Se abrió el ticket para imprimir. El cliente lo presenta en almacén para recoger.</p>
          <button type="button" autoFocus onClick={onCobrado} className={`${botonPrimario} mt-4 w-full py-3 text-base`}>
            Nueva venta
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal>
      <div className="flex items-end justify-between">
        <h3 className="text-base font-semibold text-slate-800">Cobrar</h3>
        <span className="text-2xl font-bold text-slate-900">{dinero(total)}</span>
      </div>
      <div className="mt-3 space-y-2">
        {pagos.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select value={p.metodo} onChange={(e) => setPagos((ps) => ps.map((x, j) => (j === i ? { ...x, metodo: e.target.value as MetodoPago } : x)))} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
              {metodos.map((m) => (
                <option key={m} value={m}>
                  {ETIQUETA_METODO[m]}
                </option>
              ))}
            </select>
            <input type="number" min="0" step="0.01" value={p.monto || ""} onChange={(e) => ponerMonto(i, Number(e.target.value))} className="w-32 rounded border border-slate-300 px-2 py-1.5 text-right text-base" autoFocus={i === 0} />
            {p.metodo !== "efectivo" && p.metodo !== "credito" && (
              <input value={p.referencia ?? ""} onChange={(e) => setPagos((ps) => ps.map((x, j) => (j === i ? { ...x, referencia: e.target.value } : x)))} placeholder="Referencia / autorización" className="min-w-[140px] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
            )}
            {pagos.length > 1 && (
              <button type="button" onClick={() => setPagos((ps) => ps.filter((_, j) => j !== i))} className="text-xs text-red-600">
                quitar
              </button>
            )}
          </div>
        ))}
        {pagos[0]?.metodo === "efectivo" && (
          <div className="flex flex-wrap gap-1">
            {[total, 100, 200, 500, 1000].map((v, k) => (
              <button key={k} type="button" onClick={() => ponerMonto(0, k === 0 ? v : Math.ceil(total / v) * v)} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                {k === 0 ? "Exacto" : `Billetes de ${v}`}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setPagos((ps) => [...ps, { metodo: "tarjeta", monto: Math.max(r.falta, 0) }])} className="text-xs text-slate-600 underline">
          + Pagar con otra forma (pago mixto)
        </button>
        {pagos.some((p) => p.metodo === "credito") && !clienteId && <p className="text-xs text-red-700">La venta a crédito necesita un cliente con crédito autorizado.</p>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 rounded bg-slate-50 p-2 text-sm">
        <span>Pagado</span>
        <span className="text-right font-medium">{dinero(r.pagado)}</span>
        <span>{r.falta > 0 ? "Falta" : "Cambio"}</span>
        <span className={`text-right text-lg font-bold ${r.falta > 0 ? "text-red-700" : "text-emerald-700"}`}>{dinero(r.falta > 0 ? r.falta : r.cambio)}</span>
      </div>
      {(error || r.error) && <p className="mt-2 text-sm text-red-700">{error ?? r.error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onCancelar} className={`${botonSecundario} flex-1`}>
          Regresar
        </button>
        <button
          type="button"
          disabled={!!r.error || cobrar.isPending}
          onClick={() => {
            setError(null);
            cobrar.mutate(abrirVentanaImpresion());
          }}
          className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-base font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {cobrar.isPending ? "Cobrando…" : "Confirmar e imprimir"}
        </button>
      </div>
    </Modal>
  );
}

export function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl">{children}</div>
    </div>
  );
}
