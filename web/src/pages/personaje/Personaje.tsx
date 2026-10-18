import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { avanceDelDia, claseDe, habilidades, logros, misionesDelDia, nivelDe, oficios, rangoDe } from "../../lib/personaje";
import { AvatarPixel } from "../../components/personaje/AvatarPixel";
import { CrearAvatar } from "../../components/personaje/CrearAvatar";
import { CredencialQr } from "../../components/personaje/CredencialQr";
import { PersonajeDelDia } from "../../components/personaje/PersonajeDelDia";
import { useEquipo, useMiAvatar, useMiPersonaje } from "../../components/personaje/datos";

/** Mi personaje (18-oct-2026): hoja con nivel, habilidades, oficios, logros,
 * misiones del día y el equipo de la organización. */
export function Personaje() {
  const { perfilReal } = useAuth();
  const [params, setParams] = useSearchParams();
  const pestana = params.get("tab") === "equipo" ? "equipo" : params.get("tab") === "qr" ? "qr" : "yo";
  const [crear, setCrear] = useState(params.get("crear") === "1");
  const hoja = useMiPersonaje();
  const avatar = useMiAvatar();
  const equipo = useEquipo(pestana === "equipo");
  if (!perfilReal) return null;
  if (perfilReal.rol === "pendiente") return <p className="text-sm text-slate-500">Tu cuenta todavía no tiene acceso.</p>;
  const clase = claseDe(perfilReal.rol, perfilReal.modulos ?? []);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">Mi personaje</h1>
        <div className="flex gap-1 rounded border border-slate-300 p-0.5 text-sm">
          {(["yo", "qr", "equipo"] as const).map((p) => (
            <button key={p} type="button" onClick={() => setParams(p === "yo" ? {} : { tab: p })} className={`rounded px-3 py-1 ${pestana === p ? "bg-slate-900 text-white" : "text-slate-600"}`}>
              {p === "yo" ? "Yo" : p === "qr" ? "🪪 Mi QR" : "Equipo"}
            </button>
          ))}
        </div>
      </div>

      {pestana === "yo" && (
        <>
          {(crear || (!avatar.isLoading && !avatar.data)) && <CrearAvatar alTerminar={() => setCrear(false)} />}
          {!crear && avatar.data && (
            <button type="button" className="text-sm text-sky-700 underline" onClick={() => setCrear(true)}>
              Cambiar mi foto de personaje
            </button>
          )}
          <PersonajeDelDia />
          {hoja.data && <HojaCompleta />}
        </>
      )}

      {pestana === "qr" && <CredencialQr />}

      {pestana === "equipo" && (
        <div>
          <p className="mb-3 text-sm text-slate-600">Tu equipo, ordenado por experiencia. La barra es lo que lleva cada quien de sus misiones de hoy.</p>
          {equipo.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(equipo.data ?? []).map((m, i) => {
              const c = claseDe(m.rol);
              const n = nivelDe(m.xp);
              const total = m.hechas_hoy + m.pendientes_hoy;
              return (
                <li key={m.profile_id} className={`flex gap-3 rounded-lg border-2 p-2 ${m.profile_id === perfilReal.id ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white"}`}>
                  <AvatarPixel avatar={m.avatar} nombre={m.nombre} color={c.color} tamano={56} nivel={n.nivel} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium text-slate-900">
                      {i < 3 ? ["🥇", "🥈", "🥉"][i] + " " : ""}
                      {m.nombre}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {c.icono} {m.titulo || c.nombre} · {rangoDe(n.nivel)}
                    </p>
                    <p className="font-mono text-xs text-slate-500">
                      {m.xp} XP{m.racha >= 2 ? ` · 🔥${m.racha}` : ""}
                      {m.vencidas ? <span className="text-red-600"> · {m.vencidas} atrasada{m.vencidas === 1 ? "" : "s"}</span> : null}
                    </p>
                    {total > 0 && (
                      <div className="mt-1 h-2 overflow-hidden rounded bg-slate-200" title={`Hoy ${m.hechas_hoy} de ${total}`}>
                        <div className="h-full bg-emerald-500" style={{ width: `${Math.round((m.hechas_hoy / total) * 100)}%` }} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="text-xs text-slate-400">
        Cómo se gana experiencia: tarea terminada +10 · día que checas entrada +3 · tarea que creas +2 · comentario en una tarjeta +1. <span className="font-mono">{clase.icono}</span> Tu
        clase sale de tu puesto.
      </p>
    </div>
  );
}

function HojaCompleta() {
  const { perfilReal } = useAuth();
  const hoja = useMiPersonaje();
  const avatar = useMiAvatar();
  if (!hoja.data || !perfilReal) return null;
  const s = hoja.data.stats;
  const nivel = nivelDe(s.xp);
  const misiones = misionesDelDia(hoja.data);
  const avance = avanceDelDia(misiones);
  const mods = oficios(perfilReal.modulos ?? []);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="mb-1 font-semibold text-slate-800">
          Nivel {nivel.nivel} · {rangoDe(nivel.nivel)}
        </h2>
        <div className="h-3 overflow-hidden rounded border border-slate-900 bg-slate-200">
          <div className="h-full bg-amber-400" style={{ width: `${nivel.progreso}%` }} />
        </div>
        <p className="mt-1 font-mono text-xs text-slate-500">
          {s.xp} / {nivel.hasta} XP para el nivel {nivel.nivel + 1}
        </p>
        <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-700">Habilidades (últimos 30 días)</h3>
        <ul className="space-y-1.5">
          {habilidades(s).map((h) => (
            <li key={h.clave} title={h.ayuda}>
              <div className="flex justify-between text-xs text-slate-600">
                <span>{h.nombre}</span>
                <span className="font-mono">{h.valor == null ? "—" : `${h.valor}`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-slate-200">
                <div className="h-full bg-sky-500" style={{ width: `${h.valor ?? 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
        {mods.length > 0 && (
          <>
            <h3 className="mb-1 mt-3 text-sm font-semibold text-slate-700">Oficios</h3>
            <div className="flex flex-wrap gap-1">
              {mods.map((m) => (
                <span key={m} className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs">
                  {m}
                </span>
              ))}
            </div>
          </>
        )}
        <p className="mt-3 font-mono text-xs text-slate-500">
          {s.tareas_terminadas} tareas terminadas · {s.dias_checados} días checados · {s.tarjetas_creadas} creadas · {s.comentarios} comentarios
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <h2 className="mb-1 font-semibold text-slate-800">
          Misiones de hoy · {avance.hechas}/{avance.total}
        </h2>
        {!misiones.length && <p className="text-sm text-slate-500">Sin misiones con fecha para hoy.</p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {misiones.map((m) => (
            <li key={m.clave}>
              <Link to={m.liga ?? "#"} className={`flex items-center justify-between gap-2 py-1.5 ${m.hecha ? "text-slate-400 line-through" : m.urgente ? "text-red-700" : "text-slate-800"}`}>
                <span className="min-w-0">
                  <span className="mr-1">{m.hecha ? "✅" : m.urgente ? "⚠️" : "◻️"}</span>
                  {m.titulo}
                  <span className="block text-xs text-slate-400 no-underline">{m.detalle}</span>
                </span>
                {m.xp > 0 && <span className="shrink-0 font-mono text-xs text-amber-700">+{m.xp}</span>}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Esta semana vienen {hoja.data.proximas_7} más{hoja.data.sin_fecha ? ` · ${hoja.data.sin_fecha} sin fecha` : ""}.{" "}
          <Link to="/tareas#mis-actividades" className="text-sky-700 underline">
            Ver todas
          </Link>
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-3 md:col-span-2">
        <h2 className="mb-2 font-semibold text-slate-800">Logros</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {logros(s, !!avatar.data).map((l) => (
            <li key={l.clave} title={l.descripcion} className={`rounded border p-2 text-center text-xs ${l.logrado ? "border-amber-400 bg-amber-50 text-slate-800" : "border-slate-200 text-slate-400 grayscale"}`}>
              <div className="text-2xl">{l.icono}</div>
              <div className="font-medium">{l.nombre}</div>
              <div className="text-[10px]">{l.descripcion}</div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
