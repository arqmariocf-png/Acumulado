import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../lib/supabase";
import { errorDeFuncion } from "../lib/funciones";
import { useAuth } from "../lib/auth";
import { eliminarPendiente, esErrorDeRed, guardarPendiente, listarPendientes, nuevoId, type MarcaPendiente } from "../lib/colaOffline";

export type TipoMarca = "entrada" | "salida" | "comida_inicio" | "comida_fin";

export const ETIQUETA_MARCA: Record<TipoMarca, string> = { entrada: "Entrada", salida: "Salida", comida_inicio: "Salió a comer", comida_fin: "Regresó de comer" };
export const SIMBOLO_MARCA: Record<TipoMarca, string> = { entrada: "→", salida: "←", comida_inicio: "🍽", comida_fin: "↩" };

interface RegistroChecador {
  id: string;
  profile_id: string;
  tipo: TipoMarca;
  created_at: string;
  lat: number | null;
  lng: number | null;
  precision_m: number | null;
  foto_path: string | null;
  sincronizada_offline?: boolean;
  manual?: boolean;
  ajuste_nota?: string | null;
  ubicacion_id?: string | null;
}

/** Copia local de las últimas marcas, para que la pantalla funcione sin
 * señal (estado dentro/fuera, historial). Se refresca con cada lectura. */
function claveCacheRegistros(profileId: string) {
  return `checador-registros-${profileId}`;
}

/** Ubicación del teléfono. Es obligatoria para marcar (pedido 21-sep-2026):
 * sin GPS o sin permiso no se registra la marca. */
function obtenerUbicacion(): Promise<{ lat: number; lng: number; precision: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Este dispositivo no reporta ubicación; no se puede marcar."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Necesitas permitir la ubicación para marcar. Actívala en los permisos del navegador e inténtalo de nuevo."
              : "No se pudo obtener tu ubicación. Activa el GPS e inténtalo de nuevo.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

/** Reduce la foto a máximo 1024 px de lado y JPEG, para que suba rápido
 * desde datos móviles (una selfie de cámara suele pesar 3-5 MB). */
async function comprimirFoto(archivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(archivo).catch(() => null);
  if (!bitmap) return archivo;
  const escala = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(bitmap.width * escala);
  lienzo.height = Math.round(bitmap.height * escala);
  const ctx = lienzo.getContext("2d");
  if (!ctx) return archivo;
  ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
  return new Promise((resolve) => lienzo.toBlob((b) => resolve(b ?? archivo), "image/jpeg", 0.82));
}

async function abrirFoto(registroId: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const respuesta = await fetch(`${urlFuncion("checador-marcar")}?registroId=${registroId}`, {
    headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
  });
  const json = await respuesta.json();
  if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
  window.open(json.url, "_blank");
}

function enlaceMapa(r: RegistroChecador): string | null {
  return r.lat != null && r.lng != null ? `https://maps.google.com/?q=${r.lat},${r.lng}` : null;
}

const DIAS_HISTORIAL = 14;

function useRegistros(profileId: string) {
  return useQuery({
    queryKey: ["checador-registros", profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - DIAS_HISTORIAL);
      desde.setHours(0, 0, 0, 0);
      try {
        const { data, error } = await supabase
          .from("checador_registros")
          .select("*")
          .eq("profile_id", profileId)
          .is("anulada_en", null)
          .gte("created_at", desde.toISOString())
          .order("created_at");
        if (error) throw error;
        try {
          localStorage.setItem(claveCacheRegistros(profileId), JSON.stringify(data));
        } catch {
          /* sin almacenamiento local */
        }
        return data as RegistroChecador[];
      } catch (err) {
        // Sin señal: se usa la última copia guardada en este teléfono.
        if (!navigator.onLine || esErrorDeRed(err)) {
          try {
            const crudo = localStorage.getItem(claveCacheRegistros(profileId));
            if (crudo) return JSON.parse(crudo) as RegistroChecador[];
          } catch {
            /* sin caché */
          }
          return [];
        }
        throw err;
      }
    },
    retry: false,
  });
}

/** Marca guardada en el teléfono, pendiente de enviar (sin señal). */
function usePendientes(profileId: string) {
  const [pendientes, setPendientes] = useState<MarcaPendiente[]>([]);
  const recargar = useCallback(async () => {
    if (!profileId) return;
    try {
      setPendientes(await listarPendientes(profileId));
    } catch {
      setPendientes([]);
    }
  }, [profileId]);
  useEffect(() => {
    recargar();
  }, [recargar]);
  return { pendientes, recargar };
}

function useEnLinea() {
  const [enLinea, setEnLinea] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setEnLinea(true);
    const off = () => setEnLinea(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return enLinea;
}

async function enviarMarca(fd: FormData): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const respuesta = await fetch(urlFuncion("checador-marcar"), {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionData.session?.access_token}` },
    body: fd,
  });
  const json = await respuesta.json();
  if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
}

function formDataDePendiente(m: MarcaPendiente): FormData {
  const fd = new FormData();
  fd.append("tipo", m.tipo);
  if (m.foto) fd.append("foto", m.foto, "marca.jpg");
  fd.append("lat", String(m.lat));
  fd.append("lng", String(m.lng));
  fd.append("precision", String(Math.round(m.precision)));
  fd.append("dispositivo", m.dispositivo);
  fd.append("marcadaEn", m.marcadaEn);
  return fd;
}

/** Empareja entrada->salida en orden y suma la duración en horas. Un
 * "entrada" sin "salida" que le siga (turno abierto, ej. hoy antes de
 * salir) simplemente no cuenta todavía -- no se inventa una hora de salida. */
/** Horas efectivas: entrada→salida menos las pausas de comida
 * (comida_inicio→comida_fin). Un turno o una comida abiertos no cuentan
 * todavía; no se inventan horas. */
export function horasTrabajadas(registros: { tipo: TipoMarca; created_at: string }[]): number {
  let totalMs = 0;
  let entradaAbierta: string | null = null;
  let comidaAbierta: string | null = null;
  let comidaMs = 0;
  for (const r of registros) {
    if (r.tipo === "entrada") {
      entradaAbierta = r.created_at;
      comidaMs = 0;
      comidaAbierta = null;
    } else if (r.tipo === "comida_inicio" && entradaAbierta) {
      comidaAbierta = r.created_at;
    } else if (r.tipo === "comida_fin" && comidaAbierta) {
      comidaMs += new Date(r.created_at).getTime() - new Date(comidaAbierta).getTime();
      comidaAbierta = null;
    } else if (r.tipo === "salida" && entradaAbierta) {
      totalMs += new Date(r.created_at).getTime() - new Date(entradaAbierta).getTime() - comidaMs;
      entradaAbierta = null;
      comidaAbierta = null;
      comidaMs = 0;
    }
  }
  return totalMs / 3_600_000;
}

function agruparPorDia(registros: RegistroChecador[]): { fecha: string; registros: RegistroChecador[] }[] {
  const porDia = new Map<string, RegistroChecador[]>();
  for (const r of registros) {
    const fecha = r.created_at.slice(0, 10);
    const lista = porDia.get(fecha) ?? [];
    lista.push(r);
    porDia.set(fecha, lista);
  }
  return [...porDia.entries()].map(([fecha, registros]) => ({ fecha, registros })).sort((a, b) => b.fecha.localeCompare(a.fecha));
}

function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

function fechaCorta(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });
}

export function Checador() {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const profileId = perfil?.id ?? "";
  const { data: registros, isLoading } = useRegistros(profileId);
  const { pendientes, recargar: recargarPendientes } = usePendientes(profileId);
  const enLinea = useEnLinea();
  const [aviso, setAviso] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);

  // La última marca puede ser una pendiente todavía en el teléfono.
  const ultimoRegistro = useMemo(() => {
    const ultimaGuardada = registros?.length ? registros[registros.length - 1] : null;
    const ultimaPendiente = pendientes.length ? pendientes[pendientes.length - 1] : null;
    if (ultimaPendiente && (!ultimaGuardada || ultimaPendiente.marcadaEn > ultimaGuardada.created_at)) {
      return { tipo: ultimaPendiente.tipo, created_at: ultimaPendiente.marcadaEn, pendiente: true };
    }
    return ultimaGuardada ? { tipo: ultimaGuardada.tipo, created_at: ultimaGuardada.created_at, pendiente: false } : null;
  }, [registros, pendientes]);
  const estado: "fuera" | "dentro" | "comida" =
    !ultimoRegistro || ultimoRegistro.tipo === "salida" ? "fuera" : ultimoRegistro.tipo === "comida_inicio" ? "comida" : "dentro";

  // Envía en orden lo guardado sin señal. Un rechazo del servidor (no de
  // red) se anota en la marca para que la persona la vea y la descarte o
  // avise a RH; un fallo de red detiene el intento hasta la próxima vez.
  const sincronizar = useCallback(async () => {
    if (!profileId || sincronizando) return;
    const lista = await listarPendientes(profileId).catch(() => [] as MarcaPendiente[]);
    if (lista.length === 0) return;
    setSincronizando(true);
    let enviadas = 0;
    try {
      for (const m of lista) {
        try {
          await enviarMarca(formDataDePendiente(m));
          await eliminarPendiente(m.id);
          enviadas++;
        } catch (err) {
          if (esErrorDeRed(err)) break;
          await guardarPendiente({ ...m, error: (err as Error).message });
        }
      }
    } finally {
      setSincronizando(false);
      await recargarPendientes();
      if (enviadas > 0) {
        setAviso(`${enviadas} marca(s) guardada(s) sin señal ya se enviaron.`);
        queryClient.invalidateQueries({ queryKey: ["checador-registros", profileId] });
      }
    }
  }, [profileId, sincronizando, recargarPendientes, queryClient]);

  useEffect(() => {
    if (enLinea) sincronizar();
    // Solo al recuperar señal / entrar a la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enLinea, profileId]);

  const hoyIso = new Date().toISOString().slice(0, 10);
  const registrosHoy = useMemo(() => (registros ?? []).filter((r) => r.created_at.slice(0, 10) === hoyIso), [registros, hoyIso]);
  const horasHoy = useMemo(() => horasTrabajadas(registrosHoy), [registrosHoy]);
  const historial = useMemo(() => agruparPorDia(registros ?? []), [registros]);

  const inputFoto = useRef<HTMLInputElement>(null);
  const [foto, setFoto] = useState<File | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [paso, setPaso] = useState<string | null>(null);

  function onFotoElegida(archivo: File | null) {
    setFoto(archivo);
    setVistaPrevia((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return archivo ? URL.createObjectURL(archivo) : null;
    });
  }

  // La marca va por el edge function checador-marcar con foto + GPS; la
  // inserción directa en la tabla está cerrada para que nadie marque sin
  // evidencia.
  const marcar = useMutation({
    mutationFn: async (tipo: TipoMarca): Promise<"enviada" | "guardada"> => {
      const pideFoto = tipo === "entrada" || tipo === "salida";
      if (pideFoto && !foto) throw new Error("Primero toma tu foto.");
      setAviso(null);
      setPaso("Obteniendo ubicación…");
      const ubicacion = await obtenerUbicacion();
      setPaso("Preparando foto…");
      const comprimida = pideFoto && foto ? await comprimirFoto(foto) : null;
      const pendiente: MarcaPendiente = {
        id: nuevoId(),
        profileId,
        tipo,
        foto: comprimida,
        lat: ubicacion.lat,
        lng: ubicacion.lng,
        precision: ubicacion.precision,
        marcadaEn: new Date().toISOString(),
        dispositivo: navigator.userAgent.slice(0, 200),
      };
      // Sin señal, o con marcas anteriores todavía en el teléfono (para no
      // desordenarlas), la marca se guarda local y se envía después.
      if (!navigator.onLine || pendientes.length > 0) {
        await guardarPendiente(pendiente);
        return "guardada";
      }
      setPaso("Enviando…");
      try {
        await enviarMarca(formDataDePendiente(pendiente));
        return "enviada";
      } catch (err) {
        if (esErrorDeRed(err)) {
          await guardarPendiente(pendiente);
          return "guardada";
        }
        throw err;
      }
    },
    onSuccess: async (resultado) => {
      onFotoElegida(null);
      if (inputFoto.current) inputFoto.current.value = "";
      if (resultado === "guardada") {
        setAviso("Sin señal: la marca quedó guardada en tu teléfono con la hora de ahora. Se enviará sola cuando vuelva la conexión.");
        await recargarPendientes();
        if (navigator.onLine) sincronizar();
      } else {
        queryClient.invalidateQueries({ queryKey: ["checador-registros", profileId] });
      }
    },
    onSettled: () => setPaso(null),
  });

  async function descartarPendiente(id: string) {
    await eliminarPendiente(id);
    await recargarPendientes();
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Checador</h1>

      {!enLinea && (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Sin conexión. Puedes marcar igual: la marca se guarda en tu teléfono y se envía cuando vuelva la señal.
        </p>
      )}
      {pendientes.length > 0 && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {pendientes.length} marca(s) guardada(s) en el teléfono, pendiente(s) de enviar.
            </span>
            <button onClick={() => sincronizar()} disabled={sincronizando || !enLinea} className="rounded border border-amber-400 bg-white px-2 py-1 text-xs font-medium text-amber-900 disabled:opacity-50">
              {sincronizando ? "Enviando…" : "Enviar ahora"}
            </button>
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {pendientes.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span>
                  {SIMBOLO_MARCA[m.tipo]} {ETIQUETA_MARCA[m.tipo]} · {new Date(m.marcadaEn).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
                {m.error && <span className="text-red-700">Rechazada: {m.error}</span>}
                {m.error && (
                  <button onClick={() => descartarPendiente(m.id)} className="text-red-700 underline">
                    descartar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {aviso && <p className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>}

      <div className="mb-6 rounded border border-slate-200 bg-white p-6 text-center">
        <p className="mb-1 text-sm text-slate-500">
          {ultimoRegistro
            ? `Última marca: ${ETIQUETA_MARCA[ultimoRegistro.tipo]} a las ${horaCorta(ultimoRegistro.created_at)}${ultimoRegistro.pendiente ? " (pendiente de enviar)" : ""}`
            : "Sin marcas todavía"}
        </p>
        <p className={`mb-4 text-2xl font-semibold ${estado === "dentro" ? "text-emerald-700" : estado === "comida" ? "text-amber-600" : "text-slate-500"}`}>
          {estado === "dentro" ? "Dentro" : estado === "comida" ? "En comida" : "Fuera"}
        </p>
        <div className="mx-auto mb-4 flex max-w-xs flex-col items-center gap-2">
          <input
            ref={inputFoto}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={(e) => onFotoElegida(e.target.files?.[0] ?? null)}
          />
          {vistaPrevia ? (
            <img src={vistaPrevia} alt="Tu foto para esta marca" className="h-32 w-32 rounded-full object-cover ring-2 ring-slate-300" />
          ) : (
            <div className="flex h-32 w-32 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400">sin foto</div>
          )}
          <button type="button" onClick={() => inputFoto.current?.click()} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
            {foto ? "Tomar otra foto" : "1. Tomar foto"}
          </button>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {estado === "fuera" && (
            <button onClick={() => marcar.mutate("entrada")} disabled={marcar.isPending || !foto} className="rounded bg-emerald-700 px-6 py-3 text-lg font-semibold text-white disabled:opacity-50">
              {marcar.isPending ? (paso ?? "Marcando…") : "2. Marcar entrada"}
            </button>
          )}
          {estado === "dentro" && (
            <>
              <button onClick={() => marcar.mutate("comida_inicio")} disabled={marcar.isPending} className="rounded bg-amber-500 px-5 py-3 text-base font-semibold text-white disabled:opacity-50">
                {marcar.isPending ? (paso ?? "Marcando…") : "Salir a comer"}
              </button>
              <button onClick={() => marcar.mutate("salida")} disabled={marcar.isPending || !foto} className="rounded bg-slate-900 px-6 py-3 text-lg font-semibold text-white disabled:opacity-50">
                {marcar.isPending ? (paso ?? "Marcando…") : "2. Marcar salida"}
              </button>
            </>
          )}
          {estado === "comida" && (
            <button onClick={() => marcar.mutate("comida_fin")} disabled={marcar.isPending} className="rounded bg-amber-600 px-6 py-3 text-lg font-semibold text-white disabled:opacity-50">
              {marcar.isPending ? (paso ?? "Marcando…") : "Regresar de comer"}
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Entrada y salida guardan tu foto y tu ubicación; la comida solo la ubicación. La pausa de comida no cuenta como horas trabajadas.
        </p>
        <p className="mt-4 text-sm text-slate-600">
          Horas trabajadas hoy: <span className="font-medium text-slate-900">{horasHoy.toFixed(1)} h</span>
        </p>
        {marcar.isError && <p className="mt-2 text-sm text-red-600">{(marcar.error as Error).message}</p>}
      </div>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      <h2 className="mb-2 text-sm font-semibold text-slate-700">Últimos {DIAS_HISTORIAL} días</h2>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Día</th>
              <th className="px-3 py-2">Marcas</th>
              <th className="px-3 py-2 text-right">Horas</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((dia) => (
              <tr key={dia.fecha} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2">{fechaCorta(dia.fecha)}</td>
                <td className="px-3 py-2 text-slate-600">
                  {dia.registros.map((r) => (
                    <span key={r.id} className="mr-3 inline-flex items-center gap-1 whitespace-nowrap">
                      <span title={ETIQUETA_MARCA[r.tipo]}>{SIMBOLO_MARCA[r.tipo]}</span> {horaCorta(r.created_at)}
                      {r.sincronizada_offline && <span title="Marcada sin señal y enviada después" className="text-[10px] text-amber-600">offline</span>}
                      {r.manual && <span title={r.ajuste_nota ?? "Marca manual de RH"} className="text-[10px] text-sky-700">manual</span>}
                      {!r.manual && r.ajuste_nota && <span title={r.ajuste_nota} className="text-[10px] text-sky-700">corregida</span>}
                      {enlaceMapa(r) && (
                        <a href={enlaceMapa(r)!} target="_blank" rel="noreferrer" className="text-xs text-slate-500 hover:underline" title={`±${Math.round(r.precision_m ?? 0)} m`}>
                          mapa
                        </a>
                      )}
                      {r.foto_path && (
                        <button type="button" onClick={() => abrirFoto(r.id).catch((e) => alert((e as Error).message))} className="text-xs text-slate-500 hover:underline">
                          foto
                        </button>
                      )}
                    </span>
                  ))}
                </td>
                <td className="px-3 py-2 text-right font-medium">{horasTrabajadas(dia.registros).toFixed(1)} h</td>
              </tr>
            ))}
            {historial.length === 0 && !isLoading && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-slate-400">
                  Sin marcas en los últimos {DIAS_HISTORIAL} días.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
