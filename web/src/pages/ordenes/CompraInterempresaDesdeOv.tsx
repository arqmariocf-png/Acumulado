import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useEmpresasAlcance } from "../../components/SelectorEmpresa";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";
import { FORMAS_PAGO } from "../../lib/ordenesIa";
import { empresaCompradoraSugerida, revisarCompraDesdeOv } from "../../lib/interempresa";

const dinero = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

interface Ov {
  id: string;
  id_ov: string;
  empresa_id: string;
  cliente: string | null;
  proyecto: string | null;
  forma_pago: string | null;
  condicion_pago: string | null;
  total: number | null;
  cancelada_en: string | null;
}
interface Linea {
  concepto: string | null;
  unidad: string | null;
  cantidad: number | null;
  precio_base: number | null;
}

/** OC inter empresa desde una OV (23-nov-2026, Mario: "la orden de venta pueda
 * convertirse en orden de compra inter empresas"): la empresa del grupo a la
 * que se le vendió recibe su OC/OS con las mismas partidas y precios s/IVA,
 * proveedor = la que vende (fn_orden_interempresa_desde_ov). */
export function CompraInterempresaDesdeOv({ ovId, onCerrar, onGuardada }: { ovId: string; onCerrar: () => void; onGuardada: () => void }) {
  const { data: empresas } = useEmpresasAlcance();
  const [ov, setOv] = useState<Ov | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [empresaCompra, setEmpresaCompra] = useState("");
  const [tipo, setTipo] = useState<"OC" | "OS">("OC");
  const [formaPago, setFormaPago] = useState("");
  const [condicion, setCondicion] = useState("");
  const [proyecto, setProyecto] = useState("");
  const [notas, setNotas] = useState("");
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<{ id: string; folio: string; total: number; compra: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data: o, error } = await supabase.from("ordenes_venta").select("id, id_ov, empresa_id, cliente, proyecto, forma_pago, condicion_pago, total, cancelada_en").eq("id", ovId).maybeSingle();
      const { data: l } = await supabase.from("ordenes_venta_lineas").select("concepto, unidad, cantidad, precio_base").eq("orden_venta_id", ovId).order("numero");
      if (!vivo) return;
      if (error || !o) {
        setErrores([error?.message ?? "No encontré la orden de venta."]);
        return;
      }
      setOv(o as Ov);
      setLineas((l ?? []) as Linea[]);
      setFormaPago(o.forma_pago ?? "Transferencia electrónica de fondos");
      setCondicion(["contado", "credito", "anticipo"].includes(o.condicion_pago ?? "") ? (o.condicion_pago as string) : "credito");
      setProyecto(o.proyecto ?? "");
    })();
    return () => {
      vivo = false;
    };
  }, [ovId]);

  // La empresa que compra se sugiere por el nombre del cliente de la OV.
  const sugerida = useMemo(() => (ov && empresas ? empresaCompradoraSugerida(ov.cliente, empresas, ov.empresa_id) : null), [ov, empresas]);
  useEffect(() => {
    if (sugerida && !empresaCompra) setEmpresaCompra(sugerida.id);
  }, [sugerida, empresaCompra]);

  const vende = ov ? empresas?.find((e) => e.id === ov.empresa_id) : undefined;
  const subtotal = lineas.reduce((s, l) => s + Number(l.cantidad ?? 0) * Number(l.precio_base ?? 0), 0);

  async function generar() {
    if (!ov) return;
    const problemas = revisarCompraDesdeOv({ empresaVende: ov.empresa_id, empresaCompra, tipo, lineas: lineas.length, cancelada: !!ov.cancelada_en });
    setErrores(problemas);
    if (problemas.length) return;
    setGuardando(true);
    const { data, error } = await supabase.rpc("fn_orden_interempresa_desde_ov", {
      p_ov: ovId,
      p_empresa_compradora: empresaCompra,
      p_tipo: tipo,
      p_proyecto: proyecto.trim() || null,
      p_forma_pago: formaPago || null,
      p_condicion: condicion || null,
      p_notas: notas.trim() || null,
    });
    setGuardando(false);
    if (error) {
      setErrores([error.message]);
      return;
    }
    const r = data as { oc: { id: string; folio: string; total: number }; compra: string };
    setResultado({ id: r.oc.id, folio: r.oc.folio, total: Number(r.oc.total), compra: r.compra });
    onGuardada();
  }

  if (resultado && ov) {
    return (
      <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p>
          Listo: la OV <b className="font-mono">{ov.id_ov}</b> de {vende?.codigo} generó la compra <b className="font-mono">{resultado.folio}</b> de {resultado.compra} por {dinero(resultado.total)} c/IVA (ya está en "Órdenes por autorizar").
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <BotonVerOc ocId={resultado.id} etiqueta={`Imprimir ${resultado.folio}`} />
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
          <h2 className="text-base font-semibold text-slate-900">Generar la compra inter empresa de {ov?.id_ov ?? "…"}</h2>
          <p className="text-xs text-slate-500">
            {vende?.codigo ?? "La empresa"} le vendió a <b>{ov?.cliente ?? "…"}</b>. La empresa del grupo que compra recibe su {tipo === "OS" ? "orden de servicio" : "orden de compra"} con las mismas partidas y precios s/IVA; proveedor = {vende?.nombre ?? "la que vende"}.
          </p>
        </div>
        <button type="button" onClick={onCerrar} className="text-sm text-slate-500 hover:text-slate-800">
          Cerrar
        </button>
      </div>
      {errores.length > 0 && (
        <ul className="mb-3 list-disc rounded border border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
          {errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs text-slate-600 lg:col-span-2">
          Empresa que compra *
          <select value={empresaCompra} onChange={(e) => setEmpresaCompra(e.target.value)} className={campo}>
            <option value="">Elige…</option>
            {(empresas ?? [])
              .filter((e) => e.id !== ov?.empresa_id)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.codigo} · {e.nombre}
                </option>
              ))}
          </select>
          {!sugerida && ov && <span className="text-[11px] text-amber-700">El cliente de la OV no coincide con ninguna empresa del grupo: elige cuál compra.</span>}
        </label>
        <label className="text-xs text-slate-600">
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "OC" | "OS")} className={campo}>
            <option value="OC">Compra (OC)</option>
            <option value="OS">Servicio (OS)</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Forma de pago
          <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className={campo}>
            {FORMAS_PAGO.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          Condición
          <select value={condicion} onChange={(e) => setCondicion(e.target.value)} className={campo}>
            <option value="credito">Crédito</option>
            <option value="contado">Contado</option>
            <option value="anticipo">Anticipo</option>
          </select>
        </label>
        <label className="text-xs text-slate-600 lg:col-span-3">
          Proyecto / obra
          <input value={proyecto} onChange={(e) => setProyecto(e.target.value)} className={campo} />
        </label>
        <label className="text-xs text-slate-600 lg:col-span-2">
          Notas
          <input value={notas} onChange={(e) => setNotas(e.target.value)} className={campo} />
        </label>
      </div>
      <div className="mt-3 overflow-x-auto rounded border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-2 py-1">Partida</th>
              <th className="px-2 py-1">Unidad</th>
              <th className="px-2 py-1 text-right">Cantidad</th>
              <th className="px-2 py-1 text-right">Precio s/IVA</th>
              <th className="px-2 py-1 text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <tr key={i} className="border-t border-slate-100">
                <td className="px-2 py-1">{l.concepto}</td>
                <td className="px-2 py-1">{l.unidad ?? "—"}</td>
                <td className="px-2 py-1 text-right tabular-nums">{Number(l.cantidad ?? 0).toLocaleString("es-MX")}</td>
                <td className="px-2 py-1 text-right tabular-nums">{dinero(Number(l.precio_base ?? 0))}</td>
                <td className="px-2 py-1 text-right tabular-nums">{dinero(Number(l.cantidad ?? 0) * Number(l.precio_base ?? 0))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 bg-slate-50 font-medium">
              <td colSpan={4} className="px-2 py-1 text-right">
                Subtotal s/IVA
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{dinero(subtotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={generar} disabled={guardando || !ov} className="rounded bg-indigo-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {guardando ? "Generando…" : `Generar ${tipo} inter empresa`}
        </button>
        <button type="button" onClick={onCerrar} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700">
          Cancelar
        </button>
      </div>
    </div>
  );
}
