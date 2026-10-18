import { useMemo, useState } from "react";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir, abrirVentanaImpresion } from "../../lib/imprimir";
import {
  CLASE_SEMAFORO,
  ETIQUETA_AREA,
  ETIQUETA_SEVERIDAD,
  etiquetaPeriodo,
  htmlInformeComite,
  periodosHasta,
  resumenComite,
  type Frecuencia,
} from "../../lib/cumplimientoNormativo";
import { ChipResultado } from "./Controles";
import { useControles, useIncidencias, useNormas, usePruebas } from "./datos";
import { boton, campo, hoyMexico } from "./comun";

const TITULO = { verde: "En orden", ambar: "Con pendientes", rojo: "Requiere atención", gris: "Sin datos" };
const FLECHA = { mejora: "▲", empeora: "▼", igual: "=", nuevo: "—" };

/** Paso 4: al comité una página, no un archivador. */
export function Comite() {
  const { perfil, grupo } = useAuth();
  const hoy = hoyMexico();
  const [frecuencia, setFrecuencia] = useState<Frecuencia>("trimestral");
  const opciones = periodosHasta(hoy, frecuencia, frecuencia === "trimestral" ? 4 : 6).reverse();
  const [periodo, setPeriodo] = useState(opciones[0]);
  const [decisiones, setDecisiones] = useState("");
  const controles = useControles();
  const pruebas = usePruebas();
  const incidencias = useIncidencias();
  const normas = useNormas();
  const elegido = opciones.includes(periodo) ? periodo : opciones[0];

  const r = useMemo(
    () =>
      resumenComite({
        periodo: elegido,
        controles: controles.data ?? [],
        pruebas: pruebas.data ?? [],
        incidencias: incidencias.data ?? [],
        normas: normas.data ?? [],
        hoy,
      }),
    [elegido, controles.data, pruebas.data, incidencias.data, normas.data, hoy],
  );
  const cargando = controles.isLoading || pruebas.isLoading || incidencias.isLoading || normas.isLoading;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        El informe junta en una sola hoja lo que el comité necesita: cómo están los controles contra el periodo anterior, las incidencias, lo que falta por
        implementar de las normas y las decisiones que se le piden.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Informe
          <select className={campo} value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as Frecuencia)}>
            <option value="trimestral">Trimestral</option>
            <option value="mensual">Mensual</option>
          </select>
        </label>
        <label className="text-sm">
          Periodo
          <select className={campo} value={elegido} onChange={(e) => setPeriodo(e.target.value)}>
            {opciones.map((p) => (
              <option key={p} value={p}>
                {etiquetaPeriodo(p)}
              </option>
            ))}
          </select>
        </label>
        <button
          className={boton}
          disabled={cargando}
          onClick={() => {
            const v = abrirVentanaImpresion();
            abrirParaImprimir(htmlInformeComite(r, { organizacion: grupo?.nombre ?? "Acumulado", decisiones, elaboro: perfil?.nombre, emitido: hoy }), v);
          }}
        >
          Imprimir / PDF
        </button>
      </div>
      {cargando ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <div className="space-y-3 rounded border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">{etiquetaPeriodo(r.periodo)}</h3>
            <span className={`rounded px-3 py-1 text-sm font-medium ${CLASE_SEMAFORO[r.semaforo]}`}>{TITULO[r.semaforo]}</span>
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            {r.mensajes.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500">
                  <th className="py-1 pr-2">Control</th>
                  <th className="py-1 pr-2">Área</th>
                  <th className="py-1 pr-2">Resultado</th>
                  <th className="py-1 pr-2 text-right">Excepciones</th>
                  <th className="py-1">vs. anterior</th>
                </tr>
              </thead>
              <tbody>
                {r.controles.map((f) => (
                  <tr key={f.clave} className="border-t border-slate-100">
                    <td className="py-1 pr-2">
                      <span className="mr-1 font-mono text-xs text-slate-500">{f.clave}</span>
                      {f.nombre}
                    </td>
                    <td className="py-1 pr-2 text-slate-600">{ETIQUETA_AREA[f.area] ?? f.area}</td>
                    <td className="py-1 pr-2">
                      <ChipResultado resultado={f.actual} />
                    </td>
                    <td className="py-1 pr-2 text-right">{f.excepciones == null ? "—" : `${f.excepciones}${f.poblacion ? ` de ${f.poblacion}` : ""}`}</td>
                    <td className={`py-1 ${f.tendencia === "empeora" ? "text-red-700" : f.tendencia === "mejora" ? "text-emerald-700" : "text-slate-500"}`}>
                      {FLECHA[f.tendencia]} {f.tendencia === "nuevo" ? "" : f.tendencia}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <h4 className="font-medium text-slate-800">Incidencias</h4>
              <p className="text-sm text-slate-600">
                {r.incidencias.nuevas} nuevas · {r.incidencias.cerradas} cerradas · <b>{r.incidencias.abiertas} abiertas</b>
              </p>
              <ul className="list-disc pl-5 text-sm">
                {r.incidencias.graves.map((g) => (
                  <li key={`${g.folio}${g.titulo}`}>
                    {g.folio} {g.titulo} — {ETIQUETA_SEVERIDAD[g.severidad]}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-slate-800">Cambios normativos</h4>
              <p className="text-sm text-slate-600">
                <b>{r.normas.pendientes}</b> por implementar
              </p>
              <ul className="list-disc pl-5 text-sm">
                {r.normas.proximas.map((n) => (
                  <li key={n.titulo}>
                    {n.titulo}
                    {n.fecha_vigor ? ` — en vigor ${n.fecha_vigor.split("-").reverse().join("/")}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <label className="block text-sm">
            Decisiones que se piden al comité
            <textarea className={campo} rows={3} value={decisiones} placeholder="Ej. Aprobar que ningún pago salga sin comprobante el mismo día." onChange={(e) => setDecisiones(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}
