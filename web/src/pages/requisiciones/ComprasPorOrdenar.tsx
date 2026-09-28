import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { moneda } from "../../lib/saldosEmpresas";

interface Necesidad {
  id: string;
  cantidad: number;
  estado: string;
  proveedor_sugerido: string | null;
  cotizacion_path: string | null;
  cotizacion_nombre: string | null;
  cotizacion_proveedor: string | null;
  cotizacion_costo_unitario: number | null;
  cotizacion_nota: string | null;
  cotizacion_en: string | null;
  created_at: string;
  requisicion_lineas: {
    unidad_medida: string;
    descripcion: string | null;
    productos: { nombre: string; sku: string } | null;
    requisiciones: { folio: number; fecha: string; empresa_id: string; proyectos: { nombre: string } | null } | null;
  } | null;
}

interface OcGenerada {
  id: string;
  id_orden: string;
  proveedor: string | null;
  total: number | null;
  fecha_creacion: string | null;
  proyecto: string | null;
}

function nombreLinea(n: Necesidad): string {
  return n.requisicion_lineas?.productos?.nombre ?? n.requisicion_lineas?.descripcion ?? "Material";
}

/** Compras que salieron de una requisición y todavía no tienen orden de
 * compra (Alma, almacén, 28-sep-2026): sube la cotización de cada renglón
 * y genera la OC desde aquí con folio propio RQ-<empresa>-0001, distinto
 * del backoffice. La OC queda en el catálogo como cualquier otra (match,
 * cuentas por pagar, recepción en almacén). */
export function ComprasPorOrdenar({ empresaId }: { empresaId: string }) {
  const queryClient = useQueryClient();
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [proveedorOc, setProveedorOc] = useState("");
  const [fechaOc, setFechaOc] = useState(new Date().toISOString().slice(0, 10));
  const [conIva, setConIva] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);

  const { data: necesidades, isLoading } = useQuery({
    queryKey: ["necesidades-compra-pendientes", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("necesidades_compra")
        .select("id, cantidad, estado, proveedor_sugerido, cotizacion_path, cotizacion_nombre, cotizacion_proveedor, cotizacion_costo_unitario, cotizacion_nota, cotizacion_en, created_at, requisicion_lineas!inner(unidad_medida, descripcion, productos(nombre, sku), requisiciones!inner(folio, fecha, empresa_id, proyectos(nombre)))")
        .eq("estado", "pendiente")
        .eq("requisicion_lineas.requisiciones.empresa_id", empresaId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Necesidad[];
    },
  });

  const { data: ocs } = useQuery({
    queryKey: ["oc-desde-requisicion", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("ordenes_compra").select("id, id_orden, proveedor, total, fecha_creacion, proyecto").eq("empresa_id", empresaId).eq("fuente", "requisicion").order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return (data ?? []) as OcGenerada[];
    },
  });

  const seleccionadas = useMemo(() => (necesidades ?? []).filter((n) => seleccion.has(n.id)), [necesidades, seleccion]);
  const totalEstimado = seleccionadas.reduce((s, n) => s + Number(n.cantidad) * Number(n.cotizacion_costo_unitario ?? 0), 0) * (conIva ? 1.16 : 1);

  const generarOc = useMutation({
    mutationFn: async () => {
      const lineas = seleccionadas.map((n) => ({ necesidad_id: n.id, costo: n.cotizacion_costo_unitario }));
      const { data, error } = await supabase.rpc("fn_oc_desde_necesidades", { p_lineas: lineas, p_proveedor: proveedorOc.trim(), p_fecha: fechaOc, p_iva: conIva });
      if (error) throw error;
      return data as { id: string; id_orden: string; total: number; lineas: number };
    },
    onSuccess: (r) => {
      setAviso(`Orden de compra ${r.id_orden} generada con ${r.lineas} partida(s) por ${moneda(r.total)}.`);
      setSeleccion(new Set());
      setProveedorOc("");
      queryClient.invalidateQueries({ queryKey: ["necesidades-compra-pendientes"] });
      queryClient.invalidateQueries({ queryKey: ["oc-desde-requisicion"] });
      queryClient.invalidateQueries({ queryKey: ["avance-resolucion-linea"] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  function alternar(id: string, proveedorSugerido: string | null) {
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else {
        s.add(id);
        if (!proveedorOc && proveedorSugerido) setProveedorOc(proveedorSugerido);
      }
      return s;
    });
  }

  if (!empresaId) return null;

  return (
    <div className="mt-8">
      <h2 className="mb-1 text-base font-semibold text-slate-900">Compras por ordenar</h2>
      <p className="mb-3 max-w-2xl text-sm text-slate-500">
        Lo que se mandó a comprar y todavía no tiene orden. Sube la cotización de cada renglón (o captura proveedor y costo), marca los que van con el mismo proveedor y genera la orden de compra: sale con folio propio <b>RQ-</b> para distinguirla de las del backoffice.
      </p>
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {necesidades && necesidades.length === 0 && <p className="rounded border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-400">Nada pendiente de ordenar.</p>}
      {necesidades && necesidades.length > 0 && (
        <div className="space-y-2">
          {necesidades.map((n) => (
            <FilaNecesidad key={n.id} n={n} seleccionada={seleccion.has(n.id)} onAlternar={() => alternar(n.id, n.cotizacion_proveedor ?? n.proveedor_sugerido)} />
          ))}
        </div>
      )}
      {seleccionadas.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded border border-slate-900 bg-white p-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Proveedor de la orden</label>
            <input value={proveedorOc} onChange={(e) => setProveedorOc(e.target.value)} placeholder="Razón social" className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Fecha</label>
            <input type="date" value={fechaOc} onChange={(e) => setFechaOc(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <label className="flex items-center gap-1.5 pb-2 text-sm text-slate-600">
            <input type="checkbox" checked={conIva} onChange={(e) => setConIva(e.target.checked)} /> con IVA
          </label>
          <div className="pb-1 text-sm text-slate-600">
            {seleccionadas.length} partida(s) · total estimado <b>{moneda(totalEstimado)}</b>
            {seleccionadas.some((n) => n.cotizacion_costo_unitario == null) && <span className="ml-2 text-amber-700">hay renglones sin costo</span>}
          </div>
          <button type="button" onClick={() => generarOc.mutate()} disabled={generarOc.isPending || !proveedorOc.trim()} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {generarOc.isPending ? "Generando…" : "Generar orden de compra RQ"}
          </button>
        </div>
      )}
      {aviso && <p className={`mt-2 text-sm ${aviso.startsWith("Orden de compra") ? "text-emerald-700" : "text-red-700"}`}>{aviso}</p>}

      {ocs && ocs.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Órdenes generadas desde requisiciones</h3>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Folio</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Proveedor</th>
                  <th className="px-3 py-2">Proyecto</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {ocs.map((o) => (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">{o.id_orden}</td>
                    <td className="px-3 py-2">{o.fecha_creacion ?? "—"}</td>
                    <td className="px-3 py-2">{o.proveedor ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{o.proyecto ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{o.total != null ? moneda(o.total) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function FilaNecesidad({ n, seleccionada, onAlternar }: { n: Necesidad; seleccionada: boolean; onAlternar: () => void }) {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [proveedor, setProveedor] = useState(n.cotizacion_proveedor ?? n.proveedor_sugerido ?? "");
  const [costo, setCosto] = useState(n.cotizacion_costo_unitario != null ? String(n.cotizacion_costo_unitario) : "");
  const [nota, setNota] = useState(n.cotizacion_nota ?? "");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const fd = new FormData();
      fd.append("necesidadId", n.id);
      fd.append("proveedor", proveedor);
      fd.append("costoUnitario", costo);
      fd.append("nota", nota);
      if (archivo) fd.append("file", archivo, archivo.name);
      const respuesta = await fetch(urlFuncion("requisiciones-cotizacion"), { method: "POST", headers: { Authorization: `Bearer ${sessionData.session?.access_token}` }, body: fd });
      const json = await respuesta.json();
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
      return json;
    },
    onSuccess: () => {
      setEditando(false);
      setArchivo(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["necesidades-compra-pendientes"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  async function abrirCotizacion() {
    const { data: sessionData } = await supabase.auth.getSession();
    const respuesta = await fetch(`${urlFuncion("requisiciones-cotizacion")}?id=${n.id}`, { headers: { Authorization: `Bearer ${sessionData.session?.access_token}` } });
    const json = await respuesta.json();
    if (!respuesta.ok) {
      setError((await errorDeFuncion(respuesta, json)).message);
      return;
    }
    window.open(json.url, "_blank");
  }

  const req = n.requisicion_lineas?.requisiciones;
  return (
    <div className={`rounded border bg-white p-3 ${seleccionada ? "border-slate-900" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-start gap-3">
        <input type="checkbox" checked={seleccionada} onChange={onAlternar} className="mt-1" title="Incluir en la orden de compra" />
        <div className="min-w-[14rem] flex-1">
          <p className="text-sm font-medium text-slate-800">
            {nombreLinea(n)} <span className="text-xs text-slate-400">· {Number(n.cantidad)} {n.requisicion_lineas?.unidad_medida}</span>
          </p>
          <p className="text-xs text-slate-500">
            Requisición #{req?.folio} · {req?.proyectos?.nombre ?? "sin proyecto"} · {req?.fecha}
          </p>
        </div>
        <div className="text-xs text-slate-600">
          {n.cotizacion_en ? (
            <>
              <p>
                <b>{n.cotizacion_proveedor ?? n.proveedor_sugerido ?? "sin proveedor"}</b>
                {n.cotizacion_costo_unitario != null && <> · {moneda(Number(n.cotizacion_costo_unitario))} c/u</>}
              </p>
              {n.cotizacion_path && (
                <button type="button" onClick={abrirCotizacion} className="text-slate-700 underline">
                  ver cotización{n.cotizacion_nombre ? ` (${n.cotizacion_nombre})` : ""}
                </button>
              )}
              {n.cotizacion_nota && <p className="text-slate-400">{n.cotizacion_nota}</p>}
            </>
          ) : (
            <p className="text-amber-700">Sin cotización{n.proveedor_sugerido ? ` · sugerido: ${n.proveedor_sugerido}` : ""}</p>
          )}
        </div>
        <button type="button" onClick={() => setEditando((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
          {n.cotizacion_en ? "Editar cotización" : "Subir cotización"}
        </button>
      </div>
      {editando && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            guardar.mutate();
          }}
          className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Proveedor</label>
            <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="w-48 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Costo unitario (sin IVA)</label>
            <input value={costo} onChange={(e) => setCosto(e.target.value)} inputMode="decimal" placeholder="0.00" className="w-28 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Archivo (PDF o foto)</label>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="text-xs" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Nota</label>
            <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="vigencia, condiciones" className="w-48 rounded border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {guardar.isPending ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" onClick={() => setEditando(false)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600">
            Cancelar
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
