import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../lib/supabase";
import { errorDeFuncion } from "../lib/funciones";
import { rutaVerArchivo } from "../lib/verArchivo";
import {
  FORMAS_PAGO_SAT,
  REGIMENES_FISCALES,
  UNIDADES_SAT,
  USOS_CFDI,
  conceptosDesdeOv,
  formaPagoSat,
  metodoPagoSugerido,
  nombreUnidadSat,
  receptorDesdeOv,
  regimenClave,
  regimenPorRfc,
  revisarFactura,
  totalesCaptura,
  type ClienteFiscal,
  type ConceptoCaptura,
  type LineaOvFactura,
  type ReceptorCaptura,
} from "../lib/facturacion";

// Facturar una orden de venta con un clic (23-nov-2026, Mario). El panel
// trae la OV (fn_ov_para_facturar): el cliente registrado que coincide con
// sus datos fiscales (se completan aquí una vez y se guardan), las partidas
// con la clave SAT recordada, la forma/método de pago sugeridos y la
// configuración de la empresa. "Timbrar" llama a la edge
// facturacion-factura-com; el PDF y el XML quedan en el visor /archivo.

const dinero = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const campo = "w-full rounded border border-slate-300 px-2 py-1 text-sm";

interface Datos {
  ov: { id: string; id_ov: string; empresa_id: string; cliente: string | null; proyecto: string | null; fecha_ov: string | null; total: number | null; forma_pago: string | null; condicion_pago: string | null; notas: string | null; cancelada: boolean };
  empresa: { id: string; codigo: string; nombre: string; rfc: string | null; razon_social: string | null } | null;
  lineas: LineaOvFactura[];
  clientes: ClienteFiscal[];
  config: { entorno: string; serie_id: number | null; serie_nombre: string | null; con_llaves: boolean; clave_prod_serv_default: string | null; clave_unidad_default: string | null; enviar_correo: boolean } | null;
  factura: { id: string; uuid: string; serie: string | null; folio: string | null; estado: string; total: number; created_at: string; entorno: string; pdf_path: string | null; xml_path: string | null } | null;
}

interface Resultado {
  factura_id: string;
  uuid: string;
  serie: string | null;
  folio: string | null;
  total: number;
  entorno: string;
  mensaje?: string;
}

export function FacturarOrden({ ovId, onCerrar, onFacturada }: { ovId: string; onCerrar: () => void; onFacturada?: () => void }) {
  const qc = useQueryClient();
  const datos = useQuery({
    queryKey: ["ov-para-facturar", ovId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_ov_para_facturar", { p_ov: ovId });
      if (error) throw error;
      return data as Datos;
    },
  });
  const [receptor, setReceptor] = useState<ReceptorCaptura | null>(null);
  const [conceptos, setConceptos] = useState<ConceptoCaptura[]>([]);
  const [formaPago, setFormaPago] = useState("99");
  const [metodo, setMetodo] = useState<"PUE" | "PPD">("PUE");
  const [condiciones, setCondiciones] = useState("");
  const [comentarios, setComentarios] = useState("");
  const [enviarCorreo, setEnviarCorreo] = useState(true);
  const [errores, setErrores] = useState<string[]>([]);
  const [timbrando, setTimbrando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  useEffect(() => {
    const d = datos.data;
    if (!d) return;
    setReceptor(receptorDesdeOv(d.ov.cliente, d.clientes));
    setConceptos(conceptosDesdeOv(d.lineas, d.config ?? {}));
    setFormaPago(formaPagoSat(d.ov.forma_pago));
    setMetodo(metodoPagoSugerido(d.ov.condicion_pago));
    setCondiciones(d.ov.condicion_pago === "credito" ? "Crédito" : d.ov.condicion_pago === "contado" ? "Contado" : "");
    setEnviarCorreo(d.config?.enviar_correo ?? true);
  }, [datos.data]);

  const totales = useMemo(() => totalesCaptura(conceptos), [conceptos]);
  const d = datos.data;

  function elegirCliente(id: string) {
    const c = d?.clientes.find((x) => x.id === id);
    if (!receptor) return;
    if (!c) {
      setReceptor({ ...receptor, cliente_id: null });
      return;
    }
    const rfc = (c.rfc ?? "").toUpperCase();
    setReceptor({ cliente_id: c.id, razon_social: c.razon_social, rfc, regimen_fiscal: regimenClave(c.regimen_fiscal) || regimenPorRfc(rfc), codigo_postal: c.codigo_postal ?? "", email: c.email ?? "", uso_cfdi: c.uso_cfdi ?? receptor.uso_cfdi });
  }
  function cambiarConcepto(i: number, cambio: Partial<ConceptoCaptura>) {
    setConceptos((cs) => cs.map((c, j) => (j === i ? { ...c, ...cambio } : c)));
  }

  async function timbrar() {
    if (!d || !receptor) return;
    const problemas = revisarFactura({ receptor, conceptos, forma_pago: formaPago, config: d.config });
    setErrores(problemas);
    if (problemas.length) return;
    if (!window.confirm(`¿Timbrar la factura de ${d.ov.id_ov} por ${dinero(totales.total)} a ${receptor.razon_social} (${receptor.rfc})?${d.config?.entorno === "sandbox" ? "\n\nOJO: la empresa está en SANDBOX (pruebas, sin validez fiscal)." : ""}`)) return;
    setTimbrando(true);
    try {
      const { data: ses } = await supabase.auth.getSession();
      const resp = await fetch(urlFuncion("facturacion-factura-com"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ses.session?.access_token}` },
        body: JSON.stringify({
          accion: "facturar",
          orden_venta_id: ovId,
          cliente_id: receptor.cliente_id,
          receptor: { rfc: receptor.rfc, razon_social: receptor.razon_social, regimen_fiscal: receptor.regimen_fiscal, codigo_postal: receptor.codigo_postal, email: receptor.email, uso_cfdi: receptor.uso_cfdi },
          conceptos: conceptos.map((c) => ({ linea_id: c.linea_id, descripcion: c.descripcion, clave_prod_serv: c.clave_prod_serv.trim(), clave_unidad: c.clave_unidad.trim().toUpperCase(), unidad: nombreUnidadSat(c.clave_unidad), cantidad: c.cantidad, precio: c.precio, iva: c.iva })),
          forma_pago: formaPago,
          metodo_pago: metodo,
          condiciones_pago: condiciones.trim() || null,
          comentarios: comentarios.trim() || null,
          enviar_correo: enviarCorreo,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw await errorDeFuncion(resp, json);
      setResultado(json as Resultado);
      qc.invalidateQueries({ queryKey: ["ov-para-facturar", ovId] });
      qc.invalidateQueries({ queryKey: ["facturas-emitidas"] });
      qc.invalidateQueries({ queryKey: ["ordenes-ia"] });
      onFacturada?.();
    } catch (e) {
      setErrores([(e as Error).message]);
    } finally {
      setTimbrando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-6" onClick={onCerrar}>
      <div className="w-full max-w-5xl rounded-lg border border-slate-200 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Facturar {d?.ov.id_ov ?? "…"}</h2>
            <p className="text-xs text-slate-500">
              {d?.empresa ? `${d.empresa.codigo} · ${d.empresa.razon_social ?? d.empresa.nombre} · RFC ${d.empresa.rfc ?? "—"}` : ""}
              {d?.config ? ` · factura.com ${d.config.entorno === "produccion" ? "PRODUCCIÓN" : "sandbox (pruebas)"}${d.config.serie_nombre ? ` · serie ${d.config.serie_nombre}` : ""}` : ""}
            </p>
          </div>
          <button type="button" onClick={onCerrar} className="text-sm text-slate-500 hover:text-slate-800">
            Cerrar
          </button>
        </div>

        {datos.isLoading && <p className="text-sm text-slate-500">Cargando la orden…</p>}
        {datos.error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{(datos.error as Error).message}</p>}

        {d && d.factura && !resultado && (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Esta orden ya está facturada: <b className="font-mono">{[d.factura.serie, d.factura.folio].filter(Boolean).join(" ") || d.factura.uuid}</b> · {dinero(Number(d.factura.total))} · UUID {d.factura.uuid}
            {d.factura.entorno === "sandbox" ? " · sandbox" : ""}
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <a href={rutaVerArchivo("factura", d.factura.id)} target="_blank" rel="noreferrer" className="rounded border border-emerald-300 bg-white px-2 py-1 text-emerald-800">
                Ver PDF
              </a>
              <a href={rutaVerArchivo("factura", `${d.factura.id}:xml`, { descargar: `${d.factura.uuid}.xml` })} target="_blank" rel="noreferrer" className="rounded border border-emerald-300 bg-white px-2 py-1 text-emerald-800">
                Descargar XML
              </a>
              <Link to="/contabilidad/facturacion" className="rounded border border-emerald-300 bg-white px-2 py-1 text-emerald-800">
                Ir a Facturación (cancelar, reenviar)
              </Link>
            </div>
          </div>
        )}

        {resultado && (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-medium">
              Factura timbrada{resultado.entorno === "sandbox" ? " en sandbox (sin validez fiscal)" : ""}: <span className="font-mono">{[resultado.serie, resultado.folio].filter(Boolean).join(" ")}</span> · {dinero(Number(resultado.total))}
            </p>
            <p className="mt-1 text-xs">UUID {resultado.uuid}. {enviarCorreo && receptor?.email ? `Se envió a ${receptor.email}.` : ""} Ya aparece como CFDI emitido en cuentas por cobrar y conciliación.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={rutaVerArchivo("factura", resultado.factura_id)} target="_blank" rel="noreferrer" className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white">
                Ver PDF
              </a>
              <a href={rutaVerArchivo("factura", `${resultado.factura_id}:xml`, { descargar: `${resultado.uuid}.xml` })} target="_blank" rel="noreferrer" className="rounded border border-emerald-300 bg-white px-3 py-1.5 text-xs text-emerald-800">
                Descargar XML
              </a>
              <button type="button" onClick={onCerrar} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700">
                Cerrar
              </button>
            </div>
          </div>
        )}

        {d && !d.factura && !resultado && receptor && (
          <>
            {d.ov.cancelada && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">La orden está cancelada: no se factura.</p>}
            {d.config && !d.config.con_llaves && (
              <p className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {d.empresa?.codigo} no tiene llaves de factura.com. <Link to="/contabilidad/facturacion" className="underline">Captúralas en Contabilidad › Facturación</Link>.
              </p>
            )}
            {!d.config && (
              <p className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {d.empresa?.codigo} todavía no está conectada a factura.com. <Link to="/contabilidad/facturacion" className="underline">Conéctala en Contabilidad › Facturación</Link>.
              </p>
            )}
            {errores.length > 0 && (
              <ul className="mb-3 list-disc rounded border border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700">
                {errores.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}

            <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Receptor (cliente)</h3>
            <div className="mb-3 grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-6">
              <label className="text-xs text-slate-600 lg:col-span-3">
                Cliente registrado
                <select value={receptor.cliente_id ?? ""} onChange={(e) => elegirCliente(e.target.value)} className={campo}>
                  <option value="">(nuevo: se da de alta con estos datos)</option>
                  {d.clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.razon_social}
                      {c.rfc ? ` · ${c.rfc}` : " · sin RFC"}
                      {c.coincide ? " ✓" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600 lg:col-span-3">
                Razón social (como en la constancia, sin S.A. de C.V.)
                <input value={receptor.razon_social} onChange={(e) => setReceptor({ ...receptor, razon_social: e.target.value })} className={campo} />
              </label>
              <label className="text-xs text-slate-600">
                RFC
                <input value={receptor.rfc} onChange={(e) => setReceptor({ ...receptor, rfc: e.target.value.toUpperCase(), regimen_fiscal: receptor.regimen_fiscal || regimenPorRfc(e.target.value) })} className={`${campo} font-mono uppercase`} maxLength={13} />
              </label>
              <label className="text-xs text-slate-600 lg:col-span-2">
                Régimen fiscal
                <select value={receptor.regimen_fiscal} onChange={(e) => setReceptor({ ...receptor, regimen_fiscal: e.target.value })} className={campo}>
                  <option value="">Elige…</option>
                  {REGIMENES_FISCALES.map((r) => (
                    <option key={r.clave} value={r.clave}>
                      {r.etiqueta}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                C.P. fiscal
                <input value={receptor.codigo_postal} onChange={(e) => setReceptor({ ...receptor, codigo_postal: e.target.value.replace(/\D/g, "").slice(0, 5) })} className={`${campo} font-mono`} maxLength={5} />
              </label>
              <label className="text-xs text-slate-600 lg:col-span-2">
                Uso del CFDI
                <select value={receptor.uso_cfdi} onChange={(e) => setReceptor({ ...receptor, uso_cfdi: e.target.value })} className={campo}>
                  {USOS_CFDI.map((u) => (
                    <option key={u.clave} value={u.clave}>
                      {u.etiqueta}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600 lg:col-span-6">
                Correo (a dónde se envía la factura)
                <input type="email" value={receptor.email} onChange={(e) => setReceptor({ ...receptor, email: e.target.value })} className={campo} placeholder="opcional" />
              </label>
            </div>

            <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Conceptos</h3>
            <div className="mb-3 overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-1">Descripción</th>
                    <th className="px-2 py-1" title="Clave de producto o servicio del SAT (8 dígitos)">Clave SAT *</th>
                    <th className="px-2 py-1" title="Clave de unidad del SAT">Unidad SAT *</th>
                    <th className="px-2 py-1 text-right">Cantidad</th>
                    <th className="px-2 py-1 text-right">Precio s/IVA</th>
                    <th className="px-2 py-1 text-center">IVA</th>
                    <th className="px-2 py-1 text-right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {conceptos.map((c, i) => (
                    <tr key={c.linea_id ?? i} className="border-t border-slate-100">
                      <td className="px-2 py-1">
                        <input value={c.descripcion} onChange={(e) => cambiarConcepto(i, { descripcion: e.target.value })} className={campo} />
                        <div className="text-[10px] text-slate-400">unidad en la OV: {c.unidad || "—"}</div>
                      </td>
                      <td className="px-2 py-1">
                        <input value={c.clave_prod_serv} onChange={(e) => cambiarConcepto(i, { clave_prod_serv: e.target.value.replace(/\D/g, "").slice(0, 8) })} className={`${campo} w-28 font-mono ${/^\d{8}$/.test(c.clave_prod_serv) ? "" : "border-amber-400"}`} placeholder="8 dígitos" />
                      </td>
                      <td className="px-2 py-1">
                        <select value={c.clave_unidad} onChange={(e) => cambiarConcepto(i, { clave_unidad: e.target.value })} className={`${campo} w-40 ${c.clave_unidad ? "" : "border-amber-400"}`}>
                          <option value="">Elige…</option>
                          {UNIDADES_SAT.map((u) => (
                            <option key={u.clave} value={u.clave}>
                              {u.clave} · {u.nombre}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{c.cantidad.toLocaleString("es-MX")}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{dinero(c.precio)}</td>
                      <td className="px-2 py-1 text-center">
                        <input type="checkbox" checked={c.iva} onChange={(e) => cambiarConcepto(i, { iva: e.target.checked })} />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{dinero(Math.round(c.cantidad * c.precio * 100) / 100)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 text-right">
                  <tr>
                    <td colSpan={6} className="px-2 py-1">
                      Subtotal
                    </td>
                    <td className="px-2 py-1 tabular-nums">{dinero(totales.subtotal)}</td>
                  </tr>
                  <tr>
                    <td colSpan={6} className="px-2 py-1">
                      IVA 16 %
                    </td>
                    <td className="px-2 py-1 tabular-nums">{dinero(totales.iva)}</td>
                  </tr>
                  <tr className="font-semibold">
                    <td colSpan={6} className="px-2 py-1">
                      Total
                    </td>
                    <td className="px-2 py-1 tabular-nums">{dinero(totales.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mb-3 text-[11px] text-slate-500">
              Las claves SAT que escribas aquí se recuerdan para la próxima vez que vendas el mismo concepto. Si no hay clave específica, el SAT acepta <b>01010101</b> ("No existe en el catálogo"), pero conviene la correcta (varilla 30102200, cemento 30111601, arena 11111700, flete 78101800…).
            </p>

            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <label className="text-xs text-slate-600 lg:col-span-2">
                Forma de pago
                <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className={campo}>
                  {FORMAS_PAGO_SAT.map((f) => (
                    <option key={f.clave} value={f.clave}>
                      {f.etiqueta}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Método
                <select value={metodo} onChange={(e) => setMetodo(e.target.value as "PUE" | "PPD")} className={campo}>
                  <option value="PUE">PUE · una sola exhibición</option>
                  <option value="PPD">PPD · en parcialidades (crédito)</option>
                </select>
              </label>
              <label className="text-xs text-slate-600 lg:col-span-2">
                Condiciones de pago
                <input value={condiciones} onChange={(e) => setCondiciones(e.target.value)} className={campo} placeholder="Crédito 30 días…" />
              </label>
              <label className="text-xs text-slate-600 lg:col-span-4">
                Comentarios (salen en el PDF)
                <input value={comentarios} onChange={(e) => setComentarios(e.target.value)} className={campo} placeholder={d.ov.proyecto ? `Obra: ${d.ov.proyecto}` : ""} />
              </label>
              <label className="flex items-end gap-2 pb-1 text-xs text-slate-600">
                <input type="checkbox" checked={enviarCorreo} onChange={(e) => setEnviarCorreo(e.target.checked)} /> enviar por correo al cliente
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={timbrar} disabled={timbrando || d.ov.cancelada || !d.config?.con_llaves} className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {timbrando ? "Timbrando…" : `Timbrar factura por ${dinero(totales.total)}`}
              </button>
              <button type="button" onClick={onCerrar} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700">
                Cancelar
              </button>
              {d.config?.entorno === "sandbox" && <span className="text-xs text-amber-700">Sandbox: la factura no tendrá validez fiscal.</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
