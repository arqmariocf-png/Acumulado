import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";

export interface UbicacionChecador {
  id: string;
  nombre: string;
  tipo: "oficina" | "obra" | "planta" | "almacen" | "cliente" | "otro";
  lat: number;
  lng: number;
  radio_m: number;
  notas: string | null;
  activo: boolean;
}

export const TIPOS_UBICACION: { valor: UbicacionChecador["tipo"]; etiqueta: string }[] = [
  { valor: "oficina", etiqueta: "Oficina" },
  { valor: "obra", etiqueta: "Obra" },
  { valor: "planta", etiqueta: "Planta / fábrica" },
  { valor: "almacen", etiqueta: "Almacén" },
  { valor: "cliente", etiqueta: "Cliente" },
  { valor: "otro", etiqueta: "Otro" },
];

export function useUbicacionesChecador() {
  return useQuery({
    queryKey: ["checador-ubicaciones"],
    queryFn: async () => {
      const { data, error } = await supabase.from("checador_ubicaciones").select("*").order("activo", { ascending: false }).order("nombre");
      if (error) throw error;
      return data as UbicacionChecador[];
    },
  });
}

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";

/** Catálogo de sitios (oficina, obra, planta...) con radio en metros. Cada
 * marca del checador se clasifica sola al sitio más cercano dentro de su
 * radio; RH puede reclasificar las que quedaron sin sitio. */
export function UbicacionesChecador({ prellenado, onConsumirPrellenado }: { prellenado?: { lat: number; lng: number } | null; onConsumirPrellenado?: () => void }) {
  const queryClient = useQueryClient();
  const { data: ubicaciones, isLoading } = useUbicacionesChecador();
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(!!prellenado);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(prellenado ?? null);
  const [editando, setEditando] = useState<string | null>(null);

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["checador-ubicaciones"] });
    queryClient.invalidateQueries({ queryKey: ["rh-marcas-checador"] });
  };

  const crear = useMutation({
    mutationFn: async (fila: Omit<UbicacionChecador, "id" | "activo">) => {
      const { data: sesion } = await supabase.auth.getSession();
      const { error: err } = await supabase.from("checador_ubicaciones").insert({ ...fila, created_by: sesion.session?.user.id });
      if (err) throw err;
      const { data: n } = await supabase.rpc("checador_reclasificar_marcas");
      return Number(n ?? 0);
    },
    onSuccess: (n) => {
      setMensaje(`Sitio guardado. ${n} marca(s) sin sitio quedaron clasificadas.`);
      setMostrarForm(false);
      setCoords(null);
      onConsumirPrellenado?.();
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });

  const actualizar = useMutation({
    mutationFn: async (fila: Partial<UbicacionChecador> & { id: string }) => {
      const { id, ...cambios } = fila;
      const { error: err } = await supabase.from("checador_ubicaciones").update(cambios).eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => {
      setEditando(null);
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });

  const reclasificar = useMutation({
    mutationFn: async () => {
      const { data, error: err } = await supabase.rpc("checador_reclasificar_marcas");
      if (err) throw err;
      return Number(data ?? 0);
    },
    onSuccess: (n) => {
      setMensaje(`${n} marca(s) reclasificada(s).`);
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });

  function usarMiUbicacion() {
    setError(null);
    navigator.geolocation?.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError("No se pudo leer la ubicación de este dispositivo."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  function onCrear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMensaje(null);
    const fd = new FormData(e.currentTarget);
    const lat = Number(fd.get("lat"));
    const lng = Number(fd.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return setError("Captura latitud y longitud válidas (o usa tu ubicación).");
    crear.mutate({
      nombre: String(fd.get("nombre") ?? "").trim(),
      tipo: String(fd.get("tipo") ?? "obra") as UbicacionChecador["tipo"],
      lat,
      lng,
      radio_m: Number(fd.get("radio_m")) || 150,
      notas: String(fd.get("notas") ?? "").trim() || null,
    });
  }

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Sitios del checador (clasificación de ubicaciones)</h3>
          <p className="text-xs text-slate-500">Cada marca se asigna sola al sitio más cercano dentro de su radio. Da de alta oficinas, obras y plantas con su radio en metros.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => reclasificar.mutate()} disabled={reclasificar.isPending} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-50">
            Reclasificar marcas sin sitio
          </button>
          <button onClick={() => setMostrarForm((v) => !v)} className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white">
            {mostrarForm ? "Cancelar" : "+ Nuevo sitio"}
          </button>
        </div>
      </div>

      {mostrarForm && (
        <form onSubmit={onCrear} className="mb-3 grid grid-cols-2 gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-6">
          <div className="col-span-2">
            <label className={etiqueta}>Nombre *</label>
            <input name="nombre" required placeholder="Ej. Oficina Puebla, Obra Lomas" className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Tipo</label>
            <select name="tipo" defaultValue="obra" className={campo}>
              {TIPOS_UBICACION.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiqueta}>Latitud *</label>
            <input name="lat" type="number" step="any" required value={coords?.lat ?? ""} onChange={(e) => setCoords({ lat: Number(e.target.value), lng: coords?.lng ?? 0 })} className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Longitud *</label>
            <input name="lng" type="number" step="any" required value={coords?.lng ?? ""} onChange={(e) => setCoords({ lat: coords?.lat ?? 0, lng: Number(e.target.value) })} className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Radio (m)</label>
            <input name="radio_m" type="number" min="20" max="5000" defaultValue={150} className={campo} />
          </div>
          <div className="col-span-2 sm:col-span-4">
            <label className={etiqueta}>Notas</label>
            <input name="notas" className={campo} />
          </div>
          <div className="col-span-2 flex items-end gap-2">
            <button type="button" onClick={usarMiUbicacion} className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700">
              Usar mi ubicación
            </button>
            <button disabled={crear.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {crear.isPending ? "Guardando…" : "Guardar sitio"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mb-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {mensaje && <p className="mb-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Sitio</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Coordenadas</th>
              <th className="px-3 py-2 text-right">Radio</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {ubicaciones?.map((u) =>
              editando === u.id ? (
                <tr key={u.id} className="border-t border-slate-100 bg-slate-50">
                  <td className="px-3 py-2" colSpan={6}>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        actualizar.mutate({
                          id: u.id,
                          nombre: String(fd.get("nombre") ?? "").trim() || u.nombre,
                          tipo: String(fd.get("tipo")) as UbicacionChecador["tipo"],
                          radio_m: Number(fd.get("radio_m")) || u.radio_m,
                          notas: String(fd.get("notas") ?? "").trim() || null,
                        });
                      }}
                      className="grid grid-cols-2 gap-2 sm:grid-cols-6"
                    >
                      <input name="nombre" defaultValue={u.nombre} className={`${campo} col-span-2`} />
                      <select name="tipo" defaultValue={u.tipo} className={campo}>
                        {TIPOS_UBICACION.map((t) => (
                          <option key={t.valor} value={t.valor}>
                            {t.etiqueta}
                          </option>
                        ))}
                      </select>
                      <input name="radio_m" type="number" min="20" max="5000" defaultValue={u.radio_m} className={campo} />
                      <input name="notas" defaultValue={u.notas ?? ""} placeholder="Notas" className={campo} />
                      <div className="flex gap-2">
                        <button className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">Guardar</button>
                        <button type="button" onClick={() => setEditando(null)} className="text-xs text-slate-500 underline">
                          Cancelar
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={u.id} className={`border-t border-slate-100 ${u.activo ? "" : "text-slate-400"}`}>
                  <td className="px-3 py-2">
                    {u.nombre}
                    {u.notas && <div className="text-xs text-slate-400">{u.notas}</div>}
                  </td>
                  <td className="px-3 py-2">{TIPOS_UBICACION.find((t) => t.valor === u.tipo)?.etiqueta ?? u.tipo}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <a href={`https://maps.google.com/?q=${u.lat},${u.lng}`} target="_blank" rel="noreferrer" className="text-slate-700 hover:underline">
                      {u.lat.toFixed(5)}, {u.lng.toFixed(5)}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-right">{u.radio_m} m</td>
                  <td className="px-3 py-2">{u.activo ? "Activo" : "Inactivo"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                    <button onClick={() => setEditando(u.id)} className="mr-2 text-slate-700 underline">
                      Editar
                    </button>
                    <button onClick={() => actualizar.mutate({ id: u.id, activo: !u.activo })} className="text-slate-500 underline">
                      {u.activo ? "Desactivar" : "Activar"}
                    </button>
                  </td>
                </tr>
              ),
            )}
            {!isLoading && ubicaciones?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Todavía no hay sitios. Da de alta el primero o créalo desde una marca del checador.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
