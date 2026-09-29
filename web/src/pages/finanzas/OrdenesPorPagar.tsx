import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { ETIQUETA_AUTORIZACION, ETIQUETA_CONDICION, estadoPagoOc, fechaPagoSugerida, montoPagoSugerido, saldoOc, textoVencimiento, vencimientoCredito, type Autorizacion, type CondicionPago } from "../../lib/pagosOc";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";
import { OcPorAutorizar } from "./OcPorAutorizar";
import { DatosBancariosProveedor } from "../../components/DatosBancariosProveedor";

export interface OcPago {
  id: string;
  id_orden: string;
  empresa_id: string;
  proveedor: string | null;
  proyecto: string | null;
  total: number | null;
  fecha_creacion: string | null;
  fuente: string;
  condicion_pago: CondicionPago | null;
  autorizada_en: string | null;
  pagado: number;
  programado: number;
  saldo: number;
  ultimo_pago: string | null;
  proximo_pago: string | null;
  proveedor_clave: string | null;
  linea_credito: number | null;
  dias_credito: number | null;
  credito_vencimiento: string | null;
  autorizacion: Autorizacion;
  vence: string | null;
  es_credito: boolean;
  rechazo_motivo: string | null;
  clave: string | null;
  beneficiario_bancario: string | null;
  banco_proveedor: string | null;
  clabe: string | null;
  cuenta_proveedor: string | null;
  estatus_backoffice: string | null;
  tipo_pago_backoffice: string | null;
  pagada_backoffice: boolean;
}

/** Condición inicial cuando dirección aún no la capturó: lo que dice el
 * backoffice (efectivo) o crédito si el proveedor tiene línea. */
function condicionInicialDe(oc: OcPago): CondicionPago {
  if (oc.condicion_pago) return oc.condicion_pago;
  if ((oc.tipo_pago_backoffice ?? "").toLowerCase().startsWith("efectivo")) return "efectivo";
  return oc.dias_credito != null ? "credito" : "contado";
}

interface Cuenta {
  id: string;
  empresa_id: string;
  banco: string;
  ultimos_4: string;
  alias: string | null;
}

function mensajeError(e: Error): string {
  return /statement timeout/i.test(e.message) ? "El catálogo de OC se está actualizando en este momento; espera un minuto y vuelve a intentar." : e.message;
}

const ESTADO_PAGO: Record<ReturnType<typeof estadoPagoOc>, [string, string]> = {
  pagada: ["pagada", "bg-emerald-100 text-emerald-800"],
  parcial: ["saldo pendiente", "bg-amber-100 text-amber-800"],
  programada: ["pago programado", "bg-blue-100 text-blue-800"],
  sin_programar: ["sin programar", "bg-slate-100 text-slate-600"],
};

/** Órdenes de compra para programar pagos (Laura, 29-sep-2026): las del
 * día y las de meses pasados con saldo. El beneficiario sale de la OC;
 * dirección asigna contado / crédito / anticipo y programa el pago con el
 * saldo calculado (total menos pagos hechos). */
export function OrdenesPorPagar({ filtroEmpresa, hoy, nombreEmpresa, cuentas }: { filtroEmpresa: string; hoy: string; nombreEmpresa: Map<string, string>; cuentas: Cuenta[] }) {
  const [pestana, setPestana] = useState<"autorizar" | "hoy" | "saldo" | "credito">("hoy");
  const [busqueda, setBusqueda] = useState("");
  const [soloConLinea, setSoloConLinea] = useState(false);
  // El backoffice ya registra pagadas las que están en Pendiente Factura /
  // Pendiente Comprobante / Completada: se ocultan de "Con saldo" salvo
  // que se pidan.
  const [verPagadasBackoffice, setVerPagadasBackoffice] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["oc-pagos", pestana, filtroEmpresa, verPagadasBackoffice],
    enabled: pestana !== "autorizar",
    queryFn: async () => {
      let q = supabase.from("v_oc_pagos").select("*");
      if (filtroEmpresa) q = q.eq("empresa_id", filtroEmpresa);
      if (pestana === "hoy") q = q.eq("fecha_creacion", hoy).order("id_orden");
      else if (pestana === "credito") q = q.eq("es_credito", true).gt("saldo", 0.01).neq("autorizacion", "rechazada").eq("pagada_backoffice", false).order("vence", { ascending: true, nullsFirst: false }).limit(400);
      else {
        q = q.gt("saldo", 0.01).neq("autorizacion", "rechazada").order("fecha_creacion", { ascending: false }).limit(400);
        if (!verPagadasBackoffice) q = q.eq("pagada_backoffice", false);
      }
      const { data: filas, error: err } = await q;
      if (err) throw err;
      return (filas ?? []) as OcPago[];
    },
  });

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (data ?? []).filter((o) => (!soloConLinea || o.linea_credito != null) && (!q || (o.proveedor ?? "").toLowerCase().includes(q) || o.id_orden.toLowerCase().includes(q) || (o.proyecto ?? "").toLowerCase().includes(q)));
  }, [data, busqueda, soloConLinea]);

  const totalSaldo = visibles.reduce((s, o) => s + saldoOc(o), 0);

  return (
    <div className="mb-4 rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2">
        <p className="text-sm font-semibold text-slate-700">Órdenes de compra</p>
        <div className="flex rounded border border-slate-200 text-xs">
          {(
            [
              ["autorizar", "Por autorizar"],
              ["hoy", "De hoy"],
              ["saldo", "Con saldo pendiente"],
              ["credito", "Crédito y vencimientos"],
            ] as const
          ).map(([clave, etiqueta]) => (
            <button key={clave} type="button" onClick={() => setPestana(clave)} className={`px-2.5 py-1 ${pestana === clave ? "bg-slate-900 text-white" : "text-slate-600"}`}>
              {etiqueta}
            </button>
          ))}
        </div>
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Proveedor, folio o proyecto…" className="w-52 rounded border border-slate-300 px-2 py-1 text-xs" />
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={soloConLinea} onChange={(e) => setSoloConLinea(e.target.checked)} /> solo proveedores con línea de crédito
        </label>
        {pestana === "saldo" && (
          <label className="flex items-center gap-1 text-xs text-slate-600" title="Pendiente Factura, Pendiente Comprobante o Completada en el backoffice">
            <input type="checkbox" checked={verPagadasBackoffice} onChange={(e) => setVerPagadasBackoffice(e.target.checked)} /> incluir pagadas en el backoffice
          </label>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {visibles.length} órdenes · saldo <b className="tabular-nums">{moneda(totalSaldo)}</b>
        </span>
      </div>
      {pestana === "autorizar" && (
        <div className="p-3">
          <p className="mb-2 text-xs text-slate-500">Las órdenes del backoffice llegan ya autorizadas. Las RQ (almacén) y las de Excel esperan a dirección: mientras no se autoricen no se programa pago.</p>
          <OcPorAutorizar />
          <PendientesBackoffice filtroEmpresa={filtroEmpresa} nombreEmpresa={nombreEmpresa} />
        </div>
      )}
      {pestana !== "autorizar" && isLoading && <p className="px-3 py-3 text-sm text-slate-400">Cargando…</p>}
      {error && <p className="px-3 py-3 text-sm text-red-600">{(error as Error).message}</p>}
      {aviso && <p className={`px-3 py-2 text-xs ${aviso.startsWith("Pago") || aviso.startsWith("Condición") ? "text-emerald-800" : "text-red-700"}`}>{aviso}</p>}
      {pestana !== "autorizar" && !isLoading && visibles.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">{pestana === "hoy" ? "No hay órdenes de compra con fecha de hoy." : pestana === "credito" ? "No hay órdenes a crédito con saldo." : "No hay órdenes con saldo pendiente."}</p>}
      {pestana !== "autorizar" && visibles.length > 0 && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Orden</th>
              <th className="px-3 py-2">Proveedor / beneficiario</th>
              <th className="px-3 py-2">Línea de crédito</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Pagado</th>
              <th className="px-3 py-2 text-right">Saldo</th>
              <th className="px-3 py-2">Condición / vencimiento</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {visibles.map((o) => (
              <FilaOc key={o.id} oc={o} hoy={hoy} empresa={nombreEmpresa.get(o.empresa_id) ?? ""} cuentas={cuentas.filter((c) => c.empresa_id === o.empresa_id)} abierta={abierta === o.id} onAbrir={() => setAbierta(abierta === o.id ? null : o.id)} onAviso={setAviso} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FilaOc({ oc, hoy, empresa, cuentas, abierta, onAbrir, onAviso }: { oc: OcPago; hoy: string; empresa: string; cuentas: Cuenta[]; abierta: boolean; onAbrir: () => void; onAviso: (m: string | null) => void }) {
  const queryClient = useQueryClient();
  // Sin condición capturada: crédito si el proveedor tiene línea, si no contado.
  const condicionInicial: CondicionPago = condicionInicialDe(oc);
  const [condicion, setCondicion] = useState<CondicionPago>(condicionInicial);
  const [monto, setMonto] = useState(String(montoPagoSugerido(condicionInicial, oc)));
  const [fecha, setFecha] = useState(fechaPagoSugerida(condicionInicial, oc, hoy));
  const [cuentaId, setCuentaId] = useState("");
  const [notas, setNotas] = useState("");
  const saldo = saldoOc(oc);
  const [etiqueta, clase] = ESTADO_PAGO[estadoPagoOc(oc)];
  const autorizada = oc.autorizacion === "autorizada";
  const venc = vencimientoCredito(oc.vence, hoy);
  const claseVenc = venc?.estado === "vencida" ? "text-red-700 font-medium" : venc?.estado === "por_vencer" ? "text-amber-700 font-medium" : "text-slate-500";

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["oc-pagos"] });
    queryClient.invalidateQueries({ queryKey: ["pagos-programados"] });
    queryClient.invalidateQueries({ queryKey: ["cxp-proveedores"] });
  };

  const cambiarCondicion = useMutation({
    mutationFn: async (c: CondicionPago) => {
      const { error } = await supabase.rpc("fn_oc_condicion_pago", { p_oc_id: oc.id, p_condicion: c });
      if (error) throw error;
      return c;
    },
    onSuccess: (c) => {
      setCondicion(c);
      setMonto(String(montoPagoSugerido(c, oc)));
      setFecha(fechaPagoSugerida(c, oc, hoy));
      onAviso(`Condición de ${oc.id_orden}: ${ETIQUETA_CONDICION[c].toLowerCase()}.`);
      invalidar();
    },
    onError: (e: Error) => onAviso(mensajeError(e)),
  });

  const programar = useMutation({
    mutationFn: async () => {
      const m = Number(monto);
      if (!(m > 0)) throw new Error("El monto debe ser mayor a 0.");
      const { error } = await supabase.rpc("fn_oc_programar_pago", { p_oc_id: oc.id, p_condicion: condicion, p_monto: m, p_fecha: fecha, p_cuenta_id: cuentaId || null, p_notas: notas.trim() || null });
      if (error) throw error;
      return m;
    },
    onSuccess: (m) => {
      onAviso(`Pago de ${moneda(m)} a ${oc.proveedor ?? "proveedor"} programado para el ${fecha} (${oc.id_orden}).`);
      onAbrir();
      invalidar();
    },
    onError: (e: Error) => onAviso(mensajeError(e)),
  });

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="whitespace-nowrap px-3 py-2">
          <span className="font-mono text-xs font-semibold text-slate-900">{oc.id_orden}</span>
          <div className="text-xs text-slate-400">
            {empresa} · {oc.fecha_creacion ?? ""}
            {oc.fuente !== "api" && <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] uppercase">{oc.fuente === "requisicion" ? "RQ" : oc.fuente}</span>}
          </div>
          {!autorizada && (
            <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] ${oc.autorizacion === "rechazada" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`} title={oc.rechazo_motivo ?? oc.estatus_backoffice ?? ""}>
              {ETIQUETA_AUTORIZACION[oc.autorizacion]}
              {oc.fuente === "api" && " (backoffice)"}
            </span>
          )}
          {oc.pagada_backoffice && (
            <span className="mt-0.5 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800" title={`Backoffice: ${oc.estatus_backoffice}`}>
              pagada en backoffice · {oc.estatus_backoffice?.toLowerCase()}
            </span>
          )}
          {oc.fuente === "api" && !oc.pagada_backoffice && oc.estatus_backoffice && <div className="text-[11px] text-slate-400">backoffice: {oc.estatus_backoffice.toLowerCase()}{oc.tipo_pago_backoffice ? ` · ${oc.tipo_pago_backoffice.toLowerCase()}` : ""}</div>}
        </td>
        <td className="px-3 py-2">
          {oc.proveedor ?? <span className="text-slate-400">sin proveedor</span>}
          {oc.proyecto && <div className="text-xs text-slate-400">{oc.proyecto}</div>}
          <div className="mt-0.5">
            <DatosBancariosProveedor datos={{ clave: oc.clave, nombre: oc.proveedor, beneficiario_bancario: oc.beneficiario_bancario, banco_proveedor: oc.banco_proveedor, clabe: oc.clabe, cuenta_proveedor: oc.cuenta_proveedor }} compacto />
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-slate-600">
          {oc.linea_credito != null ? (
            <>
              {moneda(Number(oc.linea_credito))} · {oc.dias_credito ?? 0} días
              {oc.credito_vencimiento && <div className="text-slate-400">línea vence {oc.credito_vencimiento}</div>}
            </>
          ) : (
            <span className="text-slate-400">sin línea</span>
          )}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{oc.total != null ? moneda(Number(oc.total)) : "—"}</td>
        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{Number(oc.pagado) > 0 ? moneda(Number(oc.pagado)) : "—"}</td>
        <td className="px-3 py-2 text-right">
          <span className="font-medium tabular-nums">{moneda(saldo)}</span>
          <div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${clase}`}>{etiqueta}</span>
          </div>
        </td>
        <td className="px-3 py-2">
          <select value={condicion} onChange={(e) => cambiarCondicion.mutate(e.target.value as CondicionPago)} disabled={cambiarCondicion.isPending} className="rounded border border-slate-300 px-1.5 py-1 text-xs">
            {(Object.keys(ETIQUETA_CONDICION) as CondicionPago[]).map((c) => (
              <option key={c} value={c}>
                {ETIQUETA_CONDICION[c]}
              </option>
            ))}
          </select>
          {oc.vence && (
            <div className={`mt-0.5 text-xs ${claseVenc}`} title={`Fecha de la OC (${oc.fecha_creacion ?? ""}) + ${oc.dias_credito ?? 30} días de crédito${oc.condicion_pago ? "" : " (condición por defecto: crédito)"}`}>
              OC vence {oc.vence} · {textoVencimiento(venc)}
            </div>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <span className="inline-flex gap-1">
            {saldo > 0 && autorizada && (
              <button type="button" onClick={onAbrir} className={`rounded px-2.5 py-1 text-xs font-medium ${abierta ? "bg-slate-900 text-white" : "bg-emerald-700 text-white"}`}>
                {abierta ? "Cerrar" : "Programar pago"}
              </button>
            )}
            {saldo > 0 && !autorizada && <span className="px-1 text-xs text-slate-400" title="Autorízala en la pestaña Por autorizar">{oc.autorizacion === "rechazada" ? "no se paga" : "falta autorizar"}</span>}
            <BotonVerOc ocId={oc.id} />
          </span>
        </td>
      </tr>
      {abierta && (
        <tr>
          <td colSpan={8} className="bg-slate-50 px-3 pb-3 pt-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onAviso(null);
                programar.mutate();
              }}
              className="flex flex-wrap items-end gap-3"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Monto (saldo {moneda(saldo)})</label>
                <input type="number" step="0.01" min="0.01" max={saldo} value={monto} onChange={(e) => setMonto(e.target.value)} className="w-32 rounded border border-slate-300 px-2 py-1 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Pagar el</label>
                <input type="date" value={fecha} min={hoy} onChange={(e) => setFecha(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
              </div>
              <div className={condicion === "efectivo" ? "hidden" : ""}>
                <label className="mb-1 block text-xs font-medium text-slate-600">Cuenta de salida</label>
                <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
                  <option value="">Por definir</option>
                  {cuentas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.banco} {c.ultimos_4}
                      {c.alias ? ` · ${c.alias}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Notas</label>
                <input value={notas} onChange={(e) => setNotas(e.target.value)} className="w-44 rounded border border-slate-300 px-2 py-1 text-sm" />
              </div>
              <button type="submit" disabled={programar.isPending} className="rounded bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                {programar.isPending ? "Guardando…" : `Programar ${ETIQUETA_CONDICION[condicion].toLowerCase()}`}
              </button>
              <span className="text-xs text-slate-400">Beneficiario: {oc.proveedor ?? "—"}. {condicion === "credito" ? `Fecha sugerida = fecha de la OC + ${oc.dias_credito ?? 30} días de crédito.` : condicion === "anticipo" ? "El resto queda como saldo de la orden." : condicion === "efectivo" ? "Se paga en efectivo (caja); no sale de una cuenta bancaria." : ""}</span>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

/** OC que el backoffice tiene en "Pendiente de Autorización": se autorizan
 * allá, no aquí; se listan para que dirección vea el global. */
function PendientesBackoffice({ filtroEmpresa, nombreEmpresa }: { filtroEmpresa: string; nombreEmpresa: Map<string, string> }) {
  const { data } = useQuery({
    queryKey: ["oc-pendientes-backoffice", filtroEmpresa],
    queryFn: async () => {
      let q = supabase.from("v_oc_pagos").select("id, id_orden, empresa_id, proveedor, proyecto, total, fecha_creacion, tipo_pago_backoffice").eq("fuente", "api").eq("estatus_backoffice", "Pendiente de Autorización").order("fecha_creacion", { ascending: false }).limit(200);
      if (filtroEmpresa) q = q.eq("empresa_id", filtroEmpresa);
      const { data: filas, error } = await q;
      if (error) throw error;
      return (filas ?? []) as Pick<OcPago, "id" | "id_orden" | "empresa_id" | "proveedor" | "proyecto" | "total" | "fecha_creacion" | "tipo_pago_backoffice">[];
    },
  });
  if (!data || data.length === 0) return <p className="text-xs text-slate-400">El backoffice no tiene órdenes pendientes de autorización.</p>;
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <p className="mb-1 text-sm font-semibold text-slate-700">
        Pendientes de autorización en el backoffice <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs">{data.length}</span>
      </p>
      <p className="mb-2 text-xs text-slate-500">Se autorizan en el backoffice; aquí solo se ven. En cuanto cambien de estatus allá, la siguiente actualización las mueve a "Con saldo pendiente" ({moneda(data.reduce((s, o) => s + Number(o.total ?? 0), 0))} en total).</p>
      <table className="w-full text-xs">
        <tbody>
          {data.map((o) => (
            <tr key={o.id} className="border-t border-slate-100">
              <td className="whitespace-nowrap py-1 pr-2 font-mono font-semibold text-slate-900">{o.id_orden}</td>
              <td className="py-1 pr-2 text-slate-500">
                {nombreEmpresa.get(o.empresa_id) ?? ""} · {o.fecha_creacion ?? ""}
              </td>
              <td className="py-1 pr-2">
                {o.proveedor ?? "—"}
                {o.proyecto && <span className="text-slate-400"> · {o.proyecto}</span>}
              </td>
              <td className="py-1 pr-2 text-slate-500">{o.tipo_pago_backoffice?.toLowerCase() ?? ""}</td>
              <td className="py-1 text-right tabular-nums">{o.total != null ? moneda(Number(o.total)) : "—"}</td>
              <td className="py-1 pl-2 text-right">
                <BotonVerOc ocId={o.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
