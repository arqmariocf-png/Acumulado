import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useEmpresasAlcance } from "../../components/SelectorEmpresa";
import { useItemsCompra } from "../compras/useItemsCompra";
import { agruparSimilares, filtrarGrupos, ordenarParaConservar, resumenFusion, UMBRALES, type GrupoSimilar, type ParSimilar, type UsoCatalogo } from "../../lib/fusiones";
import { claveTexto } from "../../lib/itemsConteo";

// Duplicados y fusiones (19-nov-2026, Mario: "revisemos duplicidades y
// similitudes para dar la opción a Laura y Alma de fusionarlos, incluyendo
// sus inventarios"). Los pares parecidos los precalcula la base cada noche
// (catalogo_similares); aquí se agrupan, se elige cuál conservar y se
// fusiona con fn_catalogo_fusionar (mueve inventario, conteos, requisiciones,
// ventas, precios de proveedor…); todo se puede deshacer desde el historial.

type Tipo = "item" | "producto";

interface Fusion {
  id: string;
  tipo: Tipo;
  destino_texto: string;
  origen_texto: string;
  referencias: Record<string, string[]>;
  nota: string | null;
  hecho_por_nombre: string | null;
  hecho_en: string;
  deshecho_en: string | null;
}

interface ProductoBusqueda {
  id: string;
  nombre: string;
  sku: string | null;
  clave_control: string | null;
  unidad_medida: string | null;
}

const LOTE_USO = 200;

function hora(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function Fusiones() {
  const { perfil } = useAuth();
  const qc = useQueryClient();
  const { data: empresas } = useEmpresasAlcance();
  const [tipo, setTipo] = useState<Tipo>("producto");
  const [empresaId, setEmpresaId] = useState("");
  const [umbral, setUmbral] = useState(0.8);
  const [buscar, setBuscar] = useState("");
  const [mostrar, setMostrar] = useState(60);
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!empresaId && empresas?.length) setEmpresaId(perfil?.empresa_id && empresas.some((e) => e.id === perfil.empresa_id) ? perfil.empresa_id : empresas[0].id);
  }, [empresas, empresaId, perfil?.empresa_id]);
  const nombreEmpresa = (empresas ?? []).find((e) => e.id === empresaId)?.nombre ?? "";

  // ── Pares parecidos (precalculados) ───────────────────────────────────
  const { data: pares, isLoading } = useQuery({
    queryKey: ["catalogo-similares", tipo, tipo === "producto" ? empresaId : "", umbral],
    enabled: tipo === "item" || !!empresaId,
    queryFn: async () => {
      const todos: (ParSimilar & { calculado_en: string })[] = [];
      for (let desde = 0; ; desde += 1000) {
        let q = supabase.from("catalogo_similares").select("a_id, b_id, similitud, calculado_en").eq("tipo", tipo).gte("similitud", umbral).order("similitud", { ascending: false }).order("a_id").range(desde, desde + 999);
        if (tipo === "producto") q = q.eq("empresa_id", empresaId);
        const { data, error: err } = await q;
        if (err) throw err;
        const lote = (data ?? []) as (ParSimilar & { calculado_en: string })[];
        todos.push(...lote.map((p) => ({ ...p, similitud: Number(p.similitud) })));
        if (lote.length < 1000) break;
      }
      return todos;
    },
  });
  const calculadoEn = pares?.[0]?.calculado_en ?? null;
  const grupos = useMemo(() => agruparSimilares(pares ?? [], umbral).filter((g) => !g.ids.some((id) => ocultos.has(id))), [pares, umbral, ocultos]);

  // ── Uso de cada miembro (solo de los grupos visibles) ─────────────────
  const [uso, setUso] = useState<Map<string, UsoCatalogo>>(new Map());
  const gruposFiltrados = useMemo(() => filtrarGrupos(grupos, uso, buscar), [grupos, uso, buscar]);
  const visibles = gruposFiltrados.slice(0, mostrar);
  const idsPendientes = useMemo(() => [...new Set(visibles.flatMap((g) => g.ids))].filter((id) => !uso.has(id)), [visibles, uso]);
  useEffect(() => {
    if (!idsPendientes.length) return;
    let vivo = true;
    (async () => {
      const nuevo = new Map(uso);
      for (let i = 0; i < idsPendientes.length; i += LOTE_USO) {
        const { data, error: err } = await supabase.rpc("fn_catalogo_fusion_uso", { p_tipo: tipo, p_ids: idsPendientes.slice(i, i + LOTE_USO) });
        if (err) {
          if (vivo) setError(err.message);
          return;
        }
        for (const u of (data ?? []) as UsoCatalogo[]) nuevo.set(u.id, { ...u, existencia: Number(u.existencia), movimientos: Number(u.movimientos), conteos: Number(u.conteos), requisiciones: Number(u.requisiciones), ventas: Number(u.ventas), proveedores: Number(u.proveedores), productos: Number(u.productos) });
      }
      if (vivo) setUso(nuevo);
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsPendientes.join(","), tipo]);
  useEffect(() => {
    setUso(new Map());
    setOcultos(new Set());
    setMostrar(60);
  }, [tipo, empresaId]);

  // ── Fusionar y deshacer ───────────────────────────────────────────────
  const fusionar = useMutation({
    mutationFn: async ({ destino, origenes, nota }: { destino: string; origenes: string[]; nota?: string }) => {
      const { error: err } = await supabase.rpc("fn_catalogo_fusionar", { p_tipo: tipo, p_destino: destino, p_origenes: origenes, p_nota: nota ?? null });
      if (err) throw err;
      return origenes;
    },
    onSuccess: (origenes, v) => {
      setError(null);
      setAviso(`Fusionado: ${origenes.length} en ${uso.get(v.destino)?.texto ?? "el conservado"}. Se puede deshacer en el historial de abajo.`);
      setOcultos((prev) => new Set([...prev, ...origenes]));
      setUso((prev) => {
        const n = new Map(prev);
        for (const id of [...origenes, v.destino]) n.delete(id);
        return n;
      });
      qc.invalidateQueries({ queryKey: ["catalogo-fusiones"] });
      qc.invalidateQueries({ queryKey: ["catalogo-similares"] });
      qc.invalidateQueries({ queryKey: ["productos-conteo"] });
      qc.invalidateQueries({ queryKey: ["compras-items"] });
      qc.invalidateQueries({ queryKey: ["productos-fusiones"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const deshacer = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.rpc("fn_catalogo_fusion_deshacer", { p_fusion_id: id });
      if (err) throw err;
    },
    onSuccess: () => {
      setError(null);
      setAviso("Fusión deshecha: el origen vuelve a estar activo con lo suyo.");
      qc.invalidateQueries({ queryKey: ["catalogo-fusiones"] });
      qc.invalidateQueries({ queryKey: ["productos-conteo"] });
      qc.invalidateQueries({ queryKey: ["compras-items"] });
      qc.invalidateQueries({ queryKey: ["productos-fusiones"] });
      setUso(new Map());
    },
    onError: (e: Error) => setError(e.message),
  });
  const { data: historial } = useQuery({
    queryKey: ["catalogo-fusiones"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("catalogo_fusiones").select("id, tipo, destino_texto, origen_texto, referencias, nota, hecho_por_nombre, hecho_en, deshecho_en").order("hecho_en", { ascending: false }).limit(100);
      if (err) throw err;
      return (data ?? []) as Fusion[];
    },
  });

  // ── Fusionar a mano (buscar y elegir) ─────────────────────────────────
  const [buscarMano, setBuscarMano] = useState("");
  const [elegidos, setElegidos] = useState<string[]>([]);
  const { data: itemsCompra } = useItemsCompra(tipo === "item");
  const { data: productosEmpresa } = useQuery({
    queryKey: ["productos-fusiones", empresaId],
    enabled: tipo === "producto" && !!empresaId,
    queryFn: async () => {
      const todos: ProductoBusqueda[] = [];
      for (let desde = 0; ; desde += 1000) {
        const { data, error: err } = await supabase.from("productos").select("id, nombre, sku, clave_control, unidad_medida").eq("empresa_id", empresaId).eq("activo", true).order("nombre").range(desde, desde + 999);
        if (err) throw err;
        todos.push(...((data ?? []) as ProductoBusqueda[]));
        if (!data || data.length < 1000) break;
      }
      return todos;
    },
  });
  const candidatosMano = useMemo(() => {
    const t = claveTexto(buscarMano);
    if (!t) return [];
    const partes = t.split(" ");
    const lista: { id: string; texto: string; clave: string | null }[] =
      tipo === "item"
        ? (itemsCompra ?? []).filter((i) => i.activo && i.categoria !== "servicio").map((i) => ({ id: i.id, texto: i.descripcion, clave: i.clave }))
        : (productosEmpresa ?? []).map((p) => ({ id: p.id, texto: p.nombre, clave: p.clave_control ?? p.sku }));
    return lista.filter((x) => !elegidos.includes(x.id) && partes.every((p) => claveTexto(`${x.clave ?? ""} ${x.texto}`).includes(p))).slice(0, 30);
  }, [buscarMano, tipo, itemsCompra, productosEmpresa, elegidos]);
  const idsManoSinUso = elegidos.filter((id) => !uso.has(id));
  useEffect(() => {
    if (!idsManoSinUso.length) return;
    supabase.rpc("fn_catalogo_fusion_uso", { p_tipo: tipo, p_ids: idsManoSinUso }).then(({ data, error: err }) => {
      if (err) return setError(err.message);
      setUso((prev) => {
        const n = new Map(prev);
        for (const u of (data ?? []) as UsoCatalogo[]) n.set(u.id, { ...u, existencia: Number(u.existencia), movimientos: Number(u.movimientos), conteos: Number(u.conteos), requisiciones: Number(u.requisiciones), ventas: Number(u.ventas), proveedores: Number(u.proveedores), productos: Number(u.productos) });
        return n;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsManoSinUso.join(","), tipo]);
  useEffect(() => setElegidos([]), [tipo, empresaId]);

  if (!perfil) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Duplicados y fusiones de catálogos</h1>
        <p className="text-sm text-slate-600">
          La base busca cada noche nombres parecidos. Revisa cada grupo, elige cuál se conserva y marca los que son lo mismo: lo que tenían (inventario, movimientos, conteos, requisiciones, ventas, precios de proveedor) pasa al conservado y el otro queda inactivo. Todo se puede deshacer.
          {calculadoEn ? ` Parecidos calculados el ${hora(calculadoEn)}.` : ""}
        </p>
      </div>
      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {aviso && <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>}

      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white px-4 py-3 text-sm">
        <div className="flex overflow-hidden rounded border border-slate-300 text-xs">
          <button type="button" onClick={() => setTipo("producto")} className={`px-3 py-1 ${tipo === "producto" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}>
            Artículos de inventario (por empresa)
          </button>
          <button type="button" onClick={() => setTipo("item")} className={`px-3 py-1 ${tipo === "item" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}>
            Items de compras (toda la organización)
          </button>
        </div>
        {tipo === "producto" && (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1">
            {(empresas ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        )}
        <select value={umbral} onChange={(e) => setUmbral(Number(e.target.value))} className="rounded border border-slate-300 px-2 py-1">
          {UMBRALES.map((u) => (
            <option key={u.valor} value={u.valor}>
              {u.etiqueta}
            </option>
          ))}
        </select>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="buscar en los grupos…" className="min-w-[14rem] rounded border border-slate-300 px-2 py-1" />
        <span className="text-xs text-slate-500">
          {isLoading ? "Cargando…" : `${gruposFiltrados.length} grupo(s) · ${gruposFiltrados.reduce((s, g) => s + g.ids.length, 0)} parecidos`}
        </span>
      </div>

      {!isLoading && gruposFiltrados.length === 0 && (
        <p className="rounded border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          No hay grupos con ese parecido{buscar ? " y ese texto" : ""}. Baja el nivel de parecido o usa "Fusionar a mano".
        </p>
      )}
      <div className="space-y-3">
        {visibles.map((g) => (
          <GrupoCard
            key={g.ids.join("|")}
            grupo={g}
            tipo={tipo}
            uso={uso}
            ocupado={fusionar.isPending}
            onFusionar={(destino, origenes) => {
              if (window.confirm(resumenFusion(destino, origenes, uso, tipo))) fusionar.mutate({ destino, origenes });
            }}
            onOcultar={() => setOcultos((prev) => new Set([...prev, ...g.ids]))}
          />
        ))}
        {gruposFiltrados.length > mostrar && (
          <button type="button" onClick={() => setMostrar((m) => m + 60)} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Mostrar 60 grupos más ({gruposFiltrados.length - mostrar} restantes)
          </button>
        )}
      </div>

      <section className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-2">
          <h2 className="text-sm font-semibold text-slate-800">Fusionar a mano</h2>
          <p className="text-xs text-slate-500">Para los que la base no detecta como parecidos: busca, agrega dos o más a la lista y fusiónalos igual.</p>
        </div>
        <div className="space-y-3 px-4 py-3">
          <input value={buscarMano} onChange={(e) => setBuscarMano(e.target.value)} placeholder={tipo === "item" ? "buscar item por clave o descripción…" : `buscar artículo de ${nombreEmpresa}…`} className="w-full max-w-xl rounded border border-slate-300 px-2 py-1 text-sm" />
          {candidatosMano.length > 0 && (
            <ul className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {candidatosMano.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setElegidos((e) => [...e, c.id])} className="w-full truncate rounded border border-slate-200 px-2 py-1 text-left hover:bg-slate-50" title={c.texto}>
                    <span className="font-mono text-slate-500">{c.clave ?? "—"}</span> {c.texto}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {elegidos.length > 0 && (
            <GrupoCard
              grupo={{ ids: elegidos, maxima: 0, minima: 0 }}
              tipo={tipo}
              uso={uso}
              ocupado={fusionar.isPending}
              manual
              onFusionar={(destino, origenes) => {
                if (window.confirm(resumenFusion(destino, origenes, uso, tipo))) fusionar.mutate({ destino, origenes }, { onSuccess: () => setElegidos([]) });
              }}
              onOcultar={() => setElegidos([])}
              onQuitar={(id) => setElegidos((e) => e.filter((x) => x !== id))}
            />
          )}
        </div>
      </section>

      <section className="rounded border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-2">
          <h2 className="text-sm font-semibold text-slate-800">Historial de fusiones</h2>
          <p className="text-xs text-slate-500">Las últimas 100. "Deshacer" regresa al origen lo que se le movió y lo vuelve a activar.</p>
        </div>
        {!historial?.length ? (
          <p className="px-4 py-3 text-sm text-slate-500">Todavía no se ha fusionado nada.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {historial.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5">
                <span className="text-xs text-slate-500">{hora(f.hecho_en)}</span>
                <span className="rounded bg-slate-100 px-1.5 text-[11px] text-slate-600">{f.tipo === "item" ? "item" : "artículo"}</span>
                <span className="text-slate-800">{f.origen_texto}</span>
                <span className="text-slate-400">→</span>
                <span className="font-medium text-slate-900">{f.destino_texto}</span>
                <span className="text-xs text-slate-500">
                  {Object.entries(f.referencias ?? {}).map(([k, v]) => `${v.length} ${k.split(".")[0].replace(/_/g, " ")}`).join(" · ") || "sin movimientos"} · {f.hecho_por_nombre ?? "—"}
                  {f.nota ? ` · ${f.nota}` : ""}
                </span>
                {f.deshecho_en ? (
                  <span className="text-xs text-amber-700">deshecha {hora(f.deshecho_en)}</span>
                ) : (
                  <button type="button" onClick={() => window.confirm(`¿Deshacer la fusión de "${f.origen_texto}" en "${f.destino_texto}"?`) && deshacer.mutate(f.id)} disabled={deshacer.isPending} className="text-xs text-slate-600 hover:underline disabled:opacity-50">
                    Deshacer
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function GrupoCard({
  grupo,
  tipo,
  uso,
  ocupado,
  manual,
  onFusionar,
  onOcultar,
  onQuitar,
}: {
  grupo: GrupoSimilar;
  tipo: Tipo;
  uso: Map<string, UsoCatalogo>;
  ocupado: boolean;
  manual?: boolean;
  onFusionar: (destino: string, origenes: string[]) => void;
  onOcultar: () => void;
  onQuitar?: (id: string) => void;
}) {
  const orden = useMemo(() => ordenarParaConservar(grupo.ids, uso), [grupo.ids, uso]);
  const [destino, setDestino] = useState<string>(orden[0]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!grupo.ids.includes(destino)) setDestino(orden[0]);
  }, [orden, grupo.ids, destino]);
  const origenes = [...marcados].filter((id) => id !== destino && grupo.ids.includes(id));
  const cargado = grupo.ids.every((id) => uso.has(id));
  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-xs text-slate-500">
        <span>
          {manual ? "Elegidos a mano" : `Parecido ${Math.round(grupo.maxima * 100)} %${grupo.minima < grupo.maxima ? ` (el más flojo ${Math.round(grupo.minima * 100)} %)` : ""}`} · {grupo.ids.length} {tipo === "item" ? "items" : "artículos"}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setMarcados(new Set(grupo.ids.filter((id) => id !== destino)))} className="text-slate-600 hover:underline">
            marcar todos menos el conservado
          </button>
          <button type="button" onClick={onOcultar} className="text-slate-600 hover:underline">
            {manual ? "limpiar" : "no son iguales (ocultar)"}
          </button>
        </div>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-1">Conservar</th>
            <th className="px-3 py-1">Fusionar</th>
            <th className="px-3 py-1">Clave</th>
            <th className="px-3 py-1">Nombre</th>
            <th className="px-3 py-1">Unidad</th>
            {tipo === "producto" ? (
              <>
                <th className="px-3 py-1 text-right">Existencia</th>
                <th className="px-3 py-1 text-right">Movs.</th>
                <th className="px-3 py-1 text-right">Conteos</th>
                <th className="px-3 py-1 text-right">Requis.</th>
                <th className="px-3 py-1 text-right">Ventas</th>
              </>
            ) : (
              <>
                <th className="px-3 py-1 text-right">Precios prov.</th>
                <th className="px-3 py-1 text-right">Artículos</th>
                <th className="px-3 py-1">Categoría</th>
              </>
            )}
            {manual && <th />}
          </tr>
        </thead>
        <tbody>
          {orden.map((id) => {
            const u = uso.get(id);
            const esDestino = id === destino;
            return (
              <tr key={id} className={`border-t border-slate-100 ${esDestino ? "bg-emerald-50/50" : ""}`}>
                <td className="px-3 py-1">
                  <input type="radio" name={`destino-${grupo.ids[0]}`} checked={esDestino} onChange={() => setDestino(id)} title="este se conserva" />
                </td>
                <td className="px-3 py-1">
                  <input
                    type="checkbox"
                    disabled={esDestino}
                    checked={marcados.has(id) && !esDestino}
                    onChange={() =>
                      setMarcados((prev) => {
                        const n = new Set(prev);
                        if (n.has(id)) n.delete(id);
                        else n.add(id);
                        return n;
                      })
                    }
                    title="es lo mismo: fusionar en el conservado"
                  />
                </td>
                <td className="px-3 py-1 font-mono text-xs">{u?.clave ?? "…"}</td>
                <td className="px-3 py-1">
                  {u?.texto ?? "cargando…"}
                  {esDestino && <span className="ml-2 rounded bg-emerald-100 px-1.5 text-[11px] text-emerald-800">se conserva</span>}
                </td>
                <td className="px-3 py-1 text-slate-600">{u?.unidad ?? ""}</td>
                {tipo === "producto" ? (
                  <>
                    <td className="px-3 py-1 text-right">{u ? Number(u.existencia).toLocaleString("es-MX") : ""}</td>
                    <td className="px-3 py-1 text-right">{u?.movimientos ?? ""}</td>
                    <td className="px-3 py-1 text-right">{u?.conteos ?? ""}</td>
                    <td className="px-3 py-1 text-right">{u?.requisiciones ?? ""}</td>
                    <td className="px-3 py-1 text-right">{u?.ventas ?? ""}</td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-1 text-right">{u?.proveedores ?? ""}</td>
                    <td className="px-3 py-1 text-right">{u?.productos ?? ""}</td>
                    <td className="px-3 py-1 text-xs text-slate-600">{String(u?.extra?.categoria ?? "")}</td>
                  </>
                )}
                {manual && (
                  <td className="px-3 py-1 text-right text-xs">
                    <button type="button" onClick={() => onQuitar?.(id)} className="text-slate-500 hover:underline">
                      quitar
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-4 py-2">
        <button type="button" onClick={() => onFusionar(destino, origenes)} disabled={!origenes.length || ocupado || !cargado} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          Fusionar {origenes.length || ""} en {uso.get(destino)?.clave ?? "el conservado"}
        </button>
        <span className="text-xs text-slate-500">Marca solo los que de verdad son lo mismo; "1/2" y "1 1/2" se parecen pero no lo son.</span>
      </div>
    </div>
  );
}
