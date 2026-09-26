import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { indicadoresPara, type Indicador } from "../lib/indicadores";
import { useKpisAlcance } from "../lib/socio";
import { formatearKpiEmpresa, tieneKpiEmpresa } from "../lib/kpisEmpresa";

function Tarjeta({ ind }: { ind: Indicador }) {
  const { perfil } = useAuth();
  // Lo que ya viene calculado en fn_kpis_alcance() (una llamada para todos
  // los KPIs numéricos) no se vuelve a consultar vista por vista.
  const alcance = useKpisAlcance(!!perfil);
  const enAlcance = !!alcance.data && tieneKpiEmpresa(alcance.data.total, ind.clave);
  const propio = useQuery({
    queryKey: ["indicador", ind.clave, perfil?.id],
    enabled: !!perfil && !alcance.isLoading && !enAlcance,
    staleTime: 60_000,
    queryFn: () => ind.consulta(perfil!),
  });
  const data = enAlcance
    ? (() => {
        const r = formatearKpiEmpresa(ind.clave, alcance.data!.total[ind.clave]);
        const n = typeof r.valor === "number" ? r.valor : Number(String(r.valor).replace(/[^0-9.-]/g, ""));
        const alerta = !ind.informativo && Number.isFinite(n) && (ind.direccion === "menor_es_peor" ? false : n > 0);
        return { ...r, alerta };
      })()
    : propio.data;
  const isLoading = alcance.isLoading || (!enAlcance && propio.isLoading);
  const error = enAlcance ? null : propio.error;
  const alerta = !!data?.alerta;
  return (
    <Link
      to={ind.ruta}
      className={`rounded-lg border p-3 transition hover:shadow-sm ${alerta ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
    >
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{ind.etiqueta}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${alerta ? "text-amber-900" : "text-slate-900"}`}>
        {isLoading ? "…" : error ? "—" : data?.valor}
      </p>
      <p className="text-xs text-slate-500">{error ? "sin acceso" : (data?.detalle ?? "")}</p>
    </Link>
  );
}

/** Franja de indicadores del inicio: solo los que le tocan al rol. */
export function Indicadores({ tienePersonal }: { tienePersonal: boolean }) {
  const { perfil } = useAuth();
  const lista = indicadoresPara(perfil, { tienePersonal });
  if (lista.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="text-sm font-semibold text-slate-900">Tus indicadores</h2>
      <p className="mb-2 text-xs text-slate-500">Lo que hoy necesita tu atención, según tu rol.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {lista.map((i) => (
          <Tarjeta key={i.clave} ind={i} />
        ))}
      </div>
    </section>
  );
}
