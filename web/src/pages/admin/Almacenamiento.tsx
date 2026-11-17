import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { errorDeFuncion } from "../../lib/funciones";
import { comprimirImagen, comprimirPdfEscaneado } from "../../lib/comprimirArchivo";
import { ahorroEstimado, CARPETAS_NOMBRE, ladoParaCarpeta, mb, ordenarCandidatos, textoAvance, type AvanceRecompresion, type Candidato, type CarpetaResumen } from "../../lib/almacenamiento";

// Sistemas › Almacenamiento (17-nov-2026, Mario: "ajusta todos al mínimo"):
// cuánto pesa cada carpeta del bucket y botón para recomprimir lo ya guardado
// con la misma regla que al subir. El trabajo pesado (dibujar páginas, reducir
// fotos) corre AQUÍ, en el navegador del director general; la edge
// `archivos-recomprimir` solo firma la descarga y reemplaza el archivo en la
// misma ruta si lo nuevo pesa menos. Se puede detener en cualquier momento.

interface Resumen {
  total: { archivos: number; bytes: number };
  carpetas: CarpetaResumen[];
  en: string;
}

async function token() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

async function llamarGet<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${urlFuncion("archivos-recomprimir")}?${qs}`, { headers: { Authorization: `Bearer ${await token()}` } });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw await errorDeFuncion(r, json);
  return json as T;
}

export function Almacenamiento() {
  const { esAdminGlobal } = useAuth();
  const qc = useQueryClient();
  const [carpetaEnCurso, setCarpetaEnCurso] = useState<string | null>(null);
  const [avance, setAvance] = useState<AvanceRecompresion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detener = useRef(false);

  const resumen = useQuery({
    queryKey: ["almacenamiento", "resumen"],
    enabled: esAdminGlobal,
    queryFn: () => llamarGet<{ resumen: Resumen }>({ accion: "resumen" }).then((r) => r.resumen),
  });

  if (!esAdminGlobal) return <p className="p-8 text-center text-sm text-slate-500">Solo el director general administra el almacenamiento.</p>;

  async function recomprimir(carpeta: string) {
    setError(null);
    detener.current = false;
    setCarpetaEnCurso(carpeta);
    const estado: AvanceRecompresion = { hechos: 0, total: 0, ahorrados: 0, sinCambio: 0, errores: [] };
    setAvance({ ...estado });
    try {
      const { candidatos } = await llamarGet<{ candidatos: Candidato[] }>({ accion: "candidatos", carpeta, limite: "2000" });
      const lista = ordenarCandidatos(candidatos);
      estado.total = lista.length;
      setAvance({ ...estado });
      const lado = ladoParaCarpeta(carpeta);
      for (const c of lista) {
        if (detener.current) break;
        try {
          const { url } = await llamarGet<{ url: string }>({ accion: "url", ruta: c.ruta });
          const r = await fetch(url);
          if (!r.ok) throw new Error(`no se pudo bajar (${r.status})`);
          const blob = await r.blob();
          const nombre = c.ruta.split("/").pop() ?? "archivo";
          const original = new File([blob], nombre, { type: c.mime ?? blob.type });
          const esImagen = (c.mime ?? "").startsWith("image/");
          const nuevo = esImagen ? await comprimirImagen(original, lado) : await comprimirPdfEscaneado(original);
          if (nuevo === original || nuevo.size >= original.size) {
            estado.sinCambio++;
          } else {
            const fd = new FormData();
            fd.append("ruta", c.ruta);
            fd.append("file", nuevo, nombre);
            const resp = await fetch(urlFuncion("archivos-recomprimir"), { method: "POST", headers: { Authorization: `Bearer ${await token()}` }, body: fd });
            const json = await resp.json().catch(() => null);
            if (resp.status === 409) estado.sinCambio++;
            else if (!resp.ok) throw await errorDeFuncion(resp, json);
            else estado.ahorrados += Math.max(0, Number(json?.antes ?? original.size) - Number(json?.despues ?? nuevo.size));
          }
        } catch (e) {
          estado.errores.push(`${c.ruta.split("/").pop()}: ${(e as Error).message}`);
        }
        estado.hechos++;
        setAvance({ ...estado });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCarpetaEnCurso(null);
      qc.invalidateQueries({ queryKey: ["almacenamiento"] });
    }
  }

  const r = resumen.data;
  const carpetas = r?.carpetas ?? [];
  const ahorroTotal = carpetas.reduce((s, c) => s + ahorroEstimado(c), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-800">Almacenamiento</h1>
        <p className="text-sm text-slate-600">
          Lo que pesa cada carpeta de archivos del sistema. Desde el 17-nov-2026 todo lo que se sube (fotos y PDF escaneados) se comprime solo; aquí se recomprime lo que ya estaba guardado, con la misma regla y sin mover nada de lugar.
        </p>
      </header>

      {resumen.isLoading && <p className="text-sm text-slate-500">Midiendo…</p>}
      {resumen.error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{(resumen.error as Error).message}</p>}
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      {r && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tarjeta titulo="Total guardado" valor={mb(r.total.bytes)} sub={`${r.total.archivos.toLocaleString("es-MX")} archivos`} />
            <Tarjeta titulo="Se puede liberar (estimado)" valor={`~${mb(ahorroTotal)}`} sub="recomprimiendo lo ya guardado" />
            <Tarjeta titulo="No se toca" valor={mb(carpetas.filter((c) => !c.recomprimible).reduce((s, c) => s + c.bytes, 0))} sub="estados de cuenta, SAT, CFDI, planos, Excel" />
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500">
                <th className="py-2">Carpeta</th>
                <th className="text-right">Archivos</th>
                <th className="text-right">Peso</th>
                <th className="text-right">Por recomprimir</th>
                <th className="text-right">Liberaría</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {carpetas.map((c) => (
                <tr key={c.carpeta} className="border-b border-slate-100">
                  <td className="py-2">
                    <div className="font-medium text-slate-800">{CARPETAS_NOMBRE[c.carpeta] ?? c.carpeta}</div>
                    <div className="text-xs text-slate-500">
                      {c.carpeta} · {c.imagenes} fotos · {c.pdfs} PDF
                      {!c.recomprimible && " · no se toca"}
                    </div>
                  </td>
                  <td className="text-right">{c.archivos.toLocaleString("es-MX")}</td>
                  <td className="text-right font-medium">{mb(c.bytes)}</td>
                  <td className="text-right">{c.recomprimible ? `${c.candidatos} · ${mb(c.bytes_candidatos)}` : "—"}</td>
                  <td className="text-right text-emerald-700">{c.recomprimible && c.candidatos > 0 ? `~${mb(ahorroEstimado(c))}` : "—"}</td>
                  <td className="text-right">
                    {c.recomprimible && c.candidatos > 0 && (
                      <button
                        type="button"
                        disabled={carpetaEnCurso !== null}
                        onClick={() => recomprimir(c.carpeta)}
                        className="rounded bg-slate-800 px-3 py-1 text-xs text-white disabled:opacity-40"
                      >
                        Recomprimir {c.candidatos}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {avance && (
        <section className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium text-slate-800">{carpetaEnCurso ? `Recomprimiendo ${CARPETAS_NOMBRE[carpetaEnCurso] ?? carpetaEnCurso}…` : "Terminado"}</div>
              <div className="text-slate-600">{textoAvance(avance)}</div>
            </div>
            {carpetaEnCurso && (
              <button type="button" onClick={() => (detener.current = true)} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs">
                Detener
              </button>
            )}
          </div>
          {avance.total > 0 && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded bg-slate-200">
              <div className="h-2 bg-emerald-500 transition-all" style={{ width: `${Math.round((avance.hechos / avance.total) * 100)}%` }} />
            </div>
          )}
          {avance.errores.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-red-700">
              {avance.errores.slice(0, 20).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
              {avance.errores.length > 20 && <li>… y {avance.errores.length - 20} más</li>}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">No cierres esta pestaña mientras corre. Cada archivo se baja, se comprime aquí y se reemplaza en su misma ruta solo si queda más chico; si no, se deja como estaba.</p>
        </section>
      )}

      <section className="rounded border border-slate-200 p-3 text-sm text-slate-700">
        <h2 className="font-medium text-slate-800">Qué se comprime y qué no</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>Fotos: máximo 1600 px en JPEG (selfies del checador: 800 px). Una foto de celular de 3-5 MB queda en unos 300 KB.</li>
          <li>PDF escaneados (sin texto seleccionable) de más de 1.5 MB: cada página a 130 dpi. Un expediente de 5 MB queda en menos de 1 MB.</li>
          <li>No se tocan: estados de cuenta, descargas del SAT, CFDI, planos de obra (DWG/PDF), Excel, ni ningún PDF con texto.</li>
        </ul>
      </section>
    </div>
  );
}

function Tarjeta({ titulo, valor, sub }: { titulo: string; valor: string; sub: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="text-xs uppercase text-slate-500">{titulo}</div>
      <div className="text-2xl font-semibold text-slate-800">{valor}</div>
      <div className="text-xs text-slate-500">{sub}</div>
    </div>
  );
}
