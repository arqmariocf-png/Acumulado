import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { AREAS, areaDeClave, entradasDeArea } from "../lib/organigrama";
import { INDICADORES, type Indicador } from "../lib/indicadores";

/** Primera pantalla del director general: el organigrama por áreas. Cada
 * área abre su pantalla con módulos e indicadores. */
export function Organigrama() {
  const { perfil } = useAuth();
  return (
    <div>
      <div className="mb-6 text-center">
        <div className="inline-block rounded-lg bg-slate-900 px-6 py-3 text-white">
          <p className="text-[11px] uppercase tracking-wide text-slate-300">Dirección general</p>
          <p className="font-semibold">{perfil?.nombre ?? "Grupo Loma"}</p>
        </div>
        <div className="mx-auto h-6 w-px bg-slate-300" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {AREAS.map((a) => (
          <Link key={a.clave} to={`/area/${a.clave}`} className="group rounded-lg border border-slate-200 bg-white transition hover:border-slate-400 hover:shadow-sm">
            <div className={`rounded-t-lg px-3 py-2 text-white ${a.color}`}>
              <p className="font-semibold">{a.titulo}</p>
            </div>
            <div className="px-3 py-2">
              <p className="text-xs text-slate-600">{a.descripcion}</p>
              <p className="mt-1 text-[11px] text-slate-400">{a.responsable ? `Responsable: ${a.responsable}` : "Responsable por asignar"}</p>
              <p className="mt-1 text-[11px] text-slate-400">{a.rutas.length} módulo(s)</p>
            </div>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-xs text-slate-400">
        Las mismas áreas están en la barra de arriba. Para ver todo el catálogo: <Link to="/guia" className="underline">Guía de uso</Link>.
      </p>
    </div>
  );
}

function TarjetaIndicador({ ind }: { ind: Indicador }) {
  const { perfil } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ["indicador", ind.clave, perfil?.id],
    enabled: !!perfil,
    staleTime: 60_000,
    queryFn: () => ind.consulta(perfil!),
  });
  const alerta = !!data?.alerta;
  return (
    <Link to={ind.ruta} className={`rounded-lg border p-3 ${alerta ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{ind.etiqueta}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${alerta ? "text-amber-900" : "text-slate-900"}`}>{isLoading ? "…" : error ? "—" : data?.valor}</p>
      <p className="text-xs text-slate-500">{error ? "sin acceso" : (data?.detalle ?? "")}</p>
    </Link>
  );
}

/** Pantalla de un área del organigrama: sus indicadores y sus módulos. */
export function Area() {
  const { clave } = useParams();
  const area = areaDeClave(clave);
  if (!area) return <Navigate to="/" replace />;
  const entradas = entradasDeArea(area);
  const indicadores = INDICADORES.filter((i) => area.rutas.some((r) => i.ruta === r || i.ruta.startsWith(`${r}/`)));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500">
            <Link to="/" className="underline">
              Organigrama
            </Link>{" "}
            · {area.titulo}
          </p>
          <h1 className="text-xl font-semibold text-slate-900">{area.titulo}</h1>
          <p className="text-sm text-slate-500">{area.descripcion}</p>
        </div>
        <p className="text-xs text-slate-500">{area.responsable ? `Responsable: ${area.responsable}` : "Responsable por asignar"}</p>
      </div>

      {indicadores.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Indicadores del área</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {indicadores.map((i) => (
              <TarjetaIndicador key={i.clave} ind={i} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Módulos</h2>
        <div className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
          {entradas.map((e) => (
            <Link key={e.ruta} to={e.ruta} className="grid gap-1 px-3 py-2 hover:bg-slate-50 sm:grid-cols-[200px_1fr]">
              <span className="font-medium text-slate-900">{e.etiqueta}</span>
              <span className="text-sm text-slate-600">
                {e.descripcion ? e.descripcion.charAt(0).toUpperCase() + e.descripcion.slice(1) + "." : ""}
                {e.uso && <span className="block text-xs text-slate-500">{e.uso}</span>}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
