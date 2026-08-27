import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
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

export function Match() {
  const { veTodasLasEmpresas, perfil } = useAuth();
  const { data: empresas } = useEmpresas();
  const [empresaId, setEmpresaId] = useState(perfil?.empresa_id ?? "");
  const [vista, setVista] = useState<"oc" | "ov">("oc");

  const { data: avanceOc, isLoading: cargandoOc } = useAvanceRecepcion(empresaId);
  const { data: avanceOv, isLoading: cargandoOv } = useAvanceEmbarque(empresaId);

  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Compara lo que el almacén registró como recibido/embarcado (entradas y salidas de inventario vinculadas a una
        orden) contra el total en dinero de esa orden en el catálogo de Acumulado.
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
                    <tr key={o.orden_compra_id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        {o.tipo} {o.id_orden}
                      </td>
                      <td className="px-3 py-2">{o.proveedor ?? "—"}</td>
                      <td className="px-3 py-2">{o.proyecto ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{o.total_oc ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{o.total_recibido}</td>
                      <td className="px-3 py-2">
                        <Badge {...ESTILO_RECEPCION[o.estado_recepcion]} />
                      </td>
                    </tr>
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
