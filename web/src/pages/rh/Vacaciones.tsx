import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import {
  calendarioAusencias, diaDeRegreso, diasHabiles, ETIQUETA_ESTADO, ETIQUETA_TIPO, fechaCorta, resumenAusencia, revisarSolicitud, sumarDias, vacacionesHabilitadas,
  type Ausencia, type EstadoAusencia, type SaldoVacaciones, type TipoAusencia,
} from "../../lib/vacaciones";

// Vacaciones y permisos (3-nov-2026, Mario: "habilitar un módulo de
// vacaciones, con recordatorio de quién se va y cuándo regresa"). Cada
// persona ve su saldo de ley y pide; su jefe directo o RH piden por ella; RH,
// dirección y admin autorizan y ven quién está fuera, quién sale y quién
// regresa. Los recordatorios push los manda la base a las 8:00 del día
// anterior (fn_vacaciones_recordatorios).

interface Persona {
  personal_id: string;
  nombre: string;
  puesto: string | null;
  empresa: string | null;
  profile_id: string | null;
  supervisor_profile_id: string | null;
  fecha_ingreso: string;
  a_mi_cargo: boolean;
  saldo: SaldoVacaciones | null;
}

const campo = "rounded border border-slate-300 px-2 py-1.5 text-sm";
const COLOR_ESTADO: Record<EstadoAusencia, string> = {
  solicitada: "bg-amber-100 text-amber-800",
  autorizada: "bg-emerald-100 text-emerald-800",
  rechazada: "bg-red-100 text-red-800",
  cancelada: "bg-slate-100 text-slate-600",
};
const hoyMx = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
const mensajeError = (e: unknown) => ((e as { message?: string })?.message ?? String(e)).replace(/^.*?ERROR:\s*/, "");

export function Vacaciones() {
  const { perfil } = useAuth();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const opera = !!perfil && ["rh", "admin", "direccion"].includes(perfil.rol);
  const hoy = hoyMx();

  const { data: personas = [], isLoading: cargandoPersonas } = useQuery({
    queryKey: ["vacaciones", "personas"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_vacaciones_personas");
      if (error) throw error;
      return (data ?? []) as Persona[];
    },
  });
  const { data: ausencias = [] } = useQuery({
    queryKey: ["vacaciones", "lista"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vacaciones").select("*").gte("hasta", sumarDias(hoy, -180)).order("desde", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Ausencia[];
    },
  });

  const yo = personas.find((p) => p.profile_id === perfil?.id) ?? null;
  const equipo = personas.filter((p) => p.profile_id !== perfil?.id);
  const veEquipo = opera || equipo.length > 0;
  const pestanas = [
    { clave: "mias", titulo: "Mis vacaciones" },
    ...(veEquipo ? [{ clave: "equipo", titulo: opera ? "Equipo (RH)" : "Mi equipo" }] : []),
  ];
  const actual = pestanas.find((p) => p.clave === params.get("tab"))?.clave ?? "mias";
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ["vacaciones"] });

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Vacaciones y permisos</h1>
      <p className="mb-3 text-sm text-slate-500">
        Los días de ley se ganan al cumplir cada año de antigüedad (art. 76 LFT; con menos de un año solo permisos); se descuentan solo días hábiles de tu jornada, sin domingos ni festivos. El día anterior a salir y a regresar llega un recordatorio a ti, a tu jefe y a RH.
      </p>
      {pestanas.length > 1 && (
        <div className="mb-4 flex gap-1 border-b border-slate-200">
          {pestanas.map((p) => (
            <button key={p.clave} type="button" onClick={() => setParams({ tab: p.clave })} className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${actual === p.clave ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500"}`}>
              {p.titulo}
            </button>
          ))}
        </div>
      )}
      {actual === "mias" && (
        cargandoPersonas ? <p className="text-sm text-slate-400">Cargando…</p>
        : !yo ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Tu cuenta no está ligada a un expediente de RH, así que no hay saldo de vacaciones que mostrar. Pide a RH que ligue tu expediente en RH › Accesos al sistema.
          </p>
        ) : (
          <MisVacaciones yo={yo} ausencias={ausencias.filter((a) => a.personal_id === yo.personal_id)} hoy={hoy} opera={opera} alCambiar={refrescar} />
        )
      )}
      {actual === "equipo" && veEquipo && (
        <Equipo personas={personas} ausencias={ausencias} hoy={hoy} opera={opera} alCambiar={refrescar} />
      )}
    </div>
  );
}

function Saldo({ s, titulo }: { s: SaldoVacaciones | null; titulo: string }) {
  if (!s) return null;
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm">
      <div className="font-medium text-slate-900">{titulo}</div>
      {!vacacionesHabilitadas(s) && (
        <p className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
          Las vacaciones se habilitan al cumplir un año de antigüedad{s.habilitado_desde ? `: a partir del ${fechaCorta(s.habilitado_desde)} ${s.habilitado_desde.slice(0, 4)}` : ""}. Mientras, se piden permisos.
        </p>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 tabular-nums text-slate-700">
        <span><b className="text-lg">{s.disponibles}</b> disponibles</span>
        <span>{s.dias_ley} de ley ({s.anios_cumplidos >= 1 ? `${s.anios_cumplidos} año${s.anios_cumplidos === 1 ? "" : "s"} cumplido${s.anios_cumplidos === 1 ? "" : "s"}` : "menos de un año"})</span>
        <span>{s.tomados} tomados</span>
        {s.pendientes > 0 && <span className="text-amber-700">{s.pendientes} por autorizar</span>}
      </div>
      <div className="text-xs text-slate-500">Periodo del {fechaCorta(s.periodo_desde)} al {fechaCorta(s.periodo_hasta)} · jornada de {s.dias_semana} días</div>
    </div>
  );
}

function FormularioSolicitud({ persona, personas, opera, alGuardar }: { persona: Persona; personas: Persona[]; opera: boolean; alGuardar: () => void }) {
  const [tipo, setTipo] = useState<TipoAusencia>("vacaciones");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [cubre, setCubre] = useState("");
  const [notas, setNotas] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const diasSemana = persona.saldo?.dias_semana ?? 6;
  const dias = diasHabiles(desde, hasta, diasSemana);
  const problema = desde && hasta ? revisarSolicitud({ tipo, desde, hasta, diasSemana, saldo: persona.saldo, puedeExceder: opera }) : null;
  const cubren = personas.filter((p) => p.profile_id && p.personal_id !== persona.personal_id);

  const guardar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("fn_vacaciones_solicitar", {
        p_personal: persona.personal_id, p_tipo: tipo, p_desde: desde, p_hasta: hasta, p_notas: notas || null, p_cubre: cubre || null,
      });
      if (error) throw error;
      return data as { estado: EstadoAusencia; dias: number; regresa_el: string };
    },
    onSuccess: (r) => {
      setAviso(r.estado === "autorizada" ? `Registrada y autorizada: ${r.dias} días, regresa el ${fechaCorta(r.regresa_el)}.` : `Solicitud enviada a RH: ${r.dias} días, regresa el ${fechaCorta(r.regresa_el)}. Te avisamos cuando la resuelvan.`);
      setDesde(""); setHasta(""); setNotas(""); setCubre("");
      alGuardar();
    },
    onError: (e) => setAviso(mensajeError(e)),
  });

  return (
    <form
      data-sin-borrador
      className="rounded border border-slate-200 bg-white p-3 text-sm"
      onSubmit={(e) => { e.preventDefault(); if (!problema) guardar.mutate(); }}
    >
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1">Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoAusencia)} className={campo}>
            {(Object.keys(ETIQUETA_TIPO) as TipoAusencia[]).map((t) => <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">Primer día fuera
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={campo} required />
        </label>
        <label className="flex flex-col gap-1">Último día fuera
          <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className={campo} required />
        </label>
        {cubren.length > 0 && (
          <label className="flex flex-col gap-1">Quién cubre (opcional)
            <select value={cubre} onChange={(e) => setCubre(e.target.value)} className={campo}>
              <option value="">—</option>
              {cubren.map((p) => <option key={p.personal_id} value={p.profile_id!}>{p.nombre}</option>)}
            </select>
          </label>
        )}
      </div>
      <label className="mt-2 flex flex-col gap-1">Notas (opcional)
        <input value={notas} onChange={(e) => setNotas(e.target.value)} className={campo} maxLength={300} placeholder="motivo, pendientes que deja, contacto" />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {desde && hasta && !problema && (
          <span className="text-slate-700"><b>{dias}</b> día{dias === 1 ? "" : "s"} hábil{dias === 1 ? "" : "es"} · regresa el <b>{fechaCorta(diaDeRegreso(hasta, diasSemana))}</b></span>
        )}
        {problema && <span className="text-amber-700">{problema}</span>}
        <button type="submit" disabled={!!problema || !desde || !hasta || guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {opera ? "Registrar (queda autorizada)" : "Enviar solicitud"}
        </button>
        {aviso && <span className="text-slate-600">{aviso}</span>}
      </div>
    </form>
  );
}

function ListaAusencias({ lista, hoy, opera, alCambiar, conPersona = false }: { lista: Ausencia[]; hoy: string; opera: boolean; alCambiar: () => void; conPersona?: boolean }) {
  const [aviso, setAviso] = useState<string | null>(null);
  const resolver = useMutation({
    mutationFn: async ({ id, autorizar }: { id: string; autorizar: boolean }) => {
      let motivo: string | null = null;
      if (!autorizar) {
        motivo = window.prompt("Motivo del rechazo:");
        if (motivo === null) return null;
      }
      const { error } = await supabase.rpc("fn_vacaciones_resolver", { p_id: id, p_autorizar: autorizar, p_motivo: motivo });
      if (error) throw error;
      return true;
    },
    onSuccess: (r) => { if (r) alCambiar(); },
    onError: (e) => setAviso(mensajeError(e)),
  });
  const cancelar = useMutation({
    mutationFn: async (id: string) => {
      if (!window.confirm("¿Cancelar esta ausencia?")) return null;
      const { error } = await supabase.rpc("fn_vacaciones_cancelar", { p_id: id });
      if (error) throw error;
      return true;
    },
    onSuccess: (r) => { if (r) alCambiar(); },
    onError: (e) => setAviso(mensajeError(e)),
  });
  if (lista.length === 0) return <p className="text-sm text-slate-400">Sin registros.</p>;
  return (
    <div>
      {aviso && <p className="mb-2 text-sm text-red-700">{aviso}</p>}
      <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white text-sm">
        {lista.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className={`rounded px-1.5 py-0.5 text-xs ${COLOR_ESTADO[a.estado]}`}>{ETIQUETA_ESTADO[a.estado]}</span>
            {conPersona && <span className="font-medium text-slate-900">{a.personal_nombre}</span>}
            <span className="text-slate-500">{ETIQUETA_TIPO[a.tipo]}</span>
            <span className="text-slate-700">{resumenAusencia(a)}</span>
            {a.notas && <span className="text-xs text-slate-500">· {a.notas}</span>}
            {a.rechazo_motivo && <span className="text-xs text-red-700">· {a.rechazo_motivo}</span>}
            {a.solicitante_nombre && conPersona && <span className="text-xs text-slate-400">· pidió {a.solicitante_nombre}</span>}
            <span className="ml-auto flex gap-2">
              {opera && a.estado === "solicitada" && (
                <>
                  <button type="button" onClick={() => resolver.mutate({ id: a.id, autorizar: true })} className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white">Autorizar</button>
                  <button type="button" onClick={() => resolver.mutate({ id: a.id, autorizar: false })} className="rounded border border-red-300 px-2.5 py-1 text-xs text-red-700">Rechazar</button>
                </>
              )}
              {(a.estado === "solicitada" || a.estado === "autorizada") && (opera || a.desde > hoy) && (
                <button type="button" onClick={() => cancelar.mutate(a.id)} className="text-xs text-slate-500 underline">cancelar</button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MisVacaciones({ yo, ausencias, hoy, opera, alCambiar }: { yo: Persona; ausencias: Ausencia[]; hoy: string; opera: boolean; alCambiar: () => void }) {
  return (
    <div className="space-y-4">
      <Saldo s={yo.saldo} titulo={`Mi saldo de vacaciones · ${yo.nombre}`} />
      <section>
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Pedir vacaciones o permiso</h3>
        <FormularioSolicitud persona={yo} personas={[]} opera={opera} alGuardar={alCambiar} />
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Mis registros</h3>
        <ListaAusencias lista={ausencias} hoy={hoy} opera={opera} alCambiar={alCambiar} />
      </section>
    </div>
  );
}

function Equipo({ personas, ausencias, hoy, opera, alCambiar }: { personas: Persona[]; ausencias: Ausencia[]; hoy: string; opera: boolean; alCambiar: () => void }) {
  const [personaId, setPersonaId] = useState("");
  const [buscar, setBuscar] = useState("");
  const cal = useMemo(() => calendarioAusencias(ausencias, hoy), [ausencias, hoy]);
  const pendientes = ausencias.filter((a) => a.estado === "solicitada");
  const persona = personas.find((p) => p.personal_id === personaId) ?? null;
  const q = buscar.trim().toLowerCase();
  const filtradas = personas.filter((p) => !q || p.nombre.toLowerCase().includes(q) || (p.puesto ?? "").toLowerCase().includes(q) || (p.empresa ?? "").toLowerCase().includes(q));

  const Bloque = ({ titulo, lista, vacio }: { titulo: string; lista: Ausencia[]; vacio: string }) => (
    <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm">
      <div className="mb-1 font-medium text-slate-900">{titulo} <span className="text-slate-400">{lista.length}</span></div>
      {lista.length === 0 ? <div className="text-xs text-slate-400">{vacio}</div> : (
        <ul className="space-y-0.5">
          {lista.map((a) => (
            <li key={a.id}><b>{a.personal_nombre}</b> <span className="text-slate-500">{ETIQUETA_TIPO[a.tipo].toLowerCase()}</span> · {resumenAusencia(a)}</li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {pendientes.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold text-amber-800">Por autorizar ({pendientes.length})</h3>
          <ListaAusencias lista={pendientes} hoy={hoy} opera={opera} alCambiar={alCambiar} conPersona />
          {!opera && <p className="mt-1 text-xs text-slate-500">Autoriza RH.</p>}
        </section>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <Bloque titulo="Fuera hoy" lista={cal.fueraHoy} vacio="Nadie está fuera hoy." />
        <Bloque titulo="Salen en los próximos 7 días" lista={cal.salenProximos7} vacio="Nadie sale esta semana." />
        <Bloque titulo="Regresan en los próximos 7 días" lista={cal.regresanProximos7} vacio="Nadie regresa esta semana." />
        <Bloque titulo="Próximas (8 a 30 días)" lista={cal.proximas30} vacio="Nada programado." />
      </div>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Registrar para alguien</h3>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <select value={personaId} onChange={(e) => setPersonaId(e.target.value)} className={campo}>
            <option value="">Elige a la persona…</option>
            {personas.map((p) => <option key={p.personal_id} value={p.personal_id}>{p.nombre}{p.a_mi_cargo ? " · a mi cargo" : ""}{p.empresa ? ` · ${p.empresa}` : ""}</option>)}
          </select>
          {persona?.saldo && <span className="text-slate-600">{persona.saldo.disponibles} de {persona.saldo.dias_ley} días disponibles</span>}
        </div>
        {persona && <FormularioSolicitud key={persona.personal_id} persona={persona} personas={personas} opera={opera} alGuardar={() => { alCambiar(); }} />}
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Saldos por persona</h3>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar…" className={`${campo} mb-2 w-full max-w-xs`} />
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Persona</th><th className="px-3 py-2">Empresa</th><th className="px-3 py-2">Ingreso</th>
                <th className="px-3 py-2 text-right">Año</th><th className="px-3 py-2 text-right">De ley</th><th className="px-3 py-2 text-right">Tomados</th>
                <th className="px-3 py-2 text-right">Por autorizar</th><th className="px-3 py-2 text-right">Disponibles</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((p) => (
                <tr key={p.personal_id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5"><span className="font-medium text-slate-900">{p.nombre}</span>{p.puesto && <span className="ml-1 text-xs text-slate-500">{p.puesto}</span>}</td>
                  <td className="px-3 py-1.5 text-slate-600">{p.empresa ?? "—"}</td>
                  <td className="px-3 py-1.5 text-slate-600">{fechaCorta(p.fecha_ingreso)} {p.fecha_ingreso.slice(0, 4)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.saldo?.anio_servicio ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.saldo?.dias_ley ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{p.saldo?.tomados ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">{p.saldo?.pendientes || ""}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{p.saldo?.disponibles ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Historial (últimos 6 meses y lo programado)</h3>
        <ListaAusencias lista={ausencias} hoy={hoy} opera={opera} alCambiar={alCambiar} conPersona />
      </section>
    </div>
  );
}
