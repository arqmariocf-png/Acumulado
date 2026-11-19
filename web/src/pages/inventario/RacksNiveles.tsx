import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { abrirParaImprimir, abrirVentanaImpresion } from "../../lib/imprimir";
import { htmlEtiquetas, type EtiquetaConteo } from "../../lib/conteoInventario";
import { agruparUbicaciones, generarUbicaciones, nombreUbicacion, revisarRack, urlEtiquetaLugar, type Ubicacion } from "../../lib/ubicacionesBodega";

// Racks y niveles de la bodega (19-nov-2026, Mario: "poner una opción de
// racks y niveles de rack para darle forma"). Quien administra el conteo
// (admin, corporativo, dirección, almacén) da de alta los racks de cada
// bodega con sus niveles y posiciones; cada lugar sale con código y etiqueta
// QR que, al escanearse, deja ese lugar elegido en la captura del conteo.

export function useUbicaciones(empresaId: string | null | undefined) {
  return useQuery({
    queryKey: ["inventario-ubicaciones", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventario_ubicaciones")
        .select("id, empresa_id, bodega, rack, nivel, posicion, codigo, descripcion, activo")
        .eq("empresa_id", empresaId!)
        .order("bodega")
        .order("rack")
        .order("nivel")
        .order("posicion")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Ubicacion[];
    },
  });
}

interface Props {
  empresaId: string;
  empresaNombre: string;
  administra: boolean;
  /** Ítems contados por lugar en el conteo actual (ubicacion_id → cantidad de ítems). */
  contadosPorLugar?: Map<string, number>;
}

export function RacksNiveles({ empresaId, empresaNombre, administra, contadosPorLugar }: Props) {
  const qc = useQueryClient();
  const { data: ubicaciones, isLoading } = useUbicaciones(empresaId);
  const [bodega, setBodega] = useState("Bodega");
  const [rack, setRack] = useState("");
  const [niveles, setNiveles] = useState("3");
  const [posiciones, setPosiciones] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  const grupos = useMemo(() => agruparUbicaciones((ubicaciones ?? []).filter((u) => u.activo)), [ubicaciones]);
  const bodegas = useMemo(() => [...new Set((ubicaciones ?? []).map((u) => u.bodega))].sort((a, b) => a.localeCompare(b, "es")), [ubicaciones]);

  const agregar = useMutation({
    mutationFn: async () => {
      const n = Number(niveles);
      const p = Number(posiciones);
      const falta = revisarRack({ bodega, rack, niveles: n, posiciones: p });
      if (falta) throw new Error(falta);
      const filas = generarUbicaciones(bodega, rack, n, p);
      const existentes = new Set((ubicaciones ?? []).map((u) => u.codigo));
      const nuevas = filas.filter((f) => !existentes.has(f.codigo));
      if (!nuevas.length) throw new Error(`El rack ${rack} de ${bodega} ya existe con esos niveles.`);
      const { error: err } = await supabase.from("inventario_ubicaciones").insert(nuevas.map((f) => ({ empresa_id: empresaId, bodega: f.bodega, rack: f.rack, nivel: f.nivel, posicion: f.posicion })));
      if (err) throw err;
      return nuevas.length;
    },
    onSuccess: () => {
      setError(null);
      setRack("");
      qc.invalidateQueries({ queryKey: ["inventario-ubicaciones", empresaId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const desactivar = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error: err } = await supabase.from("inventario_ubicaciones").update({ activo: false }).in("id", ids);
      if (err) throw err;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["inventario-ubicaciones", empresaId] }),
    onError: (e: Error) => setError(e.message),
  });

  async function imprimir(lista: Ubicacion[], titulo: string) {
    if (!lista.length) return;
    const ventana = abrirVentanaImpresion();
    try {
      const Q = await import("qrcode");
      const etiquetas: EtiquetaConteo[] = await Promise.all(
        lista.map(async (u) => ({
          codigo: u.codigo,
          descripcion: nombreUbicacion(u),
          cantidad: null,
          unidad: "",
          ubicacion: null,
          empresa: empresaNombre,
          qrSvg: await Q.toString(urlEtiquetaLugar(u.codigo, window.location.origin), { type: "svg", errorCorrectionLevel: "M", margin: 0 }),
        })),
      );
      if (!abrirParaImprimir(htmlEtiquetas(etiquetas, titulo), ventana)) setError("El navegador bloqueó la ventana. Permite ventanas emergentes.");
    } catch (e) {
      ventana?.close();
      setError((e as Error).message);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!agregar.isPending) agregar.mutate();
  }

  const activos = (ubicaciones ?? []).filter((u) => u.activo);

  return (
    <section className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Racks y niveles de la bodega · {empresaNombre}</h2>
          <p className="text-xs text-slate-500">
            Cada rack, nivel y posición tiene su código y su etiqueta QR. Pégala en el rack: al escanearla, el conteo queda en ese lugar y así se sabe dónde está cada cosa.
          </p>
        </div>
        <button type="button" onClick={() => imprimir(activos, `Etiquetas QR · lugares · ${empresaNombre}`)} disabled={!activos.length} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          🖨 Imprimir todas las etiquetas de lugar ({activos.length})
        </button>
      </div>
      {error && <p className="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {administra && (
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-3 text-sm" data-sin-borrador>
          <label className="block">
            <span className="block text-xs text-slate-500">Bodega</span>
            <input value={bodega} onChange={(e) => setBodega(e.target.value)} list="bodegas-conteo" className="w-40 rounded border border-slate-300 px-2 py-1" placeholder="Bodega" />
            <datalist id="bodegas-conteo">
              {bodegas.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500">Rack (número o nombre)</span>
            <input value={rack} onChange={(e) => setRack(e.target.value)} className="w-32 rounded border border-slate-300 px-2 py-1" placeholder="1" />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500">Niveles</span>
            <input value={niveles} onChange={(e) => setNiveles(e.target.value)} inputMode="numeric" className="w-20 rounded border border-slate-300 px-2 py-1 text-right" />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500">Posiciones por nivel (0 = sin posiciones)</span>
            <input value={posiciones} onChange={(e) => setPosiciones(e.target.value)} inputMode="numeric" className="w-20 rounded border border-slate-300 px-2 py-1 text-right" />
          </label>
          <button type="submit" disabled={agregar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            + Agregar rack
          </button>
          <span className="text-xs text-slate-500">Para varios racks iguales, agrégalos uno por uno cambiando el número.</span>
        </form>
      )}

      {isLoading ? (
        <p className="px-4 py-3 text-sm text-slate-500">Cargando…</p>
      ) : grupos.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">
          Esta empresa todavía no tiene racks dados de alta. {administra ? "Agrega el primero arriba." : "Los da de alta almacén o dirección."} Mientras, la ubicación se escribe a mano.
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {grupos.map((g) => {
            const clave = `${g.bodega}|${g.rack}`;
            const todosDelRack = [g.cabecera, ...g.niveles.flatMap((n) => [n.lugar, ...n.posiciones])].filter((u): u is Ubicacion => !!u);
            const contados = todosDelRack.reduce((s, u) => s + (contadosPorLugar?.get(u.id) ?? 0), 0);
            return (
              <div key={clave} className="px-4 py-2">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <button type="button" onClick={() => setAbierto(abierto === clave ? null : clave)} className="font-medium text-slate-800 hover:underline">
                    {abierto === clave ? "▾" : "▸"} {g.bodega} · Rack {g.rack}
                  </button>
                  <span className="font-mono text-xs text-slate-500">{g.cabecera?.codigo}</span>
                  <span className="text-xs text-slate-500">
                    {g.niveles.length} nivel(es){g.niveles.some((n) => n.posiciones.length) ? ` · ${g.niveles.reduce((s, n) => s + n.posiciones.length, 0)} posiciones` : ""}
                    {contadosPorLugar ? ` · ${contados} ítem(s) contados` : ""}
                  </span>
                  <button type="button" onClick={() => imprimir(todosDelRack, `Etiquetas QR · ${g.bodega} · Rack ${g.rack}`)} className="text-xs text-slate-600 hover:underline">
                    🖨 etiquetas del rack
                  </button>
                  {administra && (
                    <button
                      type="button"
                      onClick={() => window.confirm(`¿Quitar el rack ${g.rack} de ${g.bodega} con sus ${todosDelRack.length} lugares? Lo ya contado ahí conserva su código.`) && desactivar.mutate(todosDelRack.map((u) => u.id))}
                      className="text-xs text-red-600 hover:underline"
                    >
                      quitar
                    </button>
                  )}
                </div>
                {abierto === clave && (
                  <ul className="mt-1 grid gap-1 pl-5 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
                    {g.niveles.map((n) => (
                      <li key={n.nivel} className="rounded bg-slate-50 px-2 py-1">
                        <span className="font-medium text-slate-700">Nivel {n.nivel}</span> <span className="font-mono">{n.lugar?.codigo}</span>
                        {contadosPorLugar && n.lugar && contadosPorLugar.get(n.lugar.id) ? <span className="ml-1 rounded bg-emerald-50 px-1 text-emerald-800">{contadosPorLugar.get(n.lugar.id)}</span> : null}
                        {n.posiciones.length > 0 && (
                          <span className="block text-[11px] text-slate-500">
                            {n.posiciones.map((p) => (
                              <span key={p.id} className="mr-2 font-mono">
                                P{p.posicion}
                                {contadosPorLugar?.get(p.id) ? <span className="ml-0.5 rounded bg-emerald-50 px-1 text-emerald-800">{contadosPorLugar.get(p.id)}</span> : null}
                              </span>
                            ))}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
