import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa, useEmpresasAlcance } from "../../components/SelectorEmpresa";
import {
  CLASE_ESTADO_RESERVA,
  CLASE_ESTADO_UNIDAD,
  CLASE_GRAVEDAD,
  ETIQUETA_ESTADO_AVERIA,
  ETIQUETA_ESTADO_RESERVA,
  ETIQUETA_ESTADO_UNIDAD,
  ETIQUETA_GRAVEDAD,
  TIPOS_UNIDAD,
  filtrarUnidades,
  horaCorta,
  isoLocal,
  reservasDelDia,
  resumenAverias,
  revisarAveria,
  revisarReserva,
  revisarUnidad,
  semaforoUnidad,
  semanaDe,
  sumarDias,
  type Averia,
  type EstadoAveria,
  type Reserva,
  type Unidad,
} from "../../lib/logistica";

// Logística (9-nov-2026, Mario: "el módulo de logística donde cargaremos las
// unidades consultadas en el calendario de reservas; va a poner el API del
// sistema actual de reservas, y ahí vamos a reportar averías").
// Tres pestañas: Calendario de reservas (semana × unidad), Unidades (la
// flotilla por empresa) y Averías (cualquiera reporta; quien opera atiende).
// Las reservas se capturan a mano hasta que llegue el API del sistema de
// reservas: la sincronización insertará con origen 'api' y externo_id.

type Pestana = "calendario" | "unidades" | "averias";
const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";
const CLASE_SEMAFORO: Record<string, string> = { rojo: "bg-red-500", ambar: "bg-amber-400", verde: "bg-emerald-500", gris: "bg-slate-300" };

interface Obra {
  id: string;
  nombre: string;
  empresa_id: string;
}

function aLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${isoLocal(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function Logistica() {
  const { perfil, soloConsulta } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const pestana = (params.get("tab") as Pestana | null) ?? "calendario";
  const setPestana = (t: Pestana) => setParams((p) => {
    p.set("tab", t);
    return p;
  }, { replace: true });
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const { data: empresas } = useEmpresasAlcance();
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opera = !!perfil && !soloConsulta && (["admin", "corporativo", "direccion", "empresa", "almacen"].includes(perfil.rol) || (perfil.modulos ?? []).includes("logistica"));
  const puedeReportar = !!perfil && !soloConsulta && perfil.rol !== "pendiente";

  const { data: unidades = [], isLoading } = useQuery({
    queryKey: ["logistica-unidades"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("logistica_unidades").select("*").order("nombre");
      if (err) throw err;
      return (data ?? []) as Unidad[];
    },
  });
  const { data: reservas = [] } = useQuery({
    queryKey: ["logistica-reservas"],
    queryFn: async () => {
      const desde = new Date();
      desde.setDate(desde.getDate() - 60);
      const { data, error: err } = await supabase.from("logistica_reservas").select("*").gte("hasta", desde.toISOString()).order("desde");
      if (err) throw err;
      return (data ?? []) as Reserva[];
    },
  });
  const { data: averias = [] } = useQuery({
    queryKey: ["logistica-averias"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("logistica_averias").select("*").order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(500);
      if (err) throw err;
      return (data ?? []) as Averia[];
    },
  });
  const { data: obras = [] } = useQuery({
    queryKey: ["logistica-obras"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("proyectos").select("id, nombre, empresa_id").eq("activo", true).order("nombre").limit(500);
      if (err) throw err;
      return (data ?? []) as Obra[];
    },
  });
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["logistica-unidades"] });
    qc.invalidateQueries({ queryKey: ["logistica-reservas"] });
    qc.invalidateQueries({ queryKey: ["logistica-averias"] });
  };
  const ok = (m: string) => {
    setError(null);
    setAviso(m);
    refrescar();
  };
  const falla = (e: Error) => {
    setAviso(null);
    setError(e.message);
  };

  const unidadesEmpresa = useMemo(() => (empresaId ? unidades.filter((u) => u.empresa_id === empresaId) : unidades), [unidades, empresaId]);
  const nombreEmpresa = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.codigo || e.nombre])), [empresas]);
  const unidadPorId = useMemo(() => new Map(unidades.map((u) => [u.id, u])), [unidades]);
  const resumen = resumenAverias(averias.filter((a) => !empresaId || a.empresa_id === empresaId));
  const activas = unidadesEmpresa.filter((u) => u.estado !== "baja");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Logística</h1>
        <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />
        <span className="text-xs text-slate-500">
          {activas.length} unidad(es) · {resumen.abiertas + resumen.enTaller} avería(s) abierta(s){resumen.graves ? ` · ${resumen.graves} grave(s)` : ""}
        </span>
      </div>
      <p className="mb-3 rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Sistema de reservas: <b>pendiente de conectar el API</b>. Mientras, las reservas se capturan aquí; cuando llegue, entrarán solas al calendario (origen "api") sin duplicarse.
      </p>
      {aviso && <p className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>}
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-4 flex border-b border-slate-200">
        {(
          [
            ["calendario", "Calendario de reservas"],
            ["unidades", `Unidades (${unidadesEmpresa.length})`],
            ["averias", `Averías${resumen.abiertas + resumen.enTaller ? ` · ${resumen.abiertas + resumen.enTaller} abiertas` : ""}`],
          ] as [Pestana, string][]
        ).map(([clave, texto]) => (
          <button key={clave} onClick={() => setPestana(clave)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${pestana === clave ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {texto}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : pestana === "calendario" ? (
        <Calendario unidades={activas} reservas={reservas} obras={obras} averias={averias} opera={opera} empresaId={empresaId} nombreEmpresa={nombreEmpresa} onOk={ok} onError={falla} />
      ) : pestana === "unidades" ? (
        <Unidades unidades={unidadesEmpresa} averias={averias} opera={opera} empresaId={empresaId} empresas={empresas ?? []} nombreEmpresa={nombreEmpresa} onOk={ok} onError={falla} />
      ) : (
        <Averias unidades={unidadesEmpresa} unidadPorId={unidadPorId} averias={averias.filter((a) => !empresaId || a.empresa_id === empresaId)} opera={opera} puedeReportar={puedeReportar} onOk={ok} onError={falla} />
      )}
    </div>
  );
}

// ── Calendario ───────────────────────────────────────────────────────────

function Calendario({ unidades, reservas, obras, averias, opera, empresaId, nombreEmpresa, onOk, onError }: { unidades: Unidad[]; reservas: Reserva[]; obras: Obra[]; averias: Averia[]; opera: boolean; empresaId: string; nombreEmpresa: Map<string, string>; onOk: (m: string) => void; onError: (e: Error) => void }) {
  const hoy = isoLocal(new Date());
  const [base, setBase] = useState(hoy);
  const dias = semanaDe(base);
  const [nueva, setNueva] = useState<{ unidad_id: string; dia: string } | null>(null);
  const [editando, setEditando] = useState<Reserva | null>(null);
  const [form, setForm] = useState({ unidad_id: "", desde: "", hasta: "", titulo: "", destino: "", proyecto_id: "", cliente: "", chofer_nombre: "", notas: "" });

  const abrir = (unidad_id: string, dia: string, r?: Reserva) => {
    setEditando(r ?? null);
    setNueva({ unidad_id, dia });
    setForm(
      r
        ? { unidad_id: r.unidad_id, desde: aLocalInput(r.desde), hasta: aLocalInput(r.hasta), titulo: r.titulo, destino: r.destino ?? "", proyecto_id: r.proyecto_id ?? "", cliente: r.cliente ?? "", chofer_nombre: r.chofer_nombre ?? "", notas: r.notas ?? "" }
        : { unidad_id, desde: `${dia}T08:00`, hasta: `${dia}T18:00`, titulo: "", destino: "", proyecto_id: "", cliente: "", chofer_nombre: "", notas: "" },
    );
  };
  const guardar = useMutation({
    mutationFn: async () => {
      const desde = new Date(form.desde).toISOString();
      const hasta = new Date(form.hasta).toISOString();
      const falta = revisarReserva({ id: editando?.id, unidad_id: form.unidad_id, desde, hasta, titulo: form.titulo }, reservas, unidades);
      if (falta) throw new Error(falta);
      const fila = { unidad_id: form.unidad_id, desde, hasta, titulo: form.titulo.trim(), destino: form.destino.trim() || null, proyecto_id: form.proyecto_id || null, cliente: form.cliente.trim() || null, chofer_nombre: form.chofer_nombre.trim() || null, notas: form.notas.trim() || null };
      const { error } = editando ? await supabase.from("logistica_reservas").update(fila).eq("id", editando.id) : await supabase.from("logistica_reservas").insert({ ...fila, empresa_id: unidades.find((u) => u.id === form.unidad_id)?.empresa_id });
      if (error) throw error;
    },
    onSuccess: () => {
      onOk(editando ? "Reserva actualizada." : "Reserva registrada.");
      setNueva(null);
      setEditando(null);
    },
    onError,
  });
  const cambiarEstado = useMutation({
    mutationFn: async ({ r, estado }: { r: Reserva; estado: Reserva["estado"] }) => {
      const { error } = await supabase.from("logistica_reservas").update({ estado }).eq("id", r.id);
      if (error) throw error;
      return estado;
    },
    onSuccess: (estado) => onOk(`Reserva ${ETIQUETA_ESTADO_RESERVA[estado]}.`),
    onError,
  });
  const obrasDe = (unidadId: string) => {
    const emp = unidades.find((u) => u.id === unidadId)?.empresa_id;
    return obras.filter((o) => !emp || o.empresa_id === emp);
  };
  const semana = reservas.filter((r) => unidades.some((u) => u.id === r.unidad_id) && r.estado !== "cancelada" && new Date(r.desde).getTime() < new Date(`${dias[6]}T23:59:59`).getTime() && new Date(r.hasta).getTime() > new Date(`${dias[0]}T00:00:00`).getTime());
  const fechaCorta = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => setBase(sumarDias(base, -7))} className="rounded border border-slate-300 px-2 py-1">
          ‹ semana anterior
        </button>
        <button onClick={() => setBase(hoy)} className="rounded border border-slate-300 px-2 py-1">
          Hoy
        </button>
        <button onClick={() => setBase(sumarDias(base, 7))} className="rounded border border-slate-300 px-2 py-1">
          semana siguiente ›
        </button>
        <span className="text-slate-600">
          {fechaCorta(dias[0])} – {fechaCorta(dias[6])}
        </span>
        <span className="ml-auto text-xs text-slate-500">{opera ? "Clic en una celda para reservar; clic en una reserva para editarla." : "Solo consulta: quien opera logística captura las reservas."}</span>
      </div>
      {unidades.length === 0 ? (
        <p className="text-sm text-slate-500">No hay unidades{empresaId ? " en esta empresa" : ""}. Dalas de alta en la pestaña Unidades.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-600">
                <th className="px-2 py-2">Unidad</th>
                {dias.map((d) => (
                  <th key={d} className={`px-2 py-2 ${d === hoy ? "text-slate-900" : ""}`}>
                    {fechaCorta(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unidades.map((u) => {
                const sem = semaforoUnidad(u, averias);
                return (
                  <tr key={u.id} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${CLASE_SEMAFORO[sem]}`} title={sem === "rojo" ? "En taller o avería grave" : sem === "ambar" ? "Avería abierta" : "Sin pendientes"} />
                        <span className="font-medium text-slate-900">{u.nombre}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {u.folio} · {u.placas ?? "sin placas"} · {nombreEmpresa.get(u.empresa_id) ?? ""}
                        {u.estado !== "activa" && <span className={`ml-1 rounded px-1 ${CLASE_ESTADO_UNIDAD[u.estado]}`}>{ETIQUETA_ESTADO_UNIDAD[u.estado]}</span>}
                      </div>
                    </td>
                    {dias.map((d) => {
                      const del = reservasDelDia(reservas, u.id, d);
                      return (
                        <td key={d} className={`px-1 py-1 ${d === hoy ? "bg-amber-50/40" : ""} ${opera ? "cursor-pointer hover:bg-slate-50" : ""}`} onClick={() => opera && abrir(u.id, d)}>
                          {del.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (opera) abrir(u.id, d, r);
                              }}
                              className={`mb-1 block w-full rounded border px-1.5 py-1 text-left ${CLASE_ESTADO_RESERVA[r.estado]}`}
                              title={`${r.titulo}${r.destino ? ` · ${r.destino}` : ""}${r.chofer_nombre ? ` · ${r.chofer_nombre}` : ""}`}
                            >
                              <div className="truncate font-medium">{r.titulo}</div>
                              <div className="text-[10px] opacity-80">
                                {horaCorta(r.desde).slice(6)}–{horaCorta(r.hasta).slice(6)}
                                {r.origen === "api" ? " · api" : ""}
                              </div>
                            </button>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nueva && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            guardar.mutate();
          }}
          className="mt-4 max-w-2xl rounded border border-slate-300 bg-white p-4 shadow-sm"
        >
          <h3 className="mb-3 text-sm font-semibold text-slate-900">{editando ? `Reserva · ${editando.titulo}` : "Nueva reserva"}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={etiqueta}>Unidad *</label>
              <select value={form.unidad_id} onChange={(e) => setForm({ ...form, unidad_id: e.target.value })} className={campo}>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre} · {u.folio} · {u.placas ?? "sin placas"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Sale *</label>
              <input type="datetime-local" value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} className={campo} required />
            </div>
            <div>
              <label className={etiqueta}>Regresa *</label>
              <input type="datetime-local" value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} className={campo} required />
            </div>
            <div className="sm:col-span-2">
              <label className={etiqueta}>Para qué *</label>
              <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} className={campo} placeholder="Ej. Entrega de malla a Parque Real 63" required />
            </div>
            <div>
              <label className={etiqueta}>Destino</label>
              <input value={form.destino} onChange={(e) => setForm({ ...form, destino: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Obra</label>
              <select value={form.proyecto_id} onChange={(e) => setForm({ ...form, proyecto_id: e.target.value })} className={campo}>
                <option value="">Sin obra</option>
                {obrasDe(form.unidad_id).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Cliente</label>
              <input value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Chofer</label>
              <input value={form.chofer_nombre} onChange={(e) => setForm({ ...form, chofer_nombre: e.target.value })} className={campo} placeholder="Quién maneja" />
            </div>
            <div className="sm:col-span-2">
              <label className={etiqueta}>Notas</label>
              <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} className={campo} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {guardar.isPending ? "Guardando…" : editando ? "Guardar cambios" : "Reservar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setNueva(null);
                setEditando(null);
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Cerrar
            </button>
            {editando && editando.estado === "programada" && (
              <button type="button" onClick={() => cambiarEstado.mutate({ r: editando, estado: "en_curso" })} className="ml-auto rounded border border-emerald-300 px-3 py-2 text-sm text-emerald-800">
                Salió (en curso)
              </button>
            )}
            {editando && editando.estado === "en_curso" && (
              <button type="button" onClick={() => cambiarEstado.mutate({ r: editando, estado: "terminada" })} className="ml-auto rounded border border-emerald-300 px-3 py-2 text-sm text-emerald-800">
                Regresó (terminada)
              </button>
            )}
            {editando && editando.estado !== "cancelada" && editando.estado !== "terminada" && (
              <button type="button" onClick={() => window.confirm("¿Cancelar esta reserva?") && cambiarEstado.mutate({ r: editando, estado: "cancelada" })} className="rounded border border-red-300 px-3 py-2 text-sm text-red-700">
                Cancelar reserva
              </button>
            )}
          </div>
        </form>
      )}

      <h3 className="mb-1 mt-5 text-sm font-semibold text-slate-800">Reservas de la semana ({semana.length})</h3>
      {semana.length === 0 ? (
        <p className="text-xs text-slate-500">Sin reservas esta semana.</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {semana.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="whitespace-nowrap py-1.5 pr-2 text-xs text-slate-600">
                  {horaCorta(r.desde)} → {horaCorta(r.hasta)}
                </td>
                <td className="py-1.5 pr-2">
                  <span className="font-medium">{r.titulo}</span>
                  <span className="text-xs text-slate-500">
                    {" "}
                    · {unidades.find((u) => u.id === r.unidad_id)?.nombre ?? "—"}
                    {r.destino ? ` · ${r.destino}` : ""}
                    {r.chofer_nombre ? ` · ${r.chofer_nombre}` : ""}
                    {r.cliente ? ` · ${r.cliente}` : ""}
                  </span>
                </td>
                <td className="whitespace-nowrap py-1.5 text-right text-xs">
                  <span className={`rounded border px-1.5 py-0.5 ${CLASE_ESTADO_RESERVA[r.estado]}`}>{ETIQUETA_ESTADO_RESERVA[r.estado]}</span>
                  {opera && (
                    <button onClick={() => abrir(r.unidad_id, isoLocal(new Date(r.desde)), r)} className="ml-2 text-slate-600 underline">
                      editar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Unidades ─────────────────────────────────────────────────────────────

function Unidades({ unidades, averias, opera, empresaId, empresas, nombreEmpresa, onOk, onError }: { unidades: Unidad[]; averias: Averia[]; opera: boolean; empresaId: string; empresas: { id: string; nombre: string; codigo: string }[]; nombreEmpresa: Map<string, string>; onOk: (m: string) => void; onError: (e: Error) => void }) {
  const [texto, setTexto] = useState("");
  const [verBajas, setVerBajas] = useState(false);
  const [editando, setEditando] = useState<Unidad | null>(null);
  const [mostrar, setMostrar] = useState(false);
  const vacio = { nombre: "", empresa_id: empresaId || (empresas.length === 1 ? empresas[0].id : ""), tipo: "camioneta", marca: "", modelo: "", anio: "", placas: "", numero_serie: "", capacidad: "", chofer_nombre: "", externo_id: "", notas: "" };
  const [form, setForm] = useState(vacio);
  const lista = filtrarUnidades(unidades, texto).filter((u) => verBajas || u.estado !== "baja");

  const abrir = (u?: Unidad) => {
    setEditando(u ?? null);
    setForm(u ? { nombre: u.nombre, empresa_id: u.empresa_id, tipo: u.tipo, marca: u.marca ?? "", modelo: u.modelo ?? "", anio: u.anio ? String(u.anio) : "", placas: u.placas ?? "", numero_serie: u.numero_serie ?? "", capacidad: u.capacidad ?? "", chofer_nombre: u.chofer_nombre ?? "", externo_id: u.externo_id ?? "", notas: u.notas ?? "" } : vacio);
    setMostrar(true);
  };
  const guardar = useMutation({
    mutationFn: async () => {
      const falta = revisarUnidad({ nombre: form.nombre, empresa_id: form.empresa_id, anio: form.anio, placas: form.placas }, unidades, editando?.id);
      if (falta) throw new Error(falta);
      const fila = { nombre: form.nombre.trim(), empresa_id: form.empresa_id, tipo: form.tipo, marca: form.marca.trim() || null, modelo: form.modelo.trim() || null, anio: form.anio ? Number(form.anio) : null, placas: form.placas.trim() || null, numero_serie: form.numero_serie.trim() || null, capacidad: form.capacidad.trim() || null, chofer_nombre: form.chofer_nombre.trim() || null, externo_id: form.externo_id.trim() || null, notas: form.notas.trim() || null };
      const { error } = editando ? await supabase.from("logistica_unidades").update(fila).eq("id", editando.id) : await supabase.from("logistica_unidades").insert(fila);
      if (error) throw error;
    },
    onSuccess: () => {
      onOk(editando ? "Unidad actualizada." : "Unidad dada de alta con su folio.");
      setMostrar(false);
      setEditando(null);
    },
    onError,
  });
  const estado = useMutation({
    mutationFn: async ({ u, estado }: { u: Unidad; estado: Unidad["estado"] }) => {
      const { error } = await supabase.from("logistica_unidades").update({ estado }).eq("id", u.id);
      if (error) throw error;
      return estado;
    },
    onSuccess: (e) => onOk(`Unidad ${ETIQUETA_ESTADO_UNIDAD[e]}.`),
    onError,
  });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por nombre, placas, folio, chofer" className={`${campo} max-w-xs`} />
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={verBajas} onChange={(e) => setVerBajas(e.target.checked)} /> ver dadas de baja
        </label>
        {opera && (
          <button onClick={() => (mostrar && !editando ? setMostrar(false) : abrir())} className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            {mostrar && !editando ? "Cancelar" : "+ Nueva unidad"}
          </button>
        )}
      </div>
      {mostrar && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            guardar.mutate();
          }}
          className="mb-4 max-w-2xl rounded border border-slate-300 bg-white p-4 shadow-sm"
        >
          <h3 className="mb-3 text-sm font-semibold text-slate-900">{editando ? `${editando.folio} · ${editando.nombre}` : "Nueva unidad"}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className={etiqueta}>Nombre *</label>
              <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} className={campo} placeholder="Ej. Camioneta NP300 blanca" required autoFocus />
            </div>
            <div>
              <label className={etiqueta}>Empresa *</label>
              <select value={form.empresa_id} onChange={(e) => setForm({ ...form, empresa_id: e.target.value })} className={campo} required disabled={!!editando}>
                <option value="">Elige…</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Tipo</label>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} className={campo}>
                {TIPOS_UNIDAD.map((t) => (
                  <option key={t.clave} value={t.clave}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={etiqueta}>Marca</label>
              <input value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Modelo</label>
              <input value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Año</label>
              <input value={form.anio} onChange={(e) => setForm({ ...form, anio: e.target.value })} className={campo} inputMode="numeric" />
            </div>
            <div>
              <label className={etiqueta}>Placas</label>
              <input value={form.placas} onChange={(e) => setForm({ ...form, placas: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>No. de serie</label>
              <input value={form.numero_serie} onChange={(e) => setForm({ ...form, numero_serie: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Capacidad</label>
              <input value={form.capacidad} onChange={(e) => setForm({ ...form, capacidad: e.target.value })} className={campo} placeholder="Ej. 3.5 t, 12 m" />
            </div>
            <div>
              <label className={etiqueta}>Chofer habitual</label>
              <input value={form.chofer_nombre} onChange={(e) => setForm({ ...form, chofer_nombre: e.target.value })} className={campo} />
            </div>
            <div>
              <label className={etiqueta}>Id en el sistema de reservas</label>
              <input value={form.externo_id} onChange={(e) => setForm({ ...form, externo_id: e.target.value })} className={campo} placeholder="Para ligarla al API" />
            </div>
            <div className="sm:col-span-3">
              <label className={etiqueta}>Notas</label>
              <input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} className={campo} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {guardar.isPending ? "Guardando…" : editando ? "Guardar cambios" : "Dar de alta"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMostrar(false);
                setEditando(null);
              }}
              className="rounded border border-slate-300 px-3 py-2 text-sm"
            >
              Cerrar
            </button>
          </div>
        </form>
      )}
      {lista.length === 0 ? (
        <p className="text-sm text-slate-500">Sin unidades{texto ? " con ese texto" : ""}.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-600">
                <th className="px-3 py-2">Unidad</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Placas</th>
                <th className="px-3 py-2">Chofer</th>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.map((u) => {
                const sem = semaforoUnidad(u, averias);
                const abiertas = averias.filter((a) => a.unidad_id === u.id && (a.estado === "abierta" || a.estado === "en_taller")).length;
                return (
                  <tr key={u.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${CLASE_SEMAFORO[sem]}`} />
                        <span className="font-medium text-slate-900">{u.nombre}</span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {u.folio}
                        {u.marca || u.modelo ? ` · ${[u.marca, u.modelo, u.anio].filter(Boolean).join(" ")}` : ""}
                        {u.externo_id ? ` · api ${u.externo_id}` : ""}
                        {abiertas ? ` · ${abiertas} avería(s) abierta(s)` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{TIPOS_UNIDAD.find((t) => t.clave === u.tipo)?.etiqueta ?? u.tipo}</td>
                    <td className="px-3 py-2 font-mono text-xs">{u.placas ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{u.chofer_nombre ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{nombreEmpresa.get(u.empresa_id) ?? ""}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 ${CLASE_ESTADO_UNIDAD[u.estado]}`}>{ETIQUETA_ESTADO_UNIDAD[u.estado]}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                      {opera && (
                        <>
                          <button onClick={() => abrir(u)} className="mr-2 text-slate-600 underline">
                            editar
                          </button>
                          {u.estado === "baja" ? (
                            <button onClick={() => estado.mutate({ u, estado: "activa" })} className="text-emerald-700 underline">
                              reactivar
                            </button>
                          ) : (
                            <button onClick={() => window.confirm(`¿Dar de baja ${u.nombre}? Deja de salir en el calendario.`) && estado.mutate({ u, estado: "baja" })} className="text-red-700 underline">
                              dar de baja
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Averías ──────────────────────────────────────────────────────────────

function Averias({ unidades, unidadPorId, averias, opera, puedeReportar, onOk, onError }: { unidades: Unidad[]; unidadPorId: Map<string, Unidad>; averias: Averia[]; opera: boolean; puedeReportar: boolean; onOk: (m: string) => void; onError: (e: Error) => void }) {
  const [mostrar, setMostrar] = useState(false);
  const [verCerradas, setVerCerradas] = useState(false);
  const [form, setForm] = useState({ unidad_id: "", descripcion: "", gravedad: "media", kilometraje: "" });
  const reportar = useMutation({
    mutationFn: async () => {
      const falta = revisarAveria(form);
      if (falta) throw new Error(falta);
      const { data: ses } = await supabase.auth.getSession();
      const { error } = await supabase.from("logistica_averias").insert({
        unidad_id: form.unidad_id,
        empresa_id: unidadPorId.get(form.unidad_id)?.empresa_id,
        descripcion: form.descripcion.trim(),
        gravedad: form.gravedad,
        kilometraje: form.kilometraje ? Number(form.kilometraje) : null,
        reportado_por: ses.session?.user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      onOk("Avería reportada: quien opera logística y dirección ya tienen el aviso.");
      setMostrar(false);
      setForm({ unidad_id: "", descripcion: "", gravedad: "media", kilometraje: "" });
    },
    onError,
  });
  const atender = useMutation({
    mutationFn: async ({ a, estado }: { a: Averia; estado: EstadoAveria }) => {
      let cambios: Record<string, unknown> = { estado };
      if (estado === "resuelta") {
        const resolucion = window.prompt("¿Qué se hizo para resolverla?", a.resolucion ?? "");
        if (resolucion === null) return null;
        const costo = window.prompt("Costo de la reparación (opcional):", a.costo ? String(a.costo) : "");
        if (costo === null) return null;
        cambios = { estado, resolucion: resolucion.trim() || null, costo: costo.trim() ? Number(costo) : null };
      }
      if (estado === "descartada") {
        const motivo = window.prompt("¿Por qué se descarta?", "");
        if (motivo === null) return null;
        cambios = { estado, resolucion: motivo.trim() || null };
      }
      const { error } = await supabase.from("logistica_averias").update(cambios).eq("id", a.id);
      if (error) throw error;
      return estado;
    },
    onSuccess: (e) => {
      if (e) onOk(`Avería ${ETIQUETA_ESTADO_AVERIA[e]}.`);
    },
    onError,
  });
  const abiertas = averias.filter((a) => a.estado === "abierta" || a.estado === "en_taller");
  const cerradas = averias.filter((a) => a.estado === "resuelta" || a.estado === "descartada");
  const pesos = (n: number | null) => (n == null ? "" : n.toLocaleString("es-MX", { style: "currency", currency: "MXN" }));

  const Fila = ({ a }: { a: Averia }) => {
    const u = unidadPorId.get(a.unidad_id);
    return (
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-xs text-slate-500">{a.folio}</span>
          <span className="font-semibold text-slate-900">{u?.nombre ?? "—"}</span>
          <span className="text-xs text-slate-500">
            {u?.placas ?? ""} · {a.fecha}
            {a.kilometraje ? ` · ${Number(a.kilometraje).toLocaleString("es-MX")} km` : ""}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-xs ${CLASE_GRAVEDAD[a.gravedad]}`}>{ETIQUETA_GRAVEDAD[a.gravedad]}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{ETIQUETA_ESTADO_AVERIA[a.estado]}</span>
          <span className="flex-1" />
          {opera && a.estado === "abierta" && (
            <button onClick={() => atender.mutate({ a, estado: "en_taller" })} className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-800">
              Al taller
            </button>
          )}
          {opera && (a.estado === "abierta" || a.estado === "en_taller") && (
            <>
              <button onClick={() => atender.mutate({ a, estado: "resuelta" })} className="rounded bg-emerald-700 px-2 py-1 text-xs text-white">
                Resuelta
              </button>
              <button onClick={() => atender.mutate({ a, estado: "descartada" })} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600">
                Descartar
              </button>
            </>
          )}
          {opera && (a.estado === "resuelta" || a.estado === "descartada") && (
            <button onClick={() => atender.mutate({ a, estado: "abierta" })} className="text-xs text-slate-500 underline">
              reabrir
            </button>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-800">{a.descripcion}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Reportó {a.reportante_nombre ?? "—"}
          {a.resuelto_en ? ` · ${ETIQUETA_ESTADO_AVERIA[a.estado]} ${horaCorta(a.resuelto_en)}` : ""}
          {a.resolucion ? ` · ${a.resolucion}` : ""}
          {a.costo != null ? ` · ${pesos(Number(a.costo))}` : ""}
        </p>
      </div>
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={verCerradas} onChange={(e) => setVerCerradas(e.target.checked)} /> ver resueltas y descartadas ({cerradas.length})
        </label>
        {puedeReportar && (
          <button onClick={() => setMostrar((v) => !v)} className="ml-auto rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white">
            {mostrar ? "Cancelar" : "Reportar avería"}
          </button>
        )}
      </div>
      {mostrar && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            reportar.mutate();
          }}
          className="mb-4 max-w-xl rounded border border-red-200 bg-white p-4 shadow-sm"
        >
          <div className="mb-3">
            <label className={etiqueta}>Unidad *</label>
            <select value={form.unidad_id} onChange={(e) => setForm({ ...form, unidad_id: e.target.value })} className={campo} required autoFocus>
              <option value="">Elige la unidad…</option>
              {unidades
                .filter((u) => u.estado !== "baja")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre} · {u.placas ?? u.folio}
                  </option>
                ))}
            </select>
          </div>
          <div className="mb-3">
            <label className={etiqueta}>¿Qué falla? *</label>
            <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} rows={3} className={campo} placeholder="Qué pasa, desde cuándo, si puede moverse…" required />
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label className={etiqueta}>Gravedad</label>
              <select value={form.gravedad} onChange={(e) => setForm({ ...form, gravedad: e.target.value })} className={campo}>
                <option value="leve">Leve: puede seguir trabajando</option>
                <option value="media">Media: revisar pronto</option>
                <option value="grave">Grave: la unidad no debe salir</option>
              </select>
            </div>
            <div>
              <label className={etiqueta}>Kilometraje</label>
              <input value={form.kilometraje} onChange={(e) => setForm({ ...form, kilometraje: e.target.value })} className={campo} inputMode="numeric" />
            </div>
          </div>
          <p className="mb-3 text-xs text-slate-500">Con gravedad grave la unidad pasa a "en taller" y deja de poderse reservar hasta que se resuelva. Quien opera logística y dirección reciben el aviso.</p>
          <button type="submit" disabled={reportar.isPending} className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {reportar.isPending ? "Enviando…" : "Reportar"}
          </button>
        </form>
      )}
      <div className="space-y-2">
        {abiertas.length === 0 && <p className="text-sm text-slate-500">Sin averías abiertas.</p>}
        {abiertas.map((a) => (
          <Fila key={a.id} a={a} />
        ))}
        {verCerradas && cerradas.map((a) => <Fila key={a.id} a={a} />)}
      </div>
    </div>
  );
}
