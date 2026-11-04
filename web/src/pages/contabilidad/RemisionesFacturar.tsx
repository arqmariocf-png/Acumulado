import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import {
  ETIQUETA_ESTADO,
  ETIQUETA_ORIGEN,
  filtrarRemisiones,
  ordenarCfdiParaRemision,
  resumenPorEmpresa,
  rutaRemision,
  textoFactura,
  type CfdiEmitido,
  type FacturaEstado,
  type RemisionFacturacion,
} from "../../lib/remisionesFacturacion";

// Contabilidad › Remisiones por facturar (4-nov-2026, Mario: "pásalas al
// proceso de facturación, para que ya solamente tengan que dar click las
// contadoras"). Las remisiones de almacén (REM) y las de planta entran aquí
// en cuanto se emiten; al entregarse, contabilidad recibe un aviso. Un clic
// las marca facturadas (con el CFDI emitido del SAT o el folio a mano) o
// "no lleva factura" con motivo.

const dinero = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fechaCorta = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—");

type Pestana = FacturaEstado | "todas";
const PESTANAS: { clave: Pestana; etiqueta: string }[] = [
  { clave: "por_facturar", etiqueta: "Por facturar" },
  { clave: "facturada", etiqueta: "Facturadas" },
  { clave: "no_factura", etiqueta: "No llevan factura" },
  { clave: "todas", etiqueta: "Todas" },
];

function useRemisionesFacturacion() {
  return useQuery({
    queryKey: ["remisiones-facturacion"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_remisiones_facturacion");
      if (error) throw error;
      return (data ?? []) as RemisionFacturacion[];
    },
  });
}

export function RemisionesFacturar() {
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const [pestana, setPestana] = useState<Pestana>("por_facturar");
  const [texto, setTexto] = useState("");
  const [abierta, setAbierta] = useState<RemisionFacturacion | null>(null);
  const { data, isLoading, error } = useRemisionesFacturacion();

  const filas = useMemo(() => filtrarRemisiones(data ?? [], { estado: pestana, empresaId: empresaId || null, texto }), [data, pestana, empresaId, texto]);
  const resumen = useMemo(() => resumenPorEmpresa((data ?? []).filter((r) => !empresaId || r.empresa_id === empresaId)), [data, empresaId]);
  const conteo = (estado: Pestana) => (data ?? []).filter((r) => (!empresaId || r.empresa_id === empresaId) && (estado === "todas" || r.factura_estado === estado)).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Remisiones por facturar</h1>
        <p className="text-sm text-slate-500">
          Toda remisión de salida (almacén y planta) de todas las empresas llega aquí con su folio REM. Al confirmarse la entrega te avisa; marca "Facturada"
          eligiendo el CFDI emitido del SAT o escribiendo el folio, o "No lleva factura" con el motivo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar folio, cliente, OV, proyecto o factura…" className="w-72 rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </div>

      {resumen.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {resumen.map((e) => (
            <button
              key={e.empresa_id}
              onClick={() => setEmpresaId(empresaId === e.empresa_id ? "" : e.empresa_id)}
              className={`rounded border p-3 text-left ${empresaId === e.empresa_id ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
            >
              <div className="text-xs uppercase text-slate-500">{e.empresa_codigo}</div>
              <div className="text-2xl font-semibold text-slate-900">{e.por_facturar}</div>
              <div className="text-xs text-slate-600">
                por facturar · {e.entregadas_sin_factura} ya entregadas{e.importe_por_facturar > 0 ? ` · ${dinero(e.importe_por_facturar)} s/IVA` : ""}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            onClick={() => setPestana(p.clave)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${pestana === p.clave ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {p.etiqueta} <span className="ml-1 rounded bg-slate-100 px-1.5 text-xs text-slate-600">{conteo(p.clave)}</span>
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-slate-400">Cargando remisiones…</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>}

      {!isLoading && filas.length === 0 && <p className="text-sm text-slate-500">No hay remisiones en esta pestaña.</p>}

      {filas.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Folio</th>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Referencia</th>
                <th className="px-3 py-2 text-right">Importe s/IVA</th>
                <th className="px-3 py-2">Entrega</th>
                <th className="px-3 py-2">Factura</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.map((r) => (
                <tr key={`${r.origen}-${r.id}`} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <Link to={rutaRemision(r.origen, r.id)} className="font-mono text-slate-900 underline">
                      {r.folio}
                    </Link>
                    <div className="text-xs text-slate-500">{ETIQUETA_ORIGEN[r.origen]}</div>
                  </td>
                  <td className="px-3 py-2">{r.empresa_codigo}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fechaCorta(r.fecha)}</td>
                  <td className="px-3 py-2">
                    {r.cliente ?? "—"}
                    {r.cliente_rfc && <div className="text-xs text-slate-500">RFC {r.cliente_rfc}</div>}
                    {r.proyecto && <div className="text-xs text-slate-500">{r.proyecto}</div>}
                  </td>
                  <td className="px-3 py-2">{r.referencia ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{dinero(r.importe)}</td>
                  <td className="px-3 py-2">
                    {r.estatus === "entregada" ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Entregada</span>
                    ) : (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Emitida</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        r.factura_estado === "facturada" ? "bg-emerald-100 text-emerald-800" : r.factura_estado === "por_facturar" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {ETIQUETA_ESTADO[r.factura_estado]}
                    </span>
                    {r.factura_estado !== "por_facturar" && (
                      <div className="mt-1 max-w-xs truncate text-xs text-slate-600" title={textoFactura(r)}>
                        {r.factura_folio || r.cfdi_folio || r.factura_nota}
                        {r.facturada_por_nombre ? ` · ${r.facturada_por_nombre}` : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.factura_estado === "por_facturar" ? (
                      <button onClick={() => setAbierta(r)} className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800">
                        Facturar
                      </button>
                    ) : (
                      <button onClick={() => setAbierta(r)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
                        Cambiar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {abierta && <PanelFacturar remision={abierta} onCerrar={() => setAbierta(null)} />}
    </div>
  );
}

/** Panel para marcar la remisión: CFDI emitido del SAT (misma empresa), folio a
 * mano, "no lleva factura" o regresarla a por facturar. */
function PanelFacturar({ remision: r, onCerrar }: { remision: RemisionFacturacion; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<"cfdi" | "folio" | "sin">(r.factura_estado === "no_factura" ? "sin" : "cfdi");
  const [busqueda, setBusqueda] = useState("");
  const [cfdiId, setCfdiId] = useState<string | null>(r.cfdi_id);
  const [folio, setFolio] = useState(r.factura_folio ?? "");
  const [nota, setNota] = useState(r.factura_nota ?? "");
  const [error, setError] = useState<string | null>(null);

  const desde = new Date(`${r.fecha}T12:00:00`);
  desde.setDate(desde.getDate() - 15);
  const { data: cfdis, isLoading } = useQuery({
    queryKey: ["cfdi-emitidos-remision", r.empresa_id, r.fecha],
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from("cfdi")
        .select("id, folio, total, contraparte, rfc, fecha, es_complemento_pago, tipo_comprobante")
        .eq("empresa_id", r.empresa_id)
        .eq("tipo", "emitido")
        .gte("fecha", desde.toISOString().slice(0, 10))
        .order("fecha", { ascending: false })
        .limit(300);
      if (e) throw e;
      return (data ?? []) as CfdiEmitido[];
    },
  });

  const candidatos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = ordenarCfdiParaRemision(cfdis ?? [], r);
    return (q ? lista.filter((c) => [c.folio, c.contraparte, c.rfc, String(c.total)].some((v) => v && String(v).toLowerCase().includes(q))) : lista).slice(0, 40);
  }, [cfdis, busqueda, r]);

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ["remisiones-facturacion"] });
    queryClient.invalidateQueries({ queryKey: ["remision-salida", r.id] });
    queryClient.invalidateQueries({ queryKey: ["remision-produccion", r.id] });
  };

  const facturar = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("fn_remision_facturar", {
        p_origen: r.origen,
        p_id: r.id,
        p_cfdi_id: modo === "cfdi" ? cfdiId : null,
        p_folio: modo === "folio" ? folio.trim() || null : null,
        p_nota: nota.trim() || null,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      refrescar();
      onCerrar();
    },
    onError: (e) => setError((e as Error).message),
  });
  const sinFactura = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("fn_remision_sin_factura", { p_origen: r.origen, p_id: r.id, p_motivo: nota.trim() });
      if (e) throw e;
    },
    onSuccess: () => {
      refrescar();
      onCerrar();
    },
    onError: (e) => setError((e as Error).message),
  });
  const reabrir = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("fn_remision_reabrir_factura", { p_origen: r.origen, p_id: r.id });
      if (e) throw e;
    },
    onSuccess: () => {
      refrescar();
      onCerrar();
    },
    onError: (e) => setError((e as Error).message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (modo === "sin") {
      if (!nota.trim()) return setError("Escribe el motivo por el que no lleva factura.");
      sinFactura.mutate();
      return;
    }
    if (modo === "cfdi" && !cfdiId) return setError("Elige el CFDI emitido o cambia a 'Folio a mano'.");
    if (modo === "folio" && !folio.trim()) return setError("Escribe el folio de la factura.");
    facturar.mutate();
  }

  const ocupado = facturar.isPending || sinFactura.isPending || reabrir.isPending;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-2 sm:items-center" onClick={onCerrar}>
      <form onSubmit={onSubmit} onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-4 shadow-xl" data-sin-borrador>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-slate-500">Facturar remisión · {r.empresa_codigo}</p>
            <h2 className="font-mono text-lg font-semibold text-slate-900">{r.folio}</h2>
            <p className="text-sm text-slate-600">
              {r.cliente ?? "—"}
              {r.cliente_rfc ? ` · RFC ${r.cliente_rfc}` : ""} · {fechaCorta(r.fecha)}
              {r.importe != null ? ` · ${dinero(r.importe)} s/IVA (${dinero(r.importe * 1.16)} c/IVA)` : ""}
            </p>
          </div>
          <button type="button" onClick={onCerrar} className="text-slate-500 hover:text-slate-800">
            ✕
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          {(
            [
              ["cfdi", "CFDI emitido del SAT"],
              ["folio", "Folio a mano"],
              ["sin", "No lleva factura"],
            ] as const
          ).map(([k, etiqueta]) => (
            <button key={k} type="button" onClick={() => setModo(k)} className={`rounded px-3 py-1 text-sm ${modo === k ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700"}`}>
              {etiqueta}
            </button>
          ))}
        </div>

        {modo === "cfdi" && (
          <div className="mt-3">
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por folio fiscal, cliente, RFC o total…" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
            <p className="mt-1 text-xs text-slate-500">CFDI emitidos de {r.empresa_codigo} desde 15 días antes de la remisión; primero los del mismo cliente y del mismo importe. Lo facturado hoy aparece mañana (descarga del SAT).</p>
            {isLoading && <p className="mt-2 text-sm text-slate-400">Cargando CFDI…</p>}
            <div className="mt-2 max-h-64 overflow-y-auto rounded border border-slate-200">
              {candidatos.length === 0 && !isLoading && <p className="p-3 text-sm text-slate-500">No hay CFDI emitidos que coincidan. Usa "Folio a mano" si la factura aún no baja del SAT.</p>}
              {candidatos.map((c) => (
                <label key={c.id} className={`flex cursor-pointer items-start gap-2 border-b border-slate-100 px-3 py-2 text-sm ${cfdiId === c.id ? "bg-slate-50" : ""}`}>
                  <input type="radio" name="cfdi" checked={cfdiId === c.id} onChange={() => setCfdiId(c.id)} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900">{c.contraparte ?? "—"}</span>
                    <span className="block text-xs text-slate-500">
                      {fechaCorta(c.fecha)} · {dinero(c.total)}
                      {c.rfc ? ` · ${c.rfc}` : ""}
                    </span>
                    <span className="block truncate font-mono text-xs text-slate-400">{c.folio}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {modo === "folio" && (
          <div className="mt-3">
            <label className="block text-xs uppercase text-slate-500">Folio o UUID de la factura</label>
            <input value={folio} onChange={(e) => setFolio(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="A-1234 o el folio fiscal" />
          </div>
        )}

        <div className="mt-3">
          <label className="block text-xs uppercase text-slate-500">{modo === "sin" ? "Motivo (obligatorio)" : "Nota (opcional)"}</label>
          <input value={nota} onChange={(e) => setNota(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder={modo === "sin" ? "p. ej. venta al público en general, se facturó en la OV…" : "p. ej. factura parcial, se complementa con…"} />
        </div>

        {error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            {r.factura_estado !== "por_facturar" && (
              <button type="button" disabled={ocupado} onClick={() => reabrir.mutate()} className="text-sm text-slate-600 underline disabled:opacity-50">
                Regresar a "por facturar"
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onCerrar} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
              Cancelar
            </button>
            <button type="submit" disabled={ocupado} className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {ocupado ? "Guardando…" : modo === "sin" ? "Marcar sin factura" : "Marcar facturada"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
