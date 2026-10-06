import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { moneda } from "../../lib/saldosEmpresas";
import { ETIQUETA_AUTORIZACION, ETIQUETA_CONDICION, ETIQUETA_ETAPA_OC, ETIQUETA_ORDEN_OC, PASOS_OC, ordenarOcs, type OrdenOc, estadoPagoOc, etapaOc, porProgramarOc, fechaPagoSugerida, montoPagoSugerido, saldoOc, textoVencimiento, vencimientoCredito, type Autorizacion, type CondicionPago } from "../../lib/pagosOc";
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
  recepcion_estado: "recibida" | "parcial" | "sin_recibir" | "sin_partidas";
  /** Quién autorizó: el backoffice o dirección aquí (interna). */
  autorizacion_origen: "backoffice" | "interna" | null;
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
  // Laura (30-sep-2026): su lista son las pendientes de autorizar; las
  // "Pendiente de Pago" del backoffice solo como indicador.
  const [pestana, setPestana] = useState<"autorizar" | "hoy" | "saldo" | "credito">("autorizar");
  const [verPendientesPago, setVerPendientesPago] = useState(false);
  const [verRechazar, setVerRechazar] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [soloConLinea, setSoloConLinea] = useState(false);
  // El backoffice ya registra pagadas las que están en Pendiente Factura /
  // Pendiente Comprobante / Completada: se ocultan de "Con saldo" salvo
  // que se pidan.
  const [verPagadasBackoffice, setVerPagadasBackoffice] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Selección con suma automática y programación en lote (Laura, 29-sep-2026:
  // "para que no las tenga que ir sumando manual").
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [orden, setOrden] = useState<OrdenOc>("fecha_desc");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["oc-pagos", pestana, filtroEmpresa, verPagadasBackoffice, verPendientesPago],
    queryFn: async () => {
      let q = supabase.from("v_oc_pagos").select("*");
      if (filtroEmpresa) q = q.eq("empresa_id", filtroEmpresa);
      // Pendientes de autorizar (backoffice, RQ, Excel); las del backoffice
      // autorizadas aquí siguen en la lista hasta que se les programa pago.
      if (pestana === "autorizar") q = q.neq("autorizacion", "rechazada").gt("saldo", 0.01).eq("programado", 0).or('autorizacion.eq.pendiente,estatus_backoffice.eq."Pendiente de Autorización"').order("fecha_creacion", { ascending: false, nullsFirst: false }).limit(400);
      else if (pestana === "hoy") q = q.eq("fecha_creacion", hoy);
      else if (pestana === "credito") q = q.eq("es_credito", true).gt("saldo", 0.01).neq("autorizacion", "rechazada").eq("pagada_backoffice", false).order("vence", { ascending: true, nullsFirst: false }).limit(400);
      else {
        q = q.gt("saldo", 0.01).neq("autorizacion", "rechazada").order("fecha_creacion", { ascending: false }).limit(400);
        if (!verPagadasBackoffice) q = q.eq("pagada_backoffice", false);
      }
      // "Pendiente de Pago" del backoffice sin nada programado aquí: solo
      // indicador, salvo que se pidan en la lista.
      if ((pestana === "hoy" || pestana === "saldo") && !verPendientesPago) q = q.or('fuente.neq.api,estatus_backoffice.is.null,estatus_backoffice.neq."Pendiente de Pago",programado.gt.0,pagado.gt.0');
      const { data: filas, error: err } = await q;
      if (err) throw err;
      return (filas ?? []) as OcPago[];
    },
  });

  // Indicadores: cuántas esperan autorización y cuántas están "Pendiente de
  // Pago" en el backoffice (estas últimas no se listan por defecto).
  const { data: indicadores } = useQuery({
    queryKey: ["oc-indicadores", filtroEmpresa],
    queryFn: async () => {
      let q = supabase.from("v_oc_pagos").select("fuente, estatus_backoffice, autorizacion, saldo").gt("saldo", 0.01).neq("autorizacion", "rechazada").or('autorizacion.eq.pendiente,estatus_backoffice.eq."Pendiente de Pago"');
      if (filtroEmpresa) q = q.eq("empresa_id", filtroEmpresa);
      const { data: filas, error: err } = await q.limit(3000);
      if (err) throw err;
      const r = { autorizar: 0, autorizarMonto: 0, pago: 0, pagoMonto: 0 };
      for (const f of (filas ?? []) as { fuente: string; estatus_backoffice: string | null; autorizacion: string; saldo: number }[]) {
        if (f.autorizacion === "pendiente") {
          r.autorizar += 1;
          r.autorizarMonto += Number(f.saldo);
        } else if (f.fuente === "api" && f.estatus_backoffice === "Pendiente de Pago") {
          r.pago += 1;
          r.pagoMonto += Number(f.saldo);
        }
      }
      return r;
    },
  });

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const filtradas = (data ?? []).filter((o) => (!soloConLinea || o.linea_credito != null) && (!q || (o.proveedor ?? "").toLowerCase().includes(q) || o.id_orden.toLowerCase().includes(q) || (o.proyecto ?? "").toLowerCase().includes(q)));
    return ordenarOcs(filtradas, orden);
  }, [data, busqueda, soloConLinea, orden]);

  const totalSaldo = visibles.reduce((s, o) => s + saldoOc(o), 0);
  const seleccionadas = visibles.filter((o) => seleccion.has(o.id));
  const totalSeleccion = seleccionadas.reduce((s, o) => s + saldoOc(o), 0);
  // Las pendientes también: programar su pago las autoriza internamente
  // (Mario, 30-sep-2026: "que no pare el flujo").
  const programables = seleccionadas.filter((o) => o.autorizacion !== "rechazada" && porProgramarOc(o) > 0 && !o.pagada_backoffice);
  // Lo que se pagó y no se marcó en el backoffice (Mario con Laura, 6-oct-2026).
  const confirmables = seleccionadas.filter((o) => o.autorizacion !== "rechazada" && saldoOc(o) > 0.01);
  const [verConfirmar, setVerConfirmar] = useState(false);

  const programarLote = useMutation({
    mutationFn: async () => {
      if (programables.length === 0) throw new Error("Ninguna de las seleccionadas se puede programar (ya programadas, rechazadas, sin saldo o pagadas en el backoffice).");
      if (!window.confirm(`¿Programar a pago ${programables.length} orden(es) por ${moneda(programables.reduce((s, o) => s + porProgramarOc(o), 0))}? Cada una con su condición (crédito si el proveedor tiene línea, efectivo si el backoffice lo dice, si no contado) y la fecha sugerida.`)) return null;
      const errores: string[] = [];
      let n = 0;
      for (const o of programables) {
        const c = condicionInicialDe(o);
        const { error: err } = await supabase.rpc("fn_oc_programar_pago", { p_oc_id: o.id, p_condicion: c, p_monto: porProgramarOc(o), p_fecha: fechaPagoSugerida(c, o, hoy), p_cuenta_id: null, p_notas: null });
        if (err) errores.push(`${o.id_orden}: ${err.message}`);
        else n += 1;
      }
      return { n, errores };
    },
    onSuccess: (r) => {
      if (!r) return;
      setAviso(`Programadas a pago ${r.n} orden(es).${r.errores.length ? ` No se pudieron: ${r.errores.join(" · ")}` : ""}`);
      setSeleccion(new Set());
      for (const k of [["oc-pagos"], ["oc-indicadores"], ["pagos-programados"], ["cxp-proveedores"], ["tesoreria"]]) queryClient.invalidateQueries({ queryKey: k });
    },
    onError: (e: Error) => setAviso(e.message),
  });

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
        {(
          <label className="flex items-center gap-1 text-xs text-slate-600">
            Ordenar por
            <select value={orden} onChange={(e) => setOrden(e.target.value as OrdenOc)} className="rounded border border-slate-300 px-1.5 py-1 text-xs">
              {(Object.keys(ETIQUETA_ORDEN_OC) as OrdenOc[]).map((k) => (
                <option key={k} value={k}>
                  {ETIQUETA_ORDEN_OC[k]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={soloConLinea} onChange={(e) => setSoloConLinea(e.target.checked)} /> solo proveedores con línea de crédito
        </label>
        {(pestana === "hoy" || pestana === "saldo") && (
          <label className="flex items-center gap-1 text-xs text-slate-600" title="Las que el backoffice tiene en Pendiente de Pago y aquí no tienen pago programado">
            <input type="checkbox" checked={verPendientesPago} onChange={(e) => setVerPendientesPago(e.target.checked)} /> incluir pendientes de pago del backoffice
          </label>
        )}
        {pestana === "saldo" && (
          <label className="flex items-center gap-1 text-xs text-slate-600" title="Pendiente Factura, Pendiente Comprobante o Completada en el backoffice">
            <input type="checkbox" checked={verPagadasBackoffice} onChange={(e) => setVerPagadasBackoffice(e.target.checked)} /> incluir pagadas en el backoffice
          </label>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {visibles.length} órdenes · saldo <b className="tabular-nums">{moneda(totalSaldo)}</b>
        </span>
        {seleccionadas.length > 0 && (
          <span className="flex w-full flex-wrap items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-900">
            {seleccionadas.length} seleccionada(s) · suma <b className="tabular-nums">{moneda(totalSeleccion)}</b>
            <button type="button" onClick={() => programarLote.mutate()} disabled={programarLote.isPending || programables.length === 0} className="rounded bg-emerald-700 px-2.5 py-1 font-medium text-white disabled:opacity-50">
              {programarLote.isPending ? "Programando…" : `Programar a pago ${programables.length}`}
            </button>
            <button type="button" onClick={() => setVerConfirmar((v) => !v)} disabled={confirmables.length === 0} className="rounded border border-emerald-700 bg-white px-2.5 py-1 font-medium text-emerald-800 disabled:opacity-50" title="Ya se pagaron (aunque no se marcó en el backoffice): quedan pagadas y confirmadas aquí">
              {`Confirmar pagadas ${confirmables.length}`}
            </button>
            <button type="button" onClick={() => setSeleccion(new Set())} className="underline">
              quitar selección
            </button>
          </span>
        )}
        {verConfirmar && confirmables.length > 0 && (
          <ConfirmarOcPagadas
            ocs={confirmables}
            hoy={hoy}
            onListo={(m) => {
              setAviso(m);
              setVerConfirmar(false);
              setSeleccion(new Set());
              for (const k of [["oc-pagos"], ["oc-indicadores"], ["pagos-programados"], ["cxp-proveedores"], ["tesoreria"], ["confirmar-pagos"]]) queryClient.invalidateQueries({ queryKey: k });
            }}
            onCancelar={() => setVerConfirmar(false)}
          />
        )}
      </div>
      {indicadores && (
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-3 py-2 text-xs">
          <button type="button" onClick={() => setPestana("autorizar")} className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-amber-900">
            Por autorizar: <b>{indicadores.autorizar}</b> · <span className="tabular-nums">{moneda(indicadores.autorizarMonto)}</span>
          </button>
          <span className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700" title="Autorizadas en el backoffice y sin pagar allá. Solo indicador: no se listan salvo que marques 'incluir pendientes de pago del backoffice'.">
            Pendientes de pago (backoffice): <b>{indicadores.pago}</b> · <span className="tabular-nums">{moneda(indicadores.pagoMonto)}</span>
          </span>
        </div>
      )}
      {pestana === "autorizar" && (
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2 text-xs text-slate-500">
          <span>Esperan a dirección: las del backoffice en "Pendiente de Autorización", las RQ (almacén) y las de Excel. "Autorizar" y luego "Programar pago" en el mismo renglón.</span>
          <button type="button" onClick={() => setVerRechazar((v) => !v)} className="underline">
            {verRechazar ? "ocultar rechazar / archivadas" : "rechazar o ver archivadas"}
          </button>
        </div>
      )}
      {pestana === "autorizar" && verRechazar && (
        <div className="p-3">
          <OcPorAutorizar />
        </div>
      )}
      {isLoading && <p className="px-3 py-3 text-sm text-slate-400">Cargando…</p>}
      {error && <p className="px-3 py-3 text-sm text-red-600">{(error as Error).message}</p>}
      {aviso && <p className={`px-3 py-2 text-xs ${aviso.startsWith("Pago") || aviso.startsWith("Condición") || aviso.startsWith("Orden") || aviso.startsWith("Programadas") ? "text-emerald-800" : "text-red-700"}`}>{aviso}</p>}
      {!isLoading && visibles.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-400">{pestana === "autorizar" ? "No hay órdenes por autorizar." : pestana === "hoy" ? "No hay órdenes de compra con fecha de hoy." : pestana === "credito" ? "No hay órdenes a crédito con saldo." : "No hay órdenes con saldo pendiente."}</p>}
      {visibles.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">
                  <input type="checkbox" aria-label="Seleccionar todas" checked={visibles.length > 0 && visibles.every((o) => seleccion.has(o.id))} onChange={(e) => setSeleccion(e.target.checked ? new Set(visibles.map((o) => o.id)) : new Set())} />
                </th>
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
                <FilaOc
                  key={o.id}
                  oc={o}
                  hoy={hoy}
                  empresa={nombreEmpresa.get(o.empresa_id) ?? ""}
                  cuentas={cuentas.filter((c) => c.empresa_id === o.empresa_id)}
                  abierta={abierta === o.id}
                  onAbrir={() => setAbierta(abierta === o.id ? null : o.id)}
                  onAviso={setAviso}
                  seleccionada={seleccion.has(o.id)}
                  onSeleccionar={(v) =>
                    setSeleccion((prev) => {
                      const n = new Set(prev);
                      if (v) n.add(o.id);
                      else n.delete(o.id);
                      return n;
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilaOc({ oc, hoy, empresa, cuentas, abierta, onAbrir, onAviso, seleccionada, onSeleccionar }: { oc: OcPago; hoy: string; empresa: string; cuentas: Cuenta[]; abierta: boolean; onAbrir: () => void; onAviso: (m: string | null) => void; seleccionada: boolean; onSeleccionar: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  // Sin condición capturada: crédito si el proveedor tiene línea, si no contado.
  const condicionInicial: CondicionPago = condicionInicialDe(oc);
  const [condicion, setCondicion] = useState<CondicionPago>(condicionInicial);
  const [monto, setMonto] = useState(String(montoPagoSugerido(condicionInicial, oc)));
  const [fecha, setFecha] = useState(fechaPagoSugerida(condicionInicial, oc, hoy));
  const [cuentaId, setCuentaId] = useState("");
  const [notas, setNotas] = useState("");
  const saldo = saldoOc(oc);
  // Autorizar desde la lista (Laura, 30-sep-2026); rechazar sigue en "Por autorizar".
  const autorizar = useMutation({
    mutationFn: async () => {
      const f = new Date();
      f.setDate(f.getDate() + 7);
      const { error: err } = await supabase.rpc("fn_oc_autorizar", { p_oc_id: oc.id, p_autorizar: true, p_motivo: null, p_fecha_pago: f.toISOString().slice(0, 10), p_cuenta_id: null });
      if (err) throw err;
    },
    onSuccess: () => {
      onAviso(`Orden ${oc.id_orden} autorizada; ya se le puede programar pago.`);
      for (const k of [["oc-pagos"], ["oc-indicadores"], ["oc-por-autorizar"], ["pagos-programados"], ["cxp-proveedores"]]) queryClient.invalidateQueries({ queryKey: k });
    },
    onError: (e: Error) => onAviso(e.message),
  });
  const [etiqueta, clase] = ESTADO_PAGO[estadoPagoOc(oc)];
  const etapa = etapaOc(oc);
  const pasoActual = PASOS_OC.indexOf(etapa);
  const autorizada = oc.autorizacion === "autorizada";
  const venc = vencimientoCredito(oc.vence, hoy);
  const claseVenc = venc?.estado === "vencida" ? "text-red-700 font-medium" : venc?.estado === "por_vencer" ? "text-amber-700 font-medium" : "text-slate-500";

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["oc-pagos"] });
    queryClient.invalidateQueries({ queryKey: ["oc-indicadores"] });
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
        <td className="px-2 py-2 align-top">
          <input type="checkbox" checked={seleccionada} onChange={(e) => onSeleccionar(e.target.checked)} aria-label={`Seleccionar ${oc.id_orden}`} />
        </td>
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
          {oc.autorizacion_origen === "interna" && (
            <span className="mt-0.5 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[11px] text-violet-800" title={oc.fuente === "api" ? `Autorizada aquí por dirección; en el backoffice: ${oc.estatus_backoffice ?? "sin estatus"}` : "Autorizada aquí por dirección"}>
              autorizada interna{oc.fuente === "api" && oc.estatus_backoffice === "Pendiente de Autorización" ? " · backoffice pendiente" : ""}
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
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${clase}`} title={ETIQUETA_ETAPA_OC[etapa]}>
              {etapa === "programada" ? "programado a pago" : etapa === "recibida" ? "recibida" : etapa === "pagada" ? (oc.recepcion_estado === "parcial" ? "pagada · recepción parcial" : "pagada · por recibir") : etiqueta}
            </span>
            <div className="mt-0.5 flex gap-0.5" aria-hidden="true">
              {PASOS_OC.map((p, i) => (
                <span key={p} className={`h-1 w-4 rounded-sm ${etapa !== "rechazada" && i <= pasoActual ? "bg-emerald-500" : "bg-slate-200"}`} title={ETIQUETA_ETAPA_OC[p]} />
              ))}
            </div>
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
        {/* Botones uno debajo de otro para que no se salgan de la pantalla
            en laptops (Mario, 30-sep-2026). */}
        <td className="px-3 py-2 text-right align-top">
          <div className="flex flex-col items-end gap-1">
            {saldo > 0 && oc.autorizacion !== "rechazada" && porProgramarOc(oc) <= 0 && !abierta && (
              <span className="whitespace-nowrap text-xs text-blue-800" title="Ya tiene programado todo su saldo; se paga desde Tesorería">
                ya programada · {moneda(Number(oc.programado))}
              </span>
            )}
            {saldo > 0 && oc.autorizacion !== "rechazada" && (porProgramarOc(oc) > 0 || abierta) && (
              <button type="button" onClick={onAbrir} className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium ${abierta ? "bg-slate-900 text-white" : "bg-emerald-700 text-white"}`} title={autorizada ? undefined : "Al programar el pago queda autorizada internamente"}>
                {abierta ? "Cerrar" : autorizada ? "Programar pago" : "Autorizar y programar"}
              </button>
            )}
            {saldo > 0 && oc.autorizacion === "pendiente" && (
              <button type="button" onClick={() => autorizar.mutate()} disabled={autorizar.isPending} className="whitespace-nowrap text-xs text-emerald-800 underline disabled:opacity-50" title="Autoriza la orden sin programar el pago todavía">
                {autorizar.isPending ? "Autorizando…" : "solo autorizar"}
              </button>
            )}
            {saldo > 0 && oc.autorizacion === "rechazada" && <span className="text-xs text-slate-400">no se paga</span>}
            <BotonVerOc ocId={oc.id} />
          </div>
        </td>
      </tr>
      {abierta && (
        <tr>
          <td colSpan={9} className="bg-slate-50 px-3 pb-3 pt-2">
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


/** Confirma como pagadas varias OC de una vez (lo pagado que no se marcó en el
 * backoffice): fecha, método, referencia y UN comprobante para todas.
 * fn_oc_confirmar_pagadas deja pagado y confirmado lo que falte de cada una;
 * después el archivo se liga a todos esos pagos (edge pagos-comprobante). */
function ConfirmarOcPagadas({ ocs, hoy, onListo, onCancelar }: { ocs: OcPago[]; hoy: string; onListo: (mensaje: string) => void; onCancelar: () => void }) {
  const [fecha, setFecha] = useState(hoy);
  const [metodo, setMetodo] = useState<"transferencia" | "efectivo" | "cheque">("transferencia");
  const [referencia, setReferencia] = useState("");
  const [error, setError] = useState<string | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const suma = ocs.reduce((s, o) => s + saldoOc(o), 0);

  const confirmar = useMutation({
    mutationFn: async () => {
      const { data: ids, error: err } = await supabase.rpc("fn_oc_confirmar_pagadas", { p_ocs: ocs.map((o) => o.id), p_fecha: fecha, p_metodo: metodo, p_referencia: referencia.trim() || null, p_cuenta_id: null });
      if (err) throw err;
      const pagos = (ids ?? []) as string[];
      const archivo = archivoRef.current?.files?.[0];
      if (archivo && pagos.length > 0) {
        const form = new FormData();
        form.set("pagoIds", pagos.join(","));
        form.set("file", archivo);
        const { data: sesion } = await supabase.auth.getSession();
        const r = await fetch(urlFuncion("pagos-comprobante"), { method: "POST", headers: { Authorization: `Bearer ${sesion.session?.access_token ?? ""}` }, body: form });
        const json = await r.json().catch(() => null);
        if (!r.ok) throw new Error(`Quedaron pagadas, pero el comprobante no se subió: ${(await errorDeFuncion(r, json)).message}`);
      }
      return `${ocs.length} orden(es) confirmadas como pagadas · ${moneda(suma)}${archivo ? " · con el mismo comprobante" : ""}.`;
    },
    onSuccess: onListo,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded border border-emerald-300 bg-white p-2 text-xs">
      <p className="w-full text-slate-600">
        Confirmar como <b>pagadas</b> {ocs.map((o) => o.id_orden).join(", ")} por <b className="tabular-nums">{moneda(suma)}</b>. Lo programado pendiente pasa a pagado y lo que falte se registra pagado; todo queda confirmado a tu nombre.
      </p>
      <label>
        Fecha de pago
        <input type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} className="ml-1 rounded border border-slate-300 px-1.5 py-1" />
      </label>
      <label>
        Método
        <select value={metodo} onChange={(e) => setMetodo(e.target.value as typeof metodo)} className="ml-1 rounded border border-slate-300 px-1.5 py-1">
          <option value="transferencia">Transferencia</option>
          <option value="efectivo">Efectivo</option>
          <option value="cheque">Cheque</option>
        </select>
      </label>
      <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Referencia (opcional)" className="rounded border border-slate-300 px-1.5 py-1" />
      <label>
        Comprobante (uno para todas, opcional){" "}
        <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" />
      </label>
      <button
        type="button"
        disabled={confirmar.isPending}
        onClick={() => {
          setError(null);
          confirmar.mutate();
        }}
        className="rounded bg-emerald-700 px-3 py-1 font-medium text-white disabled:opacity-50"
      >
        {confirmar.isPending ? "Confirmando…" : `Confirmar ${ocs.length} pagadas`}
      </button>
      <button type="button" onClick={onCancelar} className="underline">
        cancelar
      </button>
      {error && <p className="w-full text-red-700">{error}</p>}
    </div>
  );
}
