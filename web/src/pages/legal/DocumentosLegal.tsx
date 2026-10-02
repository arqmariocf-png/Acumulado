import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { fechaCorta, llamarDocumentos, type DocumentoLegal } from "./comun";

/** Archivos de un asunto o de un contrato (demanda, acuerdos, convenio,
 * contrato firmado escaneado). Bucket privado; se ven con liga de 1 h. */
export function DocumentosLegal({ destino }: { destino: { asunto?: string; contrato?: string } }) {
  const { suscripcionPermiteEscribir, perfil } = useAuth();
  const queryClient = useQueryClient();
  const [descripcion, setDescripcion] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const clave = ["legal-documentos", destino.asunto ?? destino.contrato];

  const { data: docs, isLoading } = useQuery({
    queryKey: clave,
    queryFn: async () => ((await llamarDocumentos("GET", destino)).documentos ?? []) as DocumentoLegal[],
  });

  async function subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    setSubiendo(true);
    setMsg(null);
    try {
      for (const a of Array.from(archivos)) await llamarDocumentos("POST", destino, a, descripcion.trim() || undefined);
      setDescripcion("");
      queryClient.invalidateQueries({ queryKey: clave });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  async function borrar(id: string) {
    if (!confirm("¿Quitar este documento?")) return;
    const { error } = await supabase.from("legal_documentos").delete().eq("id", id);
    if (error) setMsg(error.message);
    else queryClient.invalidateQueries({ queryKey: clave });
  }

  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-slate-800">Documentos</h3>
      {suscripcionPermiteEscribir && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Qué es (opcional): demanda, acuerdo, convenio…" className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
          <label className={`cursor-pointer rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 ${subiendo ? "opacity-50" : ""}`}>
            {subiendo ? "Subiendo…" : "Subir archivo"}
            <input type="file" multiple accept=".pdf,image/*,.doc,.docx,.xls,.xlsx" className="hidden" disabled={subiendo} onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      )}
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {!isLoading && (docs ?? []).length === 0 && <p className="text-sm text-slate-400">Sin documentos.</p>}
      <ul className="divide-y divide-slate-100">
        {(docs ?? []).map((d) => (
          <li key={d.id} className="flex items-center gap-2 py-1 text-sm">
            {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-sky-700 hover:underline">{d.nombre ?? "documento"}</a> : <span>{d.nombre}</span>}
            {d.descripcion && <span className="text-xs text-slate-500">{d.descripcion}</span>}
            <span className="ml-auto text-xs text-slate-400">{d.subido_por_nombre} · {fechaCorta(d.created_at)}</span>
            {suscripcionPermiteEscribir && perfil?.rol === "admin" && <button type="button" onClick={() => borrar(d.id)} className="text-xs text-red-600 hover:underline">quitar</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
