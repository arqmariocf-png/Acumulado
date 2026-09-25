import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { AREAS } from "../lib/organigrama";
import { indicadorPorClave } from "../lib/indicadores";
import { useResumenSocio } from "../lib/socio";
import { cifrasTarjeta, dineroMx, formatearKpiEmpresa, saldoGrupo, tieneKpiEmpresa, type EmpresaSocio, type GrupoSocio } from "../lib/kpisEmpresa";
import { COLOR_PUNTO, semaforo, useKpis, type KpiConfig } from "./Organigrama";

/** Nivel socio (arriba de la dirección general): todas las organizaciones en
 * las que participa Mario (Grupo Loma y, de ejemplo, ARSSA) con sus empresas
 * y los KPIs de cada una. Desde aquí se entra al organigrama de una empresa
 * (filtrado) o del grupo completo. */
export function Socio() {
  const { perfil } = useAuth();
  const { data, isLoading, error } = useResumenSocio(true);
  const { data: kpis } = useKpis();

  return (
    <div>
      <div className="mb-6 text-center">
        <div className="inline-block rounded-lg bg-slate-900 px-6 py-3 text-white">
          <p className="text-[11px] uppercase tracking-wide text-slate-300">Socio</p>
          <p className="font-semibold">{perfil?.nombre ?? "—"}</p>
        </div>
        <div className="mx-auto h-6 w-px bg-slate-300" />
      </div>

      {isLoading && <p className="text-sm text-slate-500">Calculando KPIs de todas las empresas…</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>}

      {data?.grupos.map((g) => (
        <SeccionGrupo key={g.id} grupo={g} kpis={kpis ?? []} />
      ))}

      {data && (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" /> en orden</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> requiere atención</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" /> urgente</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-400" /> informativo</span>
          <span className="ml-auto">Calculado {new Date(data.calculado_en).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
          <Link to="/organigrama/configurar" className="underline">
            Configurar KPIs
          </Link>
        </div>
      )}
    </div>
  );
}

function SeccionGrupo({ grupo, kpis }: { grupo: GrupoSocio; kpis: KpiConfig[] }) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 pb-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {grupo.marca_comercial ?? grupo.nombre}
            {grupo.es_maestro && <span className="ml-2 rounded bg-slate-100 px-1.5 text-[10px] font-normal uppercase tracking-wide text-slate-500">organización maestra</span>}
          </h2>
          <p className="text-xs text-slate-500">
            {grupo.empresas.length === 1 ? "1 empresa" : `${grupo.empresas.length} empresas`}
            {grupo.empresas.length > 0 && <> · saldo en bancos {dineroMx(saldoGrupo(grupo))}</>}
          </p>
        </div>
        {grupo.es_maestro && (
          <Link to="/organigrama" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Organigrama del grupo completo →
          </Link>
        )}
      </div>
      {grupo.empresas.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-400">
          Todavía no hay empresas dadas de alta en esta organización.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {grupo.empresas.map((e) => (
            <TarjetaEmpresa key={e.id} empresa={e} kpis={kpis} />
          ))}
        </div>
      )}
    </section>
  );
}

function TarjetaEmpresa({ empresa, kpis }: { empresa: EmpresaSocio; kpis: KpiConfig[] }) {
  const cifras = cifrasTarjeta(empresa.kpis);
  return (
    <Link to={`/organigrama?empresa=${empresa.id}`} className={`rounded-lg border bg-white transition hover:border-slate-400 hover:shadow-sm ${empresa.activo ? "border-slate-200" : "border-slate-100 opacity-60"}`}>
      <div className="rounded-t-lg bg-slate-800 px-3 py-2 text-white">
        <p className="text-[11px] uppercase tracking-wide text-slate-300">{empresa.codigo}</p>
        <p className="line-clamp-2 font-semibold leading-tight">{empresa.nombre}</p>
      </div>
      <div className="space-y-1 px-3 py-2">
        {AREAS.map((a) => {
          const del = kpis.filter((k) => k.area === a.clave && k.activo && tieneKpiEmpresa(empresa.kpis, k.indicador));
          if (del.length === 0) return null;
          return (
            <div key={a.clave} className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="w-24 shrink-0 truncate">{a.titulo}</span>
              <span className="flex flex-wrap items-center gap-1">
                {del.map((k) => (
                  <PuntoEmpresa key={k.id} k={k} empresa={empresa} />
                ))}
              </span>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 px-3 py-2 text-xs">
        {cifras.map((c) => (
          <div key={c.etiqueta}>
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{c.etiqueta}</p>
            <p className={`font-semibold tabular-nums ${c.alerta ? "text-red-600" : "text-slate-900"}`}>{c.valor}</p>
          </div>
        ))}
      </div>
    </Link>
  );
}

function PuntoEmpresa({ k, empresa }: { k: KpiConfig; empresa: EmpresaSocio }) {
  const ind = indicadorPorClave(k.indicador);
  if (!ind) return null;
  const r = formatearKpiEmpresa(k.indicador, empresa.kpis[k.indicador]);
  const estado = semaforo(r.valor, k, ind);
  return (
    <span
      title={`${k.etiqueta ?? ind.etiqueta}: ${r.valor}${r.detalle ? ` (${r.detalle})` : ""}`}
      className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_PUNTO[estado]} ${estado === "rojo" ? "ring-2 ring-red-200" : ""}`}
    />
  );
}
