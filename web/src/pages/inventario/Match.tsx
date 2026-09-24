import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { cantidadTexto } from "../../lib/remision";
import type { AvanceRecepcionOc, AvanceEmbarqueOv, EstadoRecepcion, EstadoEmbarque } from "../../types/database";

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

function useAvanceRecepcion(empresaId: string) {
  return useQuery({
    queryKey: ["avance-recepcion-oc", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avance_recepcion_oc")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("estado_recepcion")
        .limit(200);
      if (error) throw error;
      return data as AvanceRecepcionOc[];
    },
  });
}

function useAvanceEmbarque(empresaId: string) {
  return useQuery({
    queryKey: ["avance-embarque-ov", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avance_embarque_ov")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("estado_embarque")
        .limit(200);
      if (error) throw error;
      return data as AvanceEmbarqueOv[];
    },
  });
}

const ESTILO_RECEPCION: Record<EstadoRecepcion, { color: string; etiqueta: string }> = {
  sin_total: { color: "bg-slate-100 text-slate-600", etiqueta: "Sin total en la orden" },
  sin_recibir: { color: "bg-red-100 text-red-800", etiqueta: "Sin recibir" },
  parcial: { color: "bg-amber-100 text-amber-800", etiqueta: "Recepción parcial" },
  completo: { color: "bg-emerald-100 text-emerald-800", etiqueta: "Recibido completo" },
};

const ESTILO_EMBARQUE: Record<EstadoEmbarque, { color: string; etiqueta: string }> = {
  sin_total: { color: "bg-slate-100 text-slate-600", etiqueta: "Sin total en la orden" },
  sin_embarcar: { color: "bg-red-100 text-red-800", etiqueta: "Sin embarcar" },
  parcial: { color: "bg-amber-100 text-amber-800", etiqueta: "Embarque parcial" },
  completo: { color: "bg-emerald-100 text-emerald-800", etiqueta: "Embarcado completo" },
};

function Badge({ color, etiqueta }: { color: string; etiqueta: string }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>{etiqueta}</span>;
}

interface LineaOcAvance {
  linea_id: string;
  numero: number;
  item: string;
  unidad: string | null;
  cantidad: number | null;
  recibido: number;
  diferencia: number;
  estado: "sin_recibir" | "parcial" | "completo" | "excedido";
  fecha_ultima_recepcion: string | null;
}

const ESTILO_LINEA: Record<LineaOcAvance["estado"], { color: string; etiqueta: string }> = {
  sin_recibir: { color: "bg-red-100 text-red-800", etiqueta: "Sin recibir" },
  parcial: { color: "bg-amber-100 text-amber-800", etiqueta: "Parcial · el proveedor debe" },
  completo: { color: "bg-emerald-100 text-emerald-800", etiqueta: "Completa" },
  excedido: { color: "bg-red-100 text-red-800", etiqueta: "Excedente · ajuste/reclamación" },
};

/** Partidas de una OC con lo recibido por cantidad (v_oc_lineas_avance). Es
 * lo que abre el QR del comprobante de entrada. */
function PartidasOc({ ordenCompraId }: { ordenCompraId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["lineas-orden", ordenCompraId, "entrada"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_oc_lineas_avance").select("*").eq("orden_compra_id", ordenCompraId).order("numero");
      if (error) throw error;
      return (data ?? []).map((l: any) => ({
        linea_id: String(l.linea_id),
        numero: Number(l.numero),
        item: String(l.item),
        unidad: l.unidad ?? null,
        cantidad: l.cantidad == null ? null : Number(l.cantidad),
        recibido: Number(l.recibido ?? 0),
        diferencia: Number(l.diferencia ?? 0),
        estado: String(l.estado) as LineaOcAvance["estado"],
        fecha_ultima_recepcion: l.fecha_ultima_recepcion ?? null,
      })) as LineaOcAvance[];
    },
  });
  if (isLoading) return <p className="px-3 py-2 text-xs text-slate-500">Cargando partidas…</p>;
  if (error) return <p className="px-3 py-2 text-xs text-red-600">{(error as Error).message}</p>;
  if (!data || data.length === 0) return <p className="px-3 py-2 text-xs text-slate-500">Esta orden no tiene partidas del backoffice (o aún no se sincronizan).</p>;
  return (
    <table className="w-full text-xs">
      <thead className="bg-slate-100 text-left uppercase text-slate-500">
        <tr>
          <th className="px-2 py-1">#</th>
          <th className="px-2 py-1">Partida</th>
          <th className="px-2 py-1">Unidad</th>
          <th className="px-2 py-1 text-right">Pedido</th>
          <th className="px-2 py-1 text-right">Recibido</th>
          <th className="px-2 py-1 text-right">Diferencia</th>
          <th className="px-2 py-1">Estado</th>
          <th className="px-2 py-1">Última recepción</th>
        </tr>
      </thead>
      <tbody>
        {data.map((l) => (
          <tr key={l.linea_id} className="border-t border-slate-100">
            <td className="px-2 py-1 text-slate-500">{l.numero}</td>
            <td className="px-2 py-1">{l.item}</td>
            <td className="px-2 py-1">{l.unidad ?? ""}</td>
            <td className="px-2 py-1 text-right">{l.cantidad == null ? "—" : cantidadTexto(l.cantidad)}</td>
            <td className="px-2 py-1 text-right">{cantidadTexto(l.recibido)}</td>
            <td className={`px-2 py-1 text-right ${l.diferencia > 0 ? "text-amber-700" : l.diferencia < 0 ? "text-red-700" : "text-emerald-700"}`}>
              {l.diferencia > 0 ? `faltan ${cantidadTexto(l.diferencia)}` : l.diferencia < 0 ? `sobran ${cantidadTexto(-l.diferencia)}` : "0"}
            </td>
            <td className="px-2 py-1">
              <Badge {...ESTILO_LINEA[l.estado]} />
            </td>
            <td className="px-2 py-1 text-slate-500">{l.fecha_ultima_recepcion ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Match() {
  const { veTodasLasEmpresas, perfil } = useAuth();
  const { data: empresas } = useEmpresas();
  const [empresaId, setEmpresaId] = useState(perfil?.empresa_id ?? "");
  const [vista, setVista] = useState<"oc" | "ov">("oc");
  // ?oc=<id>: llega del QR del comprobante de entrada -- abre esa orden con
  // sus partidas y, si hace falta, cambia a su empresa.
  const [params] = useSearchParams();
  const ocDesdeQr = params.get("oc");
  const [ocAbierta, setOcAbierta] = useState<string | null>(ocDesdeQr);

  useEffect(() => {
    if (!ocDesdeQr) return;
    setOcAbierta(ocDesdeQr);
    setVista("oc");
    supabase
      .from("ordenes_compra")
      .select("empresa_id")
      .eq("id", ocDesdeQr)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.empresa_id) setEmpresaId(String(data.empresa_id));
      });
  }, [ocDesdeQr]);

  const { data: avanceOc, isLoading: cargandoOc } = useAvanceRecepcion(empresaId);
  const { data: avanceOv, isLoading: cargandoOv } = useAvanceEmbarque(empresaId);

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Compara lo que el almacén registró como recibido/embarcado (entradas y salidas de inventario vinculadas a una
        orden) contra el total en dinero de esa orden en el catálogo de Grupo Loma.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {veTodasLasEmpresas ? (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Selecciona una empresa…</option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-slate-500">Empresa: la asignada a tu usuario.</p>
        )}
        <div className="flex overflow-hidden rounded border border-slate-300">
          <button
            onClick={() => setVista("oc")}
            className={`px-3 py-1.5 text-sm ${vista === "oc" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
          >
            Compras (OC/OS)
          </button>
          <button
            onClick={() => setVista("ov")}
            className={`px-3 py-1.5 text-sm ${vista === "ov" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
          >
            Ventas (OV)
          </button>
        </div>
      </div>

      {!empresaId && <p className="text-sm text-slate-500">Selecciona una empresa para ver el match.</p>}

      {empresaId && vista === "oc" && (
        <>
          {cargandoOc && <p className="text-sm text-slate-500">Cargando…</p>}
          {avanceOc && (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Orden</th>
                    <th className="px-3 py-2">Proveedor</th>
                    <th className="px-3 py-2">Proyecto</th>
                    <th className="px-3 py-2 text-right">Total OC</th>
                    <th className="px-3 py-2 text-right">Recibido</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {avanceOc.map((o) => (
                    <Fragment key={o.orden_compra_id}>
                      <tr className={`border-t border-slate-100 ${ocAbierta === o.orden_compra_id ? "bg-emerald-50" : ""}`}>
                        <td className="px-3 py-2">
                          {o.tipo} {o.id_orden}
                          <button
                            type="button"
                            onClick={() => setOcAbierta(ocAbierta === o.orden_compra_id ? null : o.orden_compra_id)}
                            className="ml-2 text-xs text-slate-500 underline"
                          >
                            {ocAbierta === o.orden_compra_id ? "ocultar partidas" : "partidas"}
                          </button>
                        </td>
                        <td className="px-3 py-2">{o.proveedor ?? "—"}</td>
                        <td className="px-3 py-2">{o.proyecto ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{o.total_oc ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{o.total_recibido}</td>
                        <td className="px-3 py-2">
                          <Badge {...ESTILO_RECEPCION[o.estado_recepcion]} />
                        </td>
                      </tr>
                      {ocAbierta === o.orden_compra_id && (
                        <tr className="bg-slate-50">
                          <td colSpan={6} className="px-3 py-2">
                            <PartidasOc ordenCompraId={o.orden_compra_id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {avanceOc.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                        No hay órdenes de compra cargadas para esta empresa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {empresaId && vista === "ov" && (
        <>
          {cargandoOv && <p className="text-sm text-slate-500">Cargando…</p>}
          {avanceOv && (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Orden</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Proyecto</th>
                    <th className="px-3 py-2 text-right">Total OV</th>
                    <th className="px-3 py-2 text-right">Embarcado</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {avanceOv.map((o) => (
                    <tr key={o.orden_venta_id} className="border-t border-slate-100">
                      <td className="px-3 py-2">OV {o.id_ov}</td>
                      <td className="px-3 py-2">{o.cliente ?? "—"}</td>
                      <td className="px-3 py-2">{o.proyecto ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{o.total_ov ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{o.total_embarcado}</td>
                      <td className="px-3 py-2">
                        <Badge {...ESTILO_EMBARQUE[o.estado_embarque]} />
                      </td>
                    </tr>
                  ))}
                  {avanceOv.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                        No hay órdenes de venta cargadas para esta empresa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
