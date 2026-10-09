import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { ETIQUETA_MARCA, SIMBOLO_MARCA, type TipoMarca } from "../Checador";
import { useUbicacionesChecador } from "./UbicacionesChecador";
import { rutaVerArchivo } from "../../lib/verArchivo";
import { abrirParaImprimir } from "../../lib/imprimir";
import { armarReporteChecador, csvReporteChecador, formatoHoras, horaLocal, htmlReporteChecador, totalesPorPersona, type FilaChecador } from "../../lib/reporteChecador";

interface MarcaChecador {
  id: string;
  profile_id: string;
  nombre: string;
  tipo: TipoMarca;
  created_at: string;
  lat: number | null;
  lng: number | null;
  precision_m: number | null;
  tiene_foto: boolean;
  ubicacion_id: string | null;
  ubicacion_nombre: string | null;
  sincronizada_offline: boolean;
  manual: boolean;
  hora_original: string | null;
  ajustada_en: string | null;
  ajuste_nota: string | null;
  ajustada_por_nombre: string | null;
  anulada: boolean;
  anulada_nota: string | null;
}

const campo = "rounded border border-slate-300 px-2 py-1 text-sm";

function aLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Marcas del checador con evidencia (foto + GPS) de los últimos días,
 * para que RH valide asistencia. RH/admin además pueden corregir la hora,
 * anular una marca equivocada, agregar una manual y clasificar el sitio. */
export function MarcasChecador({
  titulo = "Marcas del checador con foto y ubicación",
  onCrearSitioDesde,
}: {
  titulo?: string;
  onCrearSitioDesde?: (coords: { lat: number; lng: number }) => void;
}) {
  const { perfil } = useAuth();
  const puedeEditar = perfil?.rol === "rh" || perfil?.rol === "admin";
  const queryClient = useQueryClient();
  const [dias, setDias] = useState(3);
  const [verAnuladas, setVerAnuladas] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [mostrarManual, setMostrarManual] = useState(false);
  // Mario (9-oct-2026): por defecto el reporte horizontal por trabajador.
  const [vista, setVista] = useState<"trabajador" | "marcas">("trabajador");
  const [error, setError] = useState<string | null>(null);
  const { data: ubicaciones } = useUbicacionesChecador();

  const { data: marcas, isLoading } = useQuery({
    queryKey: ["rh-marcas-checador", dias],
    queryFn: async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - dias);
      desde.setHours(0, 0, 0, 0);
      const { data, error: err } = await supabase.from("v_checador_marcas").select("*").gte("created_at", desde.toISOString()).order("created_at", { ascending: false }).limit(5000);
      if (err) throw err;
      return data as MarcaChecador[];
    },
  });

  const { data: personas } = useQuery({
    queryKey: ["rh-personal-con-cuenta"],
    enabled: puedeEditar,
    queryFn: async () => {
      const { data, error: err } = await supabase.from("v_personal_con_cuenta").select("*").order("nombre");
      if (err) throw err;
      return data as { personal_id: string; nombre: string; profile_id: string }[];
    },
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["rh-marcas-checador"] });
    queryClient.invalidateQueries({ queryKey: ["asistencia-semanal"] });
  };

  const ajustar = useMutation({
    mutationFn: async (p: { id: string; hora: string; nota: string }) => {
      const { error: err } = await supabase.rpc("checador_ajustar_marca", { p_registro_id: p.id, p_nueva_hora: new Date(p.hora).toISOString(), p_nota: p.nota });
      if (err) throw err;
    },
    onSuccess: () => {
      setEditando(null);
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });

  const anular = useMutation({
    mutationFn: async (p: { id: string; nota: string }) => {
      const { error: err } = await supabase.rpc("checador_anular_marca", { p_registro_id: p.id, p_nota: p.nota });
      if (err) throw err;
    },
    onSuccess: () => {
      setAnulando(null);
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });

  const manual = useMutation({
    mutationFn: async (p: { profileId: string; tipo: TipoMarca; hora: string; nota: string }) => {
      const { error: err } = await supabase.rpc("checador_marca_manual", { p_profile_id: p.profileId, p_tipo: p.tipo, p_hora: new Date(p.hora).toISOString(), p_nota: p.nota });
      if (err) throw err;
    },
    onSuccess: () => {
      setMostrarManual(false);
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });

  const asignarSitio = useMutation({
    mutationFn: async (p: { id: string; ubicacionId: string | null }) => {
      const { error: err } = await supabase.rpc("checador_asignar_ubicacion", { p_registro_id: p.id, p_ubicacion_id: p.ubicacionId });
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  function verFoto(id: string) {
    // Página propia que pide la liga firmada al cargar (no caduca en la pestaña).
    window.open(rutaVerArchivo("checador", id), "_blank");
  }

  function onManual(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    manual.mutate({
      profileId: String(fd.get("profile_id")),
      tipo: String(fd.get("tipo")) as TipoMarca,
      hora: String(fd.get("hora")),
      nota: String(fd.get("nota") ?? "").trim(),
    });
  }

  const visibles = (marcas ?? []).filter((m) => verAnuladas || !m.anulada);

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">{titulo}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded border border-slate-300 text-xs">
            <button type="button" onClick={() => setVista("trabajador")} className={`px-2 py-1 ${vista === "trabajador" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>
              Por trabajador
            </button>
            <button type="button" onClick={() => setVista("marcas")} className={`px-2 py-1 ${vista === "marcas" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>
              Lista de marcas
            </button>
          </div>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={verAnuladas} onChange={(e) => setVerAnuladas(e.target.checked)} /> ver anuladas
          </label>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} className="rounded border border-slate-300 px-2 py-1 text-xs">
            <option value={1}>Hoy</option>
            <option value={3}>3 días</option>
            <option value={7}>7 días</option>
            <option value={14}>14 días</option>
            <option value={31}>31 días</option>
          </select>
          {puedeEditar && (
            <button onClick={() => setMostrarManual((v) => !v)} className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white">
              {mostrarManual ? "Cancelar" : "+ Marca manual"}
            </button>
          )}
        </div>
      </div>

      {mostrarManual && puedeEditar && (
        <form onSubmit={onManual} className="mb-3 grid grid-cols-1 gap-2 rounded border border-sky-200 bg-sky-50 p-3 sm:grid-cols-5">
          <select name="profile_id" required className={campo} defaultValue="">
            <option value="" disabled>
              Persona…
            </option>
            {personas?.map((p) => (
              <option key={p.personal_id} value={p.profile_id}>
                {p.nombre}
              </option>
            ))}
          </select>
          <select name="tipo" required className={campo} defaultValue="entrada">
            {(Object.keys(ETIQUETA_MARCA) as TipoMarca[]).map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_MARCA[t]}
              </option>
            ))}
          </select>
          <input name="hora" type="datetime-local" required defaultValue={aLocalInput(new Date().toISOString())} className={campo} />
          <input name="nota" required placeholder="Motivo (obligatorio)" className={campo} />
          <button disabled={manual.isPending} className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
            {manual.isPending ? "Guardando…" : "Agregar"}
          </button>
          <p className="text-xs text-sky-900 sm:col-span-5">Solo las personas con cuenta ligada en Personal aparecen aquí. La marca queda señalada como manual, con quién la capturó y el motivo.</p>
        </form>
      )}

      {error && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {vista === "trabajador" && <ReporteHorizontal marcas={marcas ?? []} dias={dias} cargando={isLoading} />}

      <div className={`overflow-x-auto rounded border border-slate-200 bg-white ${vista === "trabajador" ? "hidden" : ""}`}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Persona</th>
              <th className="px-3 py-2">Marca</th>
              <th className="px-3 py-2">Cuándo</th>
              <th className="px-3 py-2">Sitio</th>
              <th className="px-3 py-2">Ubicación</th>
              <th className="px-3 py-2">Foto</th>
              {puedeEditar && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {visibles.map((m) => (
              <tr key={m.id} className={`border-t border-slate-100 ${m.anulada ? "text-slate-400 line-through" : ""}`}>
                <td className="px-3 py-2">{m.nombre}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {SIMBOLO_MARCA[m.tipo]} {ETIQUETA_MARCA[m.tipo]}
                  {m.sincronizada_offline && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800 no-underline">offline</span>}
                  {m.manual && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">manual</span>}
                  {!m.manual && m.ajustada_en && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">corregida</span>}
                  {m.anulada && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] text-red-800">anulada</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                  {editando === m.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        ajustar.mutate({ id: m.id, hora: String(fd.get("hora")), nota: String(fd.get("nota") ?? "").trim() });
                      }}
                      className="flex flex-wrap items-center gap-1"
                    >
                      <input name="hora" type="datetime-local" required defaultValue={aLocalInput(m.created_at)} className={campo} />
                      <input name="nota" required placeholder="Motivo" className={campo} />
                      <button className="rounded bg-slate-900 px-2 py-1 text-xs text-white">Guardar</button>
                      <button type="button" onClick={() => setEditando(null)} className="text-xs text-slate-500 underline">
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <>
                      {new Date(m.created_at).toLocaleString("es-MX", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {m.hora_original && (
                        <div className="text-[11px] text-slate-400" title={m.ajuste_nota ?? ""}>
                          antes {new Date(m.hora_original).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })} · {m.ajustada_por_nombre ?? "RH"}: {m.ajuste_nota}
                        </div>
                      )}
                      {m.manual && m.ajuste_nota && <div className="text-[11px] text-slate-400">{m.ajustada_por_nombre ?? "RH"}: {m.ajuste_nota}</div>}
                      {m.anulada && m.anulada_nota && <div className="text-[11px] text-red-400">{m.anulada_nota}</div>}
                    </>
                  )}
                </td>
                <td className="px-3 py-2">
                  {puedeEditar && m.lat != null ? (
                    <select
                      value={m.ubicacion_id ?? ""}
                      onChange={(e) => asignarSitio.mutate({ id: m.id, ubicacionId: e.target.value || null })}
                      className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                      title="Clasificar el sitio de esta marca"
                    >
                      <option value="">sin clasificar</option>
                      {ubicaciones?.filter((u) => u.activo || u.id === m.ubicacion_id).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={m.ubicacion_nombre ? "" : "text-slate-300"}>{m.ubicacion_nombre ?? (m.lat != null ? "sin clasificar" : "—")}</span>
                  )}
                  {puedeEditar && onCrearSitioDesde && m.lat != null && m.lng != null && !m.ubicacion_id && (
                    <button onClick={() => onCrearSitioDesde({ lat: m.lat!, lng: m.lng! })} className="ml-1 text-[11px] text-slate-500 underline" title="Crear un sitio nuevo con estas coordenadas">
                      nuevo sitio aquí
                    </button>
                  )}
                </td>
                <td className="px-3 py-2">
                  {m.lat != null && m.lng != null ? (
                    <a href={`https://maps.google.com/?q=${m.lat},${m.lng}`} target="_blank" rel="noreferrer" className="text-slate-700 hover:underline">
                      ver mapa{m.precision_m != null ? ` (±${Math.round(m.precision_m)} m)` : ""}
                    </a>
                  ) : (
                    <span className="text-slate-300">sin ubicación</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {m.tiene_foto ? (
                    <button type="button" onClick={() => verFoto(m.id)} className="text-slate-700 hover:underline">
                      ver foto
                    </button>
                  ) : (
                    <span className="text-slate-300">sin foto</span>
                  )}
                </td>
                {puedeEditar && (
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                    {!m.anulada && editando !== m.id && (
                      <button onClick={() => { setEditando(m.id); setAnulando(null); }} className="mr-2 text-slate-700 underline">
                        Corregir hora
                      </button>
                    )}
                    {!m.anulada && anulando !== m.id && (
                      <button onClick={() => { setAnulando(m.id); setEditando(null); }} className="text-red-700 underline">
                        Anular
                      </button>
                    )}
                    {anulando === m.id && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          anular.mutate({ id: m.id, nota: String(fd.get("nota") ?? "").trim() });
                        }}
                        className="mt-1 flex items-center gap-1"
                      >
                        <input name="nota" required placeholder="Motivo de anulación" className={campo} />
                        <button className="rounded bg-red-700 px-2 py-1 text-xs text-white">Anular</button>
                        <button type="button" onClick={() => setAnulando(null)} className="text-xs text-slate-500 underline">
                          Cancelar
                        </button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {!isLoading && visibles.length === 0 && (
              <tr>
                <td colSpan={puedeEditar ? 7 : 6} className="px-3 py-6 text-center text-slate-400">
                  Sin marcas en este periodo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Las marcas anteriores al 21-sep-2026 no traen foto ni ubicación. Una marca "offline" se hizo sin señal y se envió después con su hora real; una "corregida" o "manual" la ajustó RH y conserva la hora original y el motivo.
      </p>
    </div>
  );
}

/** Una fila por trabajador y día: entrada, salida a comer, regreso de comer,
 * salida y horas activas; total del periodo por trabajador. */
function ReporteHorizontal({ marcas, dias, cargando }: { marcas: MarcaChecador[]; dias: number; cargando: boolean }) {
  const filas = armarReporteChecador(marcas);
  const totales = totalesPorPersona(filas);
  const [aviso, setAviso] = useState<string | null>(null);
  const periodo = dias === 1 ? "Hoy" : `Últimos ${dias} días`;
  let anterior = "";

  function descargar() {
    const url = URL.createObjectURL(new Blob([csvReporteChecador(filas)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `checador-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const celda = (iso: string | null, enTurno = false) => <td className={`whitespace-nowrap px-3 py-1.5 tabular-nums ${iso ? "" : enTurno ? "text-slate-300" : "text-amber-600"}`}>{horaLocal(iso)}</td>;
  const fecha = (f: FilaChecador) =>
    new Date(`${f.fecha}T12:00:00`).toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });

  return (
    <div className="mb-3">
      <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
        {aviso && <span className="text-xs text-amber-700">{aviso}</span>}
        <button type="button" onClick={() => setAviso(abrirParaImprimir(htmlReporteChecador(filas, periodo)) ? null : "El navegador bloqueó la ventana.")} disabled={filas.length === 0} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">
          Imprimir (horizontal)
        </button>
        <button type="button" onClick={descargar} disabled={filas.length === 0} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50">
          Excel
        </button>
      </div>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Trabajador</th>
              <th className="px-3 py-2">Día</th>
              <th className="px-3 py-2">Entrada</th>
              <th className="px-3 py-2">Salida a comer</th>
              <th className="px-3 py-2">Regreso de comer</th>
              <th className="px-3 py-2">Salida</th>
              <th className="px-3 py-2 text-right">Horas activas</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const nuevo = f.profile_id !== anterior;
              anterior = f.profile_id;
              const t = totales.get(f.profile_id)!;
              return (
                <tr key={`${f.profile_id}-${f.fecha}`} className={`border-t ${nuevo ? "border-slate-300" : "border-slate-100"}`}>
                  <td className="px-3 py-1.5">
                    {nuevo && (
                      <>
                        <div className="font-medium text-slate-900">{f.nombre}</div>
                        {t.dias > 1 && (
                          <div className="text-[11px] text-slate-500">
                            {t.dias} días · {formatoHoras(t.minutos)}
                            {t.incompletos ? ` · ${t.incompletos} sin cerrar` : ""}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{fecha(f)}</td>
                  {celda(f.entrada)}
                  {celda(f.comida_inicio, f.enTurno)}
                  {celda(f.comida_fin, f.enTurno)}
                  {celda(f.salida, f.enTurno)}
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums" title={f.faltan.length ? `Falta: ${f.faltan.join(", ")}` : ""}>
                    {f.minutos != null ? formatoHoras(f.minutos) : f.enTurno ? <span className="text-xs font-normal text-sky-700">en turno</span> : <span className="text-xs font-normal text-amber-700">falta {f.faltan.includes("entrada") ? "entrada" : "salida"}</span>}
                  </td>
                </tr>
              );
            })}
            {!cargando && filas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  Sin marcas en este periodo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-slate-400">Horas activas = salida − entrada − tiempo de comida. Sin salida a comer se cuenta el día completo. En ámbar, la etapa que no se checó.</p>
    </div>
  );
}
