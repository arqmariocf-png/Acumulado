import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BotonVerOc } from "../pages/requisiciones/VerOrdenCompra";
import { descargarCsv } from "../lib/descargarArchivo";
import { CLIENTE_DE_LA_OBRA, agruparManoObra, csvOrigen, gastoPorCliente, ligasRenglon, opcionesCliente, pendienteDe, resumenOrigen, type LigaOrigen, type RenglonOrigen } from "../lib/origenDato";

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
  /** Si viene, cada OC/OS trae el selector "cliente del gasto" (BBVA
   * Mantenimiento en oficinas u obras privadas; 5-nov-2026). */
  onCliente?: (ordenCompraId: string, cliente: string | null) => Promise<void> | void;
}

/** Selector de a quién se le carga el gasto de una OC/OS. */
export function SelectorClienteGasto({ valor, opciones, onCambiar, className = "" }: { valor: string | null; opciones: string[]; onCambiar: (cliente: string | null) => Promise<void> | void; className?: string }) {
  const [guardando, setGuardando] = useState(false);
  async function cambiar(v: string) {
    let cliente: string | null = v || null;
    if (v === "__otro__") {
      const t = window.prompt("¿A qué cliente se le carga este gasto? (por ejemplo: Obra privada · Casa Pérez)");
      if (t == null) return;
      cliente = t.trim() || null;
    }
    setGuardando(true);
    try {
      await onCambiar(cliente);
    } finally {
      setGuardando(false);
    }
  }
  const lista = valor && !opciones.includes(valor) ? [valor, ...opciones] : opciones;
  return (
    <select value={valor ?? ""} disabled={guardando} onChange={(e) => void cambiar(e.target.value)} title="Cliente al que se le carga este gasto" className={`rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] ${valor ? "text-violet-800" : "text-slate-500"} ${className}`}>
      <option value="">{CLIENTE_DE_LA_OBRA}</option>
      {lista.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value="__otro__">Otro cliente…</option>
    </select>
  );
}

/** Mano de obra de la API clasificada: partida → puesto → persona → semana. */
export function TablaManoObra({ renglones, conLigas = true }: { renglones: RenglonOrigen[]; conLigas?: boolean }) {
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const grupos = agruparManoObra(renglones);
  const alternar = (k: string) =>
    setAbiertas((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  if (!grupos.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-slate-500">
          <tr>
            <th className="py-1 pr-2">Partida · puesto · persona</th>
            <th className="pr-2">Tipo</th>
            <th className="pr-2 text-right">Semanas</th>
            <th className="pr-2 text-right">Monto</th>
            {conLigas && <th>Corroborar</th>}
          </tr>
        </thead>
        <tbody>
          {grupos.map((p) => (
            <Fragmento key={p.partida}>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-800">
                <td className="py-1 pr-2">{p.partida}</td>
                <td className="pr-2" />
                <td className="pr-2 text-right tabular-nums">{p.semanas}</td>
                <td className="pr-2 text-right tabular-nums">{dinero(p.monto)}</td>
                {conLigas && <td />}
              </tr>
              {p.subpartidas.map((sp) => (
                <Fragmento key={`${p.partida}|${sp.subpartida}`}>
                  {(p.subpartidas.length > 1 || sp.subpartida !== "Sin clasificar") && (
                    <tr className="border-t border-slate-100 text-slate-700">
                      <td className="py-1 pl-4 pr-2 font-medium">{sp.subpartida}</td>
                      <td className="pr-2" />
                      <td className="pr-2" />
                      <td className="pr-2 text-right tabular-nums">{dinero(sp.monto)}</td>
                      {conLigas && <td />}
                    </tr>
                  )}
                  {sp.personas.map((per) => {
                    const k = `${p.partida}|${sp.subpartida}|${per.trabajador}`;
                    const abierta = abiertas.has(k);
                    return (
                      <Fragmento key={k}>
                        <tr className="border-t border-slate-100">
                          <td className="py-1 pl-8 pr-2">
                            <button type="button" onClick={() => alternar(k)} className="text-left underline decoration-dotted hover:text-sky-800" title="Ver semana por semana">
                              {abierta ? "▾" : "▸"} {per.trabajador}
                            </button>
                          </td>
                          <td className="pr-2 text-slate-500">{per.tipo ?? "—"}</td>
                          <td className="pr-2 text-right tabular-nums">{per.semanas}</td>
                          <td className="pr-2 text-right tabular-nums">{dinero(per.monto)}</td>
                          {conLigas && (
                            <td className="whitespace-nowrap">
                              {ligasRenglon(per.renglones[0]).map((l) => (
                                <Link key={l.a} to={l.a} className={`${liga} mr-2`}>
                                  {l.texto}
                                </Link>
                              ))}
                            </td>
                          )}
                        </tr>
                        {abierta &&
                          per.renglones.map((r, i) => (
                            <tr key={`${k}|${i}`} className="border-t border-slate-50 text-slate-600">
                              <td className="py-0.5 pl-12 pr-2">
                                {r.num_sem != null ? `Sem ${r.num_sem} · ` : ""}
                                {r.semana ?? fechaCorta(r.fecha)}
                              </td>
                              <td className="pr-2">{r.proveedor ?? ""}</td>
                              <td className="pr-2" />
                              <td className="pr-2 text-right tabular-nums">{dinero(r.monto)}</td>
                              {conLigas && <td />}
                            </tr>
                          ))}
                      </Fragmento>
                    );
                  })}
                </Fragmento>
              ))}
            </Fragmento>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fragmento({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

/** Tabla "gasto por cliente" de una obra (OC/OS con cliente del gasto; lo demás al cliente de la obra). */
export function TablaGastoPorCliente({ renglones, clienteObra }: { renglones: RenglonOrigen[]; clienteObra?: string | null }) {
  const filas = gastoPorCliente(renglones);
  if (filas.length < 2 && !filas.some((f) => f.cliente !== CLIENTE_DE_LA_OBRA)) return null;
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-slate-500">
        <tr>
          <th className="py-1 pr-2">Cliente del gasto</th>
          <th className="pr-2 text-right">OC/OS</th>
          <th className="pr-2 text-right">Mano de obra</th>
          <th className="pr-2 text-right">Otras compras</th>
          <th className="pr-2 text-right">Total</th>
          <th className="pr-2 text-right">Pagado</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.cliente} className="border-t border-slate-100">
            <td className="py-1 pr-2 font-medium text-slate-800">
              {f.cliente === CLIENTE_DE_LA_OBRA ? (clienteObra ? `${clienteObra} (cliente de la obra)` : CLIENTE_DE_LA_OBRA) : f.cliente}
              <span className="ml-1 font-normal text-slate-400">{f.ordenes} orden{f.ordenes === 1 ? "" : "es"}</span>
            </td>
            <td className="pr-2 text-right tabular-nums">{dinero(f.oc)}</td>
            <td className="pr-2 text-right tabular-nums">{dinero(f.manoObra)}</td>
            <td className="pr-2 text-right tabular-nums">{dinero(f.control)}</td>
            <td className="pr-2 text-right font-semibold tabular-nums">{dinero(f.total)}</td>
            <td className="pr-2 text-right tabular-nums">{dinero(f.pagado)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Panel con los renglones que forman una cifra del avance financiero. */
export function PanelOrigen({ titulo, cifra, renglones, cargando, error, ligas = [], nota, onCerrar, onCliente }: PanelOrigenProps) {
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
  const opcionesClientes = opcionesCliente(renglones);
  const porCliente = gastoPorCliente(renglones);
  const hayClientes = porCliente.some((f) => f.cliente !== CLIENTE_DE_LA_OBRA);
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
          {hayClientes && (
            <section>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Gasto por cliente</h3>
              <TablaGastoPorCliente renglones={renglones} />
              <p className="mt-1 text-[11px] text-slate-500">Las OC/OS con "cliente del gasto" se separan; la mano de obra y lo sin cliente van al cliente de la obra.</p>
            </section>
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
                      {(onCliente || hayClientes) && <th className="pr-2">Cliente del gasto</th>}
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
                        {(onCliente || hayClientes) && (
                          <td className="pr-2">
                            {onCliente && r.orden_compra_id ? (
                              <SelectorClienteGasto valor={r.gasto_cliente ?? null} opciones={opcionesClientes} onCambiar={(c) => onCliente(r.orden_compra_id!, c)} />
                            ) : (
                              <span className={r.gasto_cliente ? "text-violet-800" : "text-slate-400"}>{r.gasto_cliente ?? CLIENTE_DE_LA_OBRA}</span>
                            )}
                          </td>
                        )}
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
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Mano de obra pagada ({mo.length} renglones · {dinero(mo.reduce((t, r) => t + (Number(r.monto) || 0), 0))})
              </h3>
              <TablaManoObra renglones={mo} />
              <p className="mt-1 text-[11px] text-slate-500">Lo que la API del backoffice reporta como pagado (api_MO_period_aut), clasificado por partida, puesto y persona; clic en la persona para ver semana por semana. Se cruza con la obra por el nombre del proyecto y cae en el mes en que termina la semana.</p>
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
