import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { diasVacacionesLFT, proyeccionAnual, ritmoPlanta, totalProyeccion, type LoteProyeccion, type PersonaProyeccion } from "../../lib/proyeccionPlanta";

// Proyección anual de la planta, solo director general (Mario, 10-oct-2026):
// programación actual + ritmo de la planta en los días libres, quitando
// festivos de ley, cierre de planta y vacaciones del personal; ventas,
// costos y utilidad sin IVA. Los supuestos se ajustan en la pantalla.

interface DatosProyeccion {
  empresa: string;
  personas: PersonaProyeccion[];
  lotes: LoteProyeccion[];
  mp_pieza: number | null;
  receta: { materia: string; por_pieza: number; costo: number | null }[] | null;
  precio_venta: number | null;
  vendido: number | null;
  gastos_mes: { mes: string; monto: number }[];
}

const $ = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }));
const num = (v: number, d = 0) => v.toLocaleString("es-MX", { maximumFractionDigits: d });
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const nombreMes = (k: string) => `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;

function hoyMx(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

export function ProyeccionAnualPlanta({ empresaId }: { empresaId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["proyeccion-planta", empresaId],
    queryFn: async () => {
      const { data: d, error: e } = await supabase.rpc("fn_proyeccion_planta_datos", { p_empresa: empresaId });
      if (e) throw e;
      return d as DatosProyeccion | null;
    },
  });
  if (isLoading) return <p className="text-sm text-slate-500">Calculando proyección…</p>;
  if (error) return <p className="text-sm text-red-600">{(error as Error).message}</p>;
  if (!data) return <p className="text-sm text-slate-500">Solo el director general ve la proyección anual.</p>;
  return <Proyeccion datos={data} />;
}

function Proyeccion({ datos }: { datos: DatosProyeccion }) {
  const mesActual = hoyMx().slice(0, 7);
  // Indirectos: promedio de los meses completos (el mes en curso va parcial).
  const completos = datos.gastos_mes.filter((g) => g.mes.slice(0, 7) < mesActual);
  const indirectosDefault = completos.length ? completos.reduce((s, g) => s + Number(g.monto), 0) / completos.length : 0;
  const nominaDefault = datos.personas.reduce((s, p) => s + Number(p.pago_semanal), 0);

  const [precio, setPrecio] = useState(String(datos.precio_venta ?? ""));
  const [pctVenta, setPctVenta] = useState("100");
  const [mpPieza, setMpPieza] = useState(String(Math.round(Number(datos.mp_pieza ?? 0) * 100) / 100));
  const [ritmo, setRitmo] = useState(String(ritmoPlanta(datos.lotes) ?? 5));
  const [nomina, setNomina] = useState(String(nominaDefault));
  const [indirectos, setIndirectos] = useState(String(Math.round(indirectosDefault)));
  const [cierre, setCierre] = useState("1");
  const [vacSin, setVacSin] = useState("12");

  const desde = hoyMx();
  const meses = useMemo(
    () =>
      proyeccionAnual(datos.lotes, datos.personas, {
        desde,
        precioVenta: Number(precio) || 0,
        pctVenta: Number(pctVenta) || 0,
        mpPieza: Number(mpPieza) || 0,
        piezasPorDia: Number(ritmo) || 0,
        nominaSemanal: Number(nomina) || 0,
        indirectosMes: Number(indirectos) || 0,
        semanasCierre: Number(cierre) || 0,
        diasVacacionesSinIngreso: Number(vacSin) || 0,
      }),
    [datos, desde, precio, pctVenta, mpPieza, ritmo, nomina, indirectos, cierre, vacSin],
  );
  const t = totalProyeccion(meses);
  const programados = datos.lotes.filter((l) => l.estado === "planeada" || l.estado === "en_proceso");
  const maxAbs = Math.max(1, ...meses.map((m) => Math.abs(m.utilidad)));
  const costoPieza = Number(precio) > 0 && t.vendidas > 0 ? (t.costoMp + t.nomina + t.indirectos) / t.vendidas : null;
  const campo = "w-full rounded border border-slate-300 px-2 py-1 text-sm";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-slate-700">Proyección a 12 meses · {datos.empresa}</h2>
        <p className="text-xs text-slate-500">
          Del {desde} a un año. Programación actual ({programados.map((l) => `lote ${l.folio}`).join(", ") || "sin lotes programados"}) y, en los días libres, el ritmo de la planta. Sin IVA.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tarjeta titulo="Producción" valor={`${num(t.piezas)} pzas`} nota={`${num(t.productivos, 1)} días productivos de ${t.habiles} hábiles`} />
        <Tarjeta titulo="Ventas" valor={$(t.ventas)} nota={`${num(t.vendidas)} pzas a ${$(Number(precio) || 0)}`} />
        <Tarjeta titulo="Costos" valor={$(t.costoMp + t.nomina + t.indirectos)} nota={`MP ${$(t.costoMp)} · nómina ${$(t.nomina)} · indirectos ${$(t.indirectos)}`} />
        <Tarjeta titulo="Utilidad anual" valor={$(t.utilidad)} nota={t.margen != null ? `margen ${(t.margen * 100).toFixed(1)} %` : ""} rojo={t.utilidad < 0} destacado />
        <Tarjeta titulo="Costo total por pieza" valor={$(costoPieza)} nota={`precio ${$(Number(precio) || 0)}`} rojo={costoPieza != null && costoPieza > Number(precio)} />
      </div>

      <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600">
        Días que se quitan: <b>{t.festivos}</b> festivos de ley · <b>{t.cierre}</b> de cierre de planta · <b>{num(t.vacaciones, 1)}</b> días-planta de vacaciones del personal. La nómina se paga completa los 12 meses.
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded border border-slate-200 bg-white p-3 lg:col-span-1">
          <h3 className="mb-2 text-xs font-semibold uppercase text-slate-600">Supuestos (ajustables)</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label>
              Precio de venta s/IVA
              <input type="number" value={precio} onChange={(e) => setPrecio(e.target.value)} className={campo} />
              <span className="text-slate-400">promedio real: {$(datos.precio_venta)}</span>
            </label>
            <label>
              % de lo producido que se vende
              <input type="number" value={pctVenta} onChange={(e) => setPctVenta(e.target.value)} className={campo} />
            </label>
            <label>
              Materia prima por pieza
              <input type="number" value={mpPieza} onChange={(e) => setMpPieza(e.target.value)} className={campo} />
              <span className="text-slate-400">{(datos.receta ?? []).map((r) => `${num(r.por_pieza, 2)} × ${$(r.costo)} ${r.materia}`).join(" + ")}</span>
            </label>
            <label>
              Piezas por día hábil
              <input type="number" step="0.1" value={ritmo} onChange={(e) => setRitmo(e.target.value)} className={campo} />
              <span className="text-slate-400">ritmo de los lotes</span>
            </label>
            <label>
              Nómina semanal
              <input type="number" value={nomina} onChange={(e) => setNomina(e.target.value)} className={campo} />
              <span className="text-slate-400">última semana del backoffice</span>
            </label>
            <label>
              Indirectos al mes
              <input type="number" value={indirectos} onChange={(e) => setIndirectos(e.target.value)} className={campo} />
              <span className="text-slate-400">promedio OC de la planta sin materia prima ni ISR</span>
            </label>
            <label>
              Semanas de cierre (diciembre)
              <input type="number" step="0.5" value={cierre} onChange={(e) => setCierre(e.target.value)} className={campo} />
            </label>
            <label>
              Vacaciones sin expediente (días)
              <input type="number" value={vacSin} onChange={(e) => setVacSin(e.target.value)} className={campo} />
            </label>
          </div>
          <h4 className="mb-1 mt-3 text-xs font-semibold uppercase text-slate-600">Personal y vacaciones de ley</h4>
          <ul className="space-y-0.5 text-xs">
            {datos.personas.map((p) => {
              const anios = p.ingreso ? Math.floor((Date.parse(desde) - Date.parse(p.ingreso)) / (365.25 * 864e5)) + 1 : null;
              return (
                <li key={p.nombre} className="flex justify-between gap-2">
                  <span>{p.nombre}</span>
                  <span className="text-slate-500">
                    {$(p.pago_semanal)}/sem · {anios != null ? `${diasVacacionesLFT(anios)} días al cumplir ${anios} años (${p.ingreso!.slice(5)})` : `${vacSin} días · sin expediente`}
                  </span>
                </li>
              );
            })}
          </ul>
          <h4 className="mb-1 mt-3 text-xs font-semibold uppercase text-slate-600">Gastos de la planta (OC s/IVA)</h4>
          <ul className="space-y-0.5 text-xs">
            {datos.gastos_mes.map((g) => (
              <li key={g.mes} className="flex justify-between">
                <span>{nombreMes(g.mes.slice(0, 7))}{g.mes.slice(0, 7) === mesActual ? " (en curso)" : ""}</span>
                <span>{$(Number(g.monto))}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="overflow-x-auto rounded border border-slate-200 bg-white lg:col-span-2">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">Mes</th>
                <th className="px-2 py-2 text-right">Días prod.</th>
                <th className="px-2 py-2 text-right">Programado</th>
                <th className="px-2 py-2 text-right">Piezas</th>
                <th className="px-2 py-2 text-right">Ventas</th>
                <th className="px-2 py-2 text-right">MP</th>
                <th className="px-2 py-2 text-right">Nómina</th>
                <th className="px-2 py-2 text-right">Indirectos</th>
                <th className="px-2 py-2 text-right">Utilidad</th>
                <th className="w-24 px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m.mes} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">{nombreMes(m.mes)}</td>
                  <td className="px-2 py-1.5 text-right" title={`${m.habiles} hábiles − ${m.festivos} festivos − ${m.cierre} cierre − ${m.vacaciones} vacaciones`}>
                    {num(m.productivos, 1)}
                    {(m.festivos > 0 || m.cierre > 0 || m.vacaciones >= 0.5) && <span className="block text-[10px] text-slate-400">de {m.habiles}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right">{m.piezasProgramadas ? num(m.piezasProgramadas) : "—"}</td>
                  <td className="px-2 py-1.5 text-right">{num(m.piezas)}</td>
                  <td className="px-2 py-1.5 text-right">{$(m.ventas)}</td>
                  <td className="px-2 py-1.5 text-right">{$(m.costoMp)}</td>
                  <td className="px-2 py-1.5 text-right">{$(m.nomina)}</td>
                  <td className="px-2 py-1.5 text-right">{$(m.indirectos)}</td>
                  <td className={`px-2 py-1.5 text-right font-medium ${m.utilidad < 0 ? "text-red-700" : "text-slate-800"}`}>{$(m.utilidad)}</td>
                  <td className="px-2 py-1.5">
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className={`h-2 rounded-full ${m.utilidad < 0 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${(Math.abs(m.utilidad) / maxAbs) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td className="px-2 py-2">Total</td>
                <td className="px-2 py-2 text-right">{num(t.productivos, 1)}</td>
                <td className="px-2 py-2"></td>
                <td className="px-2 py-2 text-right">{num(t.piezas)}</td>
                <td className="px-2 py-2 text-right">{$(t.ventas)}</td>
                <td className="px-2 py-2 text-right">{$(t.costoMp)}</td>
                <td className="px-2 py-2 text-right">{$(t.nomina)}</td>
                <td className="px-2 py-2 text-right">{$(t.indirectos)}</td>
                <td className={`px-2 py-2 text-right ${t.utilidad < 0 ? "text-red-700" : ""}`}>{$(t.utilidad)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        Vacaciones: art. 76 LFT (12 días el primer año, +2 por año hasta 20, luego +2 cada 5), en el mes del aniversario y en días-planta (días de la persona ÷ personas de la planta). Festivos: art. 74 LFT. No incluye la amortización de la trefiladora ni impuestos.
      </p>
    </div>
  );
}

function Tarjeta({ titulo, valor, nota, destacado, rojo }: { titulo: string; valor: string; nota?: string; destacado?: boolean; rojo?: boolean }) {
  return (
    <div className={`rounded border p-3 ${destacado ? "border-slate-800 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}>
      <p className={`text-[11px] uppercase ${destacado ? "text-slate-300" : "text-slate-500"}`}>{titulo}</p>
      <p className={`text-lg font-semibold ${rojo ? (destacado ? "text-red-300" : "text-red-700") : ""}`}>{valor}</p>
      {nota && <p className={`text-[11px] ${destacado ? "text-slate-300" : "text-slate-500"}`}>{nota}</p>}
    </div>
  );
}
