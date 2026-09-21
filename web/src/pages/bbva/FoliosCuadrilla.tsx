import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { LeyendaPasos } from "./PasosPorFolio";

// Semáforo de atención de las cuadrillas BBVA.
// - Mantenimiento BBVA (Christian, Luis: permiso bbva_mantenimiento) y
//   admin/corporativo ASIGNAN folios a los supervisores, los reasignan o
//   los quitan.
// - El supervisor de cuadrilla (rol supervisor_bbva) ve solo los suyos y
//   únicamente mueve el estatus: pendiente (rojo) -> en ejecución
//   (amarillo) -> atendido (verde). Un trigger en la base lo impide aunque
//   alguien manipule la pantalla.
// - Dirección ve todo sin tocar nada.

export type EstatusCuadrilla = "pendiente" | "en_ejecucion" | "atendido";

export interface FolioCuadrilla {
  id: string;
  folio: string;
  estatus: EstatusCuadrilla;
  sucursal: string | null;
  descripcion: string | null;
  nota: string | null;
  supervisor_id: string;
  asignado_por: string | null;
  asignado_en: string;
  en_ejecucion_en: string | null;
  atendido_en: string | null;
  creado_en: string;
  actualizado_en: string;
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
      const { data, error } = await supabase.from("bbva_folios_cuadrilla").select("*").order("actualizado_en", { ascending: false });
      if (error) throw error;
      return data as FolioCuadrilla[];
    },
  });
}

/** Supervisores de cuadrilla (vista con definer: profiles solo deja leer el propio). */
export function useSupervisoresBbva() {
  return useQuery({
    queryKey: ["bbva-supervisores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_supervisores_bbva").select("id, nombre").order("nombre");
      if (error) throw error;
      return data as { id: string; nombre: string }[];
    },
  });
}

interface PasoControl {
  folio: string | null;
  sucursal: string | null;
  supervisor: string | null;
  etapa_seguimiento: string | null;
  estatus_operativo: string | null;
  alerta_siguiente_paso: string | null;
  estado_pago: string | null;
}

/** Folios del control BBVA (vista sin montos): para mostrar la etapa del
 * control junto a cada folio y para proponer folios abiertos al asignar. */
function usePasoControl() {
  return useQuery({
    queryKey: ["bbva-folio-paso"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_bbva_folio_paso")
        .select("folio, sucursal, supervisor, etapa_seguimiento, estatus_operativo, alerta_siguiente_paso, estado_pago")
        .limit(5000);
      if (error) throw error;
      return (data as PasoControl[]).filter((r) => r.folio);
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
  const asigna = !!perfil?.bbva_mantenimiento || perfil?.rol === "admin" || perfil?.rol === "corporativo";
  const queryClient = useQueryClient();
  const { data: folios, isLoading } = useFoliosCuadrilla();
  const { data: supervisores } = useSupervisoresBbva();
  const { data: control } = usePasoControl();
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<EstatusCuadrilla | "todos">("todos");
  const [filtroSupervisor, setFiltroSupervisor] = useState("todos");
  const [sucursal, setSucursal] = useState("");
  const [descripcion, setDescripcion] = useState("");

  const nombreSupervisor = useMemo(() => new Map((supervisores ?? []).map((s) => [s.id, s.nombre])), [supervisores]);
  const controlPorFolio = useMemo(() => new Map((control ?? []).map((c) => [c.folio!.trim(), c])), [control]);
  const asignados = useMemo(() => new Set((folios ?? []).map((f) => f.folio.trim())), [folios]);
  // Folios abiertos del control que todavía nadie tiene: son los que
  // Christian/Luis reparten. Cerrados (pagados o cancelados) no se ofrecen.
  const sinAsignar = useMemo(
    () =>
      (control ?? []).filter(
        (c) =>
          !asignados.has(c.folio!.trim()) &&
          (c.estatus_operativo ?? "").toUpperCase() !== "CANCELADO" &&
          !(c.estado_pago ?? "").toLowerCase().startsWith("pago realizado"),
      ),
    [control, asignados],
  );

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["bbva-folios-cuadrilla"] });
    queryClient.invalidateQueries({ queryKey: ["bbva-folios-cuadrilla-semaforo"] });
  };

  const asignar = useMutation({
    mutationFn: async (payload: { folio: string; supervisor_id: string; sucursal: string | null; descripcion: string | null }) => {
      const { error } = await supabase.from("bbva_folios_cuadrilla").insert({ ...payload, asignado_por: perfil?.id });
      if (error) throw error;
    },
    onSuccess: invalidar,
    onError: (err) => setError(/duplicate|unique/i.test((err as Error).message) ? "Ese folio ya está asignado." : (err as Error).message),
  });

  const actualizar = useMutation({
    mutationFn: async (p: { id: string; cambios: Partial<Pick<FolioCuadrilla, "estatus" | "supervisor_id">> }) => {
      const { data, error } = await supabase.from("bbva_folios_cuadrilla").update(p.cambios).eq("id", p.id).select("id");
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

  function onFolioEscrito(valor: string) {
    const c = controlPorFolio.get(valor.trim());
    if (c) {
      setSucursal(c.sucursal ?? "");
      setDescripcion("");
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formulario = e.currentTarget;
    const fd = new FormData(formulario);
    const folio = String(fd.get("folio") ?? "").trim();
    const supervisor_id = String(fd.get("supervisor_id") ?? "");
    if (!folio || !supervisor_id) return;
    asignar.mutate(
      { folio, supervisor_id, sucursal: sucursal.trim() || null, descripcion: descripcion.trim() || null },
      {
        onSuccess: () => {
          formulario.reset();
          setSucursal("");
          setDescripcion("");
        },
      },
    );
  }

  const conteo = ESTATUS_CUADRILLA.map((e) => ({ ...e, n: (folios ?? []).filter((f) => f.estatus === e.valor).length }));
  const lista = (folios ?? []).filter((f) => (filtro === "todos" || f.estatus === filtro) && (filtroSupervisor === "todos" || f.supervisor_id === filtroSupervisor));

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Folios BBVA · semáforo de atención</h1>
        <p className="text-sm text-slate-500">
          {esSupervisor
            ? "Estos son tus folios. Muévelos conforme avance tu cuadrilla."
            : asigna
              ? "Asigna cada folio a un supervisor; ellos lo mueven de pendiente a en ejecución y atendido."
              : "Semáforo capturado por los supervisores de cuadrilla."}
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

      {asigna && (
        <form onSubmit={onSubmit} className="space-y-2 rounded border border-slate-200 bg-white p-3">
          <p className="text-sm font-medium text-slate-800">Asignar folio</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
            <div>
              <input
                name="folio"
                required
                list="folios-sin-asignar"
                placeholder="Número de folio"
                inputMode="numeric"
                onChange={(e) => onFolioEscrito(e.target.value)}
                className="w-full rounded border border-slate-300 px-2 py-2 text-sm"
              />
              <datalist id="folios-sin-asignar">
                {sinAsignar.slice(0, 300).map((c) => (
                  <option key={c.folio!} value={c.folio!}>
                    {[c.sucursal, c.etapa_seguimiento].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </datalist>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {sinAsignar.length > 0 ? `${sinAsignar.length} folios abiertos del control sin asignar; escribe para buscar.` : "Puedes escribir cualquier folio."}
              </p>
            </div>
            <select name="supervisor_id" required defaultValue="" className="rounded border border-slate-300 px-2 py-2 text-sm">
              <option value="" disabled>
                Supervisor de cuadrilla…
              </option>
              {(supervisores ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
            <input value={sucursal} onChange={(e) => setSucursal(e.target.value)} placeholder="Sucursal (opcional)" className="rounded border border-slate-300 px-2 py-2 text-sm" />
            <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Qué se atiende (opcional)" className="rounded border border-slate-300 px-2 py-2 text-sm" />
          </div>
          <button disabled={asignar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {asignar.isPending ? "Asignando…" : "Asignar"}
          </button>
        </form>
      )}

      {!esSupervisor && (supervisores?.length ?? 0) > 0 && (
        <select value={filtroSupervisor} onChange={(e) => setFiltroSupervisor(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="todos">Todos los supervisores</option>
          {(supervisores ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
      )}

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      <LeyendaPasos compacta />

      <ul className="space-y-2">
        {lista.map((f) => {
          const e = infoEstatus(f.estatus);
          const mio = f.supervisor_id === perfil?.id;
          const puedeMover = asigna || (esSupervisor && mio);
          const ctrl = controlPorFolio.get(f.folio.trim());
          return (
            <li key={f.id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-3 w-3 rounded-full ${e.punto}`} aria-hidden />
                  <div>
                    <p className="font-semibold text-slate-900">Folio {f.folio}</p>
                    <p className="text-xs text-slate-500">
                      {[f.sucursal, f.descripcion].filter(Boolean).join(" · ")}
                      {!esSupervisor ? `${f.sucursal || f.descripcion ? " · " : ""}${nombreSupervisor.get(f.supervisor_id) ?? "supervisor"}` : ""}
                    </p>
                    {ctrl && (
                      <p className="text-xs text-slate-500">
                        Control BBVA: {ctrl.etapa_seguimiento ?? ctrl.estatus_operativo ?? "—"}
                        {ctrl.estado_pago ? ` · ${ctrl.estado_pago}` : ""}
                      </p>
                    )}
                  </div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${e.chip}`}>
                  {e.etiqueta}
                  {f.estatus === "atendido" && f.atendido_en ? ` · ${fechaCorta(f.atendido_en)}` : ""}
                  {f.estatus === "en_ejecucion" && f.en_ejecucion_en ? ` · desde ${fechaCorta(f.en_ejecucion_en)}` : ""}
                </span>
              </div>
              {(puedeMover || asigna) && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {puedeMover &&
                    ESTATUS_CUADRILLA.filter((o) => o.valor !== f.estatus).map((o) => (
                      <button
                        key={o.valor}
                        type="button"
                        disabled={actualizar.isPending}
                        onClick={() => actualizar.mutate({ id: f.id, cambios: { estatus: o.valor } })}
                        className={`rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${o.boton}`}
                      >
                        {o.etiqueta}
                      </button>
                    ))}
                  {asigna && (
                    <span className="ml-auto flex items-center gap-2">
                      <select
                        value={f.supervisor_id}
                        onChange={(e) => actualizar.mutate({ id: f.id, cambios: { supervisor_id: e.target.value } })}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                        title="Reasignar"
                      >
                        {(supervisores ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.nombre}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`¿Quitar el folio ${f.folio} del semáforo?`)) quitar.mutate(f.id);
                        }}
                        className="text-xs text-slate-500 hover:underline"
                      >
                        Quitar
                      </button>
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {!isLoading && lista.length === 0 && (
          <li className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
            {folios?.length === 0
              ? esSupervisor
                ? "Todavía no te han asignado folios."
                : "Todavía no hay folios asignados."
              : "Sin folios con ese filtro."}
          </li>
        )}
      </ul>
    </div>
  );
}
