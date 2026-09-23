import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { imprimirRemisionProduccion } from "./remisionProduccionQr";

export interface ItemRemision {
  id: string;
  nombre: string;
  unidad_medida: string;
}

interface LineaForm {
  itemId: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
}

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";

/** Generador de remisión con QR para la planta. `tipo` salida = entrega a
 * cliente (producto terminado); entrada = recepción de proveedor (materia
 * prima). Al guardar se abre la remisión en hoja membretada. */
export function RemisionProduccionModal({
  empresaId,
  tipo,
  items,
  referencias,
  onCerrar,
}: {
  empresaId: string;
  tipo: "salida" | "entrada";
  items: ItemRemision[];
  /** OV (salida) u OC (entrada) para ligar y sugerir la contraparte. */
  referencias: { id: string; folio: string; contraparte: string | null }[];
  onCerrar: () => void;
}) {
  const queryClient = useQueryClient();
  const [contraparte, setContraparte] = useState("");
  const [referenciaId, setReferenciaId] = useState("");
  const [proyectoId, setProyectoId] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [lineas, setLineas] = useState<LineaForm[]>([{ itemId: "", descripcion: "", cantidad: 1, unidad: "pza" }]);
  const [error, setError] = useState<string | null>(null);
  const [creada, setCreada] = useState<{ id: string; folio: string } | null>(null);

  const { data: proyectos } = useQuery({
    queryKey: ["proyectos-planta", empresaId],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("proyectos").select("id, nombre, cliente").eq("empresa_id", empresaId).eq("activo", true).order("nombre");
      if (err) throw err;
      return data as { id: string; nombre: string; cliente: string | null }[];
    },
  });

  const contrapartes = Array.from(new Set(referencias.map((r) => r.contraparte).filter((c): c is string => !!c))).sort();

  function setLinea(i: number, cambio: Partial<LineaForm>) {
    setLineas((prev) => prev.map((l, j) => (j === i ? { ...l, ...cambio } : l)));
  }
  function elegirItem(i: number, itemId: string) {
    const it = items.find((x) => x.id === itemId);
    setLinea(i, { itemId, descripcion: it?.nombre ?? "", unidad: it?.unidad_medida ?? "pza" });
  }

  const crear = useMutation({
    mutationFn: async () => {
      if (!contraparte.trim()) throw new Error(tipo === "salida" ? "Indica el cliente." : "Indica el proveedor o de quién se recibe.");
      const validas = lineas.filter((l) => l.descripcion.trim() && l.cantidad > 0);
      if (validas.length === 0) throw new Error("Agrega al menos una partida con cantidad.");
      const { data: sesion } = await supabase.auth.getSession();
      const userId = sesion.session?.user.id;
      if (!userId) throw new Error("Sesión expirada, vuelve a iniciar sesión.");
      const { data: rem, error: errRem } = await supabase
        .from("remisiones_produccion")
        .insert({
          empresa_id: empresaId,
          tipo,
          contraparte: contraparte.trim(),
          proyecto_id: proyectoId || null,
          orden_venta_id: tipo === "salida" && referenciaId ? referenciaId : null,
          orden_compra_id: tipo === "entrada" && referenciaId ? referenciaId : null,
          observaciones: observaciones.trim() || null,
          emitida_por: userId,
        })
        .select("id, folio")
        .single();
      if (errRem) throw errRem;
      const { error: errLineas } = await supabase.from("remisiones_produccion_lineas").insert(
        validas.map((l, i) => ({
          remision_id: rem.id,
          descripcion: l.descripcion.trim(),
          cantidad: l.cantidad,
          unidad: l.unidad || "pza",
          producto_id: tipo === "salida" && l.itemId ? l.itemId : null,
          materia_prima_id: tipo === "entrada" && l.itemId ? l.itemId : null,
          orden: i,
        })),
      );
      if (errLineas) throw errLineas;
      return rem as { id: string; folio: string };
    },
    onSuccess: (rem) => {
      setCreada(rem);
      queryClient.invalidateQueries({ queryKey: ["remisiones-produccion", empresaId] });
      imprimirRemisionProduccion(rem.id).catch(() => undefined);
    },
    onError: (err) => setError((err as Error).message),
  });

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onCerrar}>
      <div className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">{tipo === "salida" ? "Remisión de entrega (cliente)" : "Remisión de recepción (proveedor)"}</h3>
          <button onClick={onCerrar} className="text-sm text-slate-500 underline">
            Cerrar
          </button>
        </div>

        {creada ? (
          <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            Remisión <b className="font-mono">{creada.folio}</b> generada. Se abrió lista para imprimir con su QR.
            <div className="mt-2 flex gap-3">
              <button onClick={() => imprimirRemisionProduccion(creada.id).catch((e) => setError((e as Error).message))} className="underline">
                Volver a imprimir
              </button>
              <Link to={`/produccion/remisiones/${creada.id}`} className="underline">
                Ver remisión
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={etiqueta}>{tipo === "salida" ? "Cliente *" : "Proveedor / de quién se recibe *"}</label>
                <input list="contrapartes-remision" value={contraparte} onChange={(e) => setContraparte(e.target.value)} className={campo} placeholder="Nombre" />
                <datalist id="contrapartes-remision">
                  {contrapartes.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className={etiqueta}>{tipo === "salida" ? "Orden de venta" : "Orden de compra"} (opcional)</label>
                <select
                  value={referenciaId}
                  onChange={(e) => {
                    setReferenciaId(e.target.value);
                    const ref = referencias.find((r) => r.id === e.target.value);
                    if (ref?.contraparte && !contraparte) setContraparte(ref.contraparte);
                  }}
                  className={campo}
                >
                  <option value="">Sin ligar</option>
                  {referencias.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.folio} — {r.contraparte ?? "sin nombre"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={etiqueta}>Proyecto / obra (opcional)</label>
                <select value={proyectoId} onChange={(e) => setProyectoId(e.target.value)} className={campo}>
                  <option value="">Sin proyecto</option>
                  {proyectos?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                      {p.cliente ? ` · ${p.cliente}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={etiqueta}>Observaciones</label>
                <input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className={campo} />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className={etiqueta}>Partidas</label>
                <button type="button" onClick={() => setLineas((p) => [...p, { itemId: "", descripcion: "", cantidad: 1, unidad: "pza" }])} className="text-xs text-slate-700 underline">
                  + Agregar partida
                </button>
              </div>
              <div className="space-y-2">
                {lineas.map((l, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <select value={l.itemId} onChange={(e) => elegirItem(i, e.target.value)} className={`${campo} col-span-4`}>
                      <option value="">{tipo === "salida" ? "Producto…" : "Materia prima…"}</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.nombre}
                        </option>
                      ))}
                    </select>
                    <input value={l.descripcion} onChange={(e) => setLinea(i, { descripcion: e.target.value })} placeholder="Descripción" className={`${campo} col-span-4`} />
                    <input type="number" step="0.0001" min="0.0001" value={l.cantidad || ""} onChange={(e) => setLinea(i, { cantidad: Number(e.target.value) })} className={`${campo} col-span-2`} />
                    <input value={l.unidad} onChange={(e) => setLinea(i, { unidad: e.target.value })} className={`${campo} col-span-1`} />
                    <button type="button" onClick={() => setLineas((p) => p.filter((_, j) => j !== i))} className="col-span-1 text-xs text-red-600">
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button onClick={() => crear.mutate()} disabled={crear.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {crear.isPending ? "Generando…" : "Generar remisión con QR"}
            </button>
            <p className="text-xs text-slate-500">La remisión sale en hoja membretada de la empresa con su folio consecutivo y un QR que abre la remisión en la app para confirmar la entrega.</p>
          </div>
        )}
      </div>
    </div>
  );
}
