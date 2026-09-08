import { useState, type DragEvent, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { DirectorioPerfil, Tablero, TableroColumna, Tarjeta } from "../../types/database";
import { TarjetaPanel } from "./TarjetaPanel";

function useTablero(tableroId: string) {
  return useQuery({
    queryKey: ["tablero", tableroId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tableros").select("*, empresas(nombre)").eq("id", tableroId).single();
      if (error) throw error;
      return data as Tablero & { empresas: { nombre: string } | null };
    },
  });
}

function useColumnas(tableroId: string) {
  return useQuery({
    queryKey: ["tablero-columnas", tableroId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tablero_columnas").select("*").eq("tablero_id", tableroId).order("orden");
      if (error) throw error;
      return data as TableroColumna[];
    },
  });
}

function useTarjetas(tableroId: string) {
  return useQuery({
    queryKey: ["tarjetas", tableroId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tarjetas")
        .select("*")
        .eq("tablero_id", tableroId)
        .eq("archivada", false)
        .order("orden");
      if (error) throw error;
      return data as Tarjeta[];
    },
  });
}

// v_directorio: nombre/rol de cualquier usuario con acceso, visible a todos
// los no-pendiente -- ver comentario en types/database.ts.
function useDirectorio() {
  return useQuery({
    queryKey: ["directorio"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("v_directorio").select("*").eq("activo", true).order("nombre");
      if (error) throw error;
      return data as DirectorioPerfil[];
    },
  });
}

const campoTexto = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

function TarjetaCard({ tarjeta, nombreAsignado, onClick, onDragStart }: {
  tarjeta: Tarjeta;
  nombreAsignado: string | null;
  onClick: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const vencida = tarjeta.fecha_limite && tarjeta.fecha_limite < new Date().toISOString().slice(0, 10);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="mb-2 cursor-pointer rounded border border-slate-200 bg-white p-2.5 text-sm shadow-sm hover:border-slate-400"
    >
      <p className="font-medium text-slate-900">{tarjeta.titulo}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {nombreAsignado && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{nombreAsignado}</span>
        )}
        {tarjeta.fecha_limite && (
          <span className={`rounded-full px-2 py-0.5 text-xs ${vencida ? "bg-red-100 text-red-700" : "bg-blue-50 text-blue-700"}`}>
            {new Date(tarjeta.fecha_limite + "T00:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}
          </span>
        )}
        {tarjeta.orden_venta_id && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">OV</span>}
      </div>
    </div>
  );
}

export function TableroDetalle() {
  const { tableroId } = useParams<{ tableroId: string }>();
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const { data: tablero } = useTablero(tableroId!);
  const { data: columnas } = useColumnas(tableroId!);
  const { data: tarjetas } = useTarjetas(tableroId!);
  const { data: directorio } = useDirectorio();
  const [tarjetaSeleccionada, setTarjetaSeleccionada] = useState<string | null>(null);
  const [nuevaColumna, setNuevaColumna] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeAdministrar = perfil?.rol === "admin" || perfil?.rol === "corporativo";
  const nombrePorId = new Map((directorio ?? []).map((p) => [p.id, p.nombre]));

  function invalidarTarjetas() {
    queryClient.invalidateQueries({ queryKey: ["tarjetas", tableroId] });
  }

  const crearTarjeta = useMutation({
    mutationFn: async ({ columnaId, titulo }: { columnaId: string; titulo: string }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Sesión expirada, vuelve a iniciar sesión.");
      const enColumna = (tarjetas ?? []).filter((t) => t.columna_id === columnaId).length;
      const { data: tarjeta, error: errTarjeta } = await supabase
        .from("tarjetas")
        .insert({ tablero_id: tableroId, columna_id: columnaId, titulo, creado_por: userId, orden: enColumna })
        .select("id")
        .single();
      if (errTarjeta) throw errTarjeta;
      await supabase.from("tarjeta_actividad").insert({ tarjeta_id: tarjeta.id, tipo: "creada", actor_id: userId });
    },
    onSuccess: invalidarTarjetas,
    onError: (err) => setError((err as Error).message),
  });

  const moverTarjeta = useMutation({
    mutationFn: async ({ tarjeta, columnaDestinoId }: { tarjeta: Tarjeta; columnaDestinoId: string }) => {
      if (tarjeta.columna_id === columnaDestinoId) return;
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      const enDestino = (tarjetas ?? []).filter((t) => t.columna_id === columnaDestinoId).length;
      const { error: errUpdate } = await supabase
        .from("tarjetas")
        .update({ columna_id: columnaDestinoId, orden: enDestino })
        .eq("id", tarjeta.id);
      if (errUpdate) throw errUpdate;
      const origen = columnas?.find((c) => c.id === tarjeta.columna_id)?.nombre;
      const destino = columnas?.find((c) => c.id === columnaDestinoId)?.nombre;
      await supabase
        .from("tarjeta_actividad")
        .insert({ tarjeta_id: tarjeta.id, tipo: "movida", detalle: { de: origen, a: destino }, actor_id: userId });
    },
    onSuccess: invalidarTarjetas,
    onError: (err) => setError((err as Error).message),
  });

  const crearColumna = useMutation({
    mutationFn: async (nombre: string) => {
      const orden = (columnas?.length ?? 0);
      const { error: errInsert } = await supabase.from("tablero_columnas").insert({ tablero_id: tableroId, nombre, orden });
      if (errInsert) throw errInsert;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tablero-columnas", tableroId] });
      setNuevaColumna(false);
    },
    onError: (err) => setError((err as Error).message),
  });

  function onDrop(e: DragEvent<HTMLDivElement>, columnaId: string) {
    e.preventDefault();
    const tarjetaId = e.dataTransfer.getData("text/tarjeta-id");
    const tarjeta = tarjetas?.find((t) => t.id === tarjetaId);
    if (tarjeta) moverTarjeta.mutate({ tarjeta, columnaDestinoId: columnaId });
  }

  function onSubmitNuevaColumna(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const nombre = String(fd.get("nombre") ?? "").trim();
    if (nombre) crearColumna.mutate(nombre);
  }

  if (!tablero || !columnas) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div>
      <Link to="/tareas" className="text-xs text-slate-500 hover:underline">
        ← Todos los tableros
      </Link>
      <div className="mt-1 mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{tablero.nombre}</h1>
          <p className="text-xs text-slate-500">{tablero.empresas?.nombre ?? "Corporativo · todas las empresas"}</p>
        </div>
      </div>

      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columnas.map((columna) => {
          const tarjetasColumna = (tarjetas ?? []).filter((t) => t.columna_id === columna.id);
          return (
            <div
              key={columna.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, columna.id)}
              className="w-72 shrink-0 rounded bg-slate-100 p-2"
            >
              <h3 className="mb-2 px-1 text-sm font-semibold text-slate-700">
                {columna.nombre} <span className="font-normal text-slate-400">({tarjetasColumna.length})</span>
              </h3>
              {tarjetasColumna.map((tarjeta) => (
                <TarjetaCard
                  key={tarjeta.id}
                  tarjeta={tarjeta}
                  nombreAsignado={tarjeta.asignado_a ? (nombrePorId.get(tarjeta.asignado_a) ?? null) : null}
                  onClick={() => setTarjetaSeleccionada(tarjeta.id)}
                  onDragStart={(e) => e.dataTransfer.setData("text/tarjeta-id", tarjeta.id)}
                />
              ))}
              <FormNuevaTarjeta onCrear={(titulo) => crearTarjeta.mutate({ columnaId: columna.id, titulo })} />
            </div>
          );
        })}

        {puedeAdministrar && (
          <div className="w-72 shrink-0">
            {nuevaColumna ? (
              <form onSubmit={onSubmitNuevaColumna} className="rounded bg-slate-100 p-2">
                <input name="nombre" autoFocus placeholder="Nombre de la columna" className={campoTexto} />
                <div className="mt-2 flex gap-2">
                  <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                    Agregar
                  </button>
                  <button type="button" onClick={() => setNuevaColumna(false)} className="text-xs text-slate-500">
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <button onClick={() => setNuevaColumna(true)} className="w-full rounded border border-dashed border-slate-300 py-2 text-sm text-slate-500 hover:bg-slate-50">
                + Nueva columna
              </button>
            )}
          </div>
        )}
      </div>

      {tarjetaSeleccionada && (
        <TarjetaPanel
          tarjetaId={tarjetaSeleccionada}
          tableroId={tableroId!}
          columnas={columnas}
          directorio={directorio ?? []}
          onClose={() => setTarjetaSeleccionada(null)}
        />
      )}
    </div>
  );
}

function FormNuevaTarjeta({ onCrear }: { onCrear: (titulo: string) => void }) {
  const [activo, setActivo] = useState(false);
  const [titulo, setTitulo] = useState("");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!titulo.trim()) return;
    onCrear(titulo.trim());
    setTitulo("");
    setActivo(false);
  }

  if (!activo) {
    return (
      <button onClick={() => setActivo(true)} className="w-full rounded px-1 py-1 text-left text-xs text-slate-500 hover:bg-slate-200">
        + Agregar tarjeta
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-1">
      <textarea
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit(e as unknown as FormEvent<HTMLFormElement>);
          }
        }}
        rows={2}
        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        placeholder="Título de la tarjeta…"
      />
      <div className="mt-1 flex gap-2">
        <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white">
          Agregar
        </button>
        <button type="button" onClick={() => setActivo(false)} className="text-xs text-slate-500">
          Cancelar
        </button>
      </div>
    </form>
  );
}
