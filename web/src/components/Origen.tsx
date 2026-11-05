import { useEffect } from "react";
import { Link } from "react-router-dom";
import { BotonVerOc } from "../pages/requisiciones/VerOrdenCompra";
import { descargarCsv } from "../lib/descargarArchivo";
import { csvOrigen, ligasRenglon, pendienteDe, resumenOrigen, type LigaOrigen, type RenglonOrigen } from "../lib/origenDato";

// "De dónde sale" (5-nov-2026, Mario: "generar hipervínculos en todos los
// gastos, ventanas y menús para que podamos consultar de dónde viene esa
// información para corroborar qué es correcto; aplícala en todas las ventanas
// para todas las áreas"). Dos piezas reutilizables:
//  - <CifraOrigen>: una cifra que al clic abre el detalle o lleva a la pantalla
//    de donde sale (liga punteada, título "ver de dónde sale").
//  - <PanelOrigen>: el panel con los renglones que forman la cifra (OC/OS,
//    semanas de mano de obra, compras del control), sus totales y las ligas a
//    cada pantalla. Lo usa el avance financiero; cualquier reporte nuevo con
//    cifras calculadas debe ofrecer lo mismo.

const estiloCifra = "cursor-pointer underline decoration-dotted decoration-slate-400 underline-offset-2 hover:decoration-solid hover:text-sky-800";

/** Cifra con liga a su origen: `a` lleva a otra pantalla; `onVer` abre un panel. */
export function CifraOrigen({ children, a, onVer, titulo = "Ver de dónde sale", className = "" }: { children: React.ReactNode; a?: string; onVer?: () => void; titulo?: string; className?: string }) {
  if (a) {
    return (
      <Link to={a} title={titulo} className={`${estiloCifra} ${className}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </Link>
    );
  }
  if (onVer) {
    return (
      <button
        type="button"
        title={titulo}
        className={`${estiloCifra} ${className}`}
        onClick={(e) => {
          e.stopPropagation();
          onVer();
        }}
      >
        {children}
      </button>
    );
  }
  return <span className={className}>{children}</span>;
}

function dinero(n: number | null | undefined, d = 2): string {
  return (Number(n) || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: d, maximumFractionDigits: d });
}
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${d} ${MESES[m - 1]} ${a}`;
}

const liga = "text-sky-700 underline hover:text-sky-900";

export interface PanelOrigenProps {
  titulo: string;
  /** La cifra de la pantalla, para cotejarla contra la suma de los renglones. */
  cifra?: number | null;
  renglones: RenglonOrigen[];
  cargando?: boolean;
  error?: string | null;
  ligas?: LigaOrigen[];
  nota?: string;
  onCerrar: () => void;
}

/** Panel con los renglones que forman una cifra del avance financiero. */
export function PanelOrigen({ titulo, cifra, renglones, cargando, error, ligas = [], nota, onCerrar }: PanelOrigenProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCerrar]);
  const res = resumenOrigen(renglones);
  const oc = renglones.filter((r) => r.origen === "oc");
  const mo = renglones.filter((r) => r.origen === "mano_obra");
  const control = renglones.filter((r) => r.origen === "control");
  const cuadra = cifra == null || Math.abs(res.real - cifra) < 0.5 || Math.abs(res.pagado - cifra) < 0.5 || Math.abs(res.pendiente - cifra) < 0.5;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-3 sm:p-6" onClick={onCerrar} role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="w-full max-w-5xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-xs text-slate-500">De dónde sale</p>
            <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
            {!cargando && !error && (
              <p className="mt-1 text-xs text-slate-600">
                {res.renglones} renglones · real <b className="tabular-nums">{dinero(res.real)}</b> · pagado <b className="tabular-nums">{dinero(res.pagado)}</b> · pendiente <b className="tabular-nums">{dinero(res.pendiente)}</b> s/IVA
                {cifra != null && (cuadra ? <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">cuadra con la pantalla ({dinero(cifra)})</span> : <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">la pantalla dice {dinero(cifra)}: revisar</span>)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {renglones.length > 0 && (
              <button type="button" onClick={() => descargarCsv(`origen-${titulo.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`, csvOrigen(renglones))} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                Descargar Excel
              </button>
            )}
            <button type="button" onClick={onCerrar} className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white">
              Cerrar
            </button>
          </div>
        </div>
        <div className="space-y-4 px-4 py-3 text-sm">
          {ligas.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
              <span>Ir a:</span>
              {ligas.map((l) => (
                <Link key={l.a} to={l.a} className={liga}>
                  {l.texto}
                </Link>
              ))}
            </p>
          )}
          {nota && <p className="text-xs text-slate-500">{nota}</p>}
          {cargando && <p className="text-slate-500">Cargando…</p>}
          {error && <p className="text-red-700">{error}</p>}
          {!cargando && !error && renglones.length === 0 && <p className="text-slate-500">No hay renglones que formen esta cifra con estos filtros.</p>}
          {res.porOrigen.length > 1 && (
            <ul className="flex flex-wrap gap-2 text-xs">
              {res.porOrigen.map((o) => (
                <li key={o.origen} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                  {o.titulo}: {o.renglones} · {dinero(o.real)}
                </li>
              ))}
            </ul>
          )}
          {oc.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Órdenes de compra y de servicio ({oc.length})</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-2">Orden</th>
                      <th className="pr-2">Obra</th>
                      <th className="pr-2">Proveedor</th>
                      <th className="pr-2">Fecha</th>
                      <th className="pr-2">Categoría</th>
                      <th className="pr-2">Estatus</th>
                      <th className="pr-2 text-right">Monto s/IVA</th>
                      <th className="pr-2 text-right">Pagado</th>
                      <th className="pr-2 text-right">Pendiente</th>
                      <th>Corroborar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {oc.map((r) => (
                      <tr key={`${r.orden_compra_id}-${r.categoria}`} className="border-t border-slate-100">
                        <td className="py-1 pr-2 font-medium text-slate-800">
                          {r.tipo} {r.folio}
                          {r.fuente && r.fuente !== "api" && <span className="ml-1 rounded bg-violet-50 px-1 text-[10px] text-violet-700">{r.fuente}</span>}
                        </td>
                        <td className="pr-2 text-slate-600">
                          {r.obra} <span className="text-slate-400">{r.empresa_codigo}</span>
                        </td>
                        <td className="pr-2">{r.proveedor ?? "—"}</td>
                        <td className="pr-2 whitespace-nowrap">{fechaCorta(r.fecha)}</td>
                        <td className="pr-2">{r.categoria}</td>
                        <td className="pr-2">{r.estatus ?? "—"}</td>
                        <td className="pr-2 text-right tabular-nums">{dinero(r.monto)}</td>
                        <td className="pr-2 text-right tabular-nums">{dinero(r.pagado)}</td>
                        <td className={`pr-2 text-right tabular-nums ${pendienteDe(r) > 0 ? "text-amber-700" : ""}`}>{dinero(pendienteDe(r))}</td>
                        <td className="whitespace-nowrap">
                          {r.orden_compra_id && <BotonVerOc ocId={r.orden_compra_id} etiqueta="Ver orden" className={`${liga} mr-2`} />}
                          {ligasRenglon(r).map((l) => (
                            <Link key={l.a} to={l.a} className={`${liga} mr-2`}>
                              {l.texto}
                            </Link>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Una OC con partidas de varias categorías aparece una vez por categoría con la parte que le toca (según el texto de sus partidas). Pagado = la OC completa si ya está pagada aquí o en el backoffice; si no, la proporción pagada.</p>
            </section>
          )}
          {mo.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Mano de obra pagada por semana ({mo.length})</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-2">Semana</th>
                      <th className="pr-2">Obra</th>
                      <th className="pr-2">Empresa (API)</th>
                      <th className="pr-2">Partida</th>
                      <th className="pr-2 text-right">Monto</th>
                      <th>Corroborar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mo.map((r, i) => (
                      <tr key={`${r.proyecto_id}-${r.semana}-${r.descripcion}-${i}`} className="border-t border-slate-100">
                        <td className="py-1 pr-2 whitespace-nowrap">{r.semana ?? fechaCorta(r.fecha)}</td>
                        <td className="pr-2 text-slate-600">{r.obra}</td>
                        <td className="pr-2">{r.proveedor ?? "—"}</td>
                        <td className="pr-2">{r.descripcion ?? "—"}</td>
                        <td className="pr-2 text-right tabular-nums">{dinero(r.monto)}</td>
                        <td className="whitespace-nowrap">
                          {ligasRenglon(r).map((l) => (
                            <Link key={l.a} to={l.a} className={`${liga} mr-2`}>
                              {l.texto}
                            </Link>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Lo que la API del backoffice reporta como pagado (api_MO_period_aut), en el mes en que termina la semana. Se cruza con la obra por el nombre del proyecto.</p>
            </section>
          )}
          {control.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Compras del control de obra sin OC ({control.length})</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-1 pr-2">Fecha</th>
                      <th className="pr-2">Obra</th>
                      <th className="pr-2">Proveedor</th>
                      <th className="pr-2">Folio</th>
                      <th className="pr-2">Control · descripción</th>
                      <th className="pr-2">Categoría</th>
                      <th className="pr-2">Estatus</th>
                      <th className="pr-2 text-right">Importe</th>
                      <th>Corroborar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {control.map((r, i) => (
                      <tr key={`${r.control_id}-${r.folio}-${i}`} className="border-t border-slate-100">
                        <td className="py-1 pr-2 whitespace-nowrap">{fechaCorta(r.fecha)}</td>
                        <td className="pr-2 text-slate-600">{r.obra}</td>
                        <td className="pr-2">{r.proveedor ?? "—"}</td>
                        <td className="pr-2">{r.folio ?? "—"}</td>
                        <td className="pr-2">{r.descripcion ?? "—"}</td>
                        <td className="pr-2">{r.categoria}</td>
                        <td className="pr-2">{r.estatus ?? "—"}</td>
                        <td className="pr-2 text-right tabular-nums">{dinero(r.monto)}</td>
                        <td className="whitespace-nowrap">
                          {ligasRenglon(r).map((l) => (
                            <Link key={l.a} to={l.a} className={`${liga} mr-2`}>
                              {l.texto}
                            </Link>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
