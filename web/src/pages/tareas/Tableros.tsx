import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { Tablero } from "../../types/database";

const campoTexto = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiquetaCampo = "mb-1 block text-xs font-medium text-slate-700";

// Columnas por defecto de todo tablero nuevo -- el usuario las puede
// renombrar/agregar más después, esto solo evita empezar con un tablero
// vacío sin ningún lugar donde poner una tarjeta.
const COLUMNAS_INICIALES = ["Por hacer", "En progreso", "Hecho"];

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").eq("activo", true).order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

function useTableros() {
  return useQuery({
    queryKey: ["tableros"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tableros")
        .select("*, empresas(nombre)")
        .eq("archivado", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as (Tablero & { empresas: { nombre: string } | null })[];
    },
  });
}

export function Tableros() {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const { data: empresas } = useEmpresas();
  const { data: tableros, isLoading } = useTableros();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puedeCrear = perfil?.rol === "admin" || perfil?.rol === "corporativo";

  const crear = useMutation({
    mutationFn: async (payload: { nombre: string; descripcion: string; empresaId: string }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) throw new Error("Sesión expirada, vuelve a iniciar sesión.");

      const { data: tablero, error: errTablero } = await supabase
        .from("tableros")
        .insert({
          nombre: payload.nombre,
          descripcion: payload.descripcion || null,
          empresa_id: payload.empresaId || null,
          creado_por: userId,
        })
        .select("id")
        .single();
      if (errTablero) throw errTablero;

      const columnas = COLUMNAS_INICIALES.map((nombre, orden) => ({ tablero_id: tablero.id, nombre, orden }));
      const { error: errColumnas } = await supabase.from("tablero_columnas").insert(columnas);
      if (errColumnas) throw errColumnas;

      return tablero.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tableros"] });
      setMostrarForm(false);
    },
    onError: (err) => setError((err as Error).message),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    crear.mutate({
      nombre: String(fd.get("nombre") ?? "").trim(),
      descripcion: String(fd.get("descripcion") ?? "").trim(),
      empresaId: String(fd.get("empresa_id") ?? ""),
    });
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Tareas</h1>
        {puedeCrear && (
          <button onClick={() => setMostrarForm((v) => !v)} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            {mostrarForm ? "Cancelar" : "+ Nuevo tablero"}
          </button>
        )}
      </div>

      {mostrarForm && (
        <form onSubmit={onSubmit} className="mb-6 max-w-xl rounded border border-slate-200 bg-white p-4">
          <div className="mb-3">
            <label className={etiquetaCampo}>Nombre *</label>
            <input name="nombre" required className={campoTexto} placeholder="Ej. Ventas septiembre, Obra Cholula…" />
          </div>
          <div className="mb-3">
            <label className={etiquetaCampo}>Descripción</label>
            <input name="descripcion" className={campoTexto} />
          </div>
          <div className="mb-3">
            <label className={etiquetaCampo}>Empresa</label>
            <select name="empresa_id" className={campoTexto} defaultValue="">
              <option value="">Corporativo (visible a todas las empresas)</option>
              {empresas?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={crear.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {crear.isPending ? "Creando…" : "Crear tablero"}
          </button>
          {error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </form>
      )}

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tableros?.map((t) => (
          <Link key={t.id} to={`/tareas/${t.id}`} className="block rounded border border-slate-200 bg-white p-4 hover:border-slate-400 hover:shadow-sm">
            <h2 className="font-semibold text-slate-900">{t.nombre}</h2>
            <p className="mt-1 text-xs text-slate-500">{t.empresas?.nombre ?? "Corporativo · todas las empresas"}</p>
            {t.descripcion && <p className="mt-2 text-sm text-slate-600">{t.descripcion}</p>}
          </Link>
        ))}
        {tableros?.length === 0 && !isLoading && <p className="text-sm text-slate-400">No hay tableros todavía.</p>}
      </div>
    </div>
  );
}
