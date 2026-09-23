import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { COLOR, GraficaApilada } from "./graficas";

interface Vacante {
  id: string;
  empresa_id: string | null;
  puesto: string;
  area: string | null;
  cantidad: number;
  descripcion: string | null;
  prioridad: "alta" | "media" | "baja";
  motivo: "nueva" | "reemplazo";
  reemplaza_personal_id: string | null;
  fecha_apertura: string;
  fecha_cierre: string | null;
  estatus: "abierta" | "cubierta" | "cancelada";
  cubierta_por_personal_id: string | null;
  created_at: string;
  empresa?: { nombre: string } | null;
  candidatos?: Candidato[];
}

interface Candidato {
  id: string;
  vacante_id: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  fuente: string | null;
  estatus: "postulado" | "entrevista" | "oferta" | "contratado" | "descartado";
  notas: string | null;
}

interface RotacionMes {
  mes: string;
  altas: number;
  bajas: number;
  plantilla_inicio: number;
  plantilla_fin: number;
  rotacion_pct: number;
}

const ESTATUS_CANDIDATO: { valor: Candidato["estatus"]; etiqueta: string }[] = [
  { valor: "postulado", etiqueta: "Postulado" },
  { valor: "entrevista", etiqueta: "En entrevista" },
  { valor: "oferta", etiqueta: "Con oferta" },
  { valor: "contratado", etiqueta: "Contratado" },
  { valor: "descartado", etiqueta: "Descartado" },
];

const AREA: Record<string, string> = { operativo: "Operativo", administrativo: "Administrativo", bbva_puebla: "Mantenimiento BBVA" };
const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function diasEntre(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export function Vacantes() {
  const queryClient = useQueryClient();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [verCerradas, setVerCerradas] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: vacantes, isLoading } = useQuery({
    queryKey: ["rh-vacantes"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("vacantes").select("*, empresa:empresa_id(nombre), candidatos:vacante_candidatos(*)").order("fecha_apertura", { ascending: false });
      if (err) throw err;
      return data as Vacante[];
    },
  });
  const { data: empresas } = useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (err) throw err;
      return data as { id: string; nombre: string }[];
    },
  });
  const { data: personal } = useQuery({
    queryKey: ["rh-personal"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("personal").select("*").order("nombre");
      if (err) throw err;
      return data as { id: string; nombre: string; activo: boolean; fecha_baja: string | null }[];
    },
  });
  const { data: rotacion } = useQuery({
    queryKey: ["rh-rotacion-mensual"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("v_rotacion_mensual").select("*");
      if (err) throw err;
      return data as RotacionMes[];
    },
  });

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["rh-vacantes"] });

  const crear = useMutation({
    mutationFn: async (fila: Record<string, unknown>) => {
      const { data: sesion } = await supabase.auth.getSession();
      const { error: err } = await supabase.from("vacantes").insert({ ...fila, created_by: sesion.session?.user.id });
      if (err) throw err;
    },
    onSuccess: () => {
      setMostrarForm(false);
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });

  const actualizar = useMutation({
    mutationFn: async (p: { id: string; cambios: Record<string, unknown> }) => {
      const { error: err } = await supabase.from("vacantes").update(p.cambios).eq("id", p.id);
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  const candidato = useMutation({
    mutationFn: async (p: { id?: string; vacante_id: string; cambios: Record<string, unknown> }) => {
      const { error: err } = p.id
        ? await supabase.from("vacante_candidatos").update(p.cambios).eq("id", p.id)
        : await supabase.from("vacante_candidatos").insert({ vacante_id: p.vacante_id, ...p.cambios });
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  function onCrear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const motivo = String(fd.get("motivo") ?? "nueva");
    crear.mutate({
      puesto: String(fd.get("puesto") ?? "").trim(),
      empresa_id: String(fd.get("empresa_id") ?? "") || null,
      area: String(fd.get("area") ?? "") || null,
      cantidad: Number(fd.get("cantidad")) || 1,
      prioridad: String(fd.get("prioridad") ?? "media"),
      motivo,
      reemplaza_personal_id: motivo === "reemplazo" ? String(fd.get("reemplaza_personal_id") ?? "") || null : null,
      fecha_apertura: String(fd.get("fecha_apertura") ?? "") || new Date().toISOString().slice(0, 10),
      descripcion: String(fd.get("descripcion") ?? "").trim() || null,
    });
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const abiertas = (vacantes ?? []).filter((v) => v.estatus === "abierta");
  const posicionesAbiertas = abiertas.reduce((s, v) => s + v.cantidad, 0);
  const hace30 = new Date();
  hace30.setDate(hace30.getDate() - 30);
  const cubiertas30 = (vacantes ?? []).filter((v) => v.estatus === "cubierta" && v.fecha_cierre && v.fecha_cierre >= hace30.toISOString().slice(0, 10));
  const cubiertasTodas = (vacantes ?? []).filter((v) => v.estatus === "cubierta" && v.fecha_cierre);
  const diasPromedio = cubiertasTodas.length ? Math.round(cubiertasTodas.reduce((s, v) => s + diasEntre(v.fecha_apertura, v.fecha_cierre!), 0) / cubiertasTodas.length) : null;
  const antiguedadPromedio = abiertas.length ? Math.round(abiertas.reduce((s, v) => s + diasEntre(v.fecha_apertura, hoy), 0) / abiertas.length) : null;
  const mesActual = rotacion?.[rotacion.length - 1];
  const visibles = (vacantes ?? []).filter((v) => verCerradas || v.estatus === "abierta");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi etiqueta="Vacantes abiertas" valor={String(abiertas.length)} detalle={`${posicionesAbiertas} posición(es)`} />
        <Kpi etiqueta="Cubiertas últimos 30 días" valor={String(cubiertas30.length)} />
        <Kpi etiqueta="Días promedio para cubrir" valor={diasPromedio != null ? `${diasPromedio}` : "—"} detalle="vacantes ya cubiertas" />
        <Kpi etiqueta="Antigüedad de las abiertas" valor={antiguedadPromedio != null ? `${antiguedadPromedio} d` : "—"} detalle="promedio de días abiertas" />
        <Kpi etiqueta="Rotación este mes" valor={mesActual ? `${mesActual.rotacion_pct}%` : "—"} detalle={mesActual ? `${mesActual.bajas} baja(s) · plantilla ${mesActual.plantilla_fin}` : ""} />
      </div>

      {rotacion && (
        <GraficaApilada
          titulo="Rotación de personal por mes (altas y bajas)"
          barras={rotacion.map((r) => ({
            etiqueta: `${MESES[new Date(`${r.mes}T00:00:00`).getMonth()]} ${String(r.mes).slice(2, 4)}`,
            segmentos: [
              { clave: "altas", etiqueta: "Altas", valor: r.altas, color: COLOR.serie1 },
              { clave: "bajas", etiqueta: "Bajas", valor: r.bajas, color: COLOR.serie2 },
            ],
          }))}
        />
      )}
      {rotacion && (
        <details className="rounded border border-slate-200 bg-white p-3 text-xs">
          <summary className="cursor-pointer text-slate-600">Detalle de rotación por mes (plantilla y %)</summary>
          <table className="mt-2 w-full">
            <thead className="text-left uppercase text-slate-500">
              <tr>
                <th className="py-1">Mes</th>
                <th className="py-1 text-right">Plantilla inicio</th>
                <th className="py-1 text-right">Altas</th>
                <th className="py-1 text-right">Bajas</th>
                <th className="py-1 text-right">Plantilla fin</th>
                <th className="py-1 text-right">Rotación</th>
              </tr>
            </thead>
            <tbody>
              {rotacion.map((r) => (
                <tr key={r.mes} className="border-t border-slate-100 tabular-nums">
                  <td className="py-1">{String(r.mes).slice(0, 7)}</td>
                  <td className="py-1 text-right">{r.plantilla_inicio}</td>
                  <td className="py-1 text-right">{r.altas}</td>
                  <td className="py-1 text-right">{r.bajas}</td>
                  <td className="py-1 text-right">{r.plantilla_fin}</td>
                  <td className="py-1 text-right">{r.rotacion_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-slate-400">Rotación = bajas del mes ÷ plantilla promedio del mes. Se calcula con las fechas de ingreso y baja de Personal.</p>
        </details>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Vacantes</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={verCerradas} onChange={(e) => setVerCerradas(e.target.checked)} /> ver cubiertas y canceladas
          </label>
          <button onClick={() => setMostrarForm((v) => !v)} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            {mostrarForm ? "Cancelar" : "+ Nueva vacante"}
          </button>
        </div>
      </div>

      {mostrarForm && (
        <form onSubmit={onCrear} className="grid grid-cols-1 gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={etiqueta}>Puesto *</label>
            <input name="puesto" required className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Empresa</label>
            <select name="empresa_id" className={campo} defaultValue="">
              <option value="">Cualquiera / grupo</option>
              {empresas?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiqueta}>Área</label>
            <select name="area" className={campo} defaultValue="">
              <option value="">—</option>
              <option value="operativo">Operativo</option>
              <option value="administrativo">Administrativo</option>
              <option value="bbva_puebla">Mantenimiento BBVA</option>
            </select>
          </div>
          <div>
            <label className={etiqueta}>Posiciones</label>
            <input name="cantidad" type="number" min="1" defaultValue={1} className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Prioridad</label>
            <select name="prioridad" className={campo} defaultValue="media">
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
          <div>
            <label className={etiqueta}>Motivo</label>
            <select name="motivo" className={campo} defaultValue="nueva">
              <option value="nueva">Posición nueva</option>
              <option value="reemplazo">Reemplazo por baja</option>
            </select>
          </div>
          <div>
            <label className={etiqueta}>Reemplaza a (si aplica)</label>
            <select name="reemplaza_personal_id" className={campo} defaultValue="">
              <option value="">—</option>
              {personal?.filter((p) => !p.activo).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiqueta}>Fecha de apertura</label>
            <input name="fecha_apertura" type="date" defaultValue={hoy} className={campo} />
          </div>
          <div className="sm:col-span-3">
            <label className={etiqueta}>Descripción / requisitos</label>
            <input name="descripcion" className={campo} />
          </div>
          <div className="sm:col-span-4">
            <button disabled={crear.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {crear.isPending ? "Guardando…" : "Abrir vacante"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      <div className="space-y-3">
        {visibles.map((v) => (
          <TarjetaVacante
            key={v.id}
            vacante={v}
            personal={personal ?? []}
            onCambiar={(cambios) => actualizar.mutate({ id: v.id, cambios })}
            onCandidato={(id, cambios) => candidato.mutate({ id, vacante_id: v.id, cambios })}
          />
        ))}
        {!isLoading && visibles.length === 0 && <p className="rounded border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-400">No hay vacantes abiertas.</p>}
      </div>
    </div>
  );
}

function Kpi({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <p className="text-[11px] uppercase text-slate-500">{etiqueta}</p>
      <p className="text-2xl font-semibold tabular-nums text-slate-900">{valor}</p>
      {detalle && <p className="text-[11px] text-slate-400">{detalle}</p>}
    </div>
  );
}

function TarjetaVacante({
  vacante: v,
  personal,
  onCambiar,
  onCandidato,
}: {
  vacante: Vacante;
  personal: { id: string; nombre: string; activo: boolean }[];
  onCambiar: (cambios: Record<string, unknown>) => void;
  onCandidato: (id: string | undefined, cambios: Record<string, unknown>) => void;
}) {
  const [abierta, setAbierta] = useState(false);
  const [cubriendo, setCubriendo] = useState(false);
  const hoy = new Date().toISOString().slice(0, 10);
  const dias = diasEntre(v.fecha_apertura, v.fecha_cierre ?? hoy);
  const candidatos = v.candidatos ?? [];
  const activos = candidatos.filter((c) => c.estatus !== "descartado" && c.estatus !== "contratado").length;
  const prioridadColor = v.prioridad === "alta" ? "bg-red-100 text-red-800" : v.prioridad === "media" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700";
  const reemplaza = v.reemplaza_personal_id ? personal.find((p) => p.id === v.reemplaza_personal_id)?.nombre : null;
  const cubiertaPor = v.cubierta_por_personal_id ? personal.find((p) => p.id === v.cubierta_por_personal_id)?.nombre : null;

  function onNuevoCandidato(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    onCandidato(undefined, {
      nombre: String(fd.get("nombre") ?? "").trim(),
      telefono: String(fd.get("telefono") ?? "").trim() || null,
      correo: String(fd.get("correo") ?? "").trim() || null,
      fuente: String(fd.get("fuente") ?? "").trim() || null,
      notas: String(fd.get("notas") ?? "").trim() || null,
    });
    e.currentTarget.reset();
  }

  return (
    <div className={`rounded border bg-white p-3 ${v.estatus === "abierta" ? "border-slate-200" : "border-slate-100 opacity-75"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setAbierta((a) => !a)} className="text-left text-sm font-semibold text-slate-900 hover:underline">
              {v.puesto} {v.cantidad > 1 && <span className="text-slate-500">× {v.cantidad}</span>}
            </button>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${prioridadColor}`}>{v.prioridad}</span>
            {v.estatus !== "abierta" && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-700">{v.estatus}</span>}
          </div>
          <p className="text-xs text-slate-500">
            {v.empresa?.nombre ?? "Grupo"}
            {v.area && ` · ${AREA[v.area] ?? v.area}`} · abierta {v.fecha_apertura} ({dias} día{dias === 1 ? "" : "s"})
            {v.motivo === "reemplazo" && ` · reemplazo${reemplaza ? ` de ${reemplaza}` : ""}`}
            {cubiertaPor && ` · cubierta por ${cubiertaPor}`}
          </p>
          {v.descripcion && <p className="mt-1 text-xs text-slate-600">{v.descripcion}</p>}
        </div>
        <div className="text-right text-xs">
          <p className="text-slate-600">
            {candidatos.length} candidato(s) · {activos} en proceso
          </p>
          {v.estatus === "abierta" && (
            <div className="mt-1 flex justify-end gap-2">
              <button onClick={() => setCubriendo((c) => !c)} className="text-emerald-700 underline">
                Marcar cubierta
              </button>
              <button onClick={() => window.confirm("¿Cancelar esta vacante?") && onCambiar({ estatus: "cancelada", fecha_cierre: hoy })} className="text-slate-500 underline">
                Cancelar
              </button>
            </div>
          )}
          {v.estatus !== "abierta" && (
            <button onClick={() => onCambiar({ estatus: "abierta", fecha_cierre: null, cubierta_por_personal_id: null })} className="mt-1 text-slate-500 underline">
              Reabrir
            </button>
          )}
        </div>
      </div>

      {cubriendo && v.estatus === "abierta" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            onCambiar({ estatus: "cubierta", fecha_cierre: String(fd.get("fecha_cierre") ?? hoy), cubierta_por_personal_id: String(fd.get("personal_id") ?? "") || null });
            setCubriendo(false);
          }}
          className="mt-2 flex flex-wrap items-end gap-2 rounded bg-emerald-50 p-2"
        >
          <div>
            <label className={etiqueta}>Quién la cubre (Personal)</label>
            <select name="personal_id" className={campo} defaultValue="">
              <option value="">Todavía no está en Personal</option>
              {personal.filter((p) => p.activo).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiqueta}>Fecha</label>
            <input name="fecha_cierre" type="date" defaultValue={hoy} className={campo} />
          </div>
          <button className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white">Cubierta</button>
        </form>
      )}

      {abierta && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-1 text-xs font-medium text-slate-700">Candidatos</p>
          <table className="w-full text-xs">
            <tbody>
              {candidatos.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-1 pr-2">
                    {c.nombre}
                    <div className="text-[10px] text-slate-400">
                      {[c.telefono, c.correo, c.fuente].filter(Boolean).join(" · ")}
                      {c.notas && ` · ${c.notas}`}
                    </div>
                  </td>
                  <td className="py-1 text-right">
                    <select value={c.estatus} onChange={(e) => onCandidato(c.id, { estatus: e.target.value })} className="rounded border border-slate-300 px-1 py-0.5 text-xs">
                      {ESTATUS_CANDIDATO.map((s) => (
                        <option key={s.valor} value={s.valor}>
                          {s.etiqueta}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
              {candidatos.length === 0 && (
                <tr>
                  <td className="py-1 text-slate-400">Sin candidatos todavía.</td>
                </tr>
              )}
            </tbody>
          </table>
          <form onSubmit={onNuevoCandidato} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
            <input name="nombre" required placeholder="Nombre *" className={`${campo} col-span-2`} />
            <input name="telefono" placeholder="Teléfono" className={campo} />
            <input name="correo" placeholder="Correo" className={campo} />
            <input name="fuente" placeholder="Fuente (OCC, referido…)" className={campo} />
            <button className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">Agregar candidato</button>
            <input name="notas" placeholder="Notas" className={`${campo} col-span-2 sm:col-span-6`} />
          </form>
        </div>
      )}
    </div>
  );
}
