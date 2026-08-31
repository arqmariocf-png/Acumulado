import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { dinero } from "./comun";
import type { PuInsumo, PuTipoInsumo } from "../../types/database";

const TIPOS: { id: PuTipoInsumo; etiqueta: string }[] = [
  { id: "material", etiqueta: "Material" },
  { id: "mano_obra", etiqueta: "Mano de obra" },
  { id: "herramienta", etiqueta: "Herramienta" },
  { id: "equipo", etiqueta: "Equipo" },
];

/**
 * El insumo no guarda su costo: se deriva del historial en pu_insumo_precios.
 * v_pu_insumos_vigentes ya resuelve el costo que le aplica a quien consulta,
 * con la misma función que usa el motor de costeo -- así la pantalla y el
 * precio unitario no pueden discrepar.
 */
function useInsumos() {
  return useQuery({
    queryKey: ["pu-insumos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_pu_insumos_vigentes")
        .select("*")
        .eq("activo", true)
        .order("descripcion")
        .limit(500);
      if (error) throw error;
      return data as (PuInsumo & { costo_vigente: number | null; cotizado_el: string | null })[];
    },
  });
}

export function Catalogo() {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const [busqueda, setBusqueda] = useState("");
  const [creando, setCreando] = useState(false);
  const [cotizando, setCotizando] = useState<string | null>(null);

  const { data: insumos, isLoading, error } = useInsumos();
  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["pu-insumos"] });

  const crear = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      const d = new FormData(form);
      const { data, error: err } = await supabase
        .from("pu_insumos")
        .insert({
          codigo: String(d.get("codigo")).trim().toUpperCase(),
          descripcion: String(d.get("descripcion")).trim(),
          unidad: String(d.get("unidad")).trim().toUpperCase(),
          tipo: String(d.get("tipo")) as PuTipoInsumo,
        })
        .select("id")
        .single();

      if (err) throw new Error(err.code === "23505" ? "Ya existe un insumo con esa clave." : err.message);

      const costo = Number(d.get("costo"));
      if (costo > 0) {
        await supabase.from("pu_insumo_precios").insert({
          insumo_id: data.id,
          costo,
          fuente: "alta de catálogo",
          creado_por: perfil?.id,
        });
      }
    },
    onSuccess: () => {
      setCreando(false);
      invalidar();
    },
  });

  const cotizar = useMutation({
    mutationFn: async ({ insumoId, form }: { insumoId: string; form: HTMLFormElement }) => {
      const d = new FormData(form);
      const { error: err } = await supabase.from("pu_insumo_precios").insert({
        insumo_id: insumoId,
        costo: Number(d.get("costo")),
        fuente: String(d.get("fuente") ?? "").trim() || null,
        // El catálogo es del grupo: un jornal de albañil cuesta lo mismo lo
        // capture quien lo capture, así que la cotización se guarda a nivel
        // grupo (empresa_id null) y la ven las ocho empresas. El esquema sí
        // admite un precio propio por empresa, pero no se ofrece aquí hasta
        // que alguien tenga una razón real para partir el catálogo.
        empresa_id: null,
        creado_por: perfil?.id,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setCotizando(null);
      invalidar();
    },
  });

  const q = busqueda.trim().toLowerCase();
  const filtrados = insumos?.filter((i) => !q || `${i.codigo} ${i.descripcion}`.toLowerCase().includes(q));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o clave…"
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <div className="grow" />
        <button
          onClick={() => setCreando((v) => !v)}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          {creando ? "Cancelar" : "Nuevo insumo"}
        </button>
      </div>

      {creando && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            crear.mutate(e.currentTarget);
          }}
          className="mb-6 grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-3"
        >
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-slate-600">Descripción</span>
            <input name="descripcion" required className="w-full rounded border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Clave</span>
            <input name="codigo" required placeholder="MAT-CEM-01" className="w-full rounded border border-slate-300 px-2 py-1.5 uppercase" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Unidad</span>
            <input name="unidad" required placeholder="M3" className="w-full rounded border border-slate-300 px-2 py-1.5 uppercase" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Tipo</span>
            <select name="tipo" required className="w-full rounded border border-slate-300 px-2 py-1.5">
              {TIPOS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Costo actual (opcional)</span>
            <input name="costo" type="number" step="any" className="w-full rounded border border-slate-300 px-2 py-1.5" />
          </label>

          {crear.error && <p className="sm:col-span-3 text-sm text-red-600">{(crear.error as Error).message}</p>}

          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={crear.isPending}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {crear.isPending ? "Guardando…" : "Dar de alta"}
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {(error as Error).message}</p>}

      {filtrados && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Clave</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2 text-right">Costo vigente</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtrados.map((i) => (
                <tr key={i.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 text-slate-500">{i.codigo}</td>
                  <td className="px-3 py-2">{i.descripcion}</td>
                  <td className="px-3 py-2 text-slate-500">{TIPOS.find((t) => t.id === i.tipo)?.etiqueta ?? i.tipo}</td>
                  <td className="px-3 py-2 text-slate-500">{i.unidad}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {i.costo_vigente === null ? <span className="text-amber-700">sin cotizar</span> : dinero(i.costo_vigente)}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    <button
                      onClick={() => setCotizando(cotizando === i.id ? null : i.id)}
                      className="text-slate-600 underline"
                    >
                      cotizar
                    </button>
                    {cotizando === i.id && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          cotizar.mutate({ insumoId: i.id, form: e.currentTarget });
                        }}
                        className="mt-2 grid justify-items-end gap-1"
                      >
                        <input
                          name="costo"
                          type="number"
                          step="any"
                          required
                          placeholder="Nuevo costo"
                          className="w-40 rounded border border-slate-300 px-2 py-1"
                        />
                        <input
                          name="fuente"
                          placeholder="Cotización, factura…"
                          className="w-40 rounded border border-slate-300 px-2 py-1"
                        />
                        <button className="w-40 rounded bg-slate-900 px-2 py-1 text-white">Guardar costo</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    {q ? "Nada coincide." : "Catálogo vacío."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {cotizar.error && <p className="mt-2 text-sm text-red-600">{(cotizar.error as Error).message}</p>}

      <p className="mt-3 text-xs text-slate-500">
        Un costo nuevo no borra el anterior: se agrega al historial con su fecha. Los análisis viejos siguen siendo
        reproducibles y los que estén en borrador se recalculan solos.
      </p>
    </div>
  );
}
