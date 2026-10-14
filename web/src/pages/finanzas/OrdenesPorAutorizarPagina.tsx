import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { OcPorAutorizar } from "./OcPorAutorizar";
import { OrdenesPorPagar } from "./OrdenesPorPagar";
import { AltaOcManual } from "../../components/AltaOcManual";

/** Laura (8-oct-2026, "CORRECCIONES SISTEMA GRUPO LOMA"): "Panel de órdenes
 * por autorizar: que solo salga esta pantalla". Antes vivía dentro de Saldos
 * por empresa y de Programación de pagos. Mario (14-oct-2026): las ya
 * autorizadas también se programan a pago desde aquí. */
export function OrdenesPorAutorizarPagina() {
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: empresas } = useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return data as { id: string; nombre: string }[];
    },
  });
  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-bancarias-todas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cuentas_bancarias").select("id, empresa_id, banco, ultimos_4, alias, activo").eq("activo", true).order("banco");
      if (error) throw error;
      return data as { id: string; empresa_id: string; banco: string; ultimos_4: string; alias: string | null }[];
    },
  });
  const nombreEmpresa = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.nombre])), [empresas]);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Órdenes por autorizar</h1>
      <p className="mb-4 text-sm text-slate-500">OC del backoffice pendientes de autorización, de requisiciones (RQ), IA y de Excel. Autoriza o rechaza; abajo, las ya autorizadas que aún no tienen pago programado, para programarlas.</p>
      <div className="mb-4">
        <AltaOcManual />
      </div>
      <OcPorAutorizar />
      <OrdenesPorPagar filtroEmpresa="" hoy={hoy} nombreEmpresa={nombreEmpresa} cuentas={cuentas ?? []} soloAutorizadas />
    </div>
  );
}
