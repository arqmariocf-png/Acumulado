import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { diasDesde, lunesDeSemana } from "../../lib/puestos";

// Acumulado por empresa para contabilidad (Belén, 6-oct-2026: "revisa y
// valida el acumulado; necesita OC/OV y CFDI de todas las empresas"): qué
// tan al día está cada fuente. Rojo = más de 7 días; ámbar = más de 2.

interface FilaCfdi {
  empresa_id: string;
  empresa_codigo: string;
  empresa_nombre: string;
  ultimo_emitido: string | null;
  ultimo_recibido: string | null;
  ultima_carga: string | null;
  total_cfdi: number;
}
interface FilaCarga {
  empresa_id: string;
  ultima_carga_estado_cuenta: string | null;
  ultimo_periodo_oc: string | null;
  ultimo_periodo_ov: string | null;
}

function hoyMx(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

function Celda({ fecha, hoy }: { fecha: string | null; hoy: string }) {
  const d = diasDesde(fecha, hoy);
  const color = d === null ? "text-slate-400" : d > 7 ? "text-red-700 font-medium" : d > 2 ? "text-amber-700" : "text-emerald-700";
  return (
    <td className={`px-2 py-1.5 text-right tabular-nums ${color}`} title={d === null ? "" : `hace ${d} días`}>
      {fecha ? new Date(`${fecha.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "—"}
      {d !== null && d > 2 && <span className="ml-1 text-[10px]">({d} d)</span>}
    </td>
  );
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** OC/OV vienen por periodo AAAAMM: verde si es el mes en curso. */
function CeldaPeriodo({ periodo, hoy }: { periodo: string | null; hoy: string }) {
  if (!periodo || periodo.length < 6) return <td className="px-2 py-1.5 text-right text-slate-400">—</td>;
  const actual = periodo.slice(0, 6) === hoy.slice(0, 7).replace("-", "");
  return <td className={`px-2 py-1.5 text-right ${actual ? "text-emerald-700" : "text-amber-700"}`}>{`${MESES[Number(periodo.slice(4, 6)) - 1]} ${periodo.slice(0, 4)}`}</td>;
}

export function AcumuladoContable() {
  const hoy = hoyMx();
  const { data: cfdi, isLoading } = useQuery({
    queryKey: ["acumulado-contable", "cfdi"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cfdi_ultimo_por_empresa").select("*").order("empresa_codigo");
      if (error) throw error;
      return (data ?? []) as FilaCfdi[];
    },
  });
  const { data: cargas } = useQuery({
    queryKey: ["acumulado-contable", "cargas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_estado_carga_empresa").select("empresa_id, ultima_carga_estado_cuenta, ultimo_periodo_oc, ultimo_periodo_ov");
      if (error) throw error;
      return (data ?? []) as FilaCarga[];
    },
  });
  const { data: adquira } = useQuery({
    queryKey: ["acumulado-contable", "adquira"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bbva_adquira_pedidos").select("subido_en").order("subido_en", { ascending: false }).limit(1);
      if (error) throw error;
      return (data?.[0]?.subido_en as string | undefined) ?? null;
    },
  });
  const porEmpresa = useMemo(() => new Map((cargas ?? []).map((c) => [c.empresa_id, c])), [cargas]);
  const adquiraSemana = !!adquira && adquira.slice(0, 10) >= lunesDeSemana(hoy);

  return (
    <section className="mb-6 rounded border border-slate-200 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-900">Acumulado por empresa</h2>
        <span className="text-xs text-slate-500">qué tan al día está cada fuente (rojo: más de 7 días)</span>
        <span className="flex-1" />
        <Link to="/mantenimiento/bbva" className={`rounded px-2 py-1 text-xs ${adquiraSemana ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          Adquira BBVA: {adquiraSemana ? "subido esta semana" : "pendiente esta semana (viernes)"}
        </Link>
        <Link to="/carga" className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white">
          Cargar archivos
        </Link>
      </div>
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1">Empresa</th>
              <th className="px-2 py-1 text-right">CFDI emitidos</th>
              <th className="px-2 py-1 text-right">CFDI recibidos</th>
              <th className="px-2 py-1 text-right">Estado de cuenta</th>
              <th className="px-2 py-1 text-right">OC</th>
              <th className="px-2 py-1 text-right">OV</th>
            </tr>
          </thead>
          <tbody>
            {(cfdi ?? []).map((c) => {
              const g = porEmpresa.get(c.empresa_id);
              return (
                <tr key={c.empresa_id} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">
                    <span className="font-medium">{c.empresa_codigo}</span> <span className="text-xs text-slate-400">{c.total_cfdi} CFDI</span>
                  </td>
                  <Celda fecha={c.ultimo_emitido} hoy={hoy} />
                  <Celda fecha={c.ultimo_recibido} hoy={hoy} />
                  <Celda fecha={g?.ultima_carga_estado_cuenta ?? null} hoy={hoy} />
                  <CeldaPeriodo periodo={g?.ultimo_periodo_oc ?? null} hoy={hoy} />
                  <CeldaPeriodo periodo={g?.ultimo_periodo_ov ?? null} hoy={hoy} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        CFDI y estados de cuenta se suben en Carga (zip del SAT y PDF del banco). OC y OV llegan solas del backoffice cada hora; el backoffice no publica las del día en curso.
      </p>
    </section>
  );
}
