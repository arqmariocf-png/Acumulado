import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { moneda } from "../../lib/saldosEmpresas";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import { DocumentosLegal } from "./DocumentosLegal";
import { ESTATUS_ASUNTO, TIPOS_ASUNTO, TIPOS_SEGUIMIENTO, diasPara, esCerrado, fechaCorta } from "./comun";

interface Asunto {
  id: string;
  empresa_id: string;
  folio: string | null;
  tipo: string;
  titulo: string;
  contraparte: string | null;
  autoridad: string | null;
  expediente: string | null;
  abogado: string | null;
  responsable_nombre: string | null;
  monto_en_riesgo: number | null;
  prioridad: "alta" | "media" | "baja";
  estatus: string;
  fecha_inicio: string | null;
  proxima_fecha: string | null;
  proxima_actuacion: string | null;
  descripcion: string | null;
  cerrado_en: string | null;
  created_at: string;
  empresas: { nombre: string; codigo: string } | null;
}

interface Seguimiento {
  id: string;
  fecha: string;
  tipo: string;
  nota: string;
  proxima_fecha: string | null;
  proxima_actuacion: string | null;
  autor_nombre: string | null;
  autor_id: string | null;
}

const VACIO = {
  tipo: "laboral",
  titulo: "",
  contraparte: "",
  autoridad: "",
  expediente: "",
  abogado: "",
  responsable_nombre: "",
  monto_en_riesgo: "",
  prioridad: "media",
  fecha_inicio: "",
  proxima_fecha: "",
  proxima_actuacion: "",
  descripcion: "",
};

const inp = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

function Semaforo({ fecha, estatus }: { fecha: string | null; estatus: string }) {
  if (esCerrado(estatus)) return <span className="text-xs text-slate-400">cerrado</span>;
  const d = diasPara(fecha);
  if (d == null) return <span className="text-xs text-slate-400">sin fecha</span>;
  const color = d < 0 ? "bg-red-100 text-red-800" : d <= 7 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800";
  const texto = d < 0 ? `vencida hace ${-d} d` : d === 0 ? "hoy" : `en ${d} d`;
  return <span className={`rounded px-1.5 py-0.5 text-xs ${color}`}>{fechaCorta(fecha)} · {texto}</span>;
}

/** Asuntos y juicios: lista con semáforo por la próxima actuación, alta,
 * detalle con bitácora y documentos. */
export function Asuntos() {
  const { suscripcionPermiteEscribir, perfil } = useAuth();
  const [empresa, setEmpresa] = useEmpresaFiltro();
  const [verCerrados, setVerCerrados] = useState(false);
  const [busca, setBusca] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const queryClient = useQueryClient();

  const { data: asuntos, isLoading, error } = useQuery({
    queryKey: ["legal-asuntos", empresa],
    queryFn: async () => {
      let q = supabase.from("legal_asuntos").select("*, empresas(nombre, codigo)").order("proxima_fecha", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
      if (empresa) q = q.eq("empresa_id", empresa);
      const { data, error: err } = await q;
      if (err) throw err;
      return (data ?? []) as Asunto[];
    },
  });

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (asuntos ?? []).filter(
      (a) => (verCerrados || !esCerrado(a.estatus)) && (!t || [a.folio, a.titulo, a.contraparte, a.expediente, a.autoridad, a.abogado].some((v) => (v ?? "").toLowerCase().includes(t))),
    );
  }, [asuntos, verCerrados, busca]);

  const abiertos = (asuntos ?? []).filter((a) => !esCerrado(a.estatus));
  const vencidos = abiertos.filter((a) => (diasPara(a.proxima_fecha) ?? 1) < 0).length;
  const semana = abiertos.filter((a) => {
    const d = diasPara(a.proxima_fecha);
    return d != null && d >= 0 && d <= 7;
  }).length;
  const riesgo = abiertos.reduce((s, a) => s + Number(a.monto_en_riesgo ?? 0), 0);

  const seleccionado = (asuntos ?? []).find((a) => a.id === abierto) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorEmpresa value={empresa} onChange={setEmpresa} />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar folio, asunto, contraparte, expediente…" className="min-w-[14rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={verCerrados} onChange={(e) => setVerCerrados(e.target.checked)} /> ver cerrados
        </label>
        {suscripcionPermiteEscribir && (
          <button type="button" onClick={() => setNuevo((v) => !v)} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            {nuevo ? "Cerrar" : "Nuevo asunto"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded border border-slate-200 bg-white p-2"><div className="text-xs text-slate-500">Abiertos</div><div className="text-lg font-semibold">{abiertos.length}</div></div>
        <div className="rounded border border-slate-200 bg-white p-2"><div className="text-xs text-slate-500">Fecha vencida</div><div className={`text-lg font-semibold ${vencidos ? "text-red-700" : ""}`}>{vencidos}</div></div>
        <div className="rounded border border-slate-200 bg-white p-2"><div className="text-xs text-slate-500">Actuación esta semana</div><div className={`text-lg font-semibold ${semana ? "text-amber-700" : ""}`}>{semana}</div></div>
        <div className="rounded border border-slate-200 bg-white p-2"><div className="text-xs text-slate-500">Monto en riesgo</div><div className="text-lg font-semibold">{moneda(riesgo)}</div></div>
      </div>

      {nuevo && <FormAsunto empresaInicial={empresa || perfil?.empresa_id || ""} onListo={(id) => { setNuevo(false); setAbierto(id); queryClient.invalidateQueries({ queryKey: ["legal-asuntos"] }); }} />}

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      {!isLoading && lista.length === 0 && <p className="text-sm text-slate-400">Sin asuntos {verCerrados ? "" : "abiertos "}para mostrar.</p>}

      {lista.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1.5">Folio</th>
                <th className="px-2 py-1.5">Asunto</th>
                <th className="px-2 py-1.5">Contraparte / autoridad</th>
                <th className="px-2 py-1.5">Estatus</th>
                <th className="px-2 py-1.5">Próxima actuación</th>
                <th className="px-2 py-1.5 text-right">En riesgo</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id} onClick={() => setAbierto(a.id === abierto ? null : a.id)} className={`cursor-pointer border-t border-slate-100 hover:bg-slate-50 ${a.id === abierto ? "bg-sky-50" : ""}`}>
                  <td className="px-2 py-1.5 font-mono text-xs">{a.folio}<div className="text-slate-400">{a.empresas?.codigo}</div></td>
                  <td className="px-2 py-1.5">
                    <div className="font-medium text-slate-900">{a.titulo}</div>
                    <div className="text-xs text-slate-500">{TIPOS_ASUNTO[a.tipo] ?? a.tipo}{a.expediente ? ` · exp. ${a.expediente}` : ""}{a.prioridad === "alta" ? " · prioridad alta" : ""}</div>
                  </td>
                  <td className="px-2 py-1.5 text-xs text-slate-600">{a.contraparte ?? "—"}<div className="text-slate-400">{a.autoridad}</div></td>
                  <td className="px-2 py-1.5 text-xs">{ESTATUS_ASUNTO[a.estatus] ?? a.estatus}</td>
                  <td className="px-2 py-1.5">
                    <Semaforo fecha={a.proxima_fecha} estatus={a.estatus} />
                    {a.proxima_actuacion && !esCerrado(a.estatus) && <div className="text-xs text-slate-500">{a.proxima_actuacion}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{a.monto_en_riesgo != null ? moneda(Number(a.monto_en_riesgo)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {seleccionado && <DetalleAsunto asunto={seleccionado} onCerrar={() => setAbierto(null)} />}
    </div>
  );
}

function FormAsunto({ empresaInicial, onListo }: { empresaInicial: string; onListo: (id: string) => void }) {
  const [f, setF] = useState({ ...VACIO, empresa_id: empresaInicial });
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const guardar = useMutation({
    mutationFn: async () => {
      if (!f.empresa_id) throw new Error("Elige la empresa");
      if (!f.titulo.trim()) throw new Error("Escribe de qué se trata el asunto");
      const fila = {
        empresa_id: f.empresa_id,
        tipo: f.tipo,
        titulo: f.titulo.trim(),
        contraparte: f.contraparte.trim() || null,
        autoridad: f.autoridad.trim() || null,
        expediente: f.expediente.trim() || null,
        abogado: f.abogado.trim() || null,
        responsable_nombre: f.responsable_nombre.trim() || null,
        monto_en_riesgo: f.monto_en_riesgo ? Number(f.monto_en_riesgo) : null,
        prioridad: f.prioridad,
        fecha_inicio: f.fecha_inicio || null,
        proxima_fecha: f.proxima_fecha || null,
        proxima_actuacion: f.proxima_actuacion.trim() || null,
        descripcion: f.descripcion.trim() || null,
      };
      const { data, error } = await supabase.from("legal_asuntos").insert(fila).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: onListo,
    onError: (e) => setMsg((e as Error).message),
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        guardar.mutate();
      }}
      className="grid gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-3"
    >
      <label className="text-xs text-slate-600">Empresa<SelectorEmpresa value={f.empresa_id} onChange={(v) => set("empresa_id", v)} vacio="Elige empresa…" className={inp} required /></label>
      <label className="text-xs text-slate-600">Tipo
        <select value={f.tipo} onChange={(e) => set("tipo", e.target.value)} className={inp}>
          {Object.entries(TIPOS_ASUNTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="text-xs text-slate-600">Prioridad
        <select value={f.prioridad} onChange={(e) => set("prioridad", e.target.value)} className={inp}>
          <option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option>
        </select>
      </label>
      <label className="text-xs text-slate-600 sm:col-span-3">Asunto<input value={f.titulo} onChange={(e) => set("titulo", e.target.value)} className={inp} placeholder="Ej. Demanda laboral de Juan Pérez" required /></label>
      <label className="text-xs text-slate-600">Contraparte<input value={f.contraparte} onChange={(e) => set("contraparte", e.target.value)} className={inp} /></label>
      <label className="text-xs text-slate-600">Autoridad / juzgado<input value={f.autoridad} onChange={(e) => set("autoridad", e.target.value)} className={inp} placeholder="Ej. Tribunal Laboral de Puebla" /></label>
      <label className="text-xs text-slate-600">Expediente<input value={f.expediente} onChange={(e) => set("expediente", e.target.value)} className={inp} /></label>
      <label className="text-xs text-slate-600">Abogado externo<input value={f.abogado} onChange={(e) => set("abogado", e.target.value)} className={inp} /></label>
      <label className="text-xs text-slate-600">Responsable interno<input value={f.responsable_nombre} onChange={(e) => set("responsable_nombre", e.target.value)} className={inp} /></label>
      <label className="text-xs text-slate-600">Monto en riesgo<input type="number" step="0.01" min="0" value={f.monto_en_riesgo} onChange={(e) => set("monto_en_riesgo", e.target.value)} className={inp} /></label>
      <label className="text-xs text-slate-600">Inicio<input type="date" value={f.fecha_inicio} onChange={(e) => set("fecha_inicio", e.target.value)} className={inp} /></label>
      <label className="text-xs text-slate-600">Próxima fecha<input type="date" value={f.proxima_fecha} onChange={(e) => set("proxima_fecha", e.target.value)} className={inp} /></label>
      <label className="text-xs text-slate-600">Próxima actuación<input value={f.proxima_actuacion} onChange={(e) => set("proxima_actuacion", e.target.value)} className={inp} placeholder="Ej. Audiencia de conciliación" /></label>
      <label className="text-xs text-slate-600 sm:col-span-3">Descripción<textarea value={f.descripcion} onChange={(e) => set("descripcion", e.target.value)} rows={2} className={inp} /></label>
      <div className="flex items-center gap-2 sm:col-span-3">
        <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">{guardar.isPending ? "Guardando…" : "Dar de alta"}</button>
        {msg && <span className="text-sm text-red-600">{msg}</span>}
      </div>
    </form>
  );
}

function DetalleAsunto({ asunto, onCerrar }: { asunto: Asunto; onCerrar: () => void }) {
  const { suscripcionPermiteEscribir, perfil } = useAuth();
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [nota, setNota] = useState({ fecha: new Date().toISOString().slice(0, 10), tipo: "nota", nota: "", proxima_fecha: "", proxima_actuacion: "" });

  const { data: bitacora } = useQuery({
    queryKey: ["legal-seguimiento", asunto.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("legal_seguimiento").select("id, fecha, tipo, nota, proxima_fecha, proxima_actuacion, autor_nombre, autor_id").eq("asunto_id", asunto.id).order("fecha", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Seguimiento[];
    },
  });

  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ["legal-seguimiento", asunto.id] });
    queryClient.invalidateQueries({ queryKey: ["legal-asuntos"] });
  };

  const cambiarEstatus = useMutation({
    mutationFn: async (estatus: string) => {
      const { error } = await supabase.from("legal_asuntos").update({ estatus }).eq("id", asunto.id);
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: (e) => setMsg((e as Error).message),
  });

  const agregar = useMutation({
    mutationFn: async () => {
      if (!nota.nota.trim()) throw new Error("Escribe qué pasó");
      const { error } = await supabase.from("legal_seguimiento").insert({
        asunto_id: asunto.id,
        fecha: nota.fecha,
        tipo: nota.tipo,
        nota: nota.nota.trim(),
        proxima_fecha: nota.proxima_fecha || null,
        proxima_actuacion: nota.proxima_actuacion.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNota((n) => ({ ...n, nota: "", proxima_fecha: "", proxima_actuacion: "" }));
      refrescar();
    },
    onError: (e) => setMsg((e as Error).message),
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("legal_seguimiento").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: (e) => setMsg((e as Error).message),
  });

  return (
    <div className="space-y-3 rounded border border-sky-200 bg-white p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1">
          <div className="font-mono text-xs text-slate-500">{asunto.folio} · {asunto.empresas?.nombre}</div>
          <h2 className="text-base font-semibold text-slate-900">{asunto.titulo}</h2>
          <div className="text-xs text-slate-600">
            {TIPOS_ASUNTO[asunto.tipo]} · {asunto.contraparte ?? "sin contraparte"}{asunto.autoridad ? ` · ${asunto.autoridad}` : ""}{asunto.expediente ? ` · exp. ${asunto.expediente}` : ""}
          </div>
          <div className="text-xs text-slate-500">
            {asunto.abogado ? `Abogado: ${asunto.abogado}` : ""}{asunto.responsable_nombre ? ` · Responsable: ${asunto.responsable_nombre}` : ""}{asunto.fecha_inicio ? ` · Desde ${fechaCorta(asunto.fecha_inicio)}` : ""}
          </div>
          {asunto.descripcion && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{asunto.descripcion}</p>}
        </div>
        <label className="text-xs text-slate-600">Estatus
          <select value={asunto.estatus} disabled={!suscripcionPermiteEscribir || cambiarEstatus.isPending} onChange={(e) => cambiarEstatus.mutate(e.target.value)} className="block rounded border border-slate-300 px-2 py-1 text-sm">
            {Object.entries(ESTATUS_ASUNTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button type="button" onClick={onCerrar} className="text-sm text-slate-500 hover:text-slate-900">Cerrar ✕</button>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      <div>
        <h3 className="mb-1 text-sm font-semibold text-slate-800">Bitácora</h3>
        {suscripcionPermiteEscribir && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setMsg(null);
              agregar.mutate();
            }}
            className="mb-2 grid gap-2 rounded bg-slate-50 p-2 sm:grid-cols-6"
          >
            <input type="date" value={nota.fecha} onChange={(e) => setNota({ ...nota, fecha: e.target.value })} className={inp} />
            <select value={nota.tipo} onChange={(e) => setNota({ ...nota, tipo: e.target.value })} className={inp}>
              {Object.entries(TIPOS_SEGUIMIENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input value={nota.nota} onChange={(e) => setNota({ ...nota, nota: e.target.value })} placeholder="Qué pasó" className={`${inp} sm:col-span-4`} />
            <label className="text-xs text-slate-600 sm:col-span-2">Siguiente fecha<input type="date" value={nota.proxima_fecha} onChange={(e) => setNota({ ...nota, proxima_fecha: e.target.value })} className={inp} /></label>
            <label className="text-xs text-slate-600 sm:col-span-3">Siguiente actuación<input value={nota.proxima_actuacion} onChange={(e) => setNota({ ...nota, proxima_actuacion: e.target.value })} className={inp} /></label>
            <div className="flex items-end"><button type="submit" disabled={agregar.isPending} className="w-full rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">Agregar</button></div>
          </form>
        )}
        {(bitacora ?? []).length === 0 && <p className="text-sm text-slate-400">Sin movimientos todavía.</p>}
        <ul className="divide-y divide-slate-100">
          {(bitacora ?? []).map((s) => (
            <li key={s.id} className="flex gap-2 py-1.5 text-sm">
              <span className="w-20 shrink-0 text-xs text-slate-500">{fechaCorta(s.fecha)}</span>
              <span className="w-24 shrink-0 text-xs font-medium text-slate-700">{TIPOS_SEGUIMIENTO[s.tipo] ?? s.tipo}</span>
              <span className="flex-1">
                {s.nota}
                {s.proxima_fecha && <span className="block text-xs text-slate-500">Siguiente: {fechaCorta(s.proxima_fecha)}{s.proxima_actuacion ? ` · ${s.proxima_actuacion}` : ""}</span>}
              </span>
              <span className="shrink-0 text-xs text-slate-400">{s.autor_nombre}</span>
              {suscripcionPermiteEscribir && (s.autor_id === perfil?.id || perfil?.rol === "admin") && (
                <button type="button" onClick={() => confirm("¿Borrar este movimiento?") && borrar.mutate(s.id)} className="text-xs text-red-600 hover:underline">borrar</button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <DocumentosLegal destino={{ asunto: asunto.id }} />
    </div>
  );
}
