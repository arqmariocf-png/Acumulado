import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import type { PuInsumo } from "../../types/database";

type Modo = "insumo" | "basico" | "porcentaje";

const MODOS: { id: Modo; etiqueta: string; ayuda: string }[] = [
  { id: "insumo", etiqueta: "Insumo", ayuda: "Material, mano de obra o equipo del catálogo." },
  { id: "basico", etiqueta: "Básico", ayuda: "Un análisis auxiliar ya capturado (mortero, cuadrilla, habilitado)." },
  {
    id: "porcentaje",
    etiqueta: "% de mano de obra",
    ayuda: "Herramienta menor y equipo de seguridad, que se cobran como porcentaje de la mano de obra.",
  },
];

function useBusquedaInsumos(texto: string, soloHerramienta: boolean) {
  return useQuery({
    queryKey: ["pu-insumos-busqueda", texto, soloHerramienta],
    enabled: soloHerramienta || texto.trim().length >= 2,
    queryFn: async () => {
      let q = supabase.from("pu_insumos").select("id, codigo, descripcion, unidad, tipo").eq("activo", true);
      if (soloHerramienta) q = q.in("tipo", ["herramienta", "equipo"]);
      else q = q.ilike("descripcion", `%${texto.trim()}%`);
      const { data, error } = await q.order("descripcion").limit(25);
      if (error) throw error;
      return data as PuInsumo[];
    },
  });
}

function useBasicos(empresaId: string, analisisId: string) {
  return useQuery({
    queryKey: ["pu-basicos", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pu_analisis")
        .select("id, codigo, concepto, unidad")
        .eq("empresa_id", empresaId)
        .eq("es_auxiliar", true)
        .neq("id", analisisId)
        .order("codigo")
        .limit(100);
      if (error) throw error;
      return data as { id: string; codigo: string; concepto: string; unidad: string }[];
    },
  });
}

export function AgregarRenglon({
  analisisId,
  empresaId,
  onListo,
}: {
  analisisId: string;
  empresaId: string;
  onListo: () => void;
}) {
  const queryClient = useQueryClient();
  const [modo, setModo] = useState<Modo>("insumo");
  const [texto, setTexto] = useState("");
  const [elegido, setElegido] = useState<PuInsumo | null>(null);

  const { data: insumos } = useBusquedaInsumos(texto, modo === "porcentaje");
  const { data: basicos } = useBasicos(empresaId, analisisId);

  const esManoDeObra = elegido?.tipo === "mano_obra";

  const agregar = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      const datos = new FormData(form);

      // El orden se calcula al vuelo en vez de guardarse en el componente: si
      // dos personas capturan a la vez, cada renglón cae al final igual.
      const { count } = await supabase
        .from("pu_analisis_items")
        .select("id", { count: "exact", head: true })
        .eq("analisis_id", analisisId);

      const base = { analisis_id: analisisId, orden: (count ?? 0) + 1 };

      let fila: Record<string, unknown>;
      if (modo === "basico") {
        fila = { ...base, analisis_hijo_id: String(datos.get("basico")), cantidad: Number(datos.get("cantidad")) };
      } else if (modo === "porcentaje") {
        fila = {
          ...base,
          insumo_id: String(datos.get("insumo")),
          base_calculo: "pct_mano_obra",
          cantidad: Number(datos.get("porcentaje")) / 100,
        };
      } else {
        if (!elegido) throw new Error("Elige un insumo de la lista.");
        fila = {
          ...base,
          insumo_id: elegido.id,
          cantidad: Number(datos.get("cantidad")),
          rendimiento: esManoDeObra ? Number(datos.get("rendimiento")) || 1 : 1,
        };
      }

      const { error } = await supabase.from("pu_analisis_items").insert(fila);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pu-detalle", analisisId] });
      setElegido(null);
      setTexto("");
      onListo();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        agregar.mutate(e.currentTarget);
      }}
      className="rounded border border-slate-200 bg-slate-50 p-4"
    >
      <div className="mb-3 flex flex-wrap gap-1">
        {MODOS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setModo(m.id);
              setElegido(null);
            }}
            className={`rounded px-3 py-1 text-sm ${modo === m.id ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"}`}
          >
            {m.etiqueta}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-slate-500">{MODOS.find((m) => m.id === modo)?.ayuda}</p>

      {modo === "basico" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Análisis básico</span>
            <select name="basico" required className="w-full rounded border border-slate-300 px-2 py-1.5">
              <option value="">Elige…</option>
              {basicos?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.codigo} — {b.concepto} ({b.unidad})
                </option>
              ))}
            </select>
            {basicos?.length === 0 && (
              <span className="mt-1 block text-xs text-amber-700">
                No hay básicos capturados en esta empresa todavía.
              </span>
            )}
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Cantidad por unidad del concepto</span>
            <input name="cantidad" type="number" step="any" required className="w-full rounded border border-slate-300 px-2 py-1.5" />
          </label>
        </div>
      )}

      {modo === "porcentaje" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Insumo</span>
            <select name="insumo" required className="w-full rounded border border-slate-300 px-2 py-1.5">
              <option value="">Elige…</option>
              {insumos?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.descripcion}
                </option>
              ))}
            </select>
            {insumos?.length === 0 && (
              <span className="mt-1 block text-xs text-amber-700">
                Da de alta primero un insumo tipo herramienta (por ejemplo “Herramienta menor”).
              </span>
            )}
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Porcentaje sobre la mano de obra</span>
            <input
              name="porcentaje"
              type="number"
              step="any"
              required
              placeholder="3"
              className="w-full rounded border border-slate-300 px-2 py-1.5"
            />
            <span className="mt-1 block text-xs text-slate-500">Se recalcula solo si cambias un rendimiento.</span>
          </label>
        </div>
      )}

      {modo === "insumo" && (
        <div>
          {!elegido ? (
            <>
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Busca el insumo por nombre… (cemento, albañil, excavadora)"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
              {insumos && insumos.length > 0 && (
                <ul className="mt-2 max-h-56 overflow-y-auto rounded border border-slate-200 bg-white">
                  {insumos.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => setElegido(i)}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className="text-slate-900">{i.descripcion}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          {i.codigo} · {i.unidad}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {texto.trim().length >= 2 && insumos?.length === 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  No hay insumos que digan “{texto}”. Créalo en la pestaña de Catálogo.
                </p>
              )}
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3 flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-900">{elegido.descripcion}</span>
                <span className="text-xs text-slate-500">
                  {elegido.codigo} · {elegido.unidad}
                </span>
                <button type="button" onClick={() => setElegido(null)} className="text-xs text-slate-500 underline">
                  cambiar
                </button>
              </div>

              <label className="text-sm">
                <span className="mb-1 block text-slate-600">
                  {esManoDeObra ? "Jornadas de cuadrilla" : `Cantidad (${elegido.unidad})`}
                </span>
                <input
                  name="cantidad"
                  type="number"
                  step="any"
                  required
                  defaultValue={esManoDeObra ? 1 : undefined}
                  className="w-full rounded border border-slate-300 px-2 py-1.5"
                />
              </label>

              {esManoDeObra && (
                <label className="text-sm sm:col-span-2">
                  <span className="mb-1 block text-slate-600">Rendimiento: ¿cuántas unidades hace por jornada?</span>
                  <input
                    name="rendimiento"
                    type="number"
                    step="any"
                    required
                    placeholder="8"
                    className="w-full rounded border border-slate-300 px-2 py-1.5"
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    Su aportación al precio es jornadas ÷ rendimiento.
                  </span>
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {agregar.error && <p className="mt-2 text-sm text-red-600">{(agregar.error as Error).message}</p>}

      <button
        type="submit"
        disabled={agregar.isPending || (modo === "insumo" && !elegido)}
        className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {agregar.isPending ? "Agregando…" : "Agregar renglón"}
      </button>
    </form>
  );
}
