import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useEmpresasAlcance } from "../../components/SelectorEmpresa";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";
import { BotonVerOv } from "./VerOrdenVenta";
import { FORMAS_PAGO, partidasParaGuardar } from "../../lib/ordenesIa";
import { partidasDesdeOrigen, partidasVenta, precioPartida, resumenInterempresa, revisarInterempresa, type PartidaInterempresa } from "../../lib/interempresa";

const dinero = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

interface Origen {
  id_orden: string;
  tipo: string;
  empresa_id: string;
  proveedor: string | null;
  proyecto: string | null;
  fuente: string;
  tipo_pago_backoffice: string | null;
}

interface Resultado {
  ov: { id: string; folio: string; total: number };
  oc: { id: string; folio: string; total: number };
}

/** Venta inter empresa desde una OC/OS (21-oct-2026, Mario): copia el folio
 * como base y genera de una vez la OV de la empresa que compró a la otra
 * empresa del grupo y la OC/OS de esa otra empresa, con la comisión o el
 * precio corregido por partida (fn_orden_interempresa). */
export function VentaInterempresa({ ocId, onCerrar, onGuardada }: { ocId: string; onCerrar: () => void; onGuardada: () => void }) {
  const { data: empresas } = useEmpresasAlcance();
  const [origen, setOrigen] = useState<Origen | null>(null);
  const [partidas, setPartidas] = useState<PartidaInterempresa[]>([]);
  const [empresaCompra, setEmpresaCompra] = useState("");
  const [comision, setComision] = useState("10");
  const [formaPago, setFormaPago] = useState("Transferencia electrónica de fondos");
  const [condicion, setCondicion] = useState("credito");
  const [proyecto, setProyecto] = useState("");
  const [notas, setNotas] = useState("");
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data: o, error } = await supabase.from("ordenes_compra").select("id_orden, tipo, empresa_id, proveedor, proyecto, fuente, tipo_pago_backoffice").eq("id", ocId).maybeSingle();
      const { data: l } = await supabase.from("ordenes_compra_lineas").select("item, unidad, cantidad, costo, iva").eq("orden_compra_id", ocId).order("numero");
      if (!vivo) return;
      if (error || !o) {
        setErrores([error?.message ?? "No encontré la orden."]);
        return;
      }
      setOrigen(o as Origen);
      setProyecto(o.proyecto ?? "");
      setPartidas(partidasDesdeOrigen(l ?? [], o.fuente as string));
    })();
    return () => {
      vivo = false;
    };
  }, [ocId]);

  const pct = Number(comision) || 0;
  const resumen = useMemo(() => resumenInterempresa(partidas, pct), [partidas, pct]);
  const nombre = (id: string) => empresas?.find((e) => e.id === id);
  const vende = origen ? nombre(origen.empresa_id) : undefined;
  const compra = empresaCompra ? nombre(empresaCompra) : undefined;

  function cambiar(i: number, cambio: Partial<PartidaInterempresa>) {
    setPartidas((ps) => ps.map((p, j) => (j === i ? { ...p, ...cambio } : p)));
  }

  async function generar() {
    if (!origen) return;
    const problemas = revisarInterempresa({ empresaVende: origen.empresa_id, empresaCompra, formaPago, partidas });
    setErrores(problemas);
    if (problemas.length) return;
    setGuardando(true);
    const { data, error } = await supabase.rpc("fn_orden_interempresa", {
      p_origen: ocId,
      p_empresa_compradora: empresaCompra,
      p_lineas: partidasParaGuardar(partidasVenta(partidas, pct)),
      p_comision: comision.trim() === "" ? null : pct,
      p_proyecto: proyecto.trim() || null,
      p_forma_pago: formaPago,
      p_condicion: condicion || null,
      p_notas: notas.trim() || null,
    });
    setGuardando(false);
    if (error) {
      setErrores([error.message]);
      return;
    }
    setResultado(data as Resultado);
    onGuardada();
  }

  if (resultado && origen) {
    return (
      <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p>
          Listo, con base en <b className="font-mono">{origen.id_orden}</b>:
        </p>
        <ul className="mt-2 list-disc pl-5">
          <li>
            Venta <b className="font-mono">{resultado.ov.folio}</b> de {vende?.codigo} a {compra?.codigo} por {dinero(Number(resultado.ov.total))} c/IVA.
          </li>
          <li>
            Compra <b className="font-mono">{resultado.oc.folio}</b> de {compra?.codigo} a {vende?.codigo} por {dinero(Number(resultado.oc.total))} c/IVA (ya en "Órdenes por autorizar").
          </li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <BotonVerOv ovId={resultado.ov.id} etiqueta={`Imprimir ${resultado.ov.folio}`} />
          <BotonVerOc ocId={resultado.oc.id} etiqueta={`Imprimir ${resultado.oc.folio}`} />
          <button type="button" onClick={onCerrar} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700">
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded border border-indigo-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Venta inter empresa {origen ? `con base en ${origen.id_orden}` : ""}</h2>
          {origen && (
            <p className="text-xs text-slate-500">
              {vende?.codigo ?? "—"} le compró a {origen.proveedor ?? "—"}. Se generan juntas la <b>OV</b> de {vende?.codigo ?? "—"} a la empresa que elijas y la{" "}
              <b>{origen.tipo === "OS" ? "OS" : "OC"}</b> de esa empresa a {vende?.codigo ?? "—"}, con el mismo precio.
            </p>
          )}
        </div>
        <button type="button" onClick={onCerrar} className="text-xs text-slate-500 hover:underline">
          Cerrar
        </button>
      </div>
      {!origen ? (
        <p className="text-sm text-slate-500">{errores[0] ?? "Cargando…"}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-slate-600">
              Empresa que compra
              <select value={empresaCompra} onChange={(e) => setEmpresaCompra(e.target.value)} className={`mt-1 ${campo} ${!empresaCompra ? "border-amber-400" : ""}`}>
                <option value="">Elige…</option>
                {(empresas ?? [])
                  .filter((e) => e.id !== origen.empresa_id)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.codigo} · {e.nombre}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Comisión sobre el costo (%)
              <input type="number" step="0.01" value={comision} onChange={(e) => setComision(e.target.value)} className={`mt-1 ${campo}`} />
            </label>
            <label className="text-xs text-slate-600">
              Forma de pago
              <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className={`mt-1 ${campo}`}>
                {FORMAS_PAGO.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Condición
              <select value={condicion} onChange={(e) => setCondicion(e.target.value)} className={`mt-1 ${campo}`}>
                <option value="credito">Crédito</option>
                <option value="contado">Contado</option>
                <option value="anticipo">Anticipo</option>
                <option value="efectivo">Efectivo</option>
              </select>
            </label>
            <label className="text-xs text-slate-600 lg:col-span-2">
              Proyecto / obra
              <input value={proyecto} onChange={(e) => setProyecto(e.target.value)} className={`mt-1 ${campo}`} />
            </label>
            <label className="text-xs text-slate-600 lg:col-span-2">
              Notas (van en las dos órdenes)
              <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej. entrega directa en obra" className={`mt-1 ${campo}`} />
            </label>
          </div>

          <div className="mt-3 overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1.5" />
                  <th className="px-2 py-1.5">Partida</th>
                  <th className="px-2 py-1.5">Unidad</th>
                  <th className="px-2 py-1.5 text-right">Cantidad</th>
                  <th className="px-2 py-1.5 text-right">Costo s/IVA</th>
                  <th className="px-2 py-1.5 text-right">Precio inter empresa s/IVA</th>
                  <th className="px-2 py-1.5 text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {partidas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-4 text-center text-xs text-slate-500">
                      La orden no tiene partidas.
                    </td>
                  </tr>
                )}
                {partidas.map((p, i) => {
                  const precio = precioPartida(p, pct);
                  return (
                    <tr key={i} className={`border-t border-slate-100 ${p.incluir ? "" : "text-slate-400"}`}>
                      <td className="px-2 py-1">
                        <input type="checkbox" checked={p.incluir} onChange={(e) => cambiar(i, { incluir: e.target.checked })} title="Incluir partida" />
                      </td>
                      <td className="px-2 py-1">
                        <input value={p.item} onChange={(e) => cambiar(i, { item: e.target.value })} className="w-full min-w-[12rem] rounded border border-slate-200 px-1.5 py-1 text-sm" />
                      </td>
                      <td className="px-2 py-1">
                        <input value={p.unidad} onChange={(e) => cambiar(i, { unidad: e.target.value })} className="w-20 rounded border border-slate-200 px-1.5 py-1 text-sm" />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input type="number" min="0" step="any" value={p.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} className="w-24 rounded border border-slate-200 px-1.5 py-1 text-right text-sm" />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-500">{dinero(p.costo)}</td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={p.precio}
                          placeholder={precio.toFixed(2)}
                          onChange={(e) => cambiar(i, { precio: e.target.value })}
                          className="w-28 rounded border border-slate-200 px-1.5 py-1 text-right text-sm"
                        />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{dinero((Number(p.cantidad) || 0) * precio)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex flex-wrap justify-end gap-4 text-sm">
            <span className="text-slate-500">Costo {dinero(resumen.costo)}</span>
            <span>Venta {dinero(resumen.venta)}</span>
            <span className="font-medium text-indigo-800">
              Comisión {dinero(resumen.comision)}
              {resumen.pct != null && ` (${resumen.pct.toFixed(2)} %)`}
            </span>
            <span className="text-slate-500">s/IVA</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            El precio en blanco = costo + comisión; escríbelo para corregir una partida. Desmarca las que no van.
            {(origen.fuente === "api" || origen.fuente === "excel") && " El costo del backoffice viene con IVA y aquí se muestra sin IVA."}
          </p>

          {errores.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-red-700">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={generar} disabled={guardando || partidas.length === 0} className="rounded bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50">
              {guardando ? "Generando…" : `Generar OV de ${vende?.codigo ?? "—"} y ${origen.tipo === "OS" ? "OS" : "OC"} de ${compra?.codigo ?? "…"}`}
            </button>
            <button type="button" onClick={onCerrar} className="px-2 text-sm text-slate-600 underline">
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
