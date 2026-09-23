import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { ESTATUS_PROYECTO } from "./estatus";
import type {
  Cotizacion,
  CotizacionPartida,
  CotizacionTotales,
  DisciplinaPlano,
  EstatusProyecto,
  Plano,
  Proyecto,
} from "../../types/database";

const DISCIPLINAS: DisciplinaPlano[] = [
  "arquitectonico",
  "estructural",
  "instalaciones",
  "acabados",
  "topografia",
  "otro",
];

const dinero = (n: number, moneda = "MXN") =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda }).format(n);

export function ProyectoDetalle() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { suscripcionPermiteEscribir, perfil } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  const { data: proyecto, isLoading } = useQuery({
    queryKey: ["proyecto", id],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("proyectos").select("*").eq("id", id).single();
      if (err) throw err;
      return data as Proyecto;
    },
  });

  const { data: planos } = useQuery({
    queryKey: ["planos", id],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("planos")
        .select("*")
        .eq("proyecto_id", id)
        .order("clave")
        .order("revision", { ascending: false });
      if (err) throw err;
      return data as Plano[];
    },
  });

  const { data: cotizaciones } = useQuery({
    queryKey: ["cotizaciones", id],
    queryFn: async () => {
      const [{ data: cots, error: errC }, { data: totales, error: errT }] = await Promise.all([
        supabase.from("cotizaciones").select("*").eq("proyecto_id", id).order("fecha", { ascending: false }),
        supabase.from("v_cotizacion_totales").select("*").eq("proyecto_id", id),
      ]);
      if (errC) throw errC;
      if (errT) throw errT;
      const porId = new Map((totales as CotizacionTotales[]).map((t) => [t.cotizacion_id, t]));
      return (cots as Cotizacion[]).map((c) => ({ ...c, totales: porId.get(c.id) }));
    },
  });

  const actualizarProyecto = useMutation({
    mutationFn: async (campos: Partial<Proyecto>) => {
      const { error: err } = await supabase.from("proyectos").update(campos).eq("id", id);
      if (err) throw err;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["proyecto", id] }),
    onError: (e: Error) => setError(e.message),
  });

  // El archivo del plano va a un bucket privado, bajo la carpeta de la
  // organización: esa ruta es la frontera que revisan las policies de storage
  // (ver 20260923090005_modulo_proyectos.sql).
  async function subirArchivo(plano: Plano, archivo: File) {
    if (!proyecto) return;
    setSubiendo(true);
    setError(null);
    const ruta = `${proyecto.grupo_id}/${proyecto.id}/${plano.clave}-${plano.revision}-${archivo.name}`;
    const { error: errSubida } = await supabase.storage.from("proyectos").upload(ruta, archivo, { upsert: true });
    if (errSubida) {
      setError(errSubida.message);
      setSubiendo(false);
      return;
    }
    const { error: errPlano } = await supabase.from("planos").update({ storage_path: ruta }).eq("id", plano.id);
    if (errPlano) setError(errPlano.message);
    queryClient.invalidateQueries({ queryKey: ["planos", id] });
    setSubiendo(false);
  }

  async function descargar(plano: Plano) {
    if (!plano.storage_path) return;
    // El bucket es privado: se pide una URL firmada de un solo uso en vez de
    // exponer el archivo públicamente.
    const { data, error: err } = await supabase.storage.from("proyectos").createSignedUrl(plano.storage_path, 60);
    if (err) {
      setError(err.message);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (!proyecto) return <p className="text-sm text-slate-500">No se encontró el proyecto.</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/proyectos" className="text-sm text-slate-500 underline">
          ← Proyectos
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">
            <span className="font-mono text-slate-400">{proyecto.clave}</span> {proyecto.nombre}
          </h1>
          <select
            value={proyecto.estatus}
            disabled={!suscripcionPermiteEscribir}
            onChange={(e) => actualizarProyecto.mutate({ estatus: e.target.value as EstatusProyecto })}
            className="rounded border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-400"
          >
            {ESTATUS_PROYECTO.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.etiqueta}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1 text-sm text-slate-500">{proyecto.cliente ?? "Sin cliente asignado"}</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <SeccionPlanos
        proyectoId={id}
        planos={planos ?? []}
        puedeEscribir={suscripcionPermiteEscribir}
        usuarioId={perfil?.id ?? null}
        subiendo={subiendo}
        onSubir={subirArchivo}
        onDescargar={descargar}
        onError={setError}
      />

      <SeccionCotizaciones
        proyectoId={id}
        cliente={proyecto.cliente}
        cotizaciones={cotizaciones ?? []}
        puedeEscribir={suscripcionPermiteEscribir}
        onError={setError}
      />
    </div>
  );
}

function SeccionPlanos({
  proyectoId,
  planos,
  puedeEscribir,
  usuarioId,
  subiendo,
  onSubir,
  onDescargar,
  onError,
}: {
  proyectoId: string;
  planos: Plano[];
  puedeEscribir: boolean;
  usuarioId: string | null;
  subiendo: boolean;
  onSubir: (plano: Plano, archivo: File) => void;
  onDescargar: (plano: Plano) => void;
  onError: (mensaje: string) => void;
}) {
  const queryClient = useQueryClient();
  const [clave, setClave] = useState("");
  const [nombre, setNombre] = useState("");
  const [disciplina, setDisciplina] = useState<DisciplinaPlano>("arquitectonico");
  const [revision, setRevision] = useState("A");

  const crear = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.from("planos").insert({
        proyecto_id: proyectoId,
        clave: clave.trim().toUpperCase(),
        nombre: nombre.trim(),
        disciplina,
        revision: revision.trim().toUpperCase(),
        subido_por: usuarioId,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setClave("");
      setNombre("");
      setRevision("A");
      queryClient.invalidateQueries({ queryKey: ["planos", proyectoId] });
    },
    onError: (e: Error) => onError(e.message),
  });

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h2 className="mb-3 font-medium text-slate-900">Planos</h2>
      <p className="mb-3 text-sm text-slate-500">
        Cada revisión de una lámina es un renglón propio: el historial de diseño se agrega, no se reescribe.
      </p>

      {puedeEscribir && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            crear.mutate();
          }}
          className="mb-4 flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col text-xs text-slate-500">
            Clave
            <input
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              required
              placeholder="A-01"
              className="mt-1 w-24 rounded border border-slate-300 px-2 py-1 font-mono text-sm uppercase"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Nombre
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              className="mt-1 w-64 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Disciplina
            <select
              value={disciplina}
              onChange={(e) => setDisciplina(e.target.value as DisciplinaPlano)}
              className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm"
            >
              {DISCIPLINAS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs text-slate-500">
            Revisión
            <input
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              required
              className="mt-1 w-16 rounded border border-slate-300 px-2 py-1 text-center font-mono text-sm uppercase"
            />
          </label>
          <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            Agregar plano
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Clave</th>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Disciplina</th>
              <th className="px-3 py-2">Rev.</th>
              <th className="px-3 py-2">Archivo</th>
            </tr>
          </thead>
          <tbody>
            {planos.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-3 py-2 font-mono text-xs">{p.clave}</td>
                <td className="px-3 py-2">{p.nombre}</td>
                <td className="px-3 py-2 text-slate-600">{p.disciplina}</td>
                <td className="px-3 py-2 text-center font-mono text-xs">{p.revision}</td>
                <td className="px-3 py-2">
                  {p.storage_path ? (
                    <button onClick={() => onDescargar(p)} className="text-sm text-slate-700 underline">
                      Abrir
                    </button>
                  ) : puedeEscribir ? (
                    <label className="cursor-pointer text-sm text-slate-500 underline">
                      {subiendo ? "Subiendo…" : "Subir archivo"}
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const archivo = e.target.files?.[0];
                          if (archivo) onSubir(p, archivo);
                        }}
                      />
                    </label>
                  ) : (
                    <span className="text-sm text-slate-400">Sin archivo</span>
                  )}
                </td>
              </tr>
            ))}
            {planos.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">
                  Todavía no hay planos en este proyecto.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SeccionCotizaciones({
  proyectoId,
  cliente,
  cotizaciones,
  puedeEscribir,
  onError,
}: {
  proyectoId: string;
  cliente: string | null;
  cotizaciones: (Cotizacion & { totales?: CotizacionTotales })[];
  puedeEscribir: boolean;
  onError: (mensaje: string) => void;
}) {
  const queryClient = useQueryClient();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [folio, setFolio] = useState("");

  const crear = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase
        .from("cotizaciones")
        .insert({ proyecto_id: proyectoId, folio: folio.trim().toUpperCase(), cliente });
      if (err) throw err;
    },
    onSuccess: () => {
      setFolio("");
      queryClient.invalidateQueries({ queryKey: ["cotizaciones", proyectoId] });
    },
    onError: (e: Error) => onError(e.message),
  });

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <h2 className="mb-3 font-medium text-slate-900">Cotizaciones</h2>

      {puedeEscribir && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            crear.mutate();
          }}
          className="mb-4 flex flex-wrap items-end gap-3"
        >
          <label className="flex flex-col text-xs text-slate-500">
            Folio
            <input
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              required
              placeholder="COT-001"
              className="mt-1 w-36 rounded border border-slate-300 px-2 py-1 font-mono text-sm uppercase"
            />
          </label>
          <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            Nueva cotización
          </button>
        </form>
      )}

      <div className="space-y-2">
        {cotizaciones.map((c) => (
          <div key={c.id} className="rounded border border-slate-100">
            <button
              onClick={() => setAbierta(abierta === c.id ? null : c.id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              <span>
                <span className="font-mono text-xs text-slate-400">{c.folio}</span>{" "}
                <span className="text-slate-500">· {c.estatus}</span>
              </span>
              <span className="font-medium text-slate-900">
                {c.totales ? dinero(Number(c.totales.total), c.moneda) : dinero(0, c.moneda)}
              </span>
            </button>
            {abierta === c.id && (
              <Partidas cotizacion={c} proyectoId={proyectoId} puedeEscribir={puedeEscribir} onError={onError} />
            )}
          </div>
        ))}
        {cotizaciones.length === 0 && <p className="text-sm text-slate-500">Todavía no hay cotizaciones.</p>}
      </div>
    </section>
  );
}

function Partidas({
  cotizacion,
  proyectoId,
  puedeEscribir,
  onError,
}: {
  cotizacion: Cotizacion & { totales?: CotizacionTotales };
  proyectoId: string;
  puedeEscribir: boolean;
  onError: (mensaje: string) => void;
}) {
  const queryClient = useQueryClient();
  const [concepto, setConcepto] = useState("");
  const [unidad, setUnidad] = useState("PZA");
  const [cantidad, setCantidad] = useState("1");
  const [precio, setPrecio] = useState("");

  const { data: partidas } = useQuery({
    queryKey: ["partidas", cotizacion.id],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("cotizacion_partidas")
        .select("*")
        .eq("cotizacion_id", cotizacion.id)
        .order("orden");
      if (err) throw err;
      return data as CotizacionPartida[];
    },
  });

  const agregar = useMutation({
    mutationFn: async () => {
      // El importe no se manda: lo calcula la base (columna generada), para
      // que no pueda quedar desalineado con cantidad × precio.
      const { error: err } = await supabase.from("cotizacion_partidas").insert({
        cotizacion_id: cotizacion.id,
        orden: (partidas?.length ?? 0) + 1,
        concepto: concepto.trim(),
        unidad: unidad.trim().toUpperCase(),
        cantidad: Number(cantidad),
        precio_unitario: Number(precio),
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setConcepto("");
      setPrecio("");
      setCantidad("1");
      queryClient.invalidateQueries({ queryKey: ["partidas", cotizacion.id] });
      queryClient.invalidateQueries({ queryKey: ["cotizaciones", proyectoId] });
    },
    onError: (e: Error) => onError(e.message),
  });

  const t = cotizacion.totales;

  return (
    <div className="border-t border-slate-100 px-3 py-3">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1">Concepto</th>
            <th className="py-1">Unidad</th>
            <th className="py-1 text-right">Cantidad</th>
            <th className="py-1 text-right">P. unitario</th>
            <th className="py-1 text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {partidas?.map((p) => (
            <tr key={p.id} className="border-t border-slate-50">
              <td className="py-1">{p.concepto}</td>
              <td className="py-1 text-slate-600">{p.unidad}</td>
              <td className="py-1 text-right">{Number(p.cantidad)}</td>
              <td className="py-1 text-right">{dinero(Number(p.precio_unitario), cotizacion.moneda)}</td>
              <td className="py-1 text-right">{dinero(Number(p.importe), cotizacion.moneda)}</td>
            </tr>
          ))}
        </tbody>
        {t && (
          <tfoot className="border-t border-slate-200 text-slate-700">
            <tr>
              <td colSpan={4} className="py-1 text-right">
                Subtotal
              </td>
              <td className="py-1 text-right">{dinero(Number(t.subtotal), cotizacion.moneda)}</td>
            </tr>
            <tr>
              <td colSpan={4} className="py-1 text-right">
                IVA
              </td>
              <td className="py-1 text-right">{dinero(Number(t.iva), cotizacion.moneda)}</td>
            </tr>
            <tr className="font-semibold text-slate-900">
              <td colSpan={4} className="py-1 text-right">
                Total
              </td>
              <td className="py-1 text-right">{dinero(Number(t.total), cotizacion.moneda)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {puedeEscribir && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            agregar.mutate();
          }}
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          <input
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            required
            placeholder="Concepto"
            className="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <input
            value={unidad}
            onChange={(e) => setUnidad(e.target.value)}
            className="w-20 rounded border border-slate-300 px-2 py-1 text-center text-sm uppercase"
          />
          <input
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            type="number"
            step="0.001"
            min="0.001"
            required
            className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm"
          />
          <input
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            required
            placeholder="0.00"
            className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm"
          />
          <button type="submit" className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100">
            Agregar partida
          </button>
        </form>
      )}
    </div>
  );
}
