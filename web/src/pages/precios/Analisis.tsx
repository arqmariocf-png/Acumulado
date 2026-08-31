import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { TarjetaAnalisis } from "./TarjetaAnalisis";
import { ETAPA_DEL_ROL } from "./comun";
import type { PuCosteo, PuEstado } from "../../types/database";

type Filtro = "pendientes" | "todos";

function useAnalisis(filtro: Filtro, etapa: PuEstado | undefined) {
  return useQuery({
    queryKey: ["pu-analisis", filtro, etapa],
    queryFn: async () => {
      let q = supabase.from("v_pu_analisis_costeo").select("*").order("updated_at", { ascending: false });
      q = filtro === "pendientes" && etapa ? q.eq("estado", etapa) : q.neq("estado", "obsoleto");
      const { data, error } = await q.limit(200);
      if (error) throw error;
      return data as PuCosteo[];
    },
  });
}

/**
 * Obras donde el usuario puede abrir un análisis. RLS ya filtra las suyas.
 *
 * La empresa se trae en una consulta aparte en vez de anidarla con
 * `empresas(codigo)`: supabase-js tipa el anidado como arreglo aunque
 * PostgREST devuelva un objeto para una relación muchos-a-uno, y esa
 * discrepancia rompe el build. Dos consultas y un Map salen más baratos que
 * pelearse con ese tipo.
 */
function useProyectos() {
  return useQuery({
    queryKey: ["pu-proyectos"],
    queryFn: async () => {
      const [proyectos, empresas] = await Promise.all([
        supabase.from("proyectos").select("id, nombre, empresa_id").eq("activo", true).order("nombre").limit(500),
        supabase.from("empresas").select("id, codigo"),
      ]);
      if (proyectos.error) throw proyectos.error;
      if (empresas.error) throw empresas.error;

      const codigoPorEmpresa = new Map<string, string>(
        (empresas.data ?? []).map((e) => [String(e.id), String(e.codigo)]),
      );

      return (proyectos.data ?? []).map((p) => ({
        id: String(p.id),
        nombre: String(p.nombre),
        empresa_id: String(p.empresa_id),
        empresa_codigo: codigoPorEmpresa.get(String(p.empresa_id)) ?? "",
      }));
    },
  });
}

export function Analisis() {
  const { perfil } = useAuth();
  const navegar = useNavigate();
  const queryClient = useQueryClient();

  const etapa = perfil ? ETAPA_DEL_ROL[perfil.rol] : undefined;
  const [filtro, setFiltro] = useState<Filtro>(etapa ? "pendientes" : "todos");
  const [abriendo, setAbriendo] = useState(false);

  const { data: analisis, isLoading, error } = useAnalisis(filtro, etapa);
  const { data: proyectos } = useProyectos();

  const puedeCrear = perfil?.rol !== "almacen" && perfil?.rol !== "rh";

  const crear = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      const datos = new FormData(form);
      const proyectoId = String(datos.get("proyecto"));
      const proyecto = proyectos?.find((p) => p.id === proyectoId);
      if (!proyecto) throw new Error("Elige una obra.");

      const { data, error: errorInsert } = await supabase
        .from("pu_analisis")
        .insert({
          empresa_id: proyecto.empresa_id,
          proyecto_id: proyecto.id,
          codigo: String(datos.get("codigo")).trim().toUpperCase(),
          concepto: String(datos.get("concepto")).trim(),
          unidad: String(datos.get("unidad")).trim().toUpperCase(),
          es_auxiliar: datos.get("es_auxiliar") === "true",
          creado_por: perfil?.id,
        })
        .select("id")
        .single();

      if (errorInsert) {
        throw new Error(
          errorInsert.code === "23505"
            ? "Ya existe un análisis con esa clave en esta empresa."
            : errorInsert.message,
        );
      }
      return data.id as string;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["pu-analisis"] });
      navegar(`/precios/${id}`);
    },
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {etapa && (
          <div className="flex gap-1 rounded border border-slate-300 p-0.5">
            {(["pendientes", "todos"] as Filtro[]).map((f) => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`rounded px-3 py-1 text-sm ${filtro === f ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {f === "pendientes" ? "Me toca" : "Todos"}
              </button>
            ))}
          </div>
        )}
        <div className="grow" />
        {puedeCrear && (
          <button
            onClick={() => setAbriendo((v) => !v)}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            {abriendo ? "Cancelar" : "Nuevo análisis"}
          </button>
        )}
      </div>

      {abriendo && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            crear.mutate(e.currentTarget);
          }}
          className="mb-6 rounded border border-slate-200 bg-white p-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2 text-sm">
              <span className="mb-1 block text-slate-600">Obra</span>
              <select name="proyecto" required className="w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="">Elige una obra…</option>
                {proyectos?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.empresa_codigo} · {p.nombre}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Clave</span>
              <input
                name="codigo"
                required
                placeholder="MUR-TAB-01"
                className="w-full rounded border border-slate-300 px-2 py-1.5 uppercase"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Unidad</span>
              <input name="unidad" required placeholder="M2" className="w-full rounded border border-slate-300 px-2 py-1.5 uppercase" />
            </label>

            <label className="sm:col-span-2 text-sm">
              <span className="mb-1 block text-slate-600">Concepto</span>
              <textarea
                name="concepto"
                required
                rows={2}
                placeholder="Muro de tabique rojo recocido de 12 cm, asentado con mortero 1:5, incluye material, mano de obra y herramienta"
                className="w-full rounded border border-slate-300 px-2 py-1.5"
              />
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Tipo</span>
              <select name="es_auxiliar" className="w-full rounded border border-slate-300 px-2 py-1.5">
                <option value="false">Concepto de obra</option>
                <option value="true">Básico (auxiliar)</option>
              </select>
            </label>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            Un básico se consume dentro de otros análisis a costo directo y no lleva indirectos ni utilidad.
          </p>

          {crear.error && <p className="mt-2 text-sm text-red-600">{(crear.error as Error).message}</p>}

          <button
            type="submit"
            disabled={crear.isPending}
            className="mt-3 rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {crear.isPending ? "Creando…" : "Crear y capturar"}
          </button>
        </form>
      )}

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {(error as Error).message}</p>}

      <div className="grid gap-3">
        {analisis?.map((pu) => <TarjetaAnalisis key={pu.analisis_id} pu={pu} />)}
      </div>

      {analisis?.length === 0 && (
        <p className="py-12 text-center text-sm text-slate-400">
          {filtro === "pendientes" ? "No tienes nada pendiente por resolver." : "Todavía no hay análisis aquí."}
        </p>
      )}
    </div>
  );
}
