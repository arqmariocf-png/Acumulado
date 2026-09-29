import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import { moneda } from "../../lib/saldosEmpresas";
import { RecepcionOc } from "../requisiciones/RecepcionOc";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";

interface OcPorRecibir {
  id: string;
  id_orden: string;
  tipo: "OC" | "OS";
  empresa_id: string;
  proveedor: string | null;
  proyecto: string | null;
  total: number | null;
  fecha_creacion: string | null;
  fuente: string;
  pagado: number;
  ultimo_pago: string | null;
  pagada_backoffice: boolean;
  estatus_backoffice: string | null;
  n_lineas: number;
  cantidad_pendiente: number;
  recepcion_estado: "recibida" | "parcial" | "sin_recibir" | "sin_partidas";
  recibida_en: string | null;
  recibida_lugar: string | null;
}

const ESTADO: Record<OcPorRecibir["recepcion_estado"], [string, string]> = {
  sin_recibir: ["sin recibir", "bg-amber-100 text-amber-800"],
  parcial: ["parcial", "bg-blue-100 text-blue-800"],
  sin_partidas: ["sin partidas", "bg-slate-100 text-slate-600"],
  recibida: ["recibida", "bg-emerald-100 text-emerald-800"],
};

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function restarDias(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Almacén / obra (Alma, 29-sep-2026): las OC ya pagadas (tesorería marcó el
 * pago o el backoffice ya la tiene pagada) que faltan de confirmar, con las
 * cantidades por partida y el lugar (bodega u obra). */
export function PorRecibir() {
  const { perfil, eligeEmpresa } = useAuth();
  const [empresaFiltro, setEmpresaFiltro] = useEmpresaFiltro();
  const [pestana, setPestana] = useState<"pendientes" | "recibidas">("pendientes");
  const [busqueda, setBusqueda] = useState("");
  const [desde, setDesde] = useState(restarDias(30));
  const [soloCompras, setSoloCompras] = useState(true);
  const [abierta, setAbierta] = useState<string | null>(null);
  const puedeRecibir = ["admin", "corporativo", "almacen", "empresa", "responsable"].includes(perfil?.rol ?? "");

  const { data, isLoading, error } = useQuery({
    queryKey: ["oc-por-recibir", empresaFiltro, pestana, desde],
    queryFn: async () => {
      let q = supabase.from("v_oc_por_recibir").select("id, id_orden, tipo, empresa_id, proveedor, proyecto, total, fecha_creacion, fuente, pagado, ultimo_pago, pagada_backoffice, estatus_backoffice, n_lineas, cantidad_pendiente, recepcion_estado, recibida_en, recibida_lugar").order("fecha_creacion", { ascending: false }).limit(500);
      if (empresaFiltro) q = q.eq("empresa_id", empresaFiltro);
      if (desde) q = q.gte("fecha_creacion", desde);
      q = pestana === "pendientes" ? q.neq("recepcion_estado", "recibida") : q.eq("recepcion_estado", "recibida");
      const { data: filas, error: err } = await q;
      if (err) throw err;
      return (filas ?? []) as OcPorRecibir[];
    },
  });

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (data ?? []).filter((o) => (!soloCompras || o.tipo === "OC") && (!q || o.id_orden.toLowerCase().includes(q) || (o.proveedor ?? "").toLowerCase().includes(q) || (o.proyecto ?? "").toLowerCase().includes(q)));
  }, [data, busqueda, soloCompras]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">Por recibir</h2>
        {eligeEmpresa && <SelectorEmpresa value={empresaFiltro} onChange={setEmpresaFiltro} />}
        <div className="flex rounded border border-slate-200 text-xs">
          <button type="button" onClick={() => setPestana("pendientes")} className={`px-2.5 py-1 ${pestana === "pendientes" ? "bg-slate-900 text-white" : "text-slate-600"}`}>
            Pagadas, por confirmar
          </button>
          <button type="button" onClick={() => setPestana("recibidas")} className={`px-2.5 py-1 ${pestana === "recibidas" ? "bg-slate-900 text-white" : "text-slate-600"}`}>
            Recibidas
          </button>
        </div>
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Folio, proveedor o proyecto…" className="w-52 rounded border border-slate-300 px-2 py-1 text-xs" />
        <label className="flex items-center gap-1 text-xs text-slate-600">
          desde <input type="date" value={desde} max={hoyIso()} onChange={(e) => setDesde(e.target.value)} className="rounded border border-slate-300 px-1.5 py-0.5 text-xs" />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={soloCompras} onChange={(e) => setSoloCompras(e.target.checked)} /> solo compras (sin servicios)
        </label>
        <span className="ml-auto text-xs text-slate-500">{visibles.length} órdenes</span>
      </div>
      <p className="mb-3 text-xs text-slate-500">Aquí llegan las órdenes que tesorería ya pagó (o que el backoffice registra pagadas). Abre cada una y confirma lo que llegó, en bodega o en obra.</p>
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      {!isLoading && visibles.length === 0 && <p className="rounded border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-400">{pestana === "pendientes" ? "Nada por recibir con estos filtros." : "Sin órdenes recibidas con estos filtros."}</p>}
      <div className="space-y-2">
        {visibles.map((o) => {
          const [etiqueta, clase] = ESTADO[o.recepcion_estado];
          return (
            <div key={o.id} className="rounded border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs font-semibold text-slate-900">{o.id_orden}</span>
                {o.tipo === "OS" && <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] uppercase text-slate-600">servicio</span>}
                <span className="font-medium text-slate-800">{o.proveedor ?? "sin proveedor"}</span>
                {o.proyecto && <span className="text-slate-500">· {o.proyecto}</span>}
                <span className="text-xs text-slate-400">· {o.fecha_creacion ?? ""}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${clase}`}>
                  {etiqueta}
                  {o.recibida_lugar ? ` en ${o.recibida_lugar}` : ""}
                </span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800" title={o.pagada_backoffice ? `Backoffice: ${o.estatus_backoffice}` : `Pagado ${o.ultimo_pago ?? ""}`}>
                  {Number(o.pagado) > 0 ? `pagada ${o.ultimo_pago ?? ""}` : "pagada en backoffice"}
                </span>
                <span className="ml-auto tabular-nums text-slate-700">{o.total != null ? moneda(Number(o.total)) : ""}</span>
                <BotonVerOc ocId={o.id} />
                <button type="button" onClick={() => setAbierta(abierta === o.id ? null : o.id)} className={`rounded px-2.5 py-1 text-xs font-medium ${abierta === o.id ? "bg-slate-900 text-white" : "bg-emerald-700 text-white"}`}>
                  {abierta === o.id ? "Cerrar" : puedeRecibir ? "Recibir" : "Ver recepción"}
                </button>
              </div>
              {abierta === o.id && <RecepcionOc ocId={o.id} puedeRecibir={puedeRecibir} onCambio={() => undefined} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
