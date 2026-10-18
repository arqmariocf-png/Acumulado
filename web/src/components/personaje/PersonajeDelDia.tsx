import { Link } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { avanceDelDia, claseDe, dialogoNpc, misionesDelDia, nivelDe } from "../../lib/personaje";
import { AvatarPixel } from "./AvatarPixel";
import { useMiAvatar, useMiPersonaje } from "./datos";

function horaMexico(): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hour12: false }).format(new Date())) % 24;
}

/** Tarjeta del inicio: tu personaje, lo que te dice hoy y la barra del día. */
export function PersonajeDelDia() {
  const { perfilReal } = useAuth();
  const hoja = useMiPersonaje();
  const avatar = useMiAvatar();
  if (!perfilReal || hoja.isLoading || !hoja.data) return null;
  const clase = claseDe(perfilReal.rol, perfilReal.modulos ?? []);
  const nivel = nivelDe(hoja.data.stats.xp);
  const misiones = misionesDelDia(hoja.data);
  const avance = avanceDelDia(misiones);
  const siguientes = misiones.filter((m) => !m.hecha).slice(0, 3);

  return (
    <section className="mb-4 rounded-lg border-2 border-slate-900 bg-gradient-to-br from-slate-50 to-amber-50 p-3 shadow-[3px_3px_0_rgba(15,23,42,0.5)]">
      <div className="flex gap-3">
        <Link to="/personaje" className="shrink-0" title="Ver mi personaje">
          <AvatarPixel avatar={avatar.data?.avatar} nombre={perfilReal.nombre ?? ""} color={clase.color} tamano={72} nivel={nivel.nivel} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="font-semibold text-slate-900">
              {clase.icono} {avatar.data?.titulo || clase.nombre} · nivel {nivel.nivel}
            </p>
            <span className="font-mono text-xs text-slate-500">
              {hoja.data.stats.xp} XP{hoja.data.stats.racha >= 2 ? ` · 🔥 ${hoja.data.stats.racha} días` : ""}
            </span>
          </div>
          <div className="relative mt-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800">{dialogoNpc(perfilReal.nombre ?? "", misiones, horaMexico(), hoja.data.stats)}</div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-3 flex-1 overflow-hidden rounded border border-slate-900 bg-slate-200">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${avance.pct}%` }} />
            </div>
            <span className="whitespace-nowrap font-mono text-xs text-slate-600">
              hoy {avance.hechas}/{avance.total}
            </span>
          </div>
        </div>
      </div>
      {siguientes.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {siguientes.map((m) => (
            <li key={m.clave}>
              <Link to={m.liga ?? "/personaje"} className={`flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-white ${m.urgente ? "text-red-700" : "text-slate-700"}`}>
                <span className="truncate">
                  {m.urgente ? "⚠️" : "◻️"} {m.titulo}
                </span>
                {m.xp > 0 && <span className="shrink-0 font-mono text-xs text-amber-700">+{m.xp} XP</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs">
        {!avatar.isLoading && !avatar.data ? (
          <Link to="/personaje?crear=1" className="rounded bg-slate-900 px-2 py-1 font-medium text-white">
            📷 Crea tu personaje con tu foto
          </Link>
        ) : (
          <Link to="/personaje?tab=qr" className="rounded border border-slate-900 bg-white px-2 py-1 font-medium text-slate-900">
            🪪 Mi QR (comedor, almacén, mostrador)
          </Link>
        )}
        <Link to="/personaje" className="text-sky-700 underline">
          Ver mi personaje y al equipo
        </Link>
      </div>
    </section>
  );
}
