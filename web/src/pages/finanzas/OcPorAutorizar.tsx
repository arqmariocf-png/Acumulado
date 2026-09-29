import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { moneda } from "../../lib/saldosEmpresas";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";

interface OcPendiente {
  id: string;
  id_orden: string;
  empresa_id: string;
  proveedor: string | null;
  proyecto: string | null;
  total: number | null;
  fecha_creacion: string | null;
  created_at: string;
  fuente: string;
  rechazada_en: string | null;
  rechazo_motivo: string | null;
  empresas: { nombre: string; codigo: string } | null;
}

interface Partida {
  id: string;
  item: string;
  unidad: string | null;
  cantidad: number | null;
  costo: number | null;
  clave: string;
}

interface Cuenta {
  id: string;
  empresa_id: string;
  banco: string;
  ultimos_4: string;
  alias: string | null;
}

function sumarDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Órdenes de compra generadas por almacén desde requisiciones (serie RQ)
 * que dirección todavía no autoriza (Laura, 28-sep-2026). Autorizar
 * programa el pago y avanza la requisición; rechazar la regresa a almacén. */
export function OcPorAutorizar() {
  const queryClient = useQueryClient();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Archivadas = rechazadas (p. ej. la carga de Excel de julio-2026 que no
  // coincidía con el backoffice). Se pueden reactivar con "Autorizar".
  const [verArchivadas, setVerArchivadas] = useState(false);

  // Un solo clic (Mario, 28-sep-2026): autoriza con pago a 7 días y cuenta
  // por definir; "Revisar" es para ver partidas, cambiar fecha o rechazar.
  const autorizarDirecto = useMutation({
    mutationFn: async (o: OcPendiente) => {
      const { error } = await supabase.rpc("fn_oc_autorizar", { p_oc_id: o.id, p_autorizar: true, p_motivo: null, p_fecha_pago: sumarDias(7), p_cuenta_id: null });
      if (error) throw error;
      return o;
    },
    onSuccess: (o) => {
      setAviso(o.fuente === "requisicion" ? `Orden ${o.id_orden} autorizada: pago a ${o.proveedor ?? "proveedor"} programado para el ${sumarDias(7)}.` : `Orden ${o.id_orden} autorizada; ya se le puede programar pago.`);
      setAbierta(null);
      queryClient.invalidateQueries({ queryKey: ["oc-por-autorizar"] });
      queryClient.invalidateQueries({ queryKey: ["oc-archivadas-n"] });
      queryClient.invalidateQueries({ queryKey: ["pagos-programados"] });
      queryClient.invalidateQueries({ queryKey: ["cxp-proveedores"] });
      queryClient.invalidateQueries({ queryKey: ["oc-pagos"] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const { data: ocs, isLoading } = useQuery({
    queryKey: ["oc-por-autorizar", verArchivadas],
    queryFn: async () => {
      let q = supabase
        .from("ordenes_compra")
        .select("id, id_orden, empresa_id, proveedor, proyecto, total, fecha_creacion, created_at, fuente, rechazada_en, rechazo_motivo, empresas(nombre, codigo)")
        .in("fuente", ["requisicion", "excel"])
        .is("autorizada_en", null)
        .order("created_at", { ascending: false });
      q = verArchivadas ? q.not("rechazada_en", "is", null).limit(300) : q.is("rechazada_en", null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as OcPendiente[];
    },
  });
  const { data: nArchivadas } = useQuery({
    queryKey: ["oc-archivadas-n"],
    queryFn: async () => {
      const { count, error } = await supabase.from("ordenes_compra").select("*", { count: "exact", head: true }).in("fuente", ["requisicion", "excel"]).is("autorizada_en", null).not("rechazada_en", "is", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-bancarias-activas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cuentas_bancarias").select("id, empresa_id, banco, ultimos_4, alias").eq("activo", true).order("banco");
      if (error) throw error;
      return (data ?? []) as Cuenta[];
    },
  });

  if (isLoading) return null;
  if ((!ocs || ocs.length === 0) && !verArchivadas && !(nArchivadas ?? 0)) return null;

  return (
    <div className={`mb-5 rounded border p-3 ${verArchivadas ? "border-slate-300 bg-slate-50" : "border-amber-300 bg-amber-50"}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className={`text-sm font-semibold ${verArchivadas ? "text-slate-800" : "text-amber-900"}`}>
          {verArchivadas ? "Órdenes archivadas (rechazadas)" : "Órdenes de compra por autorizar"} <span className={`rounded-full px-2 py-0.5 text-xs ${verArchivadas ? "bg-slate-200" : "bg-amber-200"}`}>{ocs?.length ?? 0}</span>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-amber-800">{verArchivadas ? "No se pagan. \"Autorizar\" las reactiva." : "Sin autorización no se programa pago. Las RQ las genera almacén (al autorizar se programa el pago y la requisición avanza); las de Excel se cargaron a mano."}</p>
          {(nArchivadas ?? 0) > 0 && (
            <button type="button" onClick={() => setVerArchivadas((v) => !v)} className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100">
              {verArchivadas ? "Ver por autorizar" : `Ver archivadas (${nArchivadas})`}
            </button>
          )}
        </div>
      </div>
      {ocs?.length === 0 && <p className="text-xs text-slate-500">{verArchivadas ? "No hay archivadas." : "No hay órdenes pendientes de autorización."}</p>}
      <div className="space-y-2">
        {(ocs ?? []).map((o) => (
          <div key={o.id} className="rounded border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <span className="font-mono text-xs font-semibold text-slate-900">{o.id_orden}</span>
                {o.fuente === "excel" && <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-600">excel</span>} · <b>{o.proveedor ?? "sin proveedor"}</b>
                <span className="text-slate-500"> · {o.empresas?.codigo ?? ""} · {o.proyecto ?? "sin proyecto"} · {o.fecha_creacion ?? ""}</span>
                {o.rechazo_motivo && <div className="text-xs text-slate-500">{o.rechazo_motivo}</div>}
              </div>
              <div className="flex items-center gap-2">
                <span className="mr-1 text-sm font-semibold tabular-nums">{o.total != null ? moneda(o.total) : "—"}</span>
                <button
                  type="button"
                  onClick={() => autorizarDirecto.mutate(o)}
                  disabled={autorizarDirecto.isPending}
                  className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  title={o.fuente === "requisicion" ? "Autoriza y programa el pago a 7 días (la cuenta se define después en Programación de pagos)" : "Autoriza; el pago se programa después con su condición"}
                >
                  Autorizar
                </button>
                <button type="button" onClick={() => setAbierta(abierta === o.id ? null : o.id)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
                  {abierta === o.id ? "Cerrar" : "Revisar"}
                </button>
                <BotonVerOc ocId={o.id} />
              </div>
            </div>
            {abierta === o.id && (
              <DetalleOc
                oc={o}
                cuentas={(cuentas ?? []).filter((c) => c.empresa_id === o.empresa_id)}
                onResuelta={(m) => {
                  setAviso(m);
                  setAbierta(null);
                  queryClient.invalidateQueries({ queryKey: ["oc-por-autorizar"] });
      queryClient.invalidateQueries({ queryKey: ["oc-archivadas-n"] });
                  queryClient.invalidateQueries({ queryKey: ["pagos-programados"] });
                  queryClient.invalidateQueries({ queryKey: ["cxp-proveedores"] });
                  queryClient.invalidateQueries({ queryKey: ["oc-pagos"] });
                }}
              />
            )}
          </div>
        ))}
      </div>
      {aviso && <p className={`mt-2 text-xs ${aviso.startsWith("Orden") ? "text-emerald-800" : "text-red-700"}`}>{aviso}</p>}
      <p className="mt-2 text-xs text-amber-800">
        Los pagos autorizados quedan en{" "}
        <Link to="/finanzas/pagos" className="underline">
          Programación de pagos
        </Link>
        .
      </p>
    </div>
  );
}

function DetalleOc({ oc, cuentas, onResuelta }: { oc: OcPendiente; cuentas: Cuenta[]; onResuelta: (mensaje: string) => void }) {
  const [fechaPago, setFechaPago] = useState(sumarDias(7));
  const [cuentaId, setCuentaId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: partidas } = useQuery({
    queryKey: ["oc-partidas", oc.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("ordenes_compra_lineas").select("id, item, unidad, cantidad, costo, clave").eq("orden_compra_id", oc.id).order("numero");
      if (error) throw error;
      return (data ?? []) as Partida[];
    },
  });

  const resolver = useMutation({
    mutationFn: async (autorizar: boolean) => {
      if (!autorizar && !motivo.trim()) throw new Error("Escribe el motivo del rechazo para almacén.");
      const { error } = await supabase.rpc("fn_oc_autorizar", { p_oc_id: oc.id, p_autorizar: autorizar, p_motivo: motivo.trim() || null, p_fecha_pago: autorizar ? fechaPago : null, p_cuenta_id: autorizar && cuentaId ? cuentaId : null });
      if (error) throw error;
      return autorizar;
    },
    onSuccess: (autorizar) => onResuelta(autorizar ? (oc.fuente === "requisicion" ? `Orden ${oc.id_orden} autorizada: pago programado para el ${fechaPago}.` : `Orden ${oc.id_orden} autorizada; ya se le puede programar pago.`) : oc.fuente === "requisicion" ? `Orden ${oc.id_orden} rechazada; almacén la ve para recotizar.` : `Orden ${oc.id_orden} rechazada.`),
    onError: (e: Error) => setError(e.message),
  });

  async function verCotizacion(necesidadId: string) {
    const { data: sessionData } = await supabase.auth.getSession();
    const respuesta = await fetch(`${urlFuncion("requisiciones-cotizacion")}?id=${necesidadId}`, { headers: { Authorization: `Bearer ${sessionData.session?.access_token}` } });
    const json = await respuesta.json().catch(() => null);
    if (!respuesta.ok) {
      setError((await errorDeFuncion(respuesta, json)).message);
      return;
    }
    window.open(json.url, "_blank");
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <table className="mb-3 w-full text-xs">
        <thead className="text-left uppercase text-slate-400">
          <tr>
            <th className="py-1 pr-2">Partida</th>
            <th className="py-1 pr-2 text-right">Cantidad</th>
            <th className="py-1 pr-2 text-right">Costo unit.</th>
            <th className="py-1 pr-2 text-right">Importe</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {(partidas ?? []).map((p) => (
            <tr key={p.id} className="border-t border-slate-100">
              <td className="py-1 pr-2">{p.item}</td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {p.cantidad ?? "—"} {p.unidad ?? ""}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">{p.costo != null ? moneda(p.costo) : "—"}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{p.costo != null && p.cantidad != null ? moneda(p.costo * p.cantidad) : "—"}</td>
              <td className="py-1 text-right">
                {oc.fuente === "requisicion" && (
                  <button type="button" onClick={() => verCotizacion(p.clave)} className="text-slate-600 underline">
                    cotización
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Pagar el</label>
          <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Cuenta</label>
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
        <button type="button" onClick={() => resolver.mutate(true)} disabled={resolver.isPending} className="rounded bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          Autorizar y programar pago
        </button>
        <div className="ml-auto flex items-end gap-2">
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del rechazo" className="w-48 rounded border border-slate-300 px-2 py-1 text-sm" />
          <button type="button" onClick={() => window.confirm(oc.fuente === "requisicion" ? `¿Rechazar la orden ${oc.id_orden}? Se borra y almacén vuelve a cotizar.` : `¿Rechazar la orden ${oc.id_orden}? Queda registrada como rechazada y no se paga.`) && resolver.mutate(false)} disabled={resolver.isPending} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
            Rechazar
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
