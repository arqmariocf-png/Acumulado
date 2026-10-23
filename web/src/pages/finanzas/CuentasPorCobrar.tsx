import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useEmpresasAlcance } from "../../components/SelectorEmpresa";
import {
  RANGOS,
  TIPOS_GESTION,
  agendaCobranza,
  antiguedadPorCliente,
  aplicarCobro,
  cobranzaEsperada,
  cuadreEntreEmpresas,
  docDesdeOv,
  estatusDocumento,
  filtrarClientes,
  filtrarOvPendientes,
  sumaOv,
  indicadores,
  revisarDocumento,
  textoGestion,
  totalesAntiguedad,
  type ClienteCxc,
  type DocumentoCxc,
  type FiltroClientes,
  type GestionCxc,
  type OvPendiente,
  type ParEntreEmpresas,
} from "../../lib/cuentasPorCobrar";

// Cuentas por cobrar (23-oct-2026, Laura con el diseño Comercial / Cobranza).
// Cartera (antigüedad por cliente, cobranza esperada, documentos del cliente),
// Registrar cobro (se aplica a lo más vencido; el depósito del banco queda
// conciliado), Agenda de cobranza (vencidos por urgencia, gestiones con
// promesa) y Entre empresas (lo vendido contra lo que la otra registró como
// OC). Todo sale de fn_cxc_cartera(): facturas PPD del SAT con sus
// complementos y las estimaciones capturadas con su retenido.

type Vista = "cartera" | "cobro" | "agenda" | "entre";
const VISTAS: { clave: Vista; titulo: string }[] = [
  { clave: "cartera", titulo: "Cartera" },
  { clave: "cobro", titulo: "Registrar cobro" },
  { clave: "agenda", titulo: "Agenda de cobranza" },
  { clave: "entre", titulo: "Entre empresas" },
];

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "text-xs text-slate-600";
const tarjeta = "rounded-xl border border-slate-200 bg-white";
const btnPrimario = "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50";
const btnSecundario = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800";

function dinero(n: number | null | undefined, decimales = 0): string {
  return Number(n ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}
function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}
function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const num = (v: string) => Number(String(v).replace(/[$,\s]/g, "")) || 0;

interface Cartera {
  hoy: string;
  documentos: DocumentoCxc[];
  clientes: ClienteCxc[];
}

export function CuentasPorCobrar() {
  const { perfil, soloConsulta } = useAuth();
  const [params, setParams] = useSearchParams();
  const vista = (VISTAS.some((v) => v.clave === params.get("vista")) ? params.get("vista") : "cartera") as Vista;
  const clienteParam = params.get("cliente");
  const puedeOperar = !soloConsulta && !!perfil && ["admin", "direccion", "corporativo"].includes(perfil.rol);

  const { data: cartera, isLoading, error } = useQuery({
    queryKey: ["cxc-cartera"],
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc("fn_cxc_cartera");
      if (e) throw e;
      return data as Cartera;
    },
  });
  const { data: gestiones } = useQuery({
    queryKey: ["cxc-gestiones"],
    queryFn: async () => {
      const { data, error: e } = await supabase.from("cxc_gestiones").select("*").order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
      if (e) throw e;
      return (data ?? []) as GestionCxc[];
    },
  });

  function irA(v: Vista, cliente?: string | null) {
    const p = new URLSearchParams(params);
    p.set("vista", v);
    if (cliente) p.set("cliente", cliente);
    else p.delete("cliente");
    setParams(p, { replace: true });
  }

  const hoy = cartera?.hoy ?? hoyIso();
  const docs = cartera?.documentos ?? [];
  const clientes = cartera?.clientes ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">Comercial / Cobranza / Cuentas por cobrar</p>
          <h1 className="text-2xl font-bold text-slate-900">Cuentas por cobrar</h1>
          <p className="text-sm text-slate-600">Facturas y estimaciones por cobrar, su antigüedad, los cobros y el seguimiento de cada cliente.</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
          {VISTAS.map((v) => (
            <button key={v.clave} type="button" onClick={() => irA(v.clave)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${vista === v.clave ? "bg-white text-slate-900 shadow" : "text-slate-600"}`}>
              {v.titulo}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-slate-500">Cargando cartera…</p>}
      {cartera && vista === "cartera" && <VistaCartera docs={docs} clientes={clientes} gestiones={gestiones ?? []} hoy={hoy} clienteParam={clienteParam} irA={irA} puedeOperar={puedeOperar} />}
      {cartera && vista === "cobro" && <VistaCobro docs={docs} clientes={clientes} hoy={hoy} clienteParam={clienteParam} puedeOperar={puedeOperar} />}
      {cartera && vista === "agenda" && <VistaAgenda docs={docs} clientes={clientes} gestiones={gestiones ?? []} hoy={hoy} clienteParam={clienteParam} irA={irA} puedeOperar={puedeOperar} />}
      {vista === "entre" && <VistaEntreEmpresas />}
      <p className="mt-6 border-t border-slate-200 pt-3 text-xs text-slate-500">
        Saldo exigible = total − cobrado − retenido. Vencido = saldo exigible cuya fecha de vencimiento ya pasó. Días promedio de cobro = antigüedad promedio de la cartera, ponderada por saldo. Las facturas PPD salen del SAT con sus complementos de
        pago; las estimaciones y lo que no lleva CFDI se capturan en Registrar cobro › Documentos.
      </p>
    </div>
  );
}

// ---------- Cartera ----------

function VistaCartera({
  docs, clientes, gestiones, hoy, clienteParam, irA, puedeOperar,
}: { docs: DocumentoCxc[]; clientes: ClienteCxc[]; gestiones: GestionCxc[]; hoy: string; clienteParam: string | null; irA: (v: Vista, c?: string | null) => void; puedeOperar: boolean }) {
  const [filtro, setFiltro] = useState<FiltroClientes>("externos");
  const filtrados = useMemo(() => filtrarClientes(docs, filtro), [docs, filtro]);
  const ind = useMemo(() => indicadores(docs, hoy, filtro), [docs, hoy, filtro]);
  const filas = useMemo(() => antiguedadPorCliente(filtrados, clientes, hoy), [filtrados, clientes, hoy]);
  const totales = useMemo(() => totalesAntiguedad(filas), [filas]);
  const semanas = useMemo(() => cobranzaEsperada(filtrados, gestiones, hoy, 8), [filtrados, gestiones, hoy]);
  const maxSemana = Math.max(...semanas.map((s) => s.monto), 1);
  const elegido = clienteParam ? filas.find((f) => f.cliente_clave === clienteParam) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-600">Clientes:</span>
        {([["externos", "Externos"], ["grupo", "Empresas del grupo"], ["todos", "Todos"]] as [FiltroClientes, string][]).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} className={`rounded-full border px-3 py-1 font-semibold ${filtro === k ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tarjeta titulo="Cartera por cobrar" valor={dinero(ind.cartera)} nota={`${ind.documentos} documentos${ind.entreEmpresas > 0 ? ` · sin contar ${dinero(ind.entreEmpresas)} entre empresas` : ""}`} />
        <Tarjeta titulo="Vencida" valor={dinero(ind.vencida)} nota={`${ind.pctVencida}% de la cartera`} rojo={ind.vencida > 0} />
        <Tarjeta titulo="Vence en 30 días" valor={dinero(ind.vence30)} nota="Aún al corriente" />
        <Tarjeta titulo="Días promedio de cobro" valor={`${ind.diasPromedio} días`} nota="Desde la fecha de factura, ponderado por saldo" />
        <Tarjeta titulo="Fondos de garantía retenidos" valor={dinero(ind.retenido)} nota="Se cobran al finiquito de la obra" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <section className={`${tarjeta} p-4`}>
          <h2 className="text-lg font-semibold text-slate-900">Antigüedad de saldos por cliente</h2>
          <p className="mb-2 text-xs text-slate-600">Días contados desde el vencimiento (fecha de factura más días de crédito). Clic en un cliente para ver sus documentos.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="px-2 py-1">Cliente</th>
                  {RANGOS.map((r) => <th key={r.clave} className="px-2 py-1 text-right">{r.etiqueta}</th>)}
                  <th className="px-2 py-1 text-right">Total</th>
                  <th className="px-2 py-1">Línea de crédito</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.cliente_clave} className={`border-t border-slate-100 ${elegido?.cliente_clave === f.cliente_clave ? "bg-slate-50" : ""}`}>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => irA("cartera", f.cliente_clave)} className="text-left font-semibold text-slate-900 underline decoration-slate-300">
                        {f.cliente}
                      </button>
                      <div className="text-xs text-slate-500">
                        {f.empresas.join(", ")} · {f.dias_credito ?? 30} días de crédito{f.cliente_empresa ? " · empresa del grupo" : ""}
                      </div>
                    </td>
                    {RANGOS.map((r) => (
                      <td key={r.clave} className={`px-2 py-2 text-right tabular-nums ${r.clave === "corriente" ? "text-slate-700" : f.rangos[r.clave] > 0 ? "text-red-700" : "text-slate-400"}`}>
                        {f.rangos[r.clave] > 0 ? dinero(f.rangos[r.clave]) : "—"}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{dinero(f.total)}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">
                      {f.linea_credito ? `${Math.round((f.total / f.linea_credito) * 100)}% de ${dinero(f.linea_credito)}` : "Sin línea autorizada"}
                    </td>
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr><td colSpan={8} className="px-2 py-4 text-center text-slate-500">Nada por cobrar con este filtro.</td></tr>
                )}
              </tbody>
              {filas.length > 0 && (
                <tfoot className="border-t border-slate-300 font-semibold">
                  <tr>
                    <td className="px-2 py-2">Total</td>
                    {RANGOS.map((r) => <td key={r.clave} className="px-2 py-2 text-right tabular-nums">{dinero(totales[r.clave])}</td>)}
                    <td className="px-2 py-2 text-right tabular-nums">{dinero(totales.total)}</td>
                    <td />
                  </tr>
                  <tr className="text-xs font-normal text-slate-500">
                    <td className="px-2 py-1">% del total</td>
                    {RANGOS.map((r) => <td key={r.clave} className="px-2 py-1 text-right">{totales.total > 0 ? Math.round((totales[r.clave] / totales.total) * 100) : 0}%</td>)}
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
        <section className={`${tarjeta} p-4`}>
          <h2 className="text-lg font-semibold text-slate-900">Cobranza esperada · 8 semanas</h2>
          <p className="mb-3 text-xs text-slate-600">Por fecha de vencimiento y promesas de pago. Alimenta el flujo de efectivo.</p>
          <div className="space-y-2">
            {semanas.map((s) => (
              <div key={s.clave} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-xs">
                <span className={s.vencido ? "font-semibold text-red-700" : "text-slate-700"}>{s.etiqueta}</span>
                <div className="h-3 rounded bg-slate-100">
                  <div className={`h-3 rounded ${s.vencido ? "bg-red-600" : "bg-slate-700"}`} style={{ width: `${Math.round((s.monto / maxSemana) * 100)}%` }} />
                </div>
                <span className="tabular-nums font-semibold text-slate-900">{dinero(s.monto)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      {elegido && (
        <DocumentosCliente
          clave={elegido.cliente_clave}
          nombre={elegido.cliente}
          docs={docs.filter((d) => d.cliente_clave === elegido.cliente_clave)}
          cliente={clientes.find((c) => c.clave === elegido.cliente_clave) ?? null}
          hoy={hoy}
          puedeOperar={puedeOperar}
          irA={irA}
          cerrar={() => irA("cartera")}
        />
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, nota, rojo = false }: { titulo: string; valor: string; nota: string; rojo?: boolean }) {
  return (
    <div className={`${tarjeta} p-4`}>
      <p className="text-xs text-slate-600">{titulo}</p>
      <p className={`text-2xl font-bold ${rojo ? "text-red-700" : "text-slate-900"}`}>{valor}</p>
      <p className="text-xs text-slate-500">{nota}</p>
    </div>
  );
}

function DocumentosCliente({
  clave, nombre, docs, cliente, hoy, puedeOperar, irA, cerrar,
}: { clave: string; nombre: string; docs: DocumentoCxc[]; cliente: ClienteCxc | null; hoy: string; puedeOperar: boolean; irA: (v: Vista, c?: string | null) => void; cerrar: () => void }) {
  const qc = useQueryClient();
  const [editar, setEditar] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const guardar = useMutation({
    mutationFn: async (fila: Partial<ClienteCxc>) => {
      const { error } = await supabase.from("cxc_clientes").upsert({ ...fila, clave, nombre: fila.nombre || nombre, rfc: docs[0]?.rfc ?? cliente?.rfc ?? null }, { onConflict: "grupo_id,clave" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cxc-cartera"] });
      setEditar(false);
    },
    onError: (e) => setErr((e as Error).message),
  });
  const orden = [...docs].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  return (
    <section className={`${tarjeta} p-4`} id="documentos">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documentos por cobrar</p>
          <h2 className="text-lg font-semibold text-slate-900">{nombre}</h2>
          <p className="text-xs text-slate-600">
            {[cliente?.area, cliente?.responsable ? `responsable: ${cliente.responsable}` : null, `${cliente?.dias_credito ?? 30} días de crédito`, cliente?.linea_credito ? `línea ${dinero(cliente.linea_credito)}` : null].filter(Boolean).join(" · ")}
            {puedeOperar && (
              <button type="button" onClick={() => setEditar((v) => !v)} className="ml-2 text-sky-700 underline">
                {editar ? "cerrar" : "datos del cliente"}
              </button>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {puedeOperar && <button type="button" onClick={() => irA("cobro", clave)} className={btnPrimario}>Registrar cobro</button>}
          {puedeOperar && <button type="button" onClick={() => irA("agenda", clave)} className={btnSecundario}>Registrar gestión</button>}
          <button type="button" onClick={cerrar} className="text-xs text-slate-500 underline">cerrar</button>
        </div>
      </div>
      {editar && (
        <form
          className="mb-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3 lg:grid-cols-6"
          data-sin-borrador
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setErr(null);
            guardar.mutate({
              nombre: String(fd.get("nombre") ?? "").trim(),
              dias_credito: Math.max(0, Math.min(365, Math.round(num(String(fd.get("dias_credito") ?? "30"))))),
              linea_credito: num(String(fd.get("linea_credito") ?? "")) || null,
              area: String(fd.get("area") ?? "").trim() || null,
              responsable: String(fd.get("responsable") ?? "").trim() || null,
              pue_a_credito: fd.get("pue_a_credito") === "on",
            });
          }}
        >
          <label className={`${etiqueta} sm:col-span-2`}>Nombre para cobranza<input name="nombre" defaultValue={cliente?.nombre ?? nombre} className={campo} /></label>
          <label className={etiqueta}>Días de crédito<input name="dias_credito" inputMode="numeric" defaultValue={cliente?.dias_credito ?? 30} className={campo} /></label>
          <label className={etiqueta}>Línea de crédito<input name="linea_credito" inputMode="decimal" defaultValue={cliente?.linea_credito ?? ""} className={campo} /></label>
          <label className={etiqueta}>Área / contacto<input name="area" defaultValue={cliente?.area ?? ""} placeholder="Área de estimaciones" className={campo} /></label>
          <label className={etiqueta}>Responsable de cobrar<input name="responsable" defaultValue={cliente?.responsable ?? ""} placeholder="Cobranza CSC" className={campo} /></label>
          <label className="flex items-center gap-2 text-xs text-slate-700 sm:col-span-3">
            <input type="checkbox" name="pue_a_credito" defaultChecked={cliente?.pue_a_credito ?? false} /> También cuentan sus facturas PUE (le damos crédito aunque la factura diga pago en una sola exhibición)
          </label>
          <div className="flex items-center gap-2 sm:col-span-3">
            <button type="submit" disabled={guardar.isPending} className={btnPrimario}>Guardar</button>
            {err && <span className="text-xs text-red-700">{err}</span>}
          </div>
        </form>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="px-2 py-1">Documento</th>
              <th className="px-2 py-1">Empresa · obra</th>
              <th className="px-2 py-1">Fecha</th>
              <th className="px-2 py-1">Vence</th>
              <th className="px-2 py-1 text-right">Total</th>
              <th className="px-2 py-1 text-right">Cobrado</th>
              <th className="px-2 py-1 text-right">Retenido</th>
              <th className="px-2 py-1 text-right">Saldo exigible</th>
              <th className="px-2 py-1">Estatus</th>
            </tr>
          </thead>
          <tbody>
            {orden.map((d) => {
              const st = estatusDocumento(d, hoy);
              return (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="px-2 py-2 font-semibold text-slate-900" title={d.uuid ?? undefined}>
                    {d.origen === "cfdi" ? `Factura ${d.folio.slice(0, 8)}…` : d.folio}
                    {d.origen === "cfdi" && <span className="ml-1 text-[10px] font-normal text-slate-400">SAT</span>}
                  </td>
                  <td className="px-2 py-2 text-slate-700">
                    {d.empresa}
                    {d.obra && <div className="text-xs text-slate-500">{d.obra}</div>}
                  </td>
                  <td className="px-2 py-2">{fechaCorta(d.fecha)}</td>
                  <td className="px-2 py-2">{fechaCorta(d.vence)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{dinero(d.total)}</td>
                  <td className="px-2 py-2 text-right tabular-nums" title={`SAT ${dinero(d.cobrado_sat)} · banco ${dinero(d.cobrado_banco)} · aquí ${dinero(d.cobrado_aqui)}`}>{dinero(d.cobrado)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-500">{dinero(d.retenido)}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums">{dinero(d.saldo)}</td>
                  <td className="px-2 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.clave === "cobrado" ? "bg-emerald-50 text-emerald-700" : st.clave === "vencido" ? "bg-orange-50 text-orange-700" : "bg-slate-100 text-slate-700"}`}>{st.texto}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">Retenido = fondo de garantía de estimaciones; se vuelve exigible al finiquito de la obra. Cobrado = lo que el SAT ya tiene en complementos de pago o, si es mayor, lo registrado aquí más los depósitos conciliados.</p>
    </section>
  );
}

// ---------- Registrar cobro ----------

interface Cuenta { id: string; banco: string; ultimos_4: string; alias: string | null }
interface Abono { id: string; fecha_pago: string; abono_total: number; nombre_razon_social: string | null; referencia_numero: string | null; comentarios: string | null }
interface Cobro { id: string; empresa_id: string; cliente_nombre: string; tipo: string; fecha: string; monto: number; referencia: string | null; created_by_nombre: string | null; cancelado_en: string | null; cancelado_motivo: string | null }

function VistaCobro({ docs, clientes, hoy, clienteParam, puedeOperar }: { docs: DocumentoCxc[]; clientes: ClienteCxc[]; hoy: string; clienteParam: string | null; puedeOperar: boolean }) {
  const qc = useQueryClient();
  const { data: empresas } = useEmpresasAlcance();
  const vivos = useMemo(() => docs.filter((d) => d.saldo > 0.5), [docs]);
  // Órdenes de venta pendientes de pago (Mario, 23-oct-2026): se eligen y el
  // cobro se liga y aplica solo a ellas.
  const { data: ovs } = useQuery({
    queryKey: ["cxc-ov-pendientes"],
    enabled: puedeOperar,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_cxc_ov_pendientes");
      if (error) throw error;
      return ((data ?? []) as OvPendiente[]).map((o) => ({ ...o, total: Number(o.total), cobrado: Number(o.cobrado), saldo: Number(o.saldo) }));
    },
  });
  const opcionesCliente = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of vivos) if (!m.has(d.cliente_clave)) m.set(d.cliente_clave, clientes.find((c) => c.clave === d.cliente_clave)?.nombre ?? d.cliente);
    for (const o of ovs ?? []) if (!m.has(o.cliente_clave)) m.set(o.cliente_clave, clientes.find((c) => c.clave === o.cliente_clave)?.nombre ?? o.cliente);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [vivos, ovs, clientes]);
  const [clave, setClave] = useState(clienteParam ?? "");
  useEffect(() => { if (clienteParam) setClave(clienteParam); }, [clienteParam]);
  const empresasCliente = useMemo(
    () => [...new Set([...vivos.filter((d) => d.cliente_clave === clave).map((d) => d.empresa_id), ...(ovs ?? []).filter((o) => o.cliente_clave === clave).map((o) => o.empresa_id)])],
    [vivos, ovs, clave],
  );
  const [empresaId, setEmpresaId] = useState("");
  useEffect(() => { setEmpresaId(empresasCliente[0] ?? ""); }, [empresasCliente]);
  const delCliente = useMemo(() => vivos.filter((d) => d.cliente_clave === clave && d.empresa_id === empresaId), [vivos, clave, empresaId]);
  const saldoTotal = delCliente.reduce((s, d) => s + d.saldo, 0);
  const [ovSel, setOvSel] = useState<string[]>([]);
  const [verTodasOv, setVerTodasOv] = useState(false);
  const [buscarOv, setBuscarOv] = useState("");
  useEffect(() => { setOvSel([]); setVerTodasOv(false); }, [empresaId, clave]);
  const ovsEmpresa = useMemo(() => (ovs ?? []).filter((o) => o.empresa_id === empresaId), [ovs, empresaId]);
  const ovsLista = useMemo(() => filtrarOvPendientes(ovs ?? [], { empresaId: empresaId || null, clienteClave: clave || null, todas: verTodasOv, texto: buscarOv }), [ovs, empresaId, clave, verTodasOv, buscarOv]);
  const ovsElegidas = useMemo(() => (ovs ?? []).filter((o) => ovSel.includes(o.id)), [ovs, ovSel]);
  const sumaElegidas = sumaOv(ovs ?? [], ovSel);
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [cuentaId, setCuentaId] = useState("");
  const [referencia, setReferencia] = useState("");
  const [movimientoId, setMovimientoId] = useState("");
  const [notas, setNotas] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // Con OV elegidas el depósito se aplica SOLO a ellas; si no, a las facturas más vencidas.
  const aplicacion = useMemo(() => aplicarCobro(ovsElegidas.length > 0 ? ovsElegidas.map((o) => docDesdeOv(o, hoy)) : delCliente, num(monto)), [ovsElegidas, delCliente, monto, hoy]);

  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-bancarias", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("cuentas_bancarias").select("id, banco, ultimos_4, alias").eq("empresa_id", empresaId).eq("activo", true);
      if (error) throw error;
      return (data ?? []) as Cuenta[];
    },
  });
  const { data: abonos } = useQuery({
    queryKey: ["cxc-abonos", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movimientos")
        .select("id, fecha_pago, abono_total, nombre_razon_social, referencia_numero, comentarios")
        .eq("empresa_id", empresaId)
        .gt("abono_total", 0)
        .in("estado_clasificacion", ["revision", "ambiguo", "pendiente_esperado"])
        .order("fecha_pago", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Abono[];
    },
  });
  const { data: cobros } = useQuery({
    queryKey: ["cxc-cobros"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cxc_cobros").select("id, empresa_id, cliente_nombre, tipo, fecha, monto, referencia, created_by_nombre, cancelado_en, cancelado_motivo").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as Cobro[];
    },
  });
  const registrar = useMutation({
    mutationFn: async () => {
      const m = num(monto);
      if (!clave) throw new Error("Elige el cliente.");
      if (!empresaId) throw new Error("Elige la empresa que cobra.");
      if (!(m > 0)) throw new Error("Captura el monto depositado.");
      const { data, error } = await supabase.rpc("fn_cxc_registrar_cobro", {
        p: {
          empresa_id: empresaId,
          cliente_clave: clave,
          cliente_nombre: opcionesCliente.find((o) => o[0] === clave)?.[1] ?? clave,
          fecha,
          monto: m,
          cuenta_id: cuentaId || null,
          referencia: referencia || null,
          movimiento_id: movimientoId || null,
          notas: notas || null,
          aplicaciones: aplicacion.aplicaciones.filter((a) => a.aplica > 0).map((a) => ({ origen: a.doc.origen, id: a.doc.id, monto: a.aplica })),
        },
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      setOk(`Cobro de ${dinero(num(monto), 2)} aplicado${aplicacion.sobrante > 0 ? ` (sobran ${dinero(aplicacion.sobrante, 2)} sin aplicar: queda como saldo a favor del cliente)` : ""}.`);
      setErr(null);
      setMonto(""); setReferencia(""); setMovimientoId(""); setNotas(""); setOvSel([]);
      qc.invalidateQueries({ queryKey: ["cxc-cartera"] });
      qc.invalidateQueries({ queryKey: ["cxc-ov-pendientes"] });
      qc.invalidateQueries({ queryKey: ["cxc-cobros"] });
      qc.invalidateQueries({ queryKey: ["cxc-abonos"] });
    },
    onError: (e) => { setOk(null); setErr((e as Error).message); },
  });
  const cancelar = useMutation({
    mutationFn: async (c: Cobro) => {
      const motivo = window.prompt(`¿Por qué se cancela el cobro de ${dinero(c.monto, 2)} de ${c.cliente_nombre}?`);
      if (!motivo) return;
      const { error } = await supabase.rpc("fn_cxc_cancelar_cobro", { p_cobro: c.id, p_motivo: motivo });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cxc-cartera"] });
      qc.invalidateQueries({ queryKey: ["cxc-cobros"] });
      qc.invalidateQueries({ queryKey: ["cxc-ov-pendientes"] });
    },
    onError: (e) => setErr((e as Error).message),
  });

  function elegirAbono(id: string) {
    setMovimientoId(id);
    const a = abonos?.find((x) => x.id === id);
    if (a) {
      setMonto(String(a.abono_total));
      setFecha(a.fecha_pago.slice(0, 10));
      if (a.referencia_numero && !referencia) setReferencia(a.referencia_numero);
    }
  }

  if (!puedeOperar) return <p className="text-sm text-slate-600">Los cobros los registran dirección, corporativo o el administrador.</p>;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <form className={`${tarjeta} p-4`} data-sin-borrador onSubmit={(e: FormEvent) => { e.preventDefault(); registrar.mutate(); }}>
          <h2 className="text-lg font-semibold text-slate-900">Registrar cobro</h2>
          <p className="mb-3 text-xs text-slate-600">El depósito se aplica primero a los documentos más vencidos, o solo a las órdenes de venta que marques abajo. Si lo eliges del estado de cuenta, el movimiento queda conciliado con esas facturas u OV.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={`${etiqueta} sm:col-span-2`}>
              Cliente
              <select value={clave} onChange={(e) => setClave(e.target.value)} className={campo}>
                <option value="">Elige…</option>
                {opcionesCliente.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
            </label>
            <label className={`${etiqueta} sm:col-span-2`}>
              Empresa que cobra
              <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className={campo}>
                {empresasCliente.map((id) => { const e = empresas?.find((x) => x.id === id); return <option key={id} value={id}>{e ? `${e.codigo} · ${e.nombre}` : id}</option>; })}
              </select>
            </label>
            <label className={etiqueta}>Monto depositado ($)<input value={monto} onChange={(e) => setMonto(e.target.value)} inputMode="decimal" className={campo} /></label>
            <label className={etiqueta}>Fecha del depósito<input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={campo} /></label>
            <label className={etiqueta}>
              Cuenta donde entró
              <select value={cuentaId} onChange={(e) => setCuentaId(e.target.value)} className={campo}>
                <option value="">—</option>
                {(cuentas ?? []).map((c) => <option key={c.id} value={c.id}>{c.banco} {c.ultimos_4}{c.alias ? ` · ${c.alias}` : ""}</option>)}
              </select>
            </label>
            <label className={etiqueta}>Referencia bancaria<input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ej. SPEI 0123456" className={campo} /></label>
            <label className={`${etiqueta} sm:col-span-2`}>
              Depósito del estado de cuenta (opcional, abonos sin conciliar)
              <select value={movimientoId} onChange={(e) => elegirAbono(e.target.value)} className={campo}>
                <option value="">— sin ligar —</option>
                {(abonos ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{fechaCorta(a.fecha_pago)} · {dinero(a.abono_total, 2)} · {(a.nombre_razon_social || a.comentarios || a.referencia_numero || "").slice(0, 50)}</option>
                ))}
              </select>
            </label>
            <label className={`${etiqueta} sm:col-span-2`}>Nota<input value={notas} onChange={(e) => setNotas(e.target.value)} className={campo} /></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {ovSel.length > 0 ? (
              <button type="button" onClick={() => setMonto(String(sumaElegidas))} className={btnSecundario}>Poner la suma de las {ovSel.length} OV elegidas ({dinero(sumaElegidas, 2)})</button>
            ) : (
              <button type="button" onClick={() => setMonto(String(Math.round(saldoTotal * 100) / 100))} disabled={!delCliente.length} className={btnSecundario}>Poner el saldo total ({dinero(saldoTotal, 2)})</button>
            )}
          </div>
          {empresaId && (
            <section id="ov-pendientes" className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">Órdenes de venta pendientes de pago · {empresas?.find((x) => x.id === empresaId)?.codigo ?? ""}</h3>
                <span className="text-xs text-slate-500">{ovsLista.length} de {ovsEmpresa.length}</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">Marca las OV que cubre este depósito: el cobro se liga y se aplica solo a ellas (el saldo que no alcance queda pendiente en la OV).</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1 text-slate-700">
                  <input type="checkbox" checked={verTodasOv} onChange={(e) => setVerTodasOv(e.target.checked)} /> ver todas las OV de la empresa, no solo las del cliente
                </label>
                <input value={buscarOv} onChange={(e) => setBuscarOv(e.target.value)} placeholder="Buscar folio, cliente, proyecto…" className="w-56 rounded border border-slate-300 px-2 py-1 text-xs" />
              </div>
              <div className="mt-2 max-h-64 overflow-y-auto rounded border border-slate-200 bg-white">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-left text-slate-500">
                    <tr><th className="px-2 py-1" /><th className="px-2 py-1">OV</th><th className="px-2 py-1">Fecha</th><th className="px-2 py-1">Cliente</th><th className="px-2 py-1">Proyecto</th><th className="px-2 py-1 text-right">Saldo</th></tr>
                  </thead>
                  <tbody>
                    {ovsLista.slice(0, 150).map((o) => {
                      const marcada = ovSel.includes(o.id);
                      const otroCliente = !!clave && o.cliente_clave !== clave;
                      return (
                        <tr key={o.id} className={`border-t border-slate-100 ${marcada ? "bg-emerald-50" : ""}`}>
                          <td className="px-2 py-1"><input type="checkbox" checked={marcada} onChange={(e) => setOvSel((prev) => (e.target.checked ? [...prev, o.id] : prev.filter((x) => x !== o.id)))} aria-label={`Elegir OV ${o.id_ov}`} /></td>
                          <td className="px-2 py-1 font-semibold">{o.id_ov}{o.cobrado > 0 && <span className="ml-1 font-normal text-amber-700" title={`ya cobrado ${dinero(o.cobrado, 2)}`}>parcial</span>}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{o.fecha_ov ? fechaCorta(o.fecha_ov) : "—"}</td>
                          <td className={`px-2 py-1 ${otroCliente ? "text-amber-800" : ""}`} title={otroCliente ? "Es de otro cliente" : undefined}>{o.cliente}</td>
                          <td className="px-2 py-1 text-slate-500">{o.proyecto ?? "—"}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{dinero(o.saldo, 2)}</td>
                        </tr>
                      );
                    })}
                    {ovsLista.length === 0 && <tr><td colSpan={6} className="px-2 py-3 text-center text-slate-500">{ovsEmpresa.length === 0 ? "Esta empresa no tiene OV pendientes de pago." : verTodasOv ? "Ninguna OV dice eso." : "Este cliente no tiene OV pendientes; marca \"ver todas\" si la OV está a otro nombre."}</td></tr>}
                  </tbody>
                </table>
              </div>
              {ovsLista.length > 150 && <p className="mt-1 text-xs text-slate-500">Se muestran 150; afina la búsqueda.</p>}
              {ovSel.length > 0 && <p className="mt-2 text-xs font-semibold text-emerald-800">{ovSel.length} OV elegidas · suman {dinero(sumaElegidas, 2)}. <button type="button" onClick={() => setOvSel([])} className="font-normal underline">quitar</button></p>}
            </section>
          )}
          {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
          {ok && <p className="mt-2 text-sm text-emerald-700">{ok}</p>}
          <button type="submit" disabled={registrar.isPending || !clave || !(num(monto) > 0)} className={`${btnPrimario} mt-3`}>Aplicar cobro</button>
        </form>
        <section className={`${tarjeta} p-4`}>
          <h2 className="text-lg font-semibold text-slate-900">Cómo se aplica</h2>
          {ovsElegidas.length > 0 && <p className="text-xs text-emerald-800">Solo a las {ovsElegidas.length} órdenes de venta elegidas; las facturas no se tocan.</p>}
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="px-2 py-1">Documento</th><th className="px-2 py-1">Vence</th><th className="px-2 py-1 text-right">Saldo</th><th className="px-2 py-1 text-right">Se aplica</th><th className="px-2 py-1 text-right">Queda</th></tr>
            </thead>
            <tbody>
              {aplicacion.aplicaciones.map((a) => (
                <tr key={a.doc.id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5 font-semibold" title={a.doc.uuid ?? undefined}>{a.doc.origen === "cfdi" ? `Factura ${a.doc.folio.slice(0, 8)}…` : a.doc.folio}{a.doc.origen === "ov" && <span className="ml-1 text-[10px] font-normal text-slate-400">OV</span>}</td>
                  <td className="px-2 py-1.5">{fechaCorta(a.doc.vence)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{dinero(a.doc.saldo, 2)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${a.aplica > 0 ? "font-semibold text-emerald-700" : "text-slate-400"}`}>{a.aplica > 0 ? dinero(a.aplica, 2) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{dinero(a.queda, 2)}</td>
                </tr>
              ))}
              {delCliente.length === 0 && ovsElegidas.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-slate-500">Elige un cliente con saldo o marca sus órdenes de venta.</td></tr>}
            </tbody>
          </table>
          {aplicacion.sobrante > 0 && <p className="mt-2 text-xs text-amber-800">Sobran {dinero(aplicacion.sobrante, 2)} que no se aplican a ningún documento (saldo a favor del cliente).</p>}
          {(delCliente.length > 0 || ovsElegidas.length > 0) && !(num(monto) > 0) && <p className="mt-2 text-xs text-slate-500">Captura el monto para ver cómo se aplica.</p>}
        </section>
      </div>
      <CapturaDocumento empresas={empresas ?? []} clientes={clientes} docs={docs} />
      <section className={`${tarjeta} p-4`}>
        <h2 className="text-lg font-semibold text-slate-900">Últimos cobros registrados</h2>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="px-2 py-1">Fecha</th><th className="px-2 py-1">Empresa</th><th className="px-2 py-1">Cliente</th><th className="px-2 py-1 text-right">Monto</th><th className="px-2 py-1">Referencia</th><th className="px-2 py-1">Registró</th><th className="px-2 py-1" /></tr>
          </thead>
          <tbody>
            {(cobros ?? []).map((c) => (
              <tr key={c.id} className={`border-t border-slate-100 ${c.cancelado_en ? "text-slate-400 line-through" : ""}`}>
                <td className="px-2 py-1.5">{fechaCorta(c.fecha)}</td>
                <td className="px-2 py-1.5">{empresas?.find((e) => e.id === c.empresa_id)?.codigo ?? "—"}</td>
                <td className="px-2 py-1.5">{c.cliente_nombre}{c.tipo === "ajuste" ? " (ajuste)" : ""}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{dinero(c.monto, 2)}</td>
                <td className="px-2 py-1.5">{c.referencia ?? "—"}</td>
                <td className="px-2 py-1.5">{c.created_by_nombre ?? "—"}</td>
                <td className="px-2 py-1.5 text-right">
                  {c.cancelado_en ? <span className="text-xs no-underline" title={c.cancelado_motivo ?? ""}>cancelado</span> : <button type="button" onClick={() => cancelar.mutate(c)} className="text-xs text-red-700 underline">cancelar</button>}
                </td>
              </tr>
            ))}
            {(cobros ?? []).length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-center text-slate-500">Todavía no hay cobros registrados aquí.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function CapturaDocumento({ empresas, clientes, docs }: { empresas: { id: string; codigo: string; nombre: string }[]; clientes: ClienteCxc[]; docs: DocumentoCxc[] }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [empresaId, setEmpresaId] = useState(empresas[0]?.id ?? "");
  useEffect(() => { if (!empresaId && empresas[0]) setEmpresaId(empresas[0].id); }, [empresas, empresaId]);
  const { data: proyectos } = useQuery({
    queryKey: ["cxc-proyectos", empresaId],
    enabled: abierto && !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("proyectos").select("id, nombre").eq("empresa_id", empresaId).eq("activo", true).order("nombre");
      if (error) throw error;
      return (data ?? []) as { id: string; nombre: string }[];
    },
  });
  const nombres = useMemo(() => {
    const m = new Map<string, { nombre: string; rfc: string | null }>();
    for (const c of clientes) m.set(c.nombre, { nombre: c.nombre, rfc: c.rfc });
    for (const d of docs) if (!m.has(d.cliente)) m.set(d.cliente, { nombre: d.cliente, rfc: d.rfc });
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [clientes, docs]);
  const guardar = useMutation({
    mutationFn: async (fila: Record<string, unknown>) => {
      const { error } = await supabase.from("cxc_documentos").insert(fila);
      if (error) throw error;
    },
    onSuccess: () => {
      setOk("Documento registrado: ya aparece en la cartera.");
      setErr(null);
      qc.invalidateQueries({ queryKey: ["cxc-cartera"] });
    },
    onError: (e) => { setOk(null); setErr((e as Error).message); },
  });
  function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const txt = (k: string) => String(fd.get(k) ?? "").trim();
    const nombre = txt("cliente_nombre");
    const d = { folio: txt("folio"), cliente_nombre: nombre, fecha: txt("fecha"), total: num(txt("total")), retenido: num(txt("retenido")), vence: txt("vence") || null };
    const falla = revisarDocumento(d);
    if (falla) return setErr(falla);
    const proyecto = txt("proyecto_id") || null;
    guardar.mutate({
      empresa_id: empresaId,
      tipo: txt("tipo") || "estimacion",
      folio: d.folio,
      cliente_nombre: nombre,
      cliente_rfc: txt("cliente_rfc") || nombres.find((n) => n.nombre === nombre)?.rfc || null,
      proyecto_id: proyecto,
      obra: txt("obra") || (proyecto ? proyectos?.find((p) => p.id === proyecto)?.nombre ?? null : null),
      fecha: d.fecha,
      vence: d.vence,
      total: d.total,
      retenido: d.retenido,
      concepto: txt("concepto") || null,
    });
    ev.currentTarget.reset();
  }
  return (
    <section className={`${tarjeta} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Documentos sin CFDI: estimaciones y saldos iniciales</h2>
          <p className="text-xs text-slate-600">Las facturas del SAT entran solas. Aquí se capturan las estimaciones de obra (con su fondo de garantía retenido) y lo que se deba de antes.</p>
        </div>
        <button type="button" onClick={() => setAbierto((v) => !v)} className={btnSecundario}>{abierto ? "Cerrar" : "+ Registrar documento"}</button>
      </div>
      {abierto && (
        <form onSubmit={onSubmit} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-sin-borrador>
          <label className={etiqueta}>
            Empresa que cobra
            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className={campo}>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
            </select>
          </label>
          <label className={etiqueta}>
            Tipo
            <select name="tipo" defaultValue="estimacion" className={campo}>
              <option value="estimacion">Estimación</option>
              <option value="factura">Factura (sin CFDI en el sistema)</option>
              <option value="saldo_inicial">Saldo inicial</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          <label className={etiqueta}>Documento *<input name="folio" placeholder="Estimación 4" className={campo} /></label>
          <label className={etiqueta}>Cliente *<input name="cliente_nombre" list="cxc-clientes" className={campo} /><datalist id="cxc-clientes">{nombres.map((n) => <option key={n.nombre} value={n.nombre} />)}</datalist></label>
          <label className={etiqueta}>RFC del cliente<input name="cliente_rfc" className={campo} /></label>
          <label className={etiqueta}>
            Obra
            <select name="proyecto_id" className={campo}>
              <option value="">—</option>
              {(proyectos ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label className={etiqueta}>Obra (si no está en la lista)<input name="obra" className={campo} /></label>
          <label className={etiqueta}>Fecha *<input type="date" name="fecha" className={campo} /></label>
          <label className={etiqueta}>Vence (en blanco = días de crédito del cliente)<input type="date" name="vence" className={campo} /></label>
          <label className={etiqueta}>Total *<input name="total" inputMode="decimal" className={campo} /></label>
          <label className={etiqueta}>Retenido (fondo de garantía)<input name="retenido" inputMode="decimal" defaultValue="0" className={campo} /></label>
          <label className={`${etiqueta} sm:col-span-2`}>Concepto<input name="concepto" className={campo} /></label>
          <div className="flex items-center gap-3 sm:col-span-4">
            <button type="submit" disabled={guardar.isPending} className={btnPrimario}>Guardar documento</button>
            {err && <span className="text-sm text-red-700">{err}</span>}
            {ok && <span className="text-sm text-emerald-700">{ok}</span>}
          </div>
        </form>
      )}
    </section>
  );
}

// ---------- Agenda de cobranza ----------

function VistaAgenda({
  docs, clientes, gestiones, hoy, clienteParam, irA, puedeOperar,
}: { docs: DocumentoCxc[]; clientes: ClienteCxc[]; gestiones: GestionCxc[]; hoy: string; clienteParam: string | null; irA: (v: Vista, c?: string | null) => void; puedeOperar: boolean }) {
  const qc = useQueryClient();
  const agenda = useMemo(() => agendaCobranza(docs, clientes, gestiones, hoy), [docs, clientes, gestiones, hoy]);
  const elegido = clienteParam ? agenda.find((a) => a.cliente_clave === clienteParam) ?? null : null;
  const nombreElegido = elegido?.cliente ?? (clienteParam ? docs.find((d) => d.cliente_clave === clienteParam)?.cliente ?? clienteParam : null);
  const ficha = clienteParam ? clientes.find((c) => c.clave === clienteParam) ?? null : null;
  const [err, setErr] = useState<string | null>(null);
  const historial = useMemo(() => gestiones.filter((g) => g.cliente_clave === clienteParam), [gestiones, clienteParam]);
  const guardar = useMutation({
    mutationFn: async (fila: Record<string, unknown>) => {
      const { error } = await supabase.from("cxc_gestiones").insert(fila);
      if (error) throw error;
    },
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ["cxc-gestiones"] });
    },
    onError: (e) => setErr((e as Error).message),
  });
  function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!clienteParam) return;
    const fd = new FormData(ev.currentTarget);
    const txt = (k: string) => String(fd.get(k) ?? "").trim();
    const empresa = docs.find((d) => d.cliente_clave === clienteParam)?.empresa_id ?? null;
    guardar.mutate({
      cliente_clave: clienteParam,
      cliente_nombre: nombreElegido,
      empresa_id: empresa,
      tipo: txt("tipo") || "llamada",
      fecha: txt("fecha") || hoy,
      promesa_fecha: txt("promesa_fecha") || null,
      promesa_monto: num(txt("promesa_monto")) || null,
      nota: txt("nota") || null,
    });
    ev.currentTarget.reset();
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <section className={`${tarjeta} p-4`}>
        <h2 className="text-lg font-semibold text-slate-900">Agenda de cobranza</h2>
        <p className="mb-3 text-xs text-slate-600">Clientes externos con saldo vencido, del más urgente al menos urgente. Una promesa vencida sin pago vuelve a la lista como prioridad.</p>
        <div className="space-y-2">
          {agenda.map((a) => (
            <div key={a.cliente_clave} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${a.incumplida ? "border-red-200 bg-red-50" : "border-slate-200"} ${elegido?.cliente_clave === a.cliente_clave ? "ring-2 ring-slate-400" : ""}`}>
              <div className="min-w-0">
                <button type="button" onClick={() => irA("cartera", a.cliente_clave)} className="text-left font-semibold text-slate-900">{a.cliente}</button>
                <div className="text-xs text-slate-600">{a.documentos} documento{a.documentos === 1 ? "" : "s"} vencido{a.documentos === 1 ? "" : "s"}{a.responsable ? ` · ${a.responsable}` : ""}</div>
                <div className="text-xs text-slate-600">{a.ultima ? `Última gestión: ${textoGestion(a.ultima, hoy)}` : "Sin gestión registrada"}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-red-700 tabular-nums">{dinero(a.vencido)}</div>
                <div className="text-xs text-slate-500">hasta {a.diasMax} días</div>
              </div>
              {puedeOperar && <button type="button" onClick={() => irA("agenda", a.cliente_clave)} className={btnSecundario}>Registrar gestión</button>}
            </div>
          ))}
          {agenda.length === 0 && <p className="text-sm text-slate-500">Ningún cliente externo con saldo vencido.</p>}
        </div>
      </section>
      <section className={`${tarjeta} p-4`}>
        {!clienteParam ? (
          <p className="text-sm text-slate-500">Elige un cliente de la agenda para registrar la gestión y ver su historial.</p>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-slate-900">Gestión con {nombreElegido}</h2>
            <p className="mb-3 text-xs text-slate-600">{[ficha?.area, ficha?.responsable ? `responsable: ${ficha.responsable}` : null].filter(Boolean).join(" · ") || "Sin datos de contacto: captúralos en Cartera › datos del cliente."}</p>
            {puedeOperar && (
              <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2" data-sin-borrador>
                <label className={etiqueta}>
                  Tipo
                  <select name="tipo" defaultValue="llamada" className={campo}>
                    {Object.entries(TIPOS_GESTION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className={etiqueta}>Fecha<input type="date" name="fecha" defaultValue={hoy} className={campo} /></label>
                <label className={etiqueta}>Promete pagar el<input type="date" name="promesa_fecha" className={campo} /></label>
                <label className={etiqueta}>Monto prometido ($)<input name="promesa_monto" inputMode="decimal" className={campo} /></label>
                <label className={`${etiqueta} sm:col-span-2`}>Nota<textarea name="nota" rows={3} placeholder="Con quién se habló y qué se acordó" className={campo} /></label>
                <div className="flex items-center gap-3 sm:col-span-2">
                  <button type="submit" disabled={guardar.isPending} className={btnPrimario}>Guardar gestión</button>
                  {err && <span className="text-sm text-red-700">{err}</span>}
                </div>
              </form>
            )}
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Historial</h3>
            <div className="mt-2 space-y-2">
              {historial.map((g) => (
                <div key={g.id ?? `${g.fecha}-${g.tipo}`} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <div className="font-semibold text-slate-900">{TIPOS_GESTION[g.tipo] ?? g.tipo} · {fechaCorta(g.fecha)}{g.created_by_nombre ? <span className="font-normal text-slate-500"> · {g.created_by_nombre}</span> : null}</div>
                  {g.nota && <div className="text-slate-700">{g.nota}</div>}
                  {g.promesa_fecha && <div className="text-xs text-slate-600">Promesa: {g.promesa_monto ? `${dinero(g.promesa_monto)} ` : ""}el {fechaCorta(g.promesa_fecha)}{g.promesa_fecha < hoy ? " · incumplida" : ""}</div>}
                </div>
              ))}
              {historial.length === 0 && <p className="text-sm text-slate-500">Sin gestiones registradas.</p>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---------- Entre empresas ----------

function VistaEntreEmpresas() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["cxc-entre-empresas"],
    queryFn: async () => {
      const { data: r, error: e } = await supabase.rpc("fn_cxc_entre_empresas", { p_desde: null });
      if (e) throw e;
      return r as { desde: string; hoy: string; pares: ParEntreEmpresas[] };
    },
  });
  const cuadre = useMemo(() => cuadreEntreEmpresas(data?.pares ?? []).filter((c) => c.par.vendido > 0 || c.par.comprado > 0), [data]);
  return (
    <section className={`${tarjeta} p-4`}>
      <h2 className="text-lg font-semibold text-slate-900">Cuentas entre empresas del grupo</h2>
      <p className="mb-3 text-xs text-slate-600">Lo que una empresa le cobra a otra (sus órdenes de venta desde {data ? fechaCorta(data.desde) : "enero"}) debe ser igual a lo que la otra tiene registrado por pagar (sus OC/OS a esa empresa). No cuenta en la cartera consolidada del grupo.</p>
      {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-slate-500">Cuadrando…</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="px-2 py-1">Vende</th><th className="px-2 py-1">Compra</th>
              <th className="px-2 py-1 text-right">Por cobrar (vende)</th><th className="px-2 py-1 text-right">Por pagar (compra)</th>
              <th className="px-2 py-1 text-right">Diferencia</th><th className="px-2 py-1 text-right">Saldo por pagar</th><th className="px-2 py-1 text-right">Vencido</th><th className="px-2 py-1">Cuadre</th>
            </tr>
          </thead>
          <tbody>
            {cuadre.map((c) => (
              <tr key={`${c.par.vende_id}-${c.par.compra_id}`} className="border-t border-slate-100">
                <td className="px-2 py-2 font-semibold">{c.par.vende}</td>
                <td className="px-2 py-2">{c.par.compra}</td>
                <td className="px-2 py-2 text-right tabular-nums">{dinero(c.par.vendido)} <span className="text-xs text-slate-400">({c.par.ov} OV)</span></td>
                <td className="px-2 py-2 text-right tabular-nums">{dinero(c.par.comprado)} <span className="text-xs text-slate-400">({c.par.oc} OC)</span></td>
                <td className={`px-2 py-2 text-right font-semibold tabular-nums ${c.cuadra ? "text-emerald-700" : "text-red-700"}`}>{dinero(c.diferencia)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{dinero(c.par.por_pagar)}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${c.par.vencido > 0 ? "text-red-700" : "text-slate-400"}`}>{c.par.vencido > 0 ? dinero(c.par.vencido) : "—"}</td>
                <td className="px-2 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.cuadra ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{c.cuadra ? "Cuadra" : "Diferencia"}</span>
                  {c.nota && <div className="mt-1 text-xs text-slate-600">{c.nota}</div>}
                </td>
              </tr>
            ))}
            {data && cuadre.length === 0 && <tr><td colSpan={8} className="px-2 py-3 text-center text-slate-500">No hay ventas entre empresas en tu alcance.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Las ventas inter empresa que se generan desde una OC (<Link to="/ordenes" className="text-sky-700 underline">Órdenes</Link>) crean las dos órdenes a la vez y cuadran solas; una diferencia viene de OV u OC capturadas por separado o del backoffice.
      </p>
    </section>
  );
}
