import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { NIVELES, nivelPorClave } from "../../lib/cuentaNomina";

const dinero = (n: number | null | undefined) => (n ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });

interface Disponible {
  tiene: boolean;
  nivel?: string;
  estatus?: string;
  linea?: number;
  saldo?: number;
  disponible?: number;
  atraso?: number;
  plazo_max_semanas?: number;
  descuento_maximo?: number;
}

/** Mi cuenta de nómina (18-oct-2026): nivel, línea, disponible y mis
 * próximos descuentos. Estilo Mercado Pago, sin intereses. */
export function MiCuentaNomina() {
  const { perfilReal } = useAuth();
  const disp = useQuery({
    queryKey: ["mi-cuenta-nomina", perfilReal?.id],
    enabled: !!perfilReal?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_nomina_disponible", { p_profile: perfilReal!.id });
      if (error) throw error;
      return data as Disponible;
    },
  });
  const cargos = useQuery({
    queryKey: ["mis-cargos-nomina", perfilReal?.id],
    enabled: !!disp.data?.tiene,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_nomina_cargos")
        .select("id, concepto, monto, pagos, descuento_por_pago, saldo, siguiente_descuento, atraso, primer_descuento")
        .eq("profile_id", perfilReal!.id)
        .eq("estatus", "vigente")
        .order("primer_descuento");
      if (error) throw error;
      return (data ?? []) as { id: string; concepto: string; monto: number; pagos: number; descuento_por_pago: number; saldo: number; siguiente_descuento: number; atraso: number }[];
    },
  });
  if (!disp.data) return null;
  if (!disp.data.tiene || !disp.data.linea) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
        <h2 className="mb-1 font-semibold text-slate-800">💳 Mi cuenta de nómina</h2>
        Todavía no tienes línea. Se abre con tu antigüedad, tu asistencia, tus tareas a tiempo y el buen cuidado de la herramienta; RH revisa el estudio.
      </section>
    );
  }
  const d = disp.data;
  const nivel = nivelPorClave(d.nivel);
  const idx = NIVELES.findIndex((n) => n.clave === nivel.clave);
  const usado = d.linea ? Math.min(100, Math.round(((d.saldo ?? 0) / d.linea) * 100)) : 0;
  return (
    <section className="rounded-lg border-2 border-slate-900 bg-gradient-to-br from-sky-50 to-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-800">💳 Mi cuenta de nómina</h2>
        <span className={`rounded px-2 py-0.5 text-sm ${nivel.clase}`}>
          {nivel.icono} Nivel {nivel.nombre}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <div className="text-xs text-slate-500">Disponible</div>
          <div className="text-lg font-bold text-emerald-700">{dinero(d.disponible)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Línea</div>
          <div className="font-semibold">{dinero(d.linea)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Debes</div>
          <div className="font-semibold">{dinero(d.saldo)}</div>
        </div>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200">
        <div className="h-full bg-sky-500" style={{ width: `${usado}%` }} />
      </div>
      {d.atraso ? <p className="mt-2 text-sm text-red-700">Tienes {dinero(d.atraso)} atrasado: mientras no te pongas al corriente no puedes usar tu línea.</p> : null}
      {(cargos.data ?? []).length > 0 && (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {(cargos.data ?? []).map((c) => (
            <li key={c.id} className="flex justify-between py-1">
              <span>{c.concepto}</span>
              <span className="text-xs text-slate-600">
                próximo viernes {dinero(c.siguiente_descuento)} · resta {dinero(c.saldo)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Úsala en el mostrador con tu QR. Hasta {d.plazo_max_semanas} pagos semanales, <b>sin intereses</b>.
        {idx < NIVELES.length - 1 && ` Paga a tiempo, checa todos los días y termina tus tareas para subir a ${NIVELES[idx + 1].icono} ${NIVELES[idx + 1].nombre}.`}
      </p>
    </section>
  );
}
