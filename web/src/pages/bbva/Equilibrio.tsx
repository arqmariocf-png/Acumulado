import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";

// Punto de equilibrio del área de mantenimiento BBVA: semana a semana, lo
// que se paga al equipo (nómina fija + mano de obra, APIs de Grupo Loma,
// proyecto "BBVA Puebla") contra lo que el área ejecuta (folios generados)
// y lo que realmente cobra (folios con pago realizado). Los datos vienen de
// tres funciones definer (fn_equilibrio_bbva_*) acotadas a Christian
// (permiso de mantenimiento BBVA), RH, corporativo, dirección y admin.

interface SemanaEquilibrio {
  semana_inicio: string;
  gasto_mano_obra: number;
  gasto_nomina: number;
  gasto_total: number;
  folios_generados: number;
  monto_ejecutado: number;
  folios_cobrados: number;
  monto_cobrado: number;
}

interface IntegranteEquipo {
  personal_id: string | null;
  nombre: string;
  puesto: string | null;
  en_equipo: boolean;
  semanas: number;
  total_pagado: number;
  ultima_semana: string | null;
}

const fmt = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const fechaCorta = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" });

function Kpi({ etiqueta, valor, nota, tono }: { etiqueta: string; valor: string; nota?: string; tono?: "bien" | "mal" | "neutro" }) {
  const color = tono === "bien" ? "text-green-700" : tono === "mal" ? "text-red-700" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{etiqueta}</p>
      <p className={`text-xl font-semibold tabular-nums ${color}`}>{valor}</p>
      {nota && <p className="text-xs text-slate-500">{nota}</p>}
    </div>
  );
}

export function Equilibrio() {
  const { data: semanas, isLoading, error } = useQuery({
    queryKey: ["bbva-equilibrio-semanal"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_equilibrio_bbva_semanal");
      if (error) throw error;
      return (data as SemanaEquilibrio[]).map((s) => ({
        ...s,
        gasto_mano_obra: Number(s.gasto_mano_obra),
        gasto_nomina: Number(s.gasto_nomina),
        gasto_total: Number(s.gasto_total),
        monto_ejecutado: Number(s.monto_ejecutado),
        monto_cobrado: Number(s.monto_cobrado),
      }));
    },
  });
  const { data: equipo } = useQuery({
    queryKey: ["bbva-equilibrio-equipo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_equilibrio_bbva_equipo");
      if (error) throw error;
      return (data as IntegranteEquipo[]).map((i) => ({ ...i, total_pagado: Number(i.total_pagado) }));
    },
  });

  // Acumulados y punto de equilibrio: la primera semana en que lo cobrado
  // acumulado alcanza al gasto acumulado. Se acumula desde la semana más
  // antigua que traiga cualquier dato.
  const filas = useMemo(() => {
    let gasto = 0, ejecutado = 0, cobrado = 0;
    return (semanas ?? []).map((s) => {
      gasto += s.gasto_total;
      ejecutado += s.monto_ejecutado;
      cobrado += s.monto_cobrado;
      return { ...s, gasto_acum: gasto, ejecutado_acum: ejecutado, cobrado_acum: cobrado, balance: cobrado - gasto };
    });
  }, [semanas]);
  const ultima = filas[filas.length - 1];
  const semanaEquilibrio = filas.find((f) => f.gasto_acum > 0 && f.cobrado_acum >= f.gasto_acum);
  const miembros = (equipo ?? []).filter((i) => i.en_equipo);
  const sinEquipo = (equipo ?? []).filter((i) => !i.en_equipo);
  const semanasConGasto = filas.filter((f) => f.gasto_total > 0).length;
  const gastoSemanalProm = semanasConGasto ? ultima.gasto_acum / semanasConGasto : 0;

  if (isLoading) return <p className="text-sm text-slate-400">Cargando…</p>;
  if (error) return <p className="text-sm text-red-600">No se pudo cargar: {(error as Error).message}</p>;

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Punto de equilibrio · Mantenimiento BBVA</h1>
        <p className="text-sm text-slate-500">
          Gasto del equipo (nómina y mano de obra del proyecto "BBVA Puebla") contra folios generados y cobrados, semana por semana. Las
          semanas van de domingo a sábado, igual que la nómina.
        </p>
      </div>

      {ultima ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi etiqueta="Gasto acumulado" valor={fmt(ultima.gasto_acum)} nota={`${semanasConGasto} semanas · ${fmt(gastoSemanalProm)} por semana`} />
          <Kpi etiqueta="Ejecutado acumulado" valor={fmt(ultima.ejecutado_acum)} nota={`${filas.reduce((a, f) => a + f.folios_generados, 0)} folios generados`} />
          <Kpi etiqueta="Cobrado acumulado" valor={fmt(ultima.cobrado_acum)} nota={`${filas.reduce((a, f) => a + f.folios_cobrados, 0)} folios pagados`} />
          <Kpi
            etiqueta="Balance (cobrado − gasto)"
            valor={fmt(ultima.balance)}
            tono={ultima.balance >= 0 ? "bien" : "mal"}
            nota={
              semanaEquilibrio
                ? `Punto de equilibrio alcanzado la semana del ${fechaCorta(semanaEquilibrio.semana_inicio)}`
                : ultima.gasto_acum > 0
                  ? `Cobrado cubre ${Math.round((ultima.cobrado_acum / ultima.gasto_acum) * 100)} % del gasto`
                  : "Sin gasto registrado"
            }
          />
        </div>
      ) : (
        <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          Todavía no hay nómina del proyecto "BBVA Puebla" ni folios del control. El gasto llega solo con la sincronización de nómina; los
          folios, al subir el control en Mantenimiento BBVA.
        </p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Semana por semana</h2>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">Semana</th>
                <th className="px-2 py-2 text-right">Nómina</th>
                <th className="px-2 py-2 text-right">Mano de obra</th>
                <th className="px-2 py-2 text-right">Gasto</th>
                <th className="px-2 py-2 text-right">Folios</th>
                <th className="px-2 py-2 text-right">Ejecutado</th>
                <th className="px-2 py-2 text-right">Cobrado</th>
                <th className="px-2 py-2 text-right">Gasto acum.</th>
                <th className="px-2 py-2 text-right">Cobrado acum.</th>
                <th className="px-2 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {[...filas].reverse().map((f) => (
                <tr key={f.semana_inicio} className={`border-t border-slate-100 ${semanaEquilibrio?.semana_inicio === f.semana_inicio ? "bg-green-50" : ""}`}>
                  <td className="whitespace-nowrap px-2 py-1.5">{fechaCorta(f.semana_inicio)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f.gasto_nomina ? fmt(f.gasto_nomina) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f.gasto_mano_obra ? fmt(f.gasto_mano_obra) : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-medium tabular-nums">{f.gasto_total ? fmt(f.gasto_total) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f.folios_generados || "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{f.monto_ejecutado ? fmt(f.monto_ejecutado) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-green-800">{f.monto_cobrado ? fmt(f.monto_cobrado) : "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{fmt(f.gasto_acum)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{fmt(f.cobrado_acum)}</td>
                  <td className={`px-2 py-1.5 text-right font-medium tabular-nums ${f.balance >= 0 ? "text-green-700" : "text-red-700"}`}>{fmt(f.balance)}</td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-2 py-6 text-center text-slate-400">
                    Sin semanas con datos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-slate-400">
          Ejecutado = monto a cobrar de los folios recibidos esa semana (sin cancelados). Cobrado = folios con "Pago realizado" por su fecha
          de recepción de factura / pago. Ambos salen del último control BBVA cargado.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Equipo ({miembros.length})</h2>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Persona</th>
                  <th className="px-2 py-2">Puesto</th>
                  <th className="px-2 py-2 text-right">Semanas</th>
                  <th className="px-2 py-2 text-right">Pagado</th>
                </tr>
              </thead>
              <tbody>
                {miembros.map((i) => (
                  <tr key={i.personal_id ?? i.nombre} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">{i.nombre}</td>
                    <td className="px-2 py-1.5 text-slate-500">{i.puesto ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{i.semanas || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{i.total_pagado ? fmt(i.total_pagado) : "sin pagos en la API"}</td>
                  </tr>
                ))}
                {miembros.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-6 text-center text-slate-400">
                      RH todavía no marca a nadie en el área "Mantenimiento BBVA" (Recursos Humanos, pestaña Personal, columna Área).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Cargado al proyecto sin estar en el equipo ({sinEquipo.length})</h2>
          <div className="overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Nombre en la API</th>
                  <th className="px-2 py-2 text-right">Semanas</th>
                  <th className="px-2 py-2 text-right">Pagado</th>
                </tr>
              </thead>
              <tbody>
                {sinEquipo.map((i) => (
                  <tr key={i.nombre} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">{i.nombre}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{i.semanas}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(i.total_pagado)}</td>
                  </tr>
                ))}
                {sinEquipo.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-2 py-6 text-center text-slate-400">
                      Todo el gasto del proyecto está atribuido a alguien del equipo.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Su gasto sí cuenta en el total del área. Si son del equipo, RH los da de alta en Personal y les marca el área para que aparezcan
            del lado izquierdo.
          </p>
        </div>
      </section>
    </div>
  );
}
