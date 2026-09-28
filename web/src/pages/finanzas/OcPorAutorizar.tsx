import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { moneda } from "../../lib/saldosEmpresas";

interface OcPendiente {
  id: string;
  id_orden: string;
  empresa_id: string;
  proveedor: string | null;
  proyecto: string | null;
  total: number | null;
  fecha_creacion: string | null;
  created_at: string;
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

  const { data: ocs, isLoading } = useQuery({
    queryKey: ["oc-por-autorizar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordenes_compra")
        .select("id, id_orden, empresa_id, proveedor, proyecto, total, fecha_creacion, created_at, empresas(nombre, codigo)")
        .eq("fuente", "requisicion")
        .is("autorizada_en", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OcPendiente[];
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
  if (!ocs || ocs.length === 0) return null;

  return (
    <div className="mb-5 rounded border border-amber-300 bg-amber-50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-amber-900">
          Órdenes de compra por autorizar <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs">{ocs.length}</span>
        </h3>
        <p className="text-xs text-amber-800">Las genera almacén desde las requisiciones (serie RQ). Al autorizar se programa el pago y la requisición avanza.</p>
      </div>
      <div className="space-y-2">
        {ocs.map((o) => (
          <div key={o.id} className="rounded border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <span className="font-mono text-xs font-semibold text-slate-900">{o.id_orden}</span> · <b>{o.proveedor ?? "sin proveedor"}</b>
                <span className="text-slate-500"> · {o.empresas?.codigo ?? ""} · {o.proyecto ?? "sin proyecto"} · {o.fecha_creacion ?? ""}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold tabular-nums">{o.total != null ? moneda(o.total) : "—"}</span>
                <button type="button" onClick={() => setAbierta(abierta === o.id ? null : o.id)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
                  {abierta === o.id ? "Cerrar" : "Revisar"}
                </button>
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
                  queryClient.invalidateQueries({ queryKey: ["pagos-programados"] });
                  queryClient.invalidateQueries({ queryKey: ["cxp-proveedores"] });
                }}
              />
            )}
          </div>
        ))}
      </div>
      {aviso && <p className="mt-2 text-xs text-emerald-800">{aviso}</p>}
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
    onSuccess: (autorizar) => onResuelta(autorizar ? `Orden ${oc.id_orden} autorizada: pago programado para el ${fechaPago}.` : `Orden ${oc.id_orden} rechazada; almacén la ve para recotizar.`),
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
                <button type="button" onClick={() => verCotizacion(p.clave)} className="text-slate-600 underline">
                  cotización
                </button>
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
          <button type="button" onClick={() => window.confirm(`¿Rechazar la orden ${oc.id_orden}? Se borra y almacén vuelve a cotizar.`) && resolver.mutate(false)} disabled={resolver.isPending} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
            Rechazar
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
