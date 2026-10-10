import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { filtrarProductos, precioConUtilidad, revisarPrecio, utilidadDePrecio } from "../../lib/puntoVenta";
import { dinero, useProductosVenta, type ProductoVenta } from "./datos";

/** Precio de venta (con IVA) por % de utilidad sobre el costo o a mano,
 * código de barras y conteo físico del almacén del punto de venta. */
export function Precios({ empresaId }: { empresaId: string }) {
  const queryClient = useQueryClient();
  const { data: productos = [] } = useProductosVenta(empresaId);
  const [texto, setTexto] = useState("");
  const [soloSinPrecio, setSoloSinPrecio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ["pv-productos", empresaId] });
    queryClient.invalidateQueries({ queryKey: ["existencias"] });
    queryClient.invalidateQueries({ queryKey: ["inv-resumen-existencias"] });
    queryClient.invalidateQueries({ queryKey: ["inv-resumen-movimientos"] });
  };
  const guardar = useMutation({
    mutationFn: async ({ id, campo, valor }: { id: string; campo: "precio_venta" | "codigo_barras"; valor: string | number | null }) => {
      const { error: e } = await supabase.from("productos").update({ [campo]: valor }).eq("id", id);
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      refrescar();
    },
    onError: (e) => setError((e as Error).message),
  });
  const contar = useMutation({
    mutationFn: async ({ id, contado }: { id: string; contado: number }) => {
      const { error: e } = await supabase.rpc("fn_pv_ajustar_existencia", { p_producto: id, p_contado: contado, p_nota: null });
      if (e) throw e;
    },
    onSuccess: () => {
      setError(null);
      refrescar();
    },
    onError: (e) => setError((e as Error).message),
  });
  const lista = filtrarProductos(productos, texto).filter((p) => !soloSinPrecio || p.precio_venta == null);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar producto" className="w-64 rounded border border-slate-300 px-2 py-1.5" />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={soloSinPrecio} onChange={(e) => setSoloSinPrecio(e.target.checked)} />
          Solo sin precio ({productos.filter((p) => p.precio_venta == null).length})
        </label>
      </div>
      <p className="mb-2 text-xs text-slate-500">
        Pon la <b>utilidad %</b> sobre el costo y el precio se calcula solo, o escribe el <b>precio</b> a mano (con IVA): no se guarda si queda sin utilidad.
        La existencia es la del almacén del que sale la venta; "Conteo" registra lo que hay físicamente como ajuste de inventario.
      </p>
      {error && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Código de barras</th>
              <th className="px-3 py-2 text-right">Existencia</th>
              <th className="px-3 py-2 text-right">Conteo</th>
              <th className="px-3 py-2 text-right">Costo s/IVA</th>
              <th className="px-3 py-2 text-right">Utilidad %</th>
              <th className="px-3 py-2 text-right">Precio c/IVA</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <FilaPrecio
                key={`${p.id}-${p.precio_venta ?? ""}-${p.existencia}`}
                p={p}
                onPrecio={(precio) => guardar.mutate({ id: p.id, campo: "precio_venta", valor: precio })}
                onCodigo={(codigo) => guardar.mutate({ id: p.id, campo: "codigo_barras", valor: codigo })}
                onConteo={(contado) => contar.mutate({ id: p.id, contado })}
                onError={setError}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilaPrecio({
  p,
  onPrecio,
  onCodigo,
  onConteo,
  onError,
}: {
  p: ProductoVenta;
  onPrecio: (precio: number | null) => void;
  onCodigo: (codigo: string | null) => void;
  onConteo: (contado: number) => void;
  onError: (msg: string | null) => void;
}) {
  const utilidadActual = p.precio_venta != null ? utilidadDePrecio(Number(p.precio_venta), p.costo, p.iva_tasa) : null;
  const [precio, setPrecio] = useState(p.precio_venta != null ? String(p.precio_venta) : "");
  const [utilidad, setUtilidad] = useState(utilidadActual != null ? String(utilidadActual) : "");
  const [conteo, setConteo] = useState("");

  function guardarPrecio(valor: string) {
    if (valor.trim() === "") {
      if (p.precio_venta != null) onPrecio(null);
      return;
    }
    const n = Math.round(Number(valor) * 100) / 100;
    const problema = revisarPrecio(n, p.costo, p.iva_tasa);
    if (problema) {
      onError(`${p.nombre}: ${problema}`);
      setPrecio(p.precio_venta != null ? String(p.precio_venta) : "");
      setUtilidad(utilidadActual != null ? String(utilidadActual) : "");
      return;
    }
    if (n !== Number(p.precio_venta)) onPrecio(n);
  }

  function cambiarUtilidad(valor: string) {
    setUtilidad(valor);
    const u = Number(valor);
    if (p.costo != null && valor.trim() !== "" && Number.isFinite(u)) setPrecio(String(precioConUtilidad(p.costo, u, p.iva_tasa)));
  }

  function guardarUtilidad() {
    if (utilidad.trim() === "" || p.costo == null) return;
    const u = Number(utilidad);
    if (!(u > 0)) {
      onError(`${p.nombre}: la utilidad tiene que ser mayor a 0 %.`);
      setUtilidad(utilidadActual != null ? String(utilidadActual) : "");
      setPrecio(p.precio_venta != null ? String(p.precio_venta) : "");
      return;
    }
    guardarPrecio(String(precioConUtilidad(p.costo, u, p.iva_tasa)));
  }

  const u = utilidadDePrecio(Number(precio), p.costo, p.iva_tasa);
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && e.currentTarget.blur();

  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-1">
        <div>{p.nombre}</div>
        <div className="text-xs text-slate-500">{p.sku}</div>
      </td>
      <td className="px-3 py-1">
        <input
          defaultValue={p.codigo_barras ?? ""}
          onKeyDown={enter}
          onBlur={(e) => e.target.value.trim() !== (p.codigo_barras ?? "") && onCodigo(e.target.value.trim() || null)}
          className="w-36 rounded border border-slate-200 px-1 py-0.5 text-xs"
        />
      </td>
      <td className={`px-3 py-1 text-right tabular-nums ${p.existencia > 0 ? "" : "text-red-600"}`}>
        {Number(p.existencia).toLocaleString("es-MX")} {p.unidad_medida ?? ""}
      </td>
      <td className="px-3 py-1 text-right">
        <input
          type="number"
          min="0"
          step="any"
          value={conteo}
          placeholder="contado"
          onChange={(e) => setConteo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || conteo.trim() === "") return;
            const n = Number(conteo);
            if (!(n >= 0)) return onError(`${p.nombre}: cantidad contada inválida.`);
            if (n !== Number(p.existencia) && window.confirm(`${p.nombre}: el sistema tiene ${p.existencia} y contaste ${n}. ¿Registrar el ajuste de ${n - Number(p.existencia) > 0 ? "+" : ""}${n - Number(p.existencia)}?`)) {
              onConteo(n);
            }
            setConteo("");
          }}
          className="w-20 rounded border border-slate-200 px-1 py-0.5 text-right text-xs"
          title="Escribe lo que hay físicamente y presiona Enter"
        />
      </td>
      <td className="px-3 py-1 text-right tabular-nums text-slate-700">{p.costo != null ? dinero(p.costo) : <span className="text-xs text-slate-400">sin costo</span>}</td>
      <td className="px-3 py-1 text-right">
        <input
          type="number"
          min="0.01"
          step="0.1"
          value={utilidad}
          disabled={p.costo == null}
          onChange={(e) => cambiarUtilidad(e.target.value)}
          onKeyDown={enter}
          onBlur={guardarUtilidad}
          className="w-16 rounded border border-slate-200 px-1 py-0.5 text-right disabled:bg-slate-50"
          title={p.costo == null ? "Sin costo: captura el precio a mano" : "Utilidad sobre el costo sin IVA"}
        />
      </td>
      <td className="px-3 py-1 text-right">
        <input
          type="number"
          min="0"
          step="0.01"
          value={precio}
          onChange={(e) => {
            setPrecio(e.target.value);
            const nu = utilidadDePrecio(Number(e.target.value), p.costo, p.iva_tasa);
            setUtilidad(nu != null ? String(nu) : "");
          }}
          onKeyDown={enter}
          onBlur={(e) => guardarPrecio(e.target.value)}
          className={`w-24 rounded border px-1 py-0.5 text-right ${precio === "" ? "border-amber-300" : u != null && u <= 0 ? "border-red-400 bg-red-50" : "border-slate-200"}`}
          title={precio !== "" ? `Sin IVA ${dinero(Number(precio) / (1 + p.iva_tasa))}` : "Sin precio"}
        />
      </td>
    </tr>
  );
}
