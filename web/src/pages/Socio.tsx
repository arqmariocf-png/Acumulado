import { useState, type FormEvent } from "react";
import { Link, Navigate, Outlet } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { AREAS } from "../lib/organigrama";
import { indicadorPorClave } from "../lib/indicadores";
import { useEsSocio, useResumenSocio, useSociosAdmin } from "../lib/socio";
import { cifrasTarjeta, dineroMx, formatearKpiEmpresa, saldoGrupo, tieneKpiEmpresa, type EmpresaSocio, type GrupoSocio } from "../lib/kpisEmpresa";
import { COLOR_PUNTO, semaforo, useKpis, type KpiConfig } from "./Organigrama";

/** Nivel socio (arriba de la dirección general): las organizaciones en las
 * que participa la persona (Grupo Loma, ARSSA…) con sus empresas y los KPIs
 * de cada una. El admin ve todas; un socio (socios_organizacion) solo las
 * suyas. Desde aquí se entra al organigrama de una empresa (filtrado) o del
 * grupo completo. */
export function Socio() {
  const { perfil } = useAuth();
  const { data, isLoading, error } = useResumenSocio(true);
  const { data: kpis } = useKpis();
  const esAdmin = perfil?.rol === "admin";

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
        <SeccionGrupo key={g.id} grupo={g} kpis={kpis ?? []} esAdmin={esAdmin} />
      ))}
      {data && data.grupos.length === 0 && <p className="text-sm text-slate-500">No tienes organizaciones asignadas como socio.</p>}

      {data && (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" /> en orden</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400" /> requiere atención</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" /> urgente</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-sky-400" /> informativo</span>
          <span className="ml-auto">Calculado {new Date(data.calculado_en).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</span>
          {!esAdmin && (
            <Link to="/inicio" className="underline">
              Mi inicio de trabajo
            </Link>
          )}
          {esAdmin && (
            <Link to="/organigrama/configurar" className="underline">
              Configurar KPIs
            </Link>
          )}
        </div>
      )}

      {esAdmin && <AdminSocios />}
    </div>
  );
}

/** Guarda de ruta: admin o socio. Mientras se resuelve, no se redirige. */
export function RutaSocio() {
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === "admin";
  const { data, isLoading } = useEsSocio(esAdmin ? undefined : perfil?.id);
  if (esAdmin) return <Outlet />;
  if (isLoading) return <p className="text-sm text-slate-400">Cargando…</p>;
  if ((data?.length ?? 0) > 0) return <Outlet />;
  return <Navigate to="/" replace />;
}

function SeccionGrupo({ grupo, kpis, esAdmin }: { grupo: GrupoSocio; kpis: KpiConfig[]; esAdmin: boolean }) {
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
        {grupo.es_maestro && esAdmin && (
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

/** Solo admin: quién es socio de qué organización y si la vista de socio es
 * su primera pantalla. Aldo → ARSSA, Laura → ARSSA, y así los demás. */
function AdminSocios() {
  const queryClient = useQueryClient();
  const { data, error } = useSociosAdmin(true);
  const { data: perfiles } = useQuery({
    queryKey: ["perfiles-para-socio"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, nombre, rol").neq("rol", "pendiente").eq("activo", true).order("nombre");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; nombre: string | null; rol: string }[];
    },
  });
  const [profileId, setProfileId] = useState("");
  const [grupoId, setGrupoId] = useState("");
  const [inicio, setInicio] = useState(true);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["socios-admin"] });
    queryClient.invalidateQueries({ queryKey: ["socio-propio"] });
  };

  const asignar = useMutation({
    mutationFn: async (v: { profile: string; grupo: string; inicio: boolean }) => {
      const { error } = await supabase.rpc("fn_socio_asignar", { p_profile: v.profile, p_grupo: v.grupo, p_inicio: v.inicio });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      invalidar();
      setMensaje("Socio guardado.");
    },
    onError: (e) => setMensaje((e as Error).message),
  });
  const quitar = useMutation({
    mutationFn: async (v: { profile: string; grupo: string }) => {
      const { error } = await supabase.rpc("fn_socio_quitar", { p_profile: v.profile, p_grupo: v.grupo });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidar,
    onError: (e) => setMensaje((e as Error).message),
  });

  function onAsignar(e: FormEvent) {
    e.preventDefault();
    if (!profileId || !grupoId) return;
    asignar.mutate({ profile: profileId, grupo: grupoId, inicio });
  }

  return (
    <section className="mt-8 rounded border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-900">Socios por organización</h2>
        <p className="text-xs text-slate-500">
          Un socio ve esta misma pantalla solo con las organizaciones que le asignes. "Primera pantalla" = entra directo aquí; si no, la abre desde el
          menú y conserva su inicio de trabajo.
        </p>
      </div>
      {error && <p className="px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-1.5">Socio</th>
            <th className="px-3 py-1.5">Rol</th>
            <th className="px-3 py-1.5">Organización</th>
            <th className="px-3 py-1.5">Primera pantalla</th>
            <th className="px-3 py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {(data?.socios ?? []).map((s) => (
            <tr key={`${s.profile_id}-${s.grupo_id}`} className="border-t border-slate-100">
              <td className="px-3 py-1.5 text-slate-900">{s.nombre ?? s.profile_id}</td>
              <td className="px-3 py-1.5 text-slate-500">{s.rol}</td>
              <td className="px-3 py-1.5">{s.grupo_nombre}</td>
              <td className="px-3 py-1.5">
                <input type="checkbox" checked={s.inicio} onChange={(e) => asignar.mutate({ profile: s.profile_id, grupo: s.grupo_id, inicio: e.target.checked })} />
              </td>
              <td className="px-3 py-1.5 text-right">
                <button onClick={() => quitar.mutate({ profile: s.profile_id, grupo: s.grupo_id })} className="text-xs text-red-600 underline">
                  quitar
                </button>
              </td>
            </tr>
          ))}
          {data && data.socios.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-400">
                Todavía no hay socios asignados.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form onSubmit={onAsignar} className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2">
        <select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
          <option value="">Persona…</option>
          {(perfiles ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre ?? p.id} · {p.rol}
            </option>
          ))}
        </select>
        <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
          <option value="">Organización…</option>
          {(data?.grupos ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.marca_comercial ?? g.nombre}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={inicio} onChange={(e) => setInicio(e.target.checked)} /> primera pantalla
        </label>
        <button disabled={!profileId || !grupoId || asignar.isPending} className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50">
          Agregar socio
        </button>
        {mensaje && <span className="text-xs text-slate-500">{mensaje}</span>}
      </form>
      <p className="px-3 pb-2 text-[11px] text-slate-400">Si la persona no aparece es porque todavía no tiene cuenta: pídele que se registre y asígnale rol en Admin.</p>
    </section>
  );
}
