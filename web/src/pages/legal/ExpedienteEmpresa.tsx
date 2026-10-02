import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import {
  ESTATUS_OBSERVACION,
  MOTIVOS_PROTOCOLIZACION,
  TIPOS_DOCUMENTO_EMPRESA,
  estadoVencimiento,
  etiquetaTipoDocumento,
  resumenExpediente,
  textoVencimiento,
  venceSugerido,
} from "../../lib/expedienteLegal";
import { fechaCorta } from "./comun";

interface DocumentoEmpresa {
  id: string;
  empresa_id: string;
  tipo: string;
  nombre: string;
  numero: string | null;
  fecha_documento: string | null;
  vence: string | null;
  notario: string | null;
  notas: string | null;
  storage_path: string | null;
  archivo_nombre: string | null;
  subido_por_nombre: string | null;
}

interface Observacion {
  id: string;
  tipo: "observacion" | "protocolizacion";
  titulo: string;
  motivo: string | null;
  detalle: string | null;
  estatus: string;
  fecha_limite: string | null;
  resuelto_en: string | null;
  autor_nombre: string | null;
  created_at: string;
}

const inp = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const hoy = () => new Date().toISOString().slice(0, 10);
const COLOR: Record<string, string> = {
  vencido: "bg-red-100 text-red-800",
  por_vencer: "bg-amber-100 text-amber-800",
  vigente: "bg-emerald-100 text-emerald-800",
  sin_vencimiento: "bg-slate-100 text-slate-600",
};

async function llamar(metodo: "GET" | "POST", params: { id: string; archivo?: File }) {
  const { data: sesion } = await supabase.auth.getSession();
  const base = urlFuncion("legal-documentos");
  let cuerpo: FormData | undefined;
  if (params.archivo) {
    cuerpo = new FormData();
    cuerpo.append("empresaDocumentoId", params.id);
    cuerpo.append("file", params.archivo);
  }
  const resp = await fetch(metodo === "GET" ? `${base}?empresaDocumento=${encodeURIComponent(params.id)}` : base, {
    method: metodo,
    headers: { Authorization: `Bearer ${sesion.session?.access_token}` },
    body: cuerpo,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error ?? `Error ${resp.status}`);
  return json;
}

/** Observaciones de legal sobre la empresa (con las actas por protocolizar y
 * su motivo) y expediente legal con vencimientos (Eréndira, 2-oct-2026). */
export function ExpedienteEmpresa({ empresaId }: { empresaId: string }) {
  const { data: docs } = useQuery({
    queryKey: ["legal-empresa-docs", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from("legal_empresa_documentos").select("*").eq("empresa_id", empresaId).order("vence", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as DocumentoEmpresa[];
    },
  });
  const { data: obs } = useQuery({
    queryKey: ["legal-empresa-obs", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from("legal_empresa_observaciones").select("*").eq("empresa_id", empresaId).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Observacion[];
    },
  });
  const r = resumenExpediente(docs ?? [], obs ?? [], hoy());

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Indicador titulo="Vencidos" valor={r.vencidos} alerta={r.vencidos > 0 ? "text-red-700" : ""} />
        <Indicador titulo="Vencen en 30 días" valor={r.porVencer} alerta={r.porVencer > 0 ? "text-amber-700" : ""} />
        <Indicador titulo="Vigentes / sin vencimiento" valor={r.vigentes} />
        <Indicador titulo="Sin archivo" valor={r.sinArchivo} alerta={r.sinArchivo > 0 ? "text-amber-700" : ""} />
        <Indicador titulo="Actas por protocolizar" valor={r.pendientesProtocolizar} alerta={r.pendientesProtocolizar > 0 ? "text-amber-700" : ""} />
      </div>
      <Observaciones empresaId={empresaId} lista={obs ?? []} />
      <Documentos empresaId={empresaId} lista={docs ?? []} />
    </div>
  );
}

function Indicador({ titulo, valor, alerta = "" }: { titulo: string; valor: number; alerta?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-2">
      <div className="text-xs text-slate-500">{titulo}</div>
      <div className={`text-lg font-semibold ${alerta}`}>{valor}</div>
    </div>
  );
}

function Observaciones({ empresaId, lista }: { empresaId: string; lista: Observacion[] }) {
  const { suscripcionPermiteEscribir } = useAuth();
  const queryClient = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [verCerradas, setVerCerradas] = useState(false);
  const [f, setF] = useState({ tipo: "protocolizacion", titulo: "", motivo: "", detalle: "", fecha_limite: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ["legal-empresa-obs", empresaId] });

  const guardar = useMutation({
    mutationFn: async () => {
      if (!f.titulo.trim()) throw new Error("Escribe la observación o el acta");
      const { error } = await supabase.from("legal_empresa_observaciones").insert({
        empresa_id: empresaId,
        tipo: f.tipo,
        titulo: f.titulo.trim(),
        motivo: f.motivo.trim() || null,
        detalle: f.detalle.trim() || null,
        fecha_limite: f.fecha_limite || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setF({ tipo: "protocolizacion", titulo: "", motivo: "", detalle: "", fecha_limite: "" });
      setAbierto(false);
      refrescar();
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const cambiar = useMutation({
    mutationFn: async ({ id, estatus }: { id: string; estatus: string }) => {
      const { error } = await supabase.from("legal_empresa_observaciones").update({ estatus }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: (e) => setMsg((e as Error).message),
  });

  const visibles = lista.filter((o) => verCerradas || o.estatus === "pendiente" || o.estatus === "en_notaria");
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Observaciones y actas por protocolizar</h3>
        <label className="flex items-center gap-1 text-xs text-slate-500">
          <input type="checkbox" checked={verCerradas} onChange={(e) => setVerCerradas(e.target.checked)} /> ver resueltas
        </label>
        {suscripcionPermiteEscribir && (
          <button type="button" onClick={() => setAbierto((v) => !v)} className="ml-auto rounded bg-slate-900 px-2.5 py-1 text-xs text-white">
            {abierto ? "Cerrar" : "Nueva observación"}
          </button>
        )}
      </div>
      {abierto && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            guardar.mutate();
          }}
          className="mb-3 grid gap-2 rounded bg-slate-50 p-2 sm:grid-cols-4"
        >
          <label className="text-xs text-slate-600">Tipo
            <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} className={inp}>
              <option value="protocolizacion">Acta por protocolizar</option>
              <option value="observacion">Observación</option>
            </select>
          </label>
          <label className="text-xs text-slate-600 sm:col-span-3">{f.tipo === "protocolizacion" ? "Acta" : "Observación"}
            <input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} className={inp} placeholder={f.tipo === "protocolizacion" ? "Ej. Acta de asamblea ordinaria del 15-mar-2026" : "Ej. El poder del administrador no incluye actos de dominio"} />
          </label>
          {f.tipo === "protocolizacion" && (
            <label className="text-xs text-slate-600 sm:col-span-2">Motivo de la protocolización
              <input list="motivos-protocolizacion" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} className={inp} placeholder="Elige o escribe el motivo" />
              <datalist id="motivos-protocolizacion">
                {MOTIVOS_PROTOCOLIZACION.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          )}
          <label className="text-xs text-slate-600">Fecha límite<input type="date" value={f.fecha_limite} onChange={(e) => setF({ ...f, fecha_limite: e.target.value })} className={inp} /></label>
          <label className={`text-xs text-slate-600 ${f.tipo === "protocolizacion" ? "" : "sm:col-span-3"}`}>Detalle<input value={f.detalle} onChange={(e) => setF({ ...f, detalle: e.target.value })} className={inp} /></label>
          <div className="sm:col-span-4">
            <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">Guardar</button>
          </div>
        </form>
      )}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {visibles.length === 0 && <p className="text-sm text-slate-400">Sin observaciones abiertas.</p>}
      <ul className="divide-y divide-slate-100">
        {visibles.map((o) => {
          const vencida = o.fecha_limite && (o.estatus === "pendiente" || o.estatus === "en_notaria") && o.fecha_limite < hoy();
          return (
            <li key={o.id} className="flex flex-wrap items-start gap-2 py-2 text-sm">
              <span className={`rounded px-1.5 py-0.5 text-xs ${o.tipo === "protocolizacion" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"}`}>{o.tipo === "protocolizacion" ? "Protocolizar" : "Observación"}</span>
              <span className="min-w-[12rem] flex-1">
                <span className="font-medium text-slate-900">{o.titulo}</span>
                {o.motivo && <span className="block text-xs text-slate-600">Motivo: {o.motivo}</span>}
                {o.detalle && <span className="block text-xs text-slate-500">{o.detalle}</span>}
                <span className="block text-xs text-slate-400">
                  {o.autor_nombre} · {fechaCorta(o.created_at)}
                  {o.fecha_limite ? ` · límite ${fechaCorta(o.fecha_limite)}` : ""}
                  {o.resuelto_en ? ` · resuelta ${fechaCorta(o.resuelto_en)}` : ""}
                </span>
                {vencida && <span className="block text-xs font-medium text-red-700">Ya pasó la fecha límite</span>}
              </span>
              <select value={o.estatus} disabled={!suscripcionPermiteEscribir} onChange={(e) => cambiar.mutate({ id: o.id, estatus: e.target.value })} className="rounded border border-slate-300 px-1.5 py-1 text-xs">
                {Object.entries(ESTATUS_OBSERVACION)
                  .filter(([k]) => (o.tipo === "protocolizacion" ? k !== "atendida" : k !== "en_notaria" && k !== "protocolizada"))
                  .map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
              </select>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const VACIO = { tipo: "opinion_sat", nombre: "", numero: "", fecha_documento: "", vence: "", notario: "", notas: "" };

function Documentos({ empresaId, lista }: { empresaId: string; lista: DocumentoEmpresa[] }) {
  const { suscripcionPermiteEscribir } = useAuth();
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState<DocumentoEmpresa | "nuevo" | null>(null);
  const [f, setF] = useState(VACIO);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ["legal-empresa-docs", empresaId] });

  function abrir(d: DocumentoEmpresa | "nuevo") {
    setMsg(null);
    setArchivo(null);
    setEditando(d);
    setF(
      d === "nuevo"
        ? VACIO
        : { tipo: d.tipo, nombre: d.nombre, numero: d.numero ?? "", fecha_documento: d.fecha_documento ?? "", vence: d.vence ?? "", notario: d.notario ?? "", notas: d.notas ?? "" },
    );
  }

  const guardar = useMutation({
    mutationFn: async () => {
      const nombre = f.nombre.trim() || etiquetaTipoDocumento(f.tipo);
      const fila = {
        empresa_id: empresaId,
        tipo: f.tipo,
        nombre,
        numero: f.numero.trim() || null,
        fecha_documento: f.fecha_documento || null,
        vence: f.vence || null,
        notario: f.notario.trim() || null,
        notas: f.notas.trim() || null,
      };
      let id: string;
      if (editando && editando !== "nuevo") {
        const { error } = await supabase.from("legal_empresa_documentos").update(fila).eq("id", editando.id);
        if (error) throw error;
        id = editando.id;
      } else {
        const { data, error } = await supabase.from("legal_empresa_documentos").insert(fila).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      if (archivo) await llamar("POST", { id, archivo });
    },
    onSuccess: () => {
      setEditando(null);
      refrescar();
    },
    onError: (e) => setMsg((e as Error).message),
  });

  async function ver(d: DocumentoEmpresa) {
    const ventana = window.open("", "_blank");
    try {
      const { url } = await llamar("GET", { id: d.id });
      if (ventana) ventana.location.replace(url);
      else window.open(url, "_blank");
    } catch (e) {
      ventana?.close();
      setMsg((e as Error).message);
    }
  }

  async function borrar(d: DocumentoEmpresa) {
    if (!confirm(`¿Quitar "${d.nombre}" del expediente?`)) return;
    const { error } = await supabase.from("legal_empresa_documentos").delete().eq("id", d.id);
    if (error) setMsg(error.message);
    else refrescar();
  }

  const visibles = lista.filter((d) => !filtro || d.tipo === filtro);
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Documentación legal y vencimientos</h3>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1 text-xs">
          <option value="">Todos los tipos</option>
          {TIPOS_DOCUMENTO_EMPRESA.map((t) => (
            <option key={t.clave} value={t.clave}>{t.etiqueta}</option>
          ))}
        </select>
        {suscripcionPermiteEscribir && (
          <button type="button" onClick={() => abrir("nuevo")} className="ml-auto rounded bg-slate-900 px-2.5 py-1 text-xs text-white">
            Agregar documento
          </button>
        )}
      </div>
      {editando && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            guardar.mutate();
          }}
          className="mb-3 grid gap-2 rounded bg-slate-50 p-2 sm:grid-cols-4"
        >
          <label className="text-xs text-slate-600">Tipo
            <select
              value={f.tipo}
              onChange={(e) => {
                const tipo = e.target.value;
                setF({ ...f, tipo, vence: f.vence || venceSugerido(tipo, f.fecha_documento || null) || "" });
              }}
              className={inp}
            >
              {TIPOS_DOCUMENTO_EMPRESA.map((t) => (
                <option key={t.clave} value={t.clave}>{t.etiqueta}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600 sm:col-span-2">Nombre / descripción<input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} className={inp} placeholder={etiquetaTipoDocumento(f.tipo)} /></label>
          <label className="text-xs text-slate-600">Número / folio<input value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} className={inp} /></label>
          <label className="text-xs text-slate-600">Fecha del documento
            <input
              type="date"
              value={f.fecha_documento}
              onChange={(e) => setF({ ...f, fecha_documento: e.target.value, vence: f.vence || venceSugerido(f.tipo, e.target.value || null) || "" })}
              className={inp}
            />
          </label>
          <label className="text-xs text-slate-600">Vence<input type="date" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} className={inp} /></label>
          <label className="text-xs text-slate-600 sm:col-span-2">Notario / autoridad que lo emite<input value={f.notario} onChange={(e) => setF({ ...f, notario: e.target.value })} className={inp} /></label>
          <label className="text-xs text-slate-600 sm:col-span-2">Notas<input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} className={inp} /></label>
          <label className="text-xs text-slate-600 sm:col-span-2">Archivo {editando !== "nuevo" && editando.archivo_nombre ? `(actual: ${editando.archivo_nombre})` : ""}
            <input type="file" accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="block w-full text-xs" />
          </label>
          <div className="flex items-center gap-2 sm:col-span-4">
            <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">{guardar.isPending ? "Guardando…" : "Guardar"}</button>
            <button type="button" onClick={() => setEditando(null)} className="text-xs text-slate-500">cancelar</button>
          </div>
        </form>
      )}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {visibles.length === 0 && <p className="text-sm text-slate-400">Sin documentos en el expediente.</p>}
      {visibles.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1.5">Documento</th>
                <th className="px-2 py-1.5">Número</th>
                <th className="px-2 py-1.5">Fecha</th>
                <th className="px-2 py-1.5">Vencimiento</th>
                <th className="px-2 py-1.5">Archivo</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((d) => {
                const { estado } = estadoVencimiento(d.vence, hoy());
                return (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="px-2 py-1.5">
                      <div className="font-medium text-slate-900">{d.nombre}</div>
                      <div className="text-xs text-slate-500">{etiquetaTipoDocumento(d.tipo)}{d.notario ? ` · ${d.notario}` : ""}{d.notas ? ` · ${d.notas}` : ""}</div>
                    </td>
                    <td className="px-2 py-1.5 text-xs">{d.numero ?? "—"}</td>
                    <td className="px-2 py-1.5 text-xs">{fechaCorta(d.fecha_documento)}</td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${COLOR[estado]}`}>{d.vence ? `${fechaCorta(d.vence)} · ` : ""}{textoVencimiento(d.vence, hoy())}</span>
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {d.storage_path ? (
                        <button type="button" onClick={() => ver(d)} className="text-sky-700 hover:underline">{d.archivo_nombre ?? "ver"}</button>
                      ) : (
                        <span className="text-amber-700">sin archivo</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs">
                      {suscripcionPermiteEscribir && (
                        <>
                          <button type="button" onClick={() => abrir(d)} className="mr-2 text-slate-700 hover:underline">Editar</button>
                          <button type="button" onClick={() => borrar(d)} className="text-red-600 hover:underline">Quitar</button>
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
