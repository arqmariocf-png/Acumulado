import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

// Indicador de cuadrillas BBVA para los supervisores (rol supervisor_bbva):
// capturan el número de folio y lo mueven por el semáforo pendiente (rojo)
// -> en ejecución (amarillo) -> atendido (verde). Nada más. Corporativo,
// dirección y admin ven los folios de todos los supervisores.

export type EstatusCuadrilla = "pendiente" | "en_ejecucion" | "atendido";

export interface FolioCuadrilla {
  id: string;
  folio: string;
  estatus: EstatusCuadrilla;
  sucursal: string | null;
  descripcion: string | null;
  nota: string | null;
  supervisor_id: string;
  en_ejecucion_en: string | null;
  atendido_en: string | null;
  creado_en: string;
  actualizado_en: string;
  supervisor?: { nombre: string } | null;
}

export const ESTATUS_CUADRILLA: { valor: EstatusCuadrilla; etiqueta: string; chip: string; punto: string; boton: string }[] = [
  { valor: "pendiente", etiqueta: "Pendiente", chip: "bg-red-100 text-red-800 border-red-200", punto: "bg-red-500", boton: "bg-red-600 hover:bg-red-700" },
  { valor: "en_ejecucion", etiqueta: "En ejecución", chip: "bg-amber-100 text-amber-800 border-amber-200", punto: "bg-amber-400", boton: "bg-amber-500 hover:bg-amber-600" },
  { valor: "atendido", etiqueta: "Atendido", chip: "bg-green-100 text-green-800 border-green-200", punto: "bg-green-500", boton: "bg-green-600 hover:bg-green-700" },
];

export function infoEstatus(valor: EstatusCuadrilla) {
  return ESTATUS_CUADRILLA.find((e) => e.valor === valor) ?? ESTATUS_CUADRILLA[0];
}

function useFoliosCuadrilla() {
  return useQuery({
    queryKey: ["bbva-folios-cuadrilla"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bbva_folios_cuadrilla")
        .select("*, supervisor:supervisor_id(nombre)")
        .order("actualizado_en", { ascending: false });
      if (error) throw error;
      return data as FolioCuadrilla[];
    },
  });
}

function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

export function FoliosCuadrilla() {
  const { perfil } = useAuth();
  const esSupervisor = perfil?.rol === "supervisor_bbva";
  const puedeCapturar = esSupervisor || perfil?.rol === "admin";
  const veTodos = !esSupervisor;
  const queryClient = useQueryClient();
  const { data: folios, isLoading } = useFoliosCuadrilla();
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<EstatusCuadrilla | "todos">("todos");

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["bbva-folios-cuadrilla"] });

  const agregar = useMutation({
    mutationFn: async (payload: { folio: string; sucursal: string | null; descripcion: string | null }) => {
      const { error } = await supabase.from("bbva_folios_cuadrilla").insert({ ...payload, supervisor_id: perfil?.id });
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: (err) => setError(/duplicate|unique/i.test((err as Error).message) ? "Ese folio ya está registrado." : (err as Error).message),
  });

  const cambiarEstatus = useMutation({
    mutationFn: async (p: { id: string; estatus: EstatusCuadrilla }) => {
      const { data, error } = await supabase.from("bbva_folios_cuadrilla").update({ estatus: p.estatus }).eq("id", p.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("No se pudo actualizar el folio (sin permiso).");
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bbva_folios_cuadrilla").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formulario = e.currentTarget;
    const fd = new FormData(formulario);
    const folio = String(fd.get("folio") ?? "").trim();
    if (!folio) return;
    agregar.mutate(
      {
        folio,
        sucursal: String(fd.get("sucursal") ?? "").trim() || null,
        descripcion: String(fd.get("descripcion") ?? "").trim() || null,
      },
      { onSuccess: () => formulario.reset() },
    );
  }

  const conteo = ESTATUS_CUADRILLA.map((e) => ({ ...e, n: (folios ?? []).filter((f) => f.estatus === e.valor).length }));
  const lista = (folios ?? []).filter((f) => filtro === "todos" || f.estatus === filtro);

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Folios BBVA · cuadrillas</h1>
        <p className="text-sm text-slate-500">
          {esSupervisor ? "Registra el folio y muévelo conforme avance tu cuadrilla." : "Semáforo de folios capturado por los supervisores."}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {conteo.map((e) => (
          <button
            key={e.valor}
            type="button"
            onClick={() => setFiltro(filtro === e.valor ? "todos" : e.valor)}
            className={`rounded-lg border p-3 text-left ${e.chip} ${filtro === e.valor ? "ring-2 ring-slate-400" : ""}`}
          >
            <p className="text-2xl font-semibold tabular-nums">{e.n}</p>
            <p className="text-xs font-medium">{e.etiqueta}</p>
          </button>
        ))}
      </div>

      {puedeCapturar && (
        <form onSubmit={onSubmit} className="grid gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_1fr_2fr_auto]">
          <input name="folio" required placeholder="Número de folio" className="rounded border border-slate-300 px-2 py-2 text-sm" inputMode="numeric" />
          <input name="sucursal" placeholder="Sucursal (opcional)" className="rounded border border-slate-300 px-2 py-2 text-sm" />
          <input name="descripcion" placeholder="Qué se atiende (opcional)" className="rounded border border-slate-300 px-2 py-2 text-sm" />
          <button disabled={agregar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {agregar.isPending ? "Guardando…" : "Agregar"}
          </button>
        </form>
      )}

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      <ul className="space-y-2">
        {lista.map((f) => {
          const e = infoEstatus(f.estatus);
          const mio = f.supervisor_id === perfil?.id;
          const puedeMover = perfil?.rol === "admin" || (esSupervisor && mio);
          return (
            <li key={f.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-3 w-3 rounded-full ${e.punto}`} aria-hidden />
                  <div>
                    <p className="font-semibold text-slate-900">Folio {f.folio}</p>
                    <p className="text-xs text-slate-500">
                      {[f.sucursal, f.descripcion].filter(Boolean).join(" · ")}
                      {veTodos && f.supervisor?.nombre ? `${f.sucursal || f.descripcion ? " · " : ""}${f.supervisor.nombre}` : ""}
                    </p>
                  </div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${e.chip}`}>
                  {e.etiqueta}
                  {f.estatus === "atendido" && f.atendido_en ? ` · ${fechaCorta(f.atendido_en)}` : ""}
                  {f.estatus === "en_ejecucion" && f.en_ejecucion_en ? ` · desde ${fechaCorta(f.en_ejecucion_en)}` : ""}
                </span>
              </div>
              {puedeMover && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {ESTATUS_CUADRILLA.filter((o) => o.valor !== f.estatus).map((o) => (
                    <button
                      key={o.valor}
                      type="button"
                      disabled={cambiarEstatus.isPending}
                      onClick={() => cambiarEstatus.mutate({ id: f.id, estatus: o.valor })}
                      className={`rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${o.boton}`}
                    >
                      {o.etiqueta}
                    </button>
                  ))}
                  {f.estatus === "pendiente" && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`¿Quitar el folio ${f.folio}?`)) quitar.mutate(f.id);
                      }}
                      className="ml-auto text-xs text-slate-500 hover:underline"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {!isLoading && lista.length === 0 && (
          <li className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
            {folios?.length === 0 ? "Todavía no hay folios registrados." : "Sin folios en este estatus."}
          </li>
        )}
      </ul>
    </div>
  );
}
