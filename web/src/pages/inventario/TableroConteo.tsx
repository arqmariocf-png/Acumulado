import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { descargarCsv } from "../../lib/descargarArchivo";
import { csvConteo, nombreExcelConteo, type ConteoInventario as Conteo, type ItemConteo } from "../../lib/conteoInventario";
import { almacenesTablero, articulosTablero, horaCorta, lugaresTablero, MINUTOS_ACTIVO, personasTablero, serieTiempo, textoHace, totalesTablero } from "../../lib/tableroConteo";
import { useAlmacenesTodos } from "./AlmacenesEmpresa";

// Tablero en vivo del conteo (19-nov-2026, Mario: "un dashboard en tiempo
// real de quiénes están contando, qué llevan contado y en dónde están
// ubicados"). Los ítems llegan por realtime (publicación supabase_realtime
// sobre conteo_items) y, por si acaso, se vuelven a pedir cada 20 s.
// Lo ve quien administra el conteo (admin, corporativo, dirección, almacén).

const SELECT_ITEMS = "id, conteo_id, empresa_id, codigo, descripcion, cantidad, unidad, ubicacion, ubicacion_id, almacen_id, codigo_barras, notas, producto_id, herramienta_id, contado_por, contado_por_nombre, created_at";

function useAhora(cadaMs = 30000): Date {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), cadaMs);
    return () => clearInterval(t);
  }, [cadaMs]);
  return ahora;
}

export function TableroConteo() {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const ahora = useAhora();
  const [conteoId, setConteoId] = useState<string>("");

  const { data: conteos } = useQuery({
    queryKey: ["conteos-inventario-lista"],
    queryFn: async () => {
      const { data, error } = await supabase.from("conteos_inventario").select("id, fecha, nombre, instrucciones, estado").order("fecha", { ascending: false }).limit(30);
      if (error) throw error;
      return (data ?? []) as Conteo[];
    },
  });
  const conteo = useMemo(() => (conteos ?? []).find((c) => c.id === conteoId) ?? (conteos ?? []).find((c) => c.estado === "abierto") ?? (conteos ?? [])[0] ?? null, [conteos, conteoId]);

  const { data: empresas } = useQuery({
    queryKey: ["empresas-conteo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, codigo").eq("activo", true).order("nombre");
      if (error) throw error;
      return (data ?? []) as { id: string; nombre: string; codigo: string }[];
    },
  });
  const nombreEmpresa = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.nombre])), [empresas]);
  const codigoEmpresa = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.codigo])), [empresas]);

  const { data: items, dataUpdatedAt } = useQuery({
    queryKey: ["conteo-items", conteo?.id],
    enabled: !!conteo,
    refetchInterval: 20000,
    queryFn: async () => {
      const todos: ItemConteo[] = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error } = await supabase.from("conteo_items").select(SELECT_ITEMS).eq("conteo_id", conteo!.id).order("created_at", { ascending: true }).range(desde, desde + 999);
        if (error) throw error;
        const lote = (data ?? []) as ItemConteo[];
        todos.push(...lote.map((i) => ({ ...i, cantidad: Number(i.cantidad) })));
        if (lote.length < 1000) break;
      }
      return todos;
    },
  });

  // Realtime: cualquier alta, corrección o baja de ítems refresca el tablero.
  useEffect(() => {
    if (!conteo) return;
    const canal = supabase
      .channel(`conteo-tablero-${conteo.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conteo_items", filter: `conteo_id=eq.${conteo.id}` }, () => qc.invalidateQueries({ queryKey: ["conteo-items", conteo.id] }))
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [conteo, qc]);

  const todos = items ?? [];
  const productoIds = useMemo(() => [...new Set(todos.map((i) => i.producto_id).filter((x): x is string => !!x))], [todos]);
  const { data: claves } = useQuery({
    queryKey: ["conteo-claves-productos", productoIds.join(",")],
    enabled: productoIds.length > 0,
    queryFn: async () => {
      const m = new Map<string, string>();
      for (let i = 0; i < productoIds.length; i += 200) {
        const { data, error } = await supabase.from("productos").select("id, sku, clave_control").in("id", productoIds.slice(i, i + 200));
        if (error) throw error;
        for (const p of (data ?? []) as { id: string; sku: string | null; clave_control: string | null }[]) m.set(p.id, p.clave_control || p.sku || "");
      }
      return m;
    },
  });

  const personas = useMemo(() => personasTablero(todos, ahora), [todos, ahora]);
  const lugares = useMemo(() => lugaresTablero(todos), [todos]);
  const { data: almacenesTodos } = useAlmacenesTodos();
  const nombreAlmacenMapa = useMemo(() => new Map((almacenesTodos ?? []).map((a) => [a.id, a.nombre])), [almacenesTodos]);
  const porAlmacen = useMemo(() => almacenesTablero(todos, nombreAlmacenMapa), [todos, nombreAlmacenMapa]);
  const articulos = useMemo(() => articulosTablero(todos, claves ?? new Map()), [todos, claves]);
  const serie = useMemo(() => serieTiempo(todos, ahora, 15), [todos, ahora]);
  const totales = useMemo(() => totalesTablero(todos, personas), [todos, personas]);
  const maxSerie = Math.max(1, ...serie.map((t) => t.items));
  const [buscarArticulo, setBuscarArticulo] = useState("");
  const articulosFiltrados = useMemo(() => {
    const t = buscarArticulo.trim().toLowerCase();
    return t ? articulos.filter((a) => `${a.clave} ${a.descripcion}`.toLowerCase().includes(t)) : articulos;
  }, [articulos, buscarArticulo]);
  const [personaAbierta, setPersonaAbierta] = useState<string | null>(null);
  const recientes = useMemo(() => [...todos].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 25), [todos]);

  if (!perfil) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Tablero del conteo · en vivo</h1>
          <p className="text-sm text-slate-600">
            Quién está contando, qué lleva y en qué lugar está. Se actualiza solo
            {dataUpdatedAt ? ` · última lectura ${horaCorta(new Date(dataUpdatedAt))}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(conteos?.length ?? 0) > 1 && (
            <select value={conteo?.id ?? ""} onChange={(e) => setConteoId(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
              {(conteos ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fecha} · {c.nombre} ({c.estado})
                </option>
              ))}
            </select>
          )}
          <Link to="/inventario/conteo" className="rounded border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50">
            Ir a la captura
          </Link>
          <button type="button" onClick={() => descargarCsv(nombreExcelConteo(conteo?.fecha ?? ""), csvConteo(todos, nombreEmpresa, nombreAlmacenMapa))} disabled={!todos.length} className="rounded border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Descargar Excel
          </button>
        </div>
      </div>

      {!conteo ? (
        <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">No hay ningún conteo todavía.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Tarjeta titulo="Contando ahora" valor={String(totales.activas)} nota={`de ${totales.personas} persona(s) · últimos ${MINUTOS_ACTIVO} min`} resaltar={totales.activas > 0} />
            <Tarjeta titulo="Ítems capturados" valor={totales.items.toLocaleString("es-MX")} nota={totales.ultima_captura ? `último ${textoHace(Math.round((ahora.getTime() - new Date(totales.ultima_captura).getTime()) / 60000))}` : "sin capturas"} />
            <Tarjeta titulo="Piezas / cantidad" valor={totales.cantidad.toLocaleString("es-MX")} nota="suma de lo contado" />
            <Tarjeta titulo="Lugares con conteo" valor={String(totales.lugares)} nota="racks, niveles o ubicaciones a mano" />
            <Tarjeta titulo="Empresas" valor={String(totales.empresas)} nota="dueñas del inventario contado" />
            <Tarjeta titulo="Artículos distintos" valor={String(articulos.length)} nota="por clave o descripción" />
          </div>

          <section className="rounded border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-2">
              <h2 className="text-sm font-semibold text-slate-800">Ritmo de captura (ítems cada 15 min)</h2>
            </div>
            <div className="flex items-end gap-1 overflow-x-auto px-4 py-3" style={{ height: 120 }}>
              {serie.map((t) => (
                <div key={t.desde} className="flex w-7 flex-none flex-col items-center justify-end gap-1" title={`${t.etiqueta}: ${t.items} ítem(s)`}>
                  <span className="text-[10px] text-slate-600">{t.items || ""}</span>
                  <div className="w-5 rounded-t bg-emerald-500" style={{ height: `${Math.max(2, (t.items / maxSerie) * 70)}px` }} />
                  <span className="text-[9px] text-slate-500">{t.etiqueta}</span>
                </div>
              ))}
              {!serie.length && <p className="text-sm text-slate-500">Todavía no hay capturas.</p>}
            </div>
          </section>

          <section className="rounded border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-2">
              <h2 className="text-sm font-semibold text-slate-800">Quién está contando</h2>
              <p className="text-xs text-slate-500">Verde = capturó en los últimos {MINUTOS_ACTIVO} minutos. El lugar es el de su última captura. Clic en la persona para ver sus ítems.</p>
            </div>
            {personas.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">Nadie ha capturado todavía.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Persona</th>
                      <th className="px-3 py-2">Estado</th>
                      <th className="px-3 py-2 text-right">Ítems</th>
                      <th className="px-3 py-2 text-right">Cantidad</th>
                      <th className="px-3 py-2 text-right">Última hora</th>
                      <th className="px-3 py-2">Dónde está (último lugar)</th>
                      <th className="px-3 py-2">Empresa</th>
                      <th className="px-3 py-2">Empezó</th>
                      <th className="px-3 py-2">Último ítem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {personas.map((p) => (
                      <PersonaFila
                        key={p.contado_por}
                        p={p}
                        empresa={nombreEmpresa.get(p.ultima_empresa_id) ?? ""}
                        abierta={personaAbierta === p.contado_por}
                        alternar={() => setPersonaAbierta(personaAbierta === p.contado_por ? null : p.contado_por)}
                        items={personaAbierta === p.contado_por ? todos.filter((i) => i.contado_por === p.contado_por).sort((a, b) => b.created_at.localeCompare(a.created_at)) : []}
                        codigoEmpresa={codigoEmpresa}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-2">
                <h2 className="text-sm font-semibold text-slate-800">Por almacén</h2>
                <p className="text-xs text-slate-500">Los almacenes con nombre de cada empresa; "sin almacén" es lo contado sin elegir uno.</p>
              </div>
              {porAlmacen.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-500">Nada contado todavía.</p>
              ) : (
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Empresa</th>
                        <th className="px-3 py-2">Almacén</th>
                        <th className="px-3 py-2 text-right">Ítems</th>
                        <th className="px-3 py-2 text-right">Cantidad</th>
                        <th className="px-3 py-2 text-right">Lugares</th>
                        <th className="px-3 py-2">Quién</th>
                        <th className="px-3 py-2">Último</th>
                      </tr>
                    </thead>
                    <tbody>
                      {porAlmacen.map((a) => (
                        <tr key={`${a.empresa_id}|${a.almacen_id ?? ""}`} className="border-t border-slate-100">
                          <td className="px-3 py-1">{codigoEmpresa.get(a.empresa_id) ?? ""}</td>
                          <td className={`px-3 py-1 ${a.almacen_id ? "font-medium" : "text-slate-500"}`}>{a.nombre}</td>
                          <td className="px-3 py-1 text-right">{a.items}</td>
                          <td className="px-3 py-1 text-right">{a.cantidad.toLocaleString("es-MX")}</td>
                          <td className="px-3 py-1 text-right">{a.lugares}</td>
                          <td className="px-3 py-1 text-xs text-slate-600">{a.personas.join(", ")}</td>
                          <td className="px-3 py-1 text-xs text-slate-500">{horaCorta(new Date(a.ultimo))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-2">
                <h2 className="text-sm font-semibold text-slate-800">Dónde se ha contado (por lugar)</h2>
                <p className="text-xs text-slate-500">Rack · nivel del QR, o la ubicación escrita a mano.</p>
              </div>
              {lugares.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-500">Sin lugares todavía.</p>
              ) : (
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Lugar</th>
                        <th className="px-3 py-2 text-right">Ítems</th>
                        <th className="px-3 py-2 text-right">Cantidad</th>
                        <th className="px-3 py-2">Quién</th>
                        <th className="px-3 py-2">Último</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lugares.map((l) => (
                        <tr key={l.ubicacion} className="border-t border-slate-100">
                          <td className="px-3 py-1 font-mono text-xs">{l.ubicacion}</td>
                          <td className="px-3 py-1 text-right">{l.items}</td>
                          <td className="px-3 py-1 text-right">{l.cantidad.toLocaleString("es-MX")}</td>
                          <td className="px-3 py-1 text-xs text-slate-600">{l.personas.join(", ")}</td>
                          <td className="px-3 py-1 text-xs text-slate-500">{horaCorta(new Date(l.ultimo))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">Qué llevan contado (por artículo)</h2>
                  <p className="text-xs text-slate-500">Suma de todos los renglones del mismo artículo (clave de control ART- o descripción).</p>
                </div>
                <input value={buscarArticulo} onChange={(e) => setBuscarArticulo(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs" placeholder="buscar clave o artículo" />
              </div>
              {articulos.length === 0 ? (
                <p className="px-4 py-3 text-sm text-slate-500">Sin artículos todavía.</p>
              ) : (
                <div className="max-h-96 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Clave</th>
                        <th className="px-3 py-2">Artículo</th>
                        <th className="px-3 py-2">Emp.</th>
                        <th className="px-3 py-2 text-right">Contado</th>
                        <th className="px-3 py-2 text-right">Renglones</th>
                        <th className="px-3 py-2">Lugares</th>
                      </tr>
                    </thead>
                    <tbody>
                      {articulosFiltrados.slice(0, 500).map((a) => (
                        <tr key={`${a.clave}|${a.descripcion}|${a.empresa_id}`} className="border-t border-slate-100">
                          <td className="px-3 py-1 font-mono text-xs">{a.clave}</td>
                          <td className="px-3 py-1">{a.descripcion}</td>
                          <td className="px-3 py-1 text-xs text-slate-600">{codigoEmpresa.get(a.empresa_id) ?? ""}</td>
                          <td className="px-3 py-1 text-right">
                            {a.cantidad.toLocaleString("es-MX")} <span className="text-xs text-slate-500">{a.unidad}</span>
                          </td>
                          <td className="px-3 py-1 text-right text-xs text-slate-600">{a.renglones}</td>
                          <td className="px-3 py-1 font-mono text-[11px] text-slate-600">{a.lugares.join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {articulosFiltrados.length > 500 && <p className="px-4 py-2 text-xs text-slate-500">Se muestran 500 de {articulosFiltrados.length}; afina la búsqueda.</p>}
                </div>
              )}
            </section>
          </div>

          <section className="rounded border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-2">
              <h2 className="text-sm font-semibold text-slate-800">Últimas capturas</h2>
            </div>
            {recientes.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">Sin capturas todavía.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {recientes.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
                    <span className="w-12 text-xs text-slate-500">{horaCorta(new Date(i.created_at))}</span>
                    <span className="font-medium text-slate-800">{i.contado_por_nombre ?? "—"}</span>
                    <span className="font-mono text-xs text-slate-500">{i.herramienta_id && i.codigo_barras ? i.codigo_barras : i.codigo}</span>
                    <span>{i.descripcion}</span>
                    <span className="text-slate-700">
                      {i.cantidad.toLocaleString("es-MX")} {i.unidad}
                    </span>
                    <span className="text-xs text-slate-500">{codigoEmpresa.get(i.empresa_id) ?? ""}</span>
                    {i.ubicacion && <span className="rounded bg-slate-100 px-1.5 font-mono text-[11px] text-slate-700">{i.ubicacion}</span>}
                    <Link to={`/inventario/conteo?item=${encodeURIComponent(i.codigo)}`} className="text-xs text-slate-500 hover:underline">
                      abrir
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, nota, resaltar }: { titulo: string; valor: string; nota: string; resaltar?: boolean }) {
  return (
    <div className={`rounded border p-3 ${resaltar ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className={`text-2xl font-semibold ${resaltar ? "text-emerald-800" : "text-slate-900"}`}>{valor}</div>
      <div className="text-xs text-slate-500">{nota}</div>
    </div>
  );
}

function PersonaFila({
  p,
  empresa,
  abierta,
  alternar,
  items,
  codigoEmpresa,
}: {
  p: ReturnType<typeof personasTablero>[number];
  empresa: string;
  abierta: boolean;
  alternar: () => void;
  items: ItemConteo[];
  codigoEmpresa: Map<string, string>;
}) {
  return (
    <>
      <tr className={`border-t border-slate-100 ${p.activa ? "bg-emerald-50/40" : ""}`}>
        <td className="px-3 py-1.5">
          <button type="button" onClick={alternar} className="font-medium text-slate-800 hover:underline">
            {abierta ? "▾" : "▸"} {p.persona}
          </button>
        </td>
        <td className="px-3 py-1.5">
          {p.activa ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> contando · {textoHace(p.minutos_sin_capturar)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              <span className="h-2 w-2 rounded-full bg-slate-400" /> sin capturar {textoHace(p.minutos_sin_capturar)}
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 text-right">{p.items}</td>
        <td className="px-3 py-1.5 text-right">{p.cantidad.toLocaleString("es-MX")}</td>
        <td className="px-3 py-1.5 text-right text-xs text-slate-600">{p.ultima_hora} ítem(s)</td>
        <td className="px-3 py-1.5 font-mono text-xs">{p.ultima_ubicacion ?? <span className="font-sans text-slate-400">sin lugar</span>}</td>
        <td className="px-3 py-1.5 text-xs text-slate-600">{empresa}</td>
        <td className="px-3 py-1.5 text-xs text-slate-500">{horaCorta(new Date(p.primero))}</td>
        <td className="px-3 py-1.5 text-xs text-slate-500">{horaCorta(new Date(p.ultimo))}</td>
      </tr>
      {abierta && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={9} className="px-6 py-2">
            <ul className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-2 rounded bg-white px-2 py-1">
                  <span className="text-slate-500">{horaCorta(new Date(i.created_at))}</span>
                  <span className="font-mono text-slate-600">{i.herramienta_id && i.codigo_barras ? i.codigo_barras : i.codigo}</span>
                  <span className="text-slate-800">{i.descripcion}</span>
                  <span>
                    {i.cantidad.toLocaleString("es-MX")} {i.unidad}
                  </span>
                  <span className="text-slate-500">{codigoEmpresa.get(i.empresa_id) ?? ""}</span>
                  {i.ubicacion && <span className="rounded bg-slate-100 px-1 font-mono text-[10px]">{i.ubicacion}</span>}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
