import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { useAuth } from "../../lib/auth";
import type { Proyecto } from "../../types/database";

// Supervisión con IA (Mario, 28-sep-2026): las cinco ayudas del supervisor
// de obra sobre este proyecto. Cada corrida queda en la bitácora; de una
// minuta se pueden crear las tareas en el tablero de avance.

type Tipo = "reporte_diario" | "minuta" | "resumen_documento" | "comparativa_cotizaciones" | "avance_cliente";

const AYUDAS: { tipo: Tipo; titulo: string; descripcion: string; placeholder: string; boton: string }[] = [
  { tipo: "reporte_diario", titulo: "Reporte diario", descripcion: "Notas sueltas de campo (trabajos, retrasos, faltantes) → reporte diario ordenado.", placeholder: "Ej. Hoy colamos losa eje 3-5, faltó varilla 3/8, llegó tarde la revolvedora, 12 personas, pendiente firma de OC de acero…", boton: "Armar reporte diario" },
  { tipo: "minuta", titulo: "Minuta de reunión", descripcion: "Notas de la junta con subcontratista, cliente o dueño → acuerdos, responsables, fechas y preguntas abiertas. Las acciones se pueden mandar al tablero como tareas.", placeholder: "Ej. Junta con cliente 27-sep: aprueban cambio de cancelería, Mario entrega cotización el viernes, pendiente definir color de piso…", boton: "Armar minuta" },
  { tipo: "resumen_documento", titulo: "Resumen de hilo o documento", descripcion: "Un correo largo, un hilo de WhatsApp o una especificación → asunto, respuesta y pendientes en una cuartilla.", placeholder: "Pega aquí el hilo o el documento…", boton: "Resumir" },
  { tipo: "comparativa_cotizaciones", titulo: "Comparativa de cotizaciones", descripcion: "Dos o más cotizaciones pegadas como texto → tabla comparativa con alcances, exclusiones y recomendación.", placeholder: "Pega las cotizaciones una tras otra, con el nombre del proveedor antes de cada una…", boton: "Comparar" },
  { tipo: "avance_cliente", titulo: "Reporte de avance para el cliente", descripcion: "Toma solo los datos del proyecto (tareas, requerimientos, precios unitarios, control de obra) más tus notas → reporte de avance para el dueño.", placeholder: "Notas adicionales (opcional): lo que no está en el sistema, riesgos, lo que necesitas del cliente…", boton: "Armar reporte de avance" },
];

const ETIQUETA_TIPO: Record<Tipo, string> = { reporte_diario: "Reporte diario", minuta: "Minuta", resumen_documento: "Resumen", comparativa_cotizaciones: "Comparativa", avance_cliente: "Avance para el cliente" };

interface Accion {
  titulo: string;
  responsable: string | null;
  fecha_limite: string | null;
}

interface Bitacora {
  id: string;
  tipo: Tipo;
  entrada: string;
  salida: string;
  acciones: Accion[];
  created_at: string;
  profiles: { nombre: string } | null;
}

function useBitacora(proyectoId: string) {
  return useQuery({
    queryKey: ["bitacora-ia", proyectoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proyecto_bitacora_ia")
        .select("id, tipo, entrada, salida, acciones, created_at, profiles!proyecto_bitacora_ia_creado_por_fkey(nombre)")
        .eq("proyecto_id", proyectoId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as Bitacora[];
    },
  });
}

/** Markdown mínimo (encabezados ##, listas -, tablas |) sin librería. */
function Salida({ texto }: { texto: string }) {
  const lineas = texto.split("\n");
  const nodos: ReactNode[] = [];
  let tabla: string[][] = [];
  const cerrarTabla = () => {
    if (tabla.length === 0) return;
    const filas = tabla.filter((f) => !f.every((c) => /^:?-+:?$/.test(c.trim())));
    nodos.push(
      <table key={`t${nodos.length}`} className="my-2 w-full text-xs">
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className={i === 0 ? "bg-slate-50 font-medium" : "border-t border-slate-100"}>
              {f.map((c, j) => (
                <td key={j} className="px-2 py-1 align-top">
                  {c.trim()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>,
    );
    tabla = [];
  };
  for (const l of lineas) {
    if (l.trim().startsWith("|")) {
      tabla.push(l.trim().replace(/^\||\|$/g, "").split("|"));
      continue;
    }
    cerrarTabla();
    if (/^#{1,3}\s/.test(l)) nodos.push(<h4 key={nodos.length} className="mt-3 text-sm font-semibold text-slate-800">{l.replace(/^#+\s*/, "")}</h4>);
    else if (/^\s*[-*]\s/.test(l)) nodos.push(<li key={nodos.length} className="ml-4 list-disc text-sm text-slate-700">{l.replace(/^\s*[-*]\s*/, "")}</li>);
    else if (l.trim() === "") nodos.push(<div key={nodos.length} className="h-1" />);
    else nodos.push(<p key={nodos.length} className="text-sm text-slate-700">{l}</p>);
  }
  cerrarTabla();
  return <div>{nodos}</div>;
}

export function SupervisionIA({ proyecto }: { proyecto: Proyecto }) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const bitacora = useBitacora(proyecto.id);
  const [tipo, setTipo] = useState<Tipo>("reporte_diario");
  const [texto, setTexto] = useState("");
  const [resultado, setResultado] = useState<{ salida: string; acciones: Accion[]; aviso?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const ayuda = AYUDAS.find((a) => a.tipo === tipo)!;

  const generar = useMutation({
    mutationFn: async () => {
      const { data: sesion } = await supabase.auth.getSession();
      const token = sesion.session?.access_token;
      const respuesta = await fetch(urlFuncion("proyecto-supervision-ia"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ proyectoId: proyecto.id, tipo, texto }),
      });
      const json = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
      return json as { salida: string; acciones: Accion[]; aviso?: string };
    },
    onSuccess: (r) => {
      setError(null);
      setResultado(r);
      queryClient.invalidateQueries({ queryKey: ["bitacora-ia", proyecto.id] });
    },
    onError: (err) => setError((err as Error).message),
  });

  // Las acciones de una minuta se vuelven tarjetas en el tablero de avance
  // del proyecto (se crea uno si no existe), en la primera columna.
  const crearTareas = useMutation({
    mutationFn: async (acciones: Accion[]) => {
      if (!perfil) throw new Error("Sesión expirada");
      let { data: tableros } = await supabase.from("tableros").select("id").eq("proyecto_id", proyecto.id).eq("archivado", false).limit(1);
      if (!tableros || tableros.length === 0) {
        const { data: nuevo, error: e1 } = await supabase.from("tableros").insert({ nombre: `Avance · ${proyecto.nombre}`, empresa_id: proyecto.empresa_id, proyecto_id: proyecto.id, creado_por: perfil.id }).select("id").single();
        if (e1) throw e1;
        const { error: e2 } = await supabase.from("tablero_columnas").insert(["Por hacer", "En progreso", "Hecho"].map((nombre, orden) => ({ tablero_id: nuevo.id, nombre, orden })));
        if (e2) throw e2;
        tableros = [nuevo];
      }
      const tableroId = tableros[0].id;
      const { data: columnas, error: e3 } = await supabase.from("tablero_columnas").select("id").eq("tablero_id", tableroId).order("orden").limit(1);
      if (e3) throw e3;
      const columnaId = columnas?.[0]?.id;
      if (!columnaId) throw new Error("El tablero no tiene columnas");
      const { error: e4 } = await supabase.from("tarjetas").insert(
        acciones.map((a) => ({ tablero_id: tableroId, columna_id: columnaId, titulo: a.titulo, descripcion: a.responsable ? `Responsable según la minuta: ${a.responsable}` : null, fecha_limite: a.fecha_limite, creado_por: perfil.id })),
      );
      if (e4) throw e4;
      return { tableroId, n: acciones.length };
    },
    onSuccess: ({ n }) => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["tableros-proyecto", proyecto.id] });
      window.alert(`${n} tarea(s) creadas en el tablero de avance. Falta asignarles responsable desde el tablero.`);
    },
    onError: (err) => setError((err as Error).message),
  });

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">Las cinco ayudas del supervisor: pega tus notas y el sistema las ordena con el contexto de este proyecto. Todo queda en la bitácora de abajo. Revisa siempre el resultado antes de mandarlo; la IA no inventa datos, pero puede malinterpretar una nota.</p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        {AYUDAS.map((a) => (
          <button key={a.tipo} onClick={() => { setTipo(a.tipo); setResultado(null); setError(null); }} className={`rounded border px-3 py-2 text-left text-sm ${tipo === a.tipo ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
            <div className="font-medium">{a.titulo}</div>
            <div className={`mt-0.5 text-[11px] ${tipo === a.tipo ? "text-slate-300" : "text-slate-500"}`}>{a.descripcion}</div>
          </button>
        ))}
      </div>

      <div className="rounded border border-slate-200 bg-white p-4">
        <label className="mb-1 block text-xs font-medium text-slate-700">{ayuda.titulo}</label>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={tipo === "avance_cliente" ? 4 : 8} placeholder={ayuda.placeholder} className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button onClick={() => generar.mutate()} disabled={generar.isPending || (tipo !== "avance_cliente" && texto.trim().length < 10)} className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {generar.isPending ? "Procesando…" : ayuda.boton}
          </button>
          <span className="text-xs text-slate-400">{texto.length.toLocaleString("es-MX")} caracteres</span>
        </div>
        {error && <p className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      {resultado && (
        <div className="rounded border border-emerald-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">{ETIQUETA_TIPO[tipo]} · resultado</h3>
            <div className="flex gap-2">
              <button onClick={() => navigator.clipboard?.writeText(resultado.salida)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
                Copiar texto
              </button>
              {tipo === "minuta" && resultado.acciones.length > 0 && (
                <button onClick={() => crearTareas.mutate(resultado.acciones)} disabled={crearTareas.isPending} className="rounded border border-emerald-600 bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700 disabled:opacity-50">
                  Crear {resultado.acciones.length} tarea(s) en el tablero
                </button>
              )}
            </div>
          </div>
          {resultado.aviso && <p className="mb-2 text-xs text-amber-700">{resultado.aviso}</p>}
          <Salida texto={resultado.salida} />
        </div>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Bitácora de supervisión</h3>
        {bitacora.isPending && <p className="text-xs text-slate-500">Cargando…</p>}
        {bitacora.data && bitacora.data.length === 0 && <p className="text-xs text-slate-400">Todavía no hay reportes ni minutas de este proyecto.</p>}
        <ul className="divide-y divide-slate-100">
          {bitacora.data?.map((b) => (
            <li key={b.id} className="py-2">
              <button onClick={() => setAbierta(abierta === b.id ? null : b.id)} className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-sm">
                <span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{ETIQUETA_TIPO[b.tipo]}</span>
                  <span className="ml-2 text-slate-800">{b.salida.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.slice(0, 90) ?? "—"}</span>
                </span>
                <span className="text-xs text-slate-400">
                  {new Date(b.created_at).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · {b.profiles?.nombre ?? "—"}
                </span>
              </button>
              {abierta === b.id && (
                <div className="mt-2 rounded bg-slate-50 p-3">
                  <Salida texto={b.salida} />
                  {b.tipo === "minuta" && b.acciones.length > 0 && (
                    <button onClick={() => crearTareas.mutate(b.acciones)} disabled={crearTareas.isPending} className="mt-2 rounded border border-emerald-600 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                      Crear {b.acciones.length} tarea(s) en el tablero
                    </button>
                  )}
                  <details className="mt-2 text-xs text-slate-500">
                    <summary className="cursor-pointer">Ver notas originales</summary>
                    <pre className="mt-1 whitespace-pre-wrap font-sans">{b.entrada}</pre>
                  </details>
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-slate-400">
          Flujo semanal sugerido: reporte diario cada tarde, minuta después de cada junta, y el viernes el reporte de avance para el cliente. Las tareas van al <Link to="/tareas" className="underline">tablero de avance</Link>.
        </p>
      </section>
    </div>
  );
}
