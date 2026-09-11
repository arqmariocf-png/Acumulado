import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import type { Proyecto, ProyectoPlano, PuCosteo, PuPrecioCliente, Tablero, TableroColumna, Tarjeta } from "../../types/database";

const campoTexto = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiquetaCampo = "mb-1 block text-xs font-medium text-slate-700";

type Tab = "planos" | "cotizacion" | "avance";

function useProyecto(id: string) {
  return useQuery({
    queryKey: ["proyecto-detalle", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("proyectos").select("*, empresas(nombre)").eq("id", id).single();
      if (error) throw error;
      return data as Proyecto & { empresas: { nombre: string } | null };
    },
  });
}

export function ProyectoDetalle() {
  const { id } = useParams<{ id: string }>();
  const { data: proyecto } = useProyecto(id!);
  const [tab, setTab] = useState<Tab>("planos");
  const [prellenado, setPrellenado] = useState<{ concepto: string; unidad: string } | null>(null);

  if (!proyecto) return <p className="text-sm text-slate-500">Cargando…</p>;

  const TABS: { clave: Tab; etiqueta: string }[] = [
    { clave: "planos", etiqueta: "Planos" },
    { clave: "cotizacion", etiqueta: "Cotización" },
    { clave: "avance", etiqueta: "Avance" },
  ];

  return (
    <div>
      <Link to="/proyectos" className="text-xs text-slate-500 hover:underline">
        ← Todos los proyectos
      </Link>
      <div className="mt-1 mb-4">
        <h1 className="text-xl font-semibold text-slate-900">{proyecto.nombre}</h1>
        <p className="text-xs text-slate-500">
          {proyecto.empresas?.nombre} {proyecto.cliente && `· Cliente: ${proyecto.cliente}`}
        </p>
      </div>

      <div className="mb-4 flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.clave}
            onClick={() => setTab(t.clave)}
            className={`border-b-2 px-3 py-2 text-sm ${tab === t.clave ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      {tab === "planos" && (
        <PestanaPlanos
          proyectoId={proyecto.id}
          onUsarConcepto={(c) => {
            setPrellenado(c);
            setTab("cotizacion");
          }}
        />
      )}
      {tab === "cotizacion" && <PestanaCotizacion proyecto={proyecto} prellenado={prellenado} onConsumirPrellenado={() => setPrellenado(null)} />}
      {tab === "avance" && <PestanaAvance proyecto={proyecto} />}
    </div>
  );
}

// ── Planos ────────────────────────────────────────────────────────────────

function usePlanos(proyectoId: string) {
  return useQuery({
    queryKey: ["proyecto-planos", proyectoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("proyecto_planos").select("*").eq("proyecto_id", proyectoId).order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProyectoPlano[];
    },
  });
}

interface ConceptoSugerido {
  concepto: string;
  unidad: string | null;
  cantidad: number | null;
  tipo: "material" | "mano_obra" | "no_determinado";
  fuente: string;
}

const ETIQUETA_TIPO_SUGERIDO: Record<ConceptoSugerido["tipo"], string> = {
  material: "Material",
  mano_obra: "Mano de obra",
  no_determinado: "Sin clasificar",
};

function PestanaPlanos({ proyectoId, onUsarConcepto }: { proyectoId: string; onUsarConcepto: (c: { concepto: string; unidad: string }) => void }) {
  const queryClient = useQueryClient();
  const { data: planos } = usePlanos(proyectoId);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analizandoId, setAnalizandoId] = useState<string | null>(null);
  const [resultadoIA, setResultadoIA] = useState<{ planoId: string; nombre: string; conceptos: ConceptoSugerido[]; advertencia: string } | null>(null);

  async function onAnalizarConIA(planoId: string, nombre: string) {
    setError(null);
    setResultadoIA(null);
    setAnalizandoId(planoId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(urlFuncion("plano-analizar-ia"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planoId }),
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      setResultadoIA({ planoId, nombre, conceptos: json.conceptos ?? [], advertencia: json.advertencia ?? "" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalizandoId(null);
    }
  }

  async function onSubir(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const input = formEl.elements.namedItem("file") as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;
    setError(null);
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("proyectoId", proyectoId);
      fd.append("file", archivo);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(urlFuncion("proyecto-archivos"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      formEl.reset();
      queryClient.invalidateQueries({ queryKey: ["proyecto-planos", proyectoId] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubiendo(false);
    }
  }

  async function onDescargar(planoId: string) {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(`${urlFuncion("proyecto-archivos")}?planoId=${planoId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      window.open(json.url, "_blank");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onBorrar(planoId: string) {
    if (!confirm("¿Borrar este plano?")) return;
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const respuesta = await fetch(urlFuncion("proyecto-archivos"), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planoId }),
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
      queryClient.invalidateQueries({ queryKey: ["proyecto-planos", proyectoId] });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <p className="mb-3 max-w-2xl text-xs text-slate-500">
        PDF se puede abrir directo en el navegador. DWG no tiene visor aquí -- se descarga tal cual para abrirlo en AutoCAD o el
        programa que uses.
      </p>
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <form onSubmit={onSubir} className="mb-4 flex gap-2">
        <input type="file" name="file" accept=".pdf,.dwg" className="flex-1 text-sm" />
        <button type="submit" disabled={subiendo} className="shrink-0 rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {subiendo ? "Subiendo…" : "Subir plano"}
        </button>
      </form>

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Archivo</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Subido</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {planos?.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <button onClick={() => onDescargar(p.id)} className="text-left text-slate-700 hover:underline">
                    {p.nombre_original}
                  </button>
                </td>
                <td className="px-3 py-2 uppercase text-slate-500">{p.tipo_archivo}</td>
                <td className="px-3 py-2 text-slate-500">{new Date(p.created_at).toLocaleDateString("es-MX")}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-3">
                    {p.tipo_archivo === "pdf" && (
                      <button
                        onClick={() => onAnalizarConIA(p.id, p.nombre_original)}
                        disabled={analizandoId === p.id}
                        className="text-xs text-slate-600 hover:underline disabled:opacity-50"
                      >
                        {analizandoId === p.id ? "Leyendo…" : "Analizar con IA"}
                      </button>
                    )}
                    <button onClick={() => onBorrar(p.id)} className="text-xs text-slate-400 hover:text-red-600">
                      Borrar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {planos?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                  Sin planos todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {resultadoIA && (
        <div className="mt-4 rounded border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Borrador de IA -- {resultadoIA.nombre}</h3>
            <button onClick={() => setResultadoIA(null)} className="text-xs text-slate-400 hover:text-slate-600">
              Cerrar
            </button>
          </div>
          {resultadoIA.advertencia && (
            <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{resultadoIA.advertencia}</p>
          )}
          <p className="mb-2 text-xs text-slate-500">
            Esto es solo una sugerencia leída del plano -- revisa y corrige antes de usarlo como cotización real.
          </p>
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Concepto</th>
                  <th className="px-3 py-2">Unidad</th>
                  <th className="px-3 py-2">Cantidad</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Fuente</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {resultadoIA.conceptos.map((c, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2">{c.concepto}</td>
                    <td className="px-3 py-2">{c.unidad ?? "—"}</td>
                    <td className="px-3 py-2">{c.cantidad ?? "sin anotar"}</td>
                    <td className="px-3 py-2 text-slate-500">{ETIQUETA_TIPO_SUGERIDO[c.tipo]}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{c.fuente}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onUsarConcepto({ concepto: c.concepto, unidad: c.unidad ?? "" })}
                        className="text-xs text-slate-600 hover:underline"
                      >
                        Usar →
                      </button>
                    </td>
                  </tr>
                ))}
                {resultadoIA.conceptos.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                      La IA no encontró conceptos con especificación escrita en este plano.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cotización ────────────────────────────────────────────────────────────

function usePreciosCliente(empresaId: string, cliente: string) {
  return useQuery({
    queryKey: ["pu-precios-cliente", empresaId, cliente],
    enabled: !!cliente,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pu_precios_cliente")
        .select("*")
        .eq("empresa_id", empresaId)
        .eq("cliente", cliente)
        .eq("activo", true)
        .order("concepto");
      if (error) throw error;
      return data as PuPrecioCliente[];
    },
  });
}

function useAnalisisDelProyecto(proyectoId: string) {
  return useQuery({
    queryKey: ["pu-analisis-proyecto", proyectoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_pu_analisis_costeo").select("*").eq("proyecto_id", proyectoId).order("codigo");
      if (error) throw error;
      return data as PuCosteo[];
    },
  });
}

function PestanaCotizacion({
  proyecto,
  prellenado,
  onConsumirPrellenado,
}: {
  proyecto: Proyecto;
  prellenado: { concepto: string; unidad: string } | null;
  onConsumirPrellenado: () => void;
}) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const [cliente, setCliente] = useState(proyecto.cliente ?? "");
  const { data: precios } = usePreciosCliente(proyecto.empresa_id, proyecto.cliente ?? "");
  const { data: analisis } = useAnalisisDelProyecto(proyecto.id);
  const [error, setError] = useState<string | null>(null);

  const puedeEscribirPu = perfil?.rol && ["corporativo", "empresa", "admin", "direccion"].includes(perfil.rol);

  const guardarCliente = useMutation({
    mutationFn: async (valor: string) => {
      const { error: err } = await supabase.from("proyectos").update({ cliente: valor || null }).eq("id", proyecto.id);
      if (err) throw err;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proyecto-detalle", proyecto.id] }),
    onError: (err) => setError((err as Error).message),
  });

  const agregarPrecio = useMutation({
    mutationFn: async (fd: FormData) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      const { error: err } = await supabase.from("pu_precios_cliente").insert({
        empresa_id: proyecto.empresa_id,
        cliente: proyecto.cliente,
        concepto: String(fd.get("concepto") ?? "").trim(),
        unidad: String(fd.get("unidad") ?? "").trim().toUpperCase(),
        precio_unitario: Number(fd.get("precio_unitario")),
        created_by: userId,
      });
      if (err) throw err;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pu-precios-cliente", proyecto.empresa_id, proyecto.cliente] }),
    onError: (err) => setError((err as Error).message),
  });

  return (
    <div>
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-4 max-w-md">
        <label className={etiquetaCampo}>Cliente de este proyecto</label>
        <div className="flex gap-2">
          <input value={cliente} onChange={(e) => setCliente(e.target.value)} className={campoTexto} placeholder="Nombre del cliente…" />
          {cliente !== (proyecto.cliente ?? "") && (
            <button onClick={() => guardarCliente.mutate(cliente)} className="shrink-0 rounded bg-slate-900 px-3 text-sm font-medium text-white">
              Guardar
            </button>
          )}
        </div>
      </div>

      {proyecto.cliente ? (
        <>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Catálogo de precios de {proyecto.cliente}</h3>
          <div className="mb-4 overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Concepto</th>
                  <th className="px-3 py-2">Unidad</th>
                  <th className="px-3 py-2 text-right">Precio</th>
                  <th className="px-3 py-2">Vigente desde</th>
                </tr>
              </thead>
              <tbody>
                {precios?.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{p.concepto}</td>
                    <td className="px-3 py-2">{p.unidad}</td>
                    <td className="px-3 py-2 text-right">${p.precio_unitario.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2 text-slate-500">{new Date(p.vigente_desde + "T00:00:00").toLocaleDateString("es-MX")}</td>
                  </tr>
                ))}
                {precios?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                      Sin precios capturados para este cliente.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {puedeEscribirPu && (
            <>
              {prellenado && (
                <p className="mb-2 max-w-2xl rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                  Concepto tomado del plano -- solo falta el precio.{" "}
                  <button onClick={onConsumirPrellenado} className="text-slate-400 hover:underline">
                    Quitar
                  </button>
                </p>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  agregarPrecio.mutate(new FormData(e.currentTarget));
                  (e.target as HTMLFormElement).reset();
                  onConsumirPrellenado();
                }}
                className="mb-6 grid max-w-2xl grid-cols-1 gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-4"
              >
                <input
                  key={`concepto-${prellenado?.concepto ?? ""}`}
                  name="concepto"
                  required
                  defaultValue={prellenado?.concepto ?? ""}
                  placeholder="Concepto"
                  className={`${campoTexto} sm:col-span-2`}
                />
                <input
                  key={`unidad-${prellenado?.unidad ?? ""}`}
                  name="unidad"
                  required
                  defaultValue={prellenado?.unidad ?? ""}
                  placeholder="Unidad"
                  className={campoTexto}
                />
                <div className="flex gap-2">
                  <input name="precio_unitario" required type="number" step="0.01" min="0" placeholder="Precio" className={campoTexto} />
                  <button type="submit" className="shrink-0 rounded bg-slate-900 px-3 text-sm font-medium text-white">
                    +
                  </button>
                </div>
              </form>
            </>
          )}
        </>
      ) : (
        <p className="mb-6 text-sm text-slate-500">Define el cliente de este proyecto para ver/capturar su catálogo de precios.</p>
      )}

      <h3 className="mb-2 text-sm font-semibold text-slate-700">Análisis de Precios Unitarios de este proyecto</h3>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Concepto</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Precio</th>
            </tr>
          </thead>
          <tbody>
            {analisis?.map((a) => (
              <tr key={a.analisis_id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <Link to={`/precios/${a.analisis_id}`} className="text-slate-700 hover:underline">
                    {a.codigo}
                  </Link>
                </td>
                <td className="px-3 py-2">{a.concepto}</td>
                <td className="px-3 py-2 text-slate-500">{a.estado}</td>
                <td className="px-3 py-2 text-right">${a.precio_unitario.toLocaleString("es-MX", { minimumFractionDigits: 2 })}</td>
              </tr>
            ))}
            {analisis?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-400">
                  Sin análisis de precio unitario todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Link to={`/precios?proyecto=${proyecto.id}`} className="mt-3 inline-block text-sm text-slate-700 hover:underline">
        + Nuevo análisis de precio unitario para este proyecto
      </Link>
    </div>
  );
}

// ── Avance (vía tablero de Tareas) ─────────────────────────────────────────

function useTablerosDelProyecto(proyectoId: string) {
  return useQuery({
    queryKey: ["tableros-proyecto", proyectoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tableros").select("*").eq("proyecto_id", proyectoId).eq("archivado", false);
      if (error) throw error;
      return data as Tablero[];
    },
  });
}

function PestanaAvance({ proyecto }: { proyecto: Proyecto }) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const { data: tableros, isLoading } = useTablerosDelProyecto(proyecto.id);
  const [error, setError] = useState<string | null>(null);

  const puedeAdministrar = perfil?.rol === "admin" || perfil?.rol === "corporativo";

  const crearTablero = useMutation({
    mutationFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      const { data: tablero, error: errTablero } = await supabase
        .from("tableros")
        .insert({ nombre: proyecto.nombre, empresa_id: proyecto.empresa_id, proyecto_id: proyecto.id, creado_por: userId })
        .select("id")
        .single();
      if (errTablero) throw errTablero;
      const columnas = ["Por hacer", "En progreso", "Hecho"].map((nombre, orden) => ({ tablero_id: tablero.id, nombre, orden }));
      const { error: errColumnas } = await supabase.from("tablero_columnas").insert(columnas);
      if (errColumnas) throw errColumnas;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tableros-proyecto", proyecto.id] }),
    onError: (err) => setError((err as Error).message),
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;

  return (
    <div>
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {tableros?.map((t) => (
        <ResumenTablero key={t.id} tablero={t} />
      ))}

      {tableros?.length === 0 &&
        (puedeAdministrar ? (
          <button onClick={() => crearTablero.mutate()} disabled={crearTablero.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {crearTablero.isPending ? "Creando…" : "Crear tablero de seguimiento"}
          </button>
        ) : (
          <p className="text-sm text-slate-500">Este proyecto todavía no tiene un tablero de Tareas para dar seguimiento a su avance.</p>
        ))}
    </div>
  );
}

function useResumenTablero(tableroId: string) {
  return useQuery({
    queryKey: ["tablero-resumen", tableroId],
    queryFn: async () => {
      const [columnas, tarjetas] = await Promise.all([
        supabase.from("tablero_columnas").select("*").eq("tablero_id", tableroId).order("orden"),
        supabase.from("tarjetas").select("*").eq("tablero_id", tableroId).eq("archivada", false),
      ]);
      if (columnas.error) throw columnas.error;
      if (tarjetas.error) throw tarjetas.error;
      return { columnas: columnas.data as TableroColumna[], tarjetas: tarjetas.data as Tarjeta[] };
    },
  });
}

function ResumenTablero({ tablero }: { tablero: Tablero }) {
  const { data } = useResumenTablero(tablero.id);
  const total = data?.tarjetas.length ?? 0;

  return (
    <div className="mb-4 rounded border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-slate-900">{tablero.nombre}</h3>
        <Link to={`/tareas/${tablero.id}`} className="text-sm text-slate-600 hover:underline">
          Ver tablero completo →
        </Link>
      </div>
      <div className="flex flex-wrap gap-3">
        {data?.columnas.map((c) => {
          const n = data.tarjetas.filter((t) => t.columna_id === c.id).length;
          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
          return (
            <div key={c.id} className="rounded bg-slate-50 px-3 py-2 text-sm">
              <p className="font-medium text-slate-700">{c.nombre}</p>
              <p className="text-slate-500">
                {n} tarjeta{n !== 1 ? "s" : ""} {total > 0 && `· ${pct}%`}
              </p>
            </div>
          );
        })}
        {total === 0 && <p className="text-sm text-slate-400">Sin tarjetas todavía.</p>}
      </div>
    </div>
  );
}
