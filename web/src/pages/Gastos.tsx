import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../lib/supabase";
import { errorDeFuncion } from "../lib/funciones";
import { useAuth } from "../lib/auth";
import { dineroMx } from "../lib/kpisEmpresa";

/** Comprobación de gastos / caja chica: el supervisor sube la factura o nota
 * con monto y obra; finanzas recibe el aviso (push) y la aprueba, rechaza o
 * marca pagada desde aquí mismo. */
interface Comprobacion {
  id: string;
  empresa_id: string;
  empresa_codigo: string;
  empresa_nombre: string;
  proyecto_id: string | null;
  obra: string | null;
  supervisor_id: string;
  supervisor_nombre: string | null;
  tipo: "factura" | "nota" | "ticket";
  monto: number;
  fecha: string;
  concepto: string;
  proveedor: string | null;
  archivo_nombre: string | null;
  estatus: "enviada" | "aprobada" | "rechazada" | "pagada";
  revisado_por_nombre: string | null;
  revisado_en: string | null;
  comentario_revision: string | null;
  created_at: string;
}

const ESTILO_ESTATUS: Record<Comprobacion["estatus"], { color: string; etiqueta: string }> = {
  enviada: { color: "bg-amber-100 text-amber-800", etiqueta: "Por revisar" },
  aprobada: { color: "bg-emerald-100 text-emerald-800", etiqueta: "Aprobada" },
  rechazada: { color: "bg-red-100 text-red-800", etiqueta: "Rechazada" },
  pagada: { color: "bg-sky-100 text-sky-800", etiqueta: "Pagada" },
};

const REVISA = ["admin", "corporativo", "direccion"];

function useComprobaciones() {
  return useQuery({
    queryKey: ["comprobaciones-gasto"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_comprobaciones_gasto").select("*").order("created_at", { ascending: false }).limit(300);
      if (error) throw new Error(error.message);
      return (data ?? []) as Comprobacion[];
    },
  });
}

export function Gastos() {
  const { perfil, veTodasLasEmpresas } = useAuth();
  const queryClient = useQueryClient();
  const revisa = !!perfil && REVISA.includes(perfil.rol);
  const { data: lista, isLoading, error } = useComprobaciones();
  const [vista, setVista] = useState<"mias" | "revisar" | "todas">(revisa ? "revisar" : "mias");
  const [mensaje, setMensaje] = useState<string | null>(null);

  const { data: empresas } = useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; nombre: string }[];
    },
  });
  const [empresaId, setEmpresaId] = useState(perfil?.empresa_id ?? "");
  const { data: proyectos } = useQuery({
    queryKey: ["proyectos-activos", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("proyectos").select("id, nombre").eq("empresa_id", empresaId).eq("activo", true).order("nombre");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; nombre: string }[];
    },
  });

  const [enviando, setEnviando] = useState(false);
  async function onEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    setMensaje(null);
    setEnviando(true);
    try {
      const form = new FormData(formEl);
      form.set("empresaId", empresaId);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(urlFuncion("gastos-comprobar"), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const json = await respuesta.json();
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
      formEl.reset();
      setMensaje(json.enviados > 0 ? `Comprobación enviada. Aviso mandado a ${json.enviados} dispositivo(s) de finanzas.` : "Comprobación enviada. Finanzas la verá en su lista y en el KPI de comprobaciones.");
      queryClient.invalidateQueries({ queryKey: ["comprobaciones-gasto"] });
      queryClient.invalidateQueries({ queryKey: ["indicador"] });
    } catch (err) {
      setMensaje((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const revisar = useMutation({
    mutationFn: async (v: { id: string; estatus: Comprobacion["estatus"]; comentario?: string }) => {
      const { error } = await supabase
        .from("comprobaciones_gasto")
        .update({ estatus: v.estatus, revisado_por: perfil!.id, revisado_en: new Date().toISOString(), comentario_revision: v.comentario ?? null })
        .eq("id", v.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["comprobaciones-gasto"] }),
    onError: (e) => setMensaje((e as Error).message),
  });

  async function verArchivo(id: string) {
    const ventana = window.open("", "_blank");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(`${urlFuncion("gastos-comprobar")}?id=${id}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await respuesta.json();
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
      if (ventana) ventana.location.href = json.url;
      else window.location.href = json.url;
    } catch (err) {
      ventana?.close();
      setMensaje((err as Error).message);
    }
  }

  const filas = (lista ?? []).filter((c) => (vista === "mias" ? c.supervisor_id === perfil?.id : vista === "revisar" ? c.estatus === "enviada" : true));
  const totalFiltrado = filas.reduce((s, c) => s + Number(c.monto), 0);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Comprobación de gastos</h1>
      <p className="mb-4 text-sm text-slate-500">
        Caja chica y gastos de obra: sube la factura o nota con el monto y la obra. Finanzas recibe un aviso y la aprueba o rechaza aquí.
      </p>

      <form onSubmit={onEnviar} className="mb-6 grid grid-cols-1 gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-4">
          <p className="text-sm font-semibold text-slate-800">Nueva comprobación</p>
        </div>
        {veTodasLasEmpresas ? (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} required className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Empresa…</option>
            {(empresas ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        ) : (
          <p className="self-center text-xs text-slate-500">Empresa: la asignada a tu usuario.</p>
        )}
        <select name="proyectoId" className="rounded border border-slate-300 px-2 py-1.5 text-sm" defaultValue="">
          <option value="">Obra (proyecto)…</option>
          {(proyectos ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        <input name="obraTexto" placeholder="Obra (si no está en la lista)" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <select name="tipo" defaultValue="nota" className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="factura">Factura</option>
          <option value="nota">Nota</option>
          <option value="ticket">Ticket</option>
        </select>
        <input name="monto" type="number" step="0.01" min="0.01" required placeholder="Monto $" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <input name="fecha" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <input name="proveedor" placeholder="Proveedor / comercio" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <input name="concepto" required placeholder="Concepto (qué se compró y para qué)" className="rounded border border-slate-300 px-2 py-1.5 text-sm sm:col-span-2 lg:col-span-1" />
        <input name="file" type="file" accept="image/*,application/pdf" required className="text-sm sm:col-span-2" />
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-2">
          <button disabled={enviando || !empresaId} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {enviando ? "Enviando…" : "Enviar comprobación"}
          </button>
          <span className="text-xs text-slate-500">Foto de la nota o PDF de la factura, máximo 10 MB.</span>
        </div>
      </form>

      {mensaje && <p className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{mensaje}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded border border-slate-300">
          {revisa && (
            <button onClick={() => setVista("revisar")} className={`px-3 py-1.5 text-sm ${vista === "revisar" ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>
              Por revisar
            </button>
          )}
          <button onClick={() => setVista("mias")} className={`px-3 py-1.5 text-sm ${vista === "mias" ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>
            Mis comprobaciones
          </button>
          {revisa && (
            <button onClick={() => setVista("todas")} className={`px-3 py-1.5 text-sm ${vista === "todas" ? "bg-slate-900 text-white" : "bg-white text-slate-600"}`}>
              Todas
            </button>
          )}
        </div>
        <span className="text-xs text-slate-500">
          {filas.length} comprobación(es) · {dineroMx(totalFiltrado)}
        </span>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Supervisor</th>
              <th className="px-3 py-2">Empresa · obra</th>
              <th className="px-3 py-2">Concepto</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2">Estatus</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">{c.fecha}</td>
                <td className="px-3 py-2">{c.supervisor_nombre ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className="text-slate-500">{c.empresa_codigo}</span> · {c.obra ?? "sin obra"}
                </td>
                <td className="px-3 py-2">
                  <span className="rounded bg-slate-100 px-1 text-[10px] uppercase text-slate-500">{c.tipo}</span> {c.concepto}
                  {c.proveedor && <span className="block text-xs text-slate-500">{c.proveedor}</span>}
                  {c.comentario_revision && <span className="block text-xs text-red-700">{c.comentario_revision}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{dineroMx(Number(c.monto))}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${ESTILO_ESTATUS[c.estatus].color}`}>{ESTILO_ESTATUS[c.estatus].etiqueta}</span>
                  {c.revisado_por_nombre && <span className="block text-[11px] text-slate-400">{c.revisado_por_nombre}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                  <button onClick={() => verArchivo(c.id)} className="text-slate-600 underline">
                    ver archivo
                  </button>
                  {revisa && c.estatus === "enviada" && (
                    <>
                      {" · "}
                      <button onClick={() => revisar.mutate({ id: c.id, estatus: "aprobada" })} className="text-emerald-700 underline">
                        aprobar
                      </button>
                      {" · "}
                      <button
                        onClick={() => {
                          const motivo = window.prompt("Motivo del rechazo:") ?? "";
                          if (motivo.trim()) revisar.mutate({ id: c.id, estatus: "rechazada", comentario: motivo.trim() });
                        }}
                        className="text-red-700 underline"
                      >
                        rechazar
                      </button>
                    </>
                  )}
                  {revisa && c.estatus === "aprobada" && (
                    <>
                      {" · "}
                      <button onClick={() => revisar.mutate({ id: c.id, estatus: "pagada" })} className="text-sky-700 underline">
                        marcar pagada
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {filas.length === 0 && !isLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  Sin comprobaciones en esta vista.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
