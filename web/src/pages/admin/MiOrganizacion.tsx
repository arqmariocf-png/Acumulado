import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

const TIPOS_PERMITIDOS = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const TAMANO_MAXIMO = 1024 * 1024; // 1 MB: es un logotipo de encabezado, no un render

// Marca de la organización: el nombre con el que se identifica en la interfaz
// y su logotipo. El archivo va al bucket público `branding`, bajo la carpeta
// de la propia organización -- que es la frontera que revisan las policies de
// storage (ver 20260923090006_branding_logotipo.sql).
export function MiOrganizacion() {
  const { grupo, logoUrl, recargarOrganizacion } = useAuth();
  const queryClient = useQueryClient();
  const [marca, setMarca] = useState(grupo?.marca_comercial ?? "");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  if (!grupo) return null;

  // Se fija en una constante ya estrechada: las funciones de abajo están
  // izadas y TypeScript no puede saber que el early return ya corrió.
  const org = grupo;

  async function guardarMarca() {
    setError(null);
    const { error: err } = await supabase
      .from("grupos")
      .update({ marca_comercial: marca.trim() || null })
      .eq("id", org.id);
    if (err) {
      setError(err.message);
      return;
    }
    setMensaje("Marca actualizada");
    await recargarOrganizacion();
    queryClient.invalidateQueries({ queryKey: ["admin-grupos"] });
  }

  async function subirLogo(archivo: File) {
    setError(null);
    setMensaje(null);

    if (!TIPOS_PERMITIDOS.includes(archivo.type)) {
      setError("El logotipo tiene que ser PNG, JPG, SVG o WebP.");
      return;
    }
    if (archivo.size > TAMANO_MAXIMO) {
      setError("El logotipo no puede pesar más de 1 MB.");
      return;
    }

    setSubiendo(true);
    const extension = archivo.name.split(".").pop()?.toLowerCase() ?? "png";
    // Ruta fija por organización: subir un logotipo nuevo reemplaza al
    // anterior en vez de ir dejando archivos huérfanos en el bucket.
    const ruta = `${org.id}/logo.${extension}`;

    const { error: errSubida } = await supabase.storage.from("branding").upload(ruta, archivo, {
      upsert: true,
      contentType: archivo.type,
    });
    if (errSubida) {
      setError(errSubida.message);
      setSubiendo(false);
      return;
    }

    const { error: errGrupo } = await supabase.from("grupos").update({ logo_path: ruta }).eq("id", org.id);
    if (errGrupo) setError(errGrupo.message);
    else setMensaje("Logotipo actualizado");

    await recargarOrganizacion();
    setSubiendo(false);
  }

  async function quitarLogo() {
    setError(null);
    const { error: err } = await supabase.from("grupos").update({ logo_path: null }).eq("id", org.id);
    if (err) setError(err.message);
    else setMensaje("Se quitó el logotipo");
    await recargarOrganizacion();
  }

  return (
    <div className="max-w-2xl space-y-6">
      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-medium text-slate-900">Nombre en la interfaz</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-slate-500">
            Marca comercial
            <input
              value={marca}
              onChange={(e) => setMarca(e.target.value)}
              placeholder={grupo.nombre}
              className="mt-1 w-72 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
            />
          </label>
          <button onClick={guardarMarca} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            Guardar
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Es lo que se muestra en el encabezado cuando no hay logotipo. Vacío = se usa la razón social ({grupo.nombre}).
        </p>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-medium text-slate-900">Logotipo</h2>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex h-20 w-48 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50">
            {logoUrl ? (
              <img src={logoUrl} alt="Logotipo" className="max-h-16 max-w-[176px] object-contain" />
            ) : (
              <span className="text-xs text-slate-400">Sin logotipo</span>
            )}
          </div>
          <div className="space-y-2">
            <label className="inline-block cursor-pointer rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
              {subiendo ? "Subiendo…" : "Subir logotipo"}
              <input
                type="file"
                accept={TIPOS_PERMITIDOS.join(",")}
                className="hidden"
                onChange={(e) => {
                  const archivo = e.target.files?.[0];
                  if (archivo) void subirLogo(archivo);
                }}
              />
            </label>
            {logoUrl && (
              <button onClick={quitarLogo} className="block text-sm text-slate-500 underline">
                Quitar logotipo
              </button>
            )}
            <p className="text-xs text-slate-500">PNG, JPG, SVG o WebP, hasta 1 MB. Se ve mejor un logo horizontal.</p>
          </div>
        </div>
      </section>

      {mensaje && <p className="text-sm text-emerald-700">{mensaje}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
