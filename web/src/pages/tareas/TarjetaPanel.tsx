import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { DirectorioPerfil, TableroColumna, Tarjeta, TarjetaActividad, TarjetaArchivo, TarjetaComentario } from "../../types/database";

const campoTexto = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiquetaCampo = "mb-1 block text-xs font-medium text-slate-700";

function useTarjeta(tarjetaId: string) {
  return useQuery({
    queryKey: ["tarjeta", tarjetaId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tarjetas").select("*").eq("id", tarjetaId).single();
      if (error) throw error;
      return data as Tarjeta;
    },
  });
}

function useComentarios(tarjetaId: string) {
  return useQuery({
    queryKey: ["tarjeta-comentarios", tarjetaId],
    // El "chat interno" pedido: no hay Realtime en el proyecto todavía, así
    // que se refresca por polling mientras el panel está abierto.
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase.from("tarjeta_comentarios").select("*").eq("tarjeta_id", tarjetaId).order("created_at");
      if (error) throw error;
      return data as TarjetaComentario[];
    },
  });
}

function useArchivos(tarjetaId: string) {
  return useQuery({
    queryKey: ["tarjeta-archivos", tarjetaId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tarjeta_archivos").select("*").eq("tarjeta_id", tarjetaId).order("created_at");
      if (error) throw error;
      return data as TarjetaArchivo[];
    },
  });
}

function useActividad(tarjetaId: string) {
  return useQuery({
    queryKey: ["tarjeta-actividad", tarjetaId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tarjeta_actividad").select("*").eq("tarjeta_id", tarjetaId).order("created_at", { ascending: false });
      if (error) throw error;
      return data as TarjetaActividad[];
    },
  });
}

function useOrdenVenta(ordenVentaId: string | null) {
  return useQuery({
    queryKey: ["orden-venta", ordenVentaId],
    enabled: !!ordenVentaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("ordenes_venta").select("id, id_ov, cliente").eq("id", ordenVentaId!).single();
      if (error) throw error;
      return data as { id: string; id_ov: string; cliente: string | null };
    },
  });
}

async function usuarioActualId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error("Sesión expirada, vuelve a iniciar sesión.");
  return userId;
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const TEXTO_ACTIVIDAD: Record<string, (detalle: any) => string> = {
  creada: () => "creó la tarjeta",
  movida: (d) => `movió la tarjeta de "${d?.de ?? "?"}" a "${d?.a ?? "?"}"`,
  asignada: (d) => (d?.nombre ? `la asignó a ${d.nombre}` : "quitó la asignación"),
  archivada: () => "archivó la tarjeta",
  reabierta: () => "reabrió la tarjeta",
  editada: (d) => (d?.accion === "archivo_agregado" ? `adjuntó "${d.nombre_original}"` : "editó la tarjeta"),
};

export function TarjetaPanel({
  tarjetaId,
  tableroId,
  columnas,
  directorio,
  onClose,
}: {
  tarjetaId: string;
  tableroId: string;
  columnas: TableroColumna[];
  directorio: DirectorioPerfil[];
  onClose: () => void;
}) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const { data: tarjeta } = useTarjeta(tarjetaId);
  const { data: comentarios } = useComentarios(tarjetaId);
  const { data: archivos } = useArchivos(tarjetaId);
  const { data: actividad } = useActividad(tarjetaId);
  const { data: ordenVenta } = useOrdenVenta(tarjeta?.orden_venta_id ?? null);

  const [comentarioTexto, setComentarioTexto] = useState("");
  const [ovTexto, setOvTexto] = useState("");
  const [subiendoArchivo, setSubiendoArchivo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeAdministrar = perfil?.rol === "admin" || perfil?.rol === "corporativo";
  const nombrePorId = new Map(directorio.map((p) => [p.id, p.nombre]));

  function invalidarTodo() {
    queryClient.invalidateQueries({ queryKey: ["tarjeta", tarjetaId] });
    queryClient.invalidateQueries({ queryKey: ["tarjetas", tableroId] });
    queryClient.invalidateQueries({ queryKey: ["tarjeta-actividad", tarjetaId] });
  }

  const actualizar = useMutation({
    mutationFn: async (cambios: Partial<Tarjeta>) => {
      const { error: errUpdate } = await supabase.from("tarjetas").update(cambios).eq("id", tarjetaId);
      if (errUpdate) throw errUpdate;
    },
    onSuccess: invalidarTodo,
    onError: (err) => setError((err as Error).message),
  });

  const asignar = useMutation({
    mutationFn: async (asignadoA: string) => {
      const userId = await usuarioActualId();
      const { error: errUpdate } = await supabase.from("tarjetas").update({ asignado_a: asignadoA || null }).eq("id", tarjetaId);
      if (errUpdate) throw errUpdate;
      await supabase.from("tarjeta_actividad").insert({
        tarjeta_id: tarjetaId,
        tipo: "asignada",
        detalle: asignadoA ? { nombre: nombrePorId.get(asignadoA) } : null,
        actor_id: userId,
      });
    },
    onSuccess: invalidarTodo,
    onError: (err) => setError((err as Error).message),
  });

  const archivarToggle = useMutation({
    mutationFn: async (archivar: boolean) => {
      const userId = await usuarioActualId();
      const { error: errUpdate } = await supabase.from("tarjetas").update({ archivada: archivar }).eq("id", tarjetaId);
      if (errUpdate) throw errUpdate;
      await supabase.from("tarjeta_actividad").insert({ tarjeta_id: tarjetaId, tipo: archivar ? "archivada" : "reabierta", actor_id: userId });
    },
    onSuccess: () => {
      invalidarTodo();
      if (archivarToggle.variables) onClose();
    },
    onError: (err) => setError((err as Error).message),
  });

  const eliminar = useMutation({
    mutationFn: async () => {
      const { error: errDelete } = await supabase.from("tarjetas").delete().eq("id", tarjetaId);
      if (errDelete) throw errDelete;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tarjetas", tableroId] });
      onClose();
    },
    onError: (err) => setError((err as Error).message),
  });

  const enlazarOv = useMutation({
    mutationFn: async (idOv: string) => {
      const { data, error: errBuscar } = await supabase.from("ordenes_venta").select("id").eq("id_ov", idOv).maybeSingle();
      if (errBuscar) throw errBuscar;
      if (!data) throw new Error(`No se encontró la orden de venta "${idOv}"`);
      const { error: errUpdate } = await supabase.from("tarjetas").update({ orden_venta_id: data.id }).eq("id", tarjetaId);
      if (errUpdate) throw errUpdate;
    },
    onSuccess: () => {
      invalidarTodo();
      setOvTexto("");
    },
    onError: (err) => setError((err as Error).message),
  });

  const comentar = useMutation({
    mutationFn: async (texto: string) => {
      const userId = await usuarioActualId();
      const { error: errInsert } = await supabase.from("tarjeta_comentarios").insert({ tarjeta_id: tarjetaId, autor_id: userId, texto });
      if (errInsert) throw errInsert;
    },
    onSuccess: () => {
      setComentarioTexto("");
      queryClient.invalidateQueries({ queryKey: ["tarjeta-comentarios", tarjetaId] });
    },
    onError: (err) => setError((err as Error).message),
  });

  async function onSubirArchivo(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const input = formEl.elements.namedItem("file") as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;
    setError(null);
    setSubiendoArchivo(true);
    try {
      const fd = new FormData();
      fd.append("tarjetaId", tarjetaId);
      fd.append("file", archivo);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(urlFuncion("tareas-archivos"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      formEl.reset();
      queryClient.invalidateQueries({ queryKey: ["tarjeta-archivos", tarjetaId] });
      queryClient.invalidateQueries({ queryKey: ["tarjeta-actividad", tarjetaId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendoArchivo(false);
    }
  }

  async function onDescargarArchivo(archivoId: string) {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(`${urlFuncion("tareas-archivos")}?archivoId=${archivoId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      window.open(json.url, "_blank");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onBorrarArchivo(archivoId: string) {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(urlFuncion("tareas-archivos"), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ archivoId }),
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      queryClient.invalidateQueries({ queryKey: ["tarjeta-archivos", tarjetaId] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!tarjeta) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <input
            key={tarjeta.titulo}
            defaultValue={tarjeta.titulo}
            onBlur={(e) => e.target.value.trim() && e.target.value !== tarjeta.titulo && actualizar.mutate({ titulo: e.target.value.trim() })}
            className="mr-3 w-full text-lg font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-300 rounded px-1"
          />
          <button onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <label className={etiquetaCampo}>Columna</label>
            <select
              value={tarjeta.columna_id}
              onChange={(e) => actualizar.mutate({ columna_id: e.target.value })}
              className={campoTexto}
            >
              {columnas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiquetaCampo}>Asignado a</label>
            <select value={tarjeta.asignado_a ?? ""} onChange={(e) => asignar.mutate(e.target.value)} className={campoTexto}>
              <option value="">Sin asignar</option>
              {directorio.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiquetaCampo}>Fecha límite</label>
            <input
              type="date"
              key={tarjeta.fecha_limite ?? "sin-fecha"}
              defaultValue={tarjeta.fecha_limite ?? ""}
              onBlur={(e) => actualizar.mutate({ fecha_limite: e.target.value || null })}
              className={campoTexto}
            />
          </div>
          <div>
            <label className={etiquetaCampo}>Orden de venta</label>
            {ordenVenta ? (
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                  {ordenVenta.id_ov} {ordenVenta.cliente ? `· ${ordenVenta.cliente}` : ""}
                </span>
                <button onClick={() => actualizar.mutate({ orden_venta_id: null })} className="text-xs text-slate-400 hover:text-red-600">
                  Quitar
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={ovTexto}
                  onChange={(e) => setOvTexto(e.target.value)}
                  placeholder="ID de OV…"
                  className={campoTexto}
                />
                <button
                  onClick={() => ovTexto.trim() && enlazarOv.mutate(ovTexto.trim())}
                  disabled={enlazarOv.isPending}
                  className="shrink-0 rounded border border-slate-300 px-2 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Vincular
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mb-4">
          <label className={etiquetaCampo}>Descripción</label>
          <textarea
            key={tarjeta.descripcion ?? ""}
            defaultValue={tarjeta.descripcion ?? ""}
            onBlur={(e) => e.target.value !== (tarjeta.descripcion ?? "") && actualizar.mutate({ descripcion: e.target.value || null })}
            rows={3}
            className={campoTexto}
          />
        </div>

        <div className="mb-4 flex gap-2">
          {tarjeta.archivada ? (
            <button onClick={() => archivarToggle.mutate(false)} className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
              Reabrir
            </button>
          ) : (
            <button onClick={() => archivarToggle.mutate(true)} className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
              Archivar
            </button>
          )}
          {puedeAdministrar && (
            <button
              onClick={() => confirm("¿Eliminar esta tarjeta y todo su historial?") && eliminar.mutate()}
              className="rounded border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              Eliminar
            </button>
          )}
        </div>

        <div className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Archivos</h3>
          <ul className="mb-2 space-y-1">
            {archivos?.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded border border-slate-200 px-2 py-1 text-sm">
                <button onClick={() => onDescargarArchivo(a.id)} className="truncate text-left text-slate-700 hover:underline">
                  {a.nombre_original}
                </button>
                <button onClick={() => onBorrarArchivo(a.id)} className="ml-2 shrink-0 text-xs text-slate-400 hover:text-red-600">
                  Quitar
                </button>
              </li>
            ))}
            {archivos?.length === 0 && <li className="text-xs text-slate-400">Sin archivos adjuntos.</li>}
          </ul>
          <form onSubmit={onSubirArchivo} className="flex gap-2">
            <input type="file" name="file" className="flex-1 text-xs" />
            <button type="submit" disabled={subiendoArchivo} className="shrink-0 rounded border border-slate-300 px-2 text-xs text-slate-600 hover:bg-slate-50">
              {subiendoArchivo ? "Subiendo…" : "Subir"}
            </button>
          </form>
        </div>

        <div className="mb-5">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Comentarios</h3>
          <div className="mb-2 max-h-64 space-y-2 overflow-y-auto">
            {comentarios?.map((c) => (
              <div key={c.id} className="rounded bg-slate-50 px-2.5 py-1.5 text-sm">
                <p className="text-xs font-medium text-slate-600">
                  {nombrePorId.get(c.autor_id) ?? "…"} <span className="font-normal text-slate-400">· {fechaHora(c.created_at)}</span>
                </p>
                <p className="text-slate-800">{c.texto}</p>
              </div>
            ))}
            {comentarios?.length === 0 && <p className="text-xs text-slate-400">Sin comentarios todavía.</p>}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (comentarioTexto.trim()) comentar.mutate(comentarioTexto.trim());
            }}
            className="flex gap-2"
          >
            <input value={comentarioTexto} onChange={(e) => setComentarioTexto(e.target.value)} placeholder="Escribe un comentario…" className={campoTexto} />
            <button type="submit" disabled={comentar.isPending} className="shrink-0 rounded bg-slate-900 px-3 text-xs font-medium text-white">
              Enviar
            </button>
          </form>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Actividad</h3>
          <ul className="space-y-1">
            {actividad?.map((a) => (
              <li key={a.id} className="text-xs text-slate-500">
                <span className="font-medium text-slate-700">{nombrePorId.get(a.actor_id) ?? "…"}</span>{" "}
                {(TEXTO_ACTIVIDAD[a.tipo] ?? (() => a.tipo))(a.detalle)} · {fechaHora(a.created_at)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
