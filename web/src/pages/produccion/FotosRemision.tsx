import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

interface FotoRemision {
  id: string;
  nombre: string | null;
  subido_por_nombre: string | null;
  created_at: string;
  url: string | null;
}

async function llamar(metodo: "GET" | "POST", remisionId: string, archivo?: File) {
  const { data: sesion } = await supabase.auth.getSession();
  const token = sesion.session?.access_token;
  const base = urlFuncion("remisiones-produccion-foto");
  let cuerpo: FormData | undefined;
  if (archivo) {
    cuerpo = new FormData();
    cuerpo.append("remisionId", remisionId);
    cuerpo.append("file", archivo);
  }
  const resp = await fetch(metodo === "GET" ? `${base}?id=${encodeURIComponent(remisionId)}` : base, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}` },
    body: cuerpo,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error ?? `Error ${resp.status}`);
  return json;
}

/** Foto del celular a JPEG de máximo 1600 px (pesa poco y el HEIC del iPhone
 * se vuelve legible en cualquier navegador). Un PDF se manda tal cual. */
async function aJpeg(archivo: File): Promise<File> {
  if (!archivo.type.startsWith("image/")) return archivo;
  try {
    const bitmap = await createImageBitmap(archivo);
    const escala = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(bitmap.width * escala);
    lienzo.height = Math.round(bitmap.height * escala);
    const ctx = lienzo.getContext("2d");
    if (!ctx) return archivo;
    ctx.drawImage(bitmap, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return archivo;
    return new File([blob], archivo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return archivo;
  }
}

/** Fotos de la entrega (o de la recepción) de una remisión de planta: se
 * ven desde la remisión con QR y se suben con la cámara del celular
 * (Mario, 30-sep-2026). */
export function FotosRemision({ remisionId }: { remisionId: string }) {
  const { soloConsulta } = useAuth();
  const queryClient = useQueryClient();
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: fotos, isLoading } = useQuery({
    queryKey: ["remision-produccion-fotos", remisionId],
    queryFn: async () => (await llamar("GET", remisionId)).fotos as FotoRemision[],
  });

  async function subir(lista: FileList | null) {
    if (!lista?.length) return;
    setError(null);
    setSubiendo(true);
    try {
      for (const original of Array.from(lista)) await llamar("POST", remisionId, await aJpeg(original));
      queryClient.invalidateQueries({ queryKey: ["remision-produccion-fotos", remisionId] });
      queryClient.invalidateQueries({ queryKey: ["remisiones-planta"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="mt-4 rounded border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">Fotos de la entrega</p>
        {!soloConsulta && (
          <label className={`cursor-pointer rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white ${subiendo ? "opacity-50" : ""}`}>
            {subiendo ? "Subiendo…" : "Tomar / subir foto"}
            <input type="file" accept="image/*,application/pdf" capture="environment" multiple disabled={subiendo} className="hidden" onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
          </label>
        )}
      </div>
      {isLoading ? (
        <p className="text-xs text-slate-400">Cargando fotos…</p>
      ) : !fotos?.length ? (
        <p className="text-xs text-slate-400">Sin fotos todavía.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {fotos.map((f) => (
            <a key={f.id} href={f.url ?? undefined} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-slate-200 bg-slate-50">
              {f.nombre?.toLowerCase().endsWith(".pdf") ? (
                <div className="flex h-32 items-center justify-center text-sm text-slate-600">PDF · {f.nombre}</div>
              ) : (
                <img src={f.url ?? undefined} alt={f.nombre ?? "Foto de la entrega"} className="h-32 w-full object-cover" />
              )}
              <p className="truncate px-2 py-1 text-[11px] text-slate-500">
                {f.subido_por_nombre ?? ""} · {new Date(f.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
              </p>
            </a>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
