import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";
import { BotonVerOv } from "./VerOrdenVenta";
import {
  FORMAS_PAGO,
  importePartida,
  infoTipo,
  partidaVacia,
  partidasParaGuardar,
  revisarOrden,
  totalesPartidas,
  type PartidaCaptura,
  type TipoOrden,
} from "../../lib/ordenesIa";

const dinero = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

interface Encabezado {
  empresaId: string;
  contraparte: string;
  proyecto: string;
  fecha: string;
  formaPago: string;
  condicion: string;
  fechaEntrega: string;
  lugarEntrega: string;
  notas: string;
}

/** Captura y edición de una OC / OS / OV con folio IA. */
export function EditorOrden({
  tipo,
  id,
  empresaInicial,
  onCerrar,
  onGuardada,
}: {
  tipo: TipoOrden;
  id: string | null;
  empresaInicial: string;
  onCerrar: () => void;
  onGuardada: () => void;
}) {
  const info = infoTipo(tipo);
  const [enc, setEnc] = useState<Encabezado>({
    empresaId: empresaInicial,
    contraparte: "",
    proyecto: "",
    fecha: hoy(),
    formaPago: tipo === "OV" ? "" : FORMAS_PAGO[0],
    condicion: "",
    fechaEntrega: "",
    lugarEntrega: "",
    notas: "",
  });
  const [tipoOrden, setTipoOrden] = useState<TipoOrden>(tipo);
  const [partidas, setPartidas] = useState<PartidaCaptura[]>([partidaVacia()]);
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [guardada, setGuardada] = useState<{ id: string; folio: string; total: number } | null>(null);
  const [cargado, setCargado] = useState(id == null);

  // Editar: carga la orden y sus partidas.
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    (async () => {
      if (tipo === "OV") {
        const { data: o } = await supabase.from("ordenes_venta").select("empresa_id, cliente, proyecto, fecha_ov, forma_pago, condicion_pago, fecha_entrega, lugar_entrega, notas").eq("id", id).maybeSingle();
        const { data: l } = await supabase.from("ordenes_venta_lineas").select("concepto, unidad, cantidad, precio_base, iva").eq("orden_venta_id", id).order("numero");
        if (!vivo || !o) return;
        setEnc({ empresaId: o.empresa_id, contraparte: o.cliente ?? "", proyecto: o.proyecto ?? "", fecha: o.fecha_ov ?? hoy(), formaPago: o.forma_pago ?? "", condicion: o.condicion_pago ?? "", fechaEntrega: o.fecha_entrega ?? "", lugarEntrega: o.lugar_entrega ?? "", notas: o.notas ?? "" });
        setPartidas([...(l ?? []).map((x) => ({ item: x.concepto ?? "", unidad: x.unidad ?? "", cantidad: x.cantidad ?? "", costo: x.precio_base ?? "", iva: x.iva ?? true })), partidaVacia()]);
      } else {
        const { data: o } = await supabase.from("ordenes_compra").select("empresa_id, tipo, proveedor, proyecto, fecha_creacion, tipo_pago_backoffice, condicion_pago, fecha_entrega, lugar_entrega, notas").eq("id", id).maybeSingle();
        const { data: l } = await supabase.from("ordenes_compra_lineas").select("item, unidad, cantidad, costo, iva").eq("orden_compra_id", id).order("numero");
        if (!vivo || !o) return;
        setTipoOrden(o.tipo as TipoOrden);
        setEnc({ empresaId: o.empresa_id, contraparte: o.proveedor ?? "", proyecto: o.proyecto ?? "", fecha: o.fecha_creacion ?? hoy(), formaPago: o.tipo_pago_backoffice ?? "", condicion: o.condicion_pago ?? "", fechaEntrega: o.fecha_entrega ?? "", lugarEntrega: o.lugar_entrega ?? "", notas: o.notas ?? "" });
        setPartidas([...(l ?? []).map((x) => ({ item: x.item ?? "", unidad: x.unidad ?? "", cantidad: x.cantidad ?? "", costo: x.costo ?? "", iva: x.iva ?? true })), partidaVacia()]);
      }
      setCargado(true);
    })();
    return () => {
      vivo = false;
    };
  }, [id, tipo]);

  // Sugerencias: proveedores/clientes ya usados, obras y productos de la empresa.
  const sugerencias = useQuery({
    queryKey: ["ordenes-ia-sugerencias", tipo === "OV" ? "OV" : "OC", enc.empresaId],
    enabled: !!enc.empresaId,
    queryFn: async () => {
      const [contra, obras, prods] = await Promise.all([
        tipo === "OV"
          ? Promise.all([
              supabase.from("clientes").select("razon_social").eq("empresa_id", enc.empresaId).eq("activo", true).limit(500),
              supabase.from("ordenes_venta").select("cliente").eq("empresa_id", enc.empresaId).not("cliente", "is", null).order("fecha_ov", { ascending: false }).limit(500),
            ]).then(([a, b]) => [...(a.data ?? []).map((x) => x.razon_social as string), ...(b.data ?? []).map((x) => x.cliente as string)])
          : supabase
              .from("ordenes_compra")
              .select("proveedor")
              .eq("empresa_id", enc.empresaId)
              .not("proveedor", "is", null)
              .order("fecha_creacion", { ascending: false })
              .limit(1000)
              .then((r) => (r.data ?? []).map((x) => x.proveedor as string)),
        supabase.from("proyectos").select("nombre").eq("empresa_id", enc.empresaId).eq("activo", true).order("nombre"),
        supabase.from("productos").select("nombre, unidad_medida, costo_referencia, precio_venta, iva_tasa").eq("empresa_id", enc.empresaId).eq("activo", true).order("nombre").limit(2000),
      ]);
      return {
        contrapartes: [...new Set(contra.map((x) => x?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")),
        obras: (obras.data ?? []).map((x) => x.nombre as string),
        productos: (prods.data ?? []) as { nombre: string; unidad_medida: string | null; costo_referencia: number | null; precio_venta: number | null; iva_tasa: number | null }[],
      };
    },
  });

  function cambiar(i: number, cambio: Partial<PartidaCaptura>) {
    setPartidas((ps) => {
      const nuevas = ps.map((p, j) => (j === i ? { ...p, ...cambio } : p));
      // Al elegir un producto del catálogo se llenan unidad y costo/precio.
      if (cambio.item !== undefined) {
        const prod = sugerencias.data?.productos.find((p) => p.nombre === cambio.item);
        if (prod) {
          const base = tipo === "OV" ? (prod.precio_venta != null ? Number(prod.precio_venta) / (1 + Number(prod.iva_tasa ?? 0.16)) : null) : prod.costo_referencia;
          nuevas[i] = { ...nuevas[i], unidad: nuevas[i].unidad || prod.unidad_medida || "", costo: nuevas[i].costo === "" && base != null ? Math.round(Number(base) * 100) / 100 : nuevas[i].costo };
        }
      }
      // Siempre queda un renglón vacío al final para seguir capturando.
      const ultimo = nuevas[nuevas.length - 1];
      if (ultimo.item.trim() || String(ultimo.cantidad).trim() || String(ultimo.costo).trim()) nuevas.push(partidaVacia());
      return nuevas;
    });
  }

  async function guardar() {
    const problemas = revisarOrden({ contraparte: enc.contraparte, empresaId: enc.empresaId, partidas }, tipoOrden);
    setErrores(problemas);
    if (problemas.length) return;
    setGuardando(true);
    const { data, error } = await supabase.rpc("fn_orden_ia_guardar", {
      p_id: id,
      p_tipo: tipoOrden,
      p_empresa: enc.empresaId,
      p_contraparte: enc.contraparte,
      p_proyecto: enc.proyecto || null,
      p_fecha: enc.fecha || null,
      p_lineas: partidasParaGuardar(partidas),
      p_forma_pago: enc.formaPago || null,
      p_condicion: enc.condicion || null,
      p_fecha_entrega: enc.fechaEntrega || null,
      p_lugar_entrega: enc.lugarEntrega || null,
      p_notas: enc.notas || null,
    });
    setGuardando(false);
    if (error) {
      setErrores([error.message]);
      return;
    }
    const r = data as { id: string; folio: string; total: number };
    setGuardada(r);
    onGuardada();
  }

  const t = totalesPartidas(partidas);

  if (guardada) {
    return (
      <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm text-emerald-900">
          Orden <b className="font-mono">{guardada.folio}</b> guardada por {dinero(Number(guardada.total))} con IVA.
          {tipoOrden !== "OV" && " Ya está en \"Órdenes por autorizar\" de dirección."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {tipoOrden === "OV" ? <BotonVerOv ovId={guardada.id} etiqueta="Imprimir orden" /> : <BotonVerOc ocId={guardada.id} etiqueta="Imprimir orden" />}
          <button type="button" onClick={onCerrar} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700">
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded border border-slate-300 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{id ? "Editar orden" : `Nueva ${info.titulo.toLowerCase()}`}</h2>
        <button type="button" onClick={onCerrar} className="text-xs text-slate-500 hover:underline">
          Cerrar
        </button>
      </div>
      {!cargado ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-slate-600">
              Empresa
              <div className="mt-1">
                {id ? (
                  <span className="text-sm text-slate-800">(no se cambia al editar)</span>
                ) : (
                  <SelectorEmpresa value={enc.empresaId} onChange={(v) => setEnc({ ...enc, empresaId: v })} vacio="Selecciona…" className={campo} />
                )}
              </div>
            </label>
            {tipo !== "OV" && (
              <label className="text-xs text-slate-600">
                Tipo
                <select value={tipoOrden} onChange={(e) => setTipoOrden(e.target.value as TipoOrden)} className={`mt-1 ${campo}`}>
                  <option value="OC">Orden de compra (material)</option>
                  <option value="OS">Orden de servicio</option>
                </select>
              </label>
            )}
            <label className="text-xs text-slate-600 lg:col-span-2">
              {info.contraparte}
              <input list="ordenes-ia-contrapartes" value={enc.contraparte} onChange={(e) => setEnc({ ...enc, contraparte: e.target.value })} className={`mt-1 ${campo}`} />
              <datalist id="ordenes-ia-contrapartes">
                {sugerencias.data?.contrapartes.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            <label className="text-xs text-slate-600 lg:col-span-2">
              Proyecto / obra
              <input list="ordenes-ia-obras" value={enc.proyecto} onChange={(e) => setEnc({ ...enc, proyecto: e.target.value })} className={`mt-1 ${campo}`} />
              <datalist id="ordenes-ia-obras">
                {sugerencias.data?.obras.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            <label className="text-xs text-slate-600">
              Fecha
              <input type="date" value={enc.fecha} onChange={(e) => setEnc({ ...enc, fecha: e.target.value })} className={`mt-1 ${campo}`} />
            </label>
            <label className="text-xs text-slate-600">
              Forma de pago
              <select value={enc.formaPago} onChange={(e) => setEnc({ ...enc, formaPago: e.target.value })} className={`mt-1 ${campo}`}>
                <option value="">—</option>
                {FORMAS_PAGO.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Condición
              <select value={enc.condicion} onChange={(e) => setEnc({ ...enc, condicion: e.target.value })} className={`mt-1 ${campo}`}>
                <option value="">{tipo === "OV" ? "—" : "la define dirección"}</option>
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
                <option value="anticipo">Anticipo</option>
                <option value="efectivo">Efectivo</option>
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Fecha de entrega
              <input type="date" value={enc.fechaEntrega} onChange={(e) => setEnc({ ...enc, fechaEntrega: e.target.value })} className={`mt-1 ${campo}`} />
            </label>
            <label className="text-xs text-slate-600 lg:col-span-2">
              Lugar de entrega
              <input value={enc.lugarEntrega} onChange={(e) => setEnc({ ...enc, lugarEntrega: e.target.value })} placeholder="bodega, obra, domicilio del cliente…" className={`mt-1 ${campo}`} />
            </label>
            <label className="text-xs text-slate-600 lg:col-span-2">
              Notas
              <input value={enc.notas} onChange={(e) => setEnc({ ...enc, notas: e.target.value })} className={`mt-1 ${campo}`} />
            </label>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Descripción</th>
                  <th className="py-1 pr-2">Unidad</th>
                  <th className="py-1 pr-2 text-right">Cantidad</th>
                  <th className="py-1 pr-2 text-right">{info.importe}</th>
                  <th className="py-1 pr-2 text-center">IVA</th>
                  <th className="py-1 pr-2 text-right">Importe</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {partidas.map((p, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1 pr-2 text-xs text-slate-400">{i + 1}</td>
                    <td className="py-1 pr-2">
                      <input list="ordenes-ia-productos" value={p.item} onChange={(e) => cambiar(i, { item: e.target.value })} className="w-full min-w-[14rem] rounded border border-slate-200 px-1.5 py-1" />
                    </td>
                    <td className="py-1 pr-2">
                      <input value={p.unidad} onChange={(e) => cambiar(i, { unidad: e.target.value })} className="w-20 rounded border border-slate-200 px-1.5 py-1" />
                    </td>
                    <td className="py-1 pr-2 text-right">
                      <input type="number" min="0" step="any" value={p.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} className="w-24 rounded border border-slate-200 px-1.5 py-1 text-right" />
                    </td>
                    <td className="py-1 pr-2 text-right">
                      <input type="number" min="0" step="0.01" value={p.costo} onChange={(e) => cambiar(i, { costo: e.target.value })} className="w-28 rounded border border-slate-200 px-1.5 py-1 text-right" />
                    </td>
                    <td className="py-1 pr-2 text-center">
                      <input type="checkbox" checked={p.iva} onChange={(e) => cambiar(i, { iva: e.target.checked })} />
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{dinero(importePartida(p))}</td>
                    <td className="py-1">
                      {partidas.length > 1 && i < partidas.length - 1 && (
                        <button type="button" onClick={() => setPartidas((ps) => ps.filter((_, j) => j !== i))} className="text-xs text-red-600">
                          quitar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr>
                  <td colSpan={6} className="pt-2 text-right text-slate-500">Subtotal</td>
                  <td className="pt-2 text-right tabular-nums">{dinero(t.subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={6} className="text-right text-slate-500">IVA 16 %</td>
                  <td className="text-right tabular-nums">{dinero(t.iva)}</td>
                </tr>
                <tr>
                  <td colSpan={6} className="text-right font-semibold">Total</td>
                  <td className="text-right font-semibold tabular-nums">{dinero(t.total)}</td>
                </tr>
              </tfoot>
            </table>
            <datalist id="ordenes-ia-productos">
              {sugerencias.data?.productos.map((p) => <option key={p.nombre} value={p.nombre} />)}
            </datalist>
          </div>

          {errores.length > 0 && (
            <ul className="mt-3 list-disc rounded bg-red-50 px-6 py-2 text-sm text-red-700">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onCerrar} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={guardando} className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {guardando ? "Guardando…" : id ? "Guardar cambios" : `Guardar y sacar folio IA-${tipoOrden}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
