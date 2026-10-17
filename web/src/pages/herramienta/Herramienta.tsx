import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import { CampoBuscador } from "../../components/CampoBuscador";
import { abrirParaImprimir, abrirVentanaImpresion } from "../../lib/imprimir";
import {
  CLASE_ESTADO,
  CLASE_SOLICITUD,
  ETIQUETA_CATEGORIA,
  ETIQUETA_ESTADO,
  ETIQUETA_MOVIMIENTO,
  ETIQUETA_SOLICITUD,
  conteoPorEstado,
  faltaPorSurtir,
  filtrarHerramientas,
  htmlEtiquetas,
  htmlResguardo,
  resumenPorObra,
  semaforoDevolucion,
  sugerirParaRenglon,
  type CategoriaHerramienta,
  type CondicionHerramienta,
  type EstadoHerramienta,
  type EstadoSolicitudHerramienta,
  type Herramienta as Pieza,
  type TipoMovimientoHerramienta,
} from "../../lib/herramientas";
import type { Profile } from "../../types/database";

// Herramienta y equipo del almacén (17-oct-2026, Mario: "esto puede ser
// asignado y pedido por los supervisores para las diferentes obras").
// El supervisor pide para su obra; almacén da de alta cada pieza con su
// folio HE-… (etiqueta con código de barras), surte la solicitud, imprime el
// resguardo para firma y recibe de regreso. Todo cambio pasa por las
// funciones fn_herramienta_* (la bitácora dice dónde está cada pieza).

interface Obra {
  id: string;
  nombre: string;
  empresa_id: string;
  empresas: { codigo: string; nombre: string } | null;
}
interface LineaSolicitud {
  id: string;
  descripcion: string;
  cantidad: number;
  surtido: number;
  nota: string | null;
}
interface Solicitud {
  id: string;
  folio: string;
  empresa_id: string;
  proyecto_id: string;
  solicitado_por: string;
  solicitante_nombre: string | null;
  fecha_requerida: string | null;
  devolver_el: string | null;
  estado: EstadoSolicitudHerramienta;
  nota: string | null;
  respuesta: string | null;
  created_at: string;
  herramienta_solicitud_lineas: LineaSolicitud[];
}
interface Movimiento {
  id: string;
  tipo: TipoMovimientoHerramienta;
  proyecto_id: string | null;
  responsable_nombre: string | null;
  condicion: CondicionHerramienta | null;
  nota: string | null;
  created_at: string;
}

type Pestana = "solicitudes" | "inventario" | "obras";

const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
const pesos = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const fechaCorta = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "—");
const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const campo = "rounded border border-slate-300 px-2 py-1 text-sm";
const boton = "rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const botonSuave = "rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const porFolio = (a: { folio: string }, b: { folio: string }) => a.folio.localeCompare(b.folio, "es", { numeric: true });

export const operaHerramienta = (p: Profile | null) =>
  !!p && (["admin", "corporativo", "almacen", "empresa"].includes(p.rol) || (p.modulos ?? []).includes("herramienta"));

export function Herramienta() {
  const { perfil } = useAuth();
  const opera = operaHerramienta(perfil);
  const [pestana, setPestana] = useState<Pestana>("solicitudes");
  const [empresa, setEmpresa] = useEmpresaFiltro();
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: piezas = [], isLoading } = useQuery({
    queryKey: ["herramientas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("herramientas").select("*");
      if (error) throw error;
      return ((data ?? []) as Pieza[]).sort(porFolio);
    },
  });
  const { data: solicitudes = [] } = useQuery({
    queryKey: ["herramienta-solicitudes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("herramienta_solicitudes")
        .select("*, herramienta_solicitud_lineas(*)")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Solicitud[];
    },
  });
  const { data: obras = [] } = useQuery({
    queryKey: ["herramienta-obras"],
    queryFn: async () => {
      const { data, error } = await supabase.from("proyectos").select("id, nombre, empresa_id, empresas(codigo, nombre)").eq("activo", true).order("nombre");
      if (error) throw error;
      return (data ?? []) as unknown as Obra[];
    },
  });
  const obraDe = useMemo(() => new Map(obras.map((o) => [o.id, o])), [obras]);
  const nombreObra = (id: string | null) => (id ? obraDe.get(id)?.nombre ?? "Obra" : "");

  const deEmpresa = <T extends { empresa_id: string }>(xs: T[]) => (opera && empresa ? xs.filter((x) => x.empresa_id === empresa) : xs);
  const piezasVista = deEmpresa(piezas);
  const solicitudesVista = deEmpresa(solicitudes);
  const porSurtir = solicitudesVista.filter((s) => s.estado === "pendiente" || s.estado === "parcial").length;
  const vencidas = piezasVista.filter((p) => semaforoDevolucion(p, hoy()) === "vencida").length;

  const imprimirResguardo = (lista: Pieza[], folioSolicitud?: string | null) => {
    if (!lista.length) return;
    const obra = obraDe.get(lista[0].proyecto_id ?? "");
    const ventana = abrirVentanaImpresion();
    abrirParaImprimir(
      htmlResguardo({
        empresa_nombre: obra?.empresas?.nombre ?? "",
        empresa_codigo: obra?.empresas?.codigo ?? "",
        obra: obra?.nombre ?? "",
        responsable: lista[0].responsable_nombre ?? "",
        fecha: hoy(),
        folio_solicitud: folioSolicitud ?? null,
        entrega_nombre: opera ? perfil?.nombre ?? null : null,
        piezas: lista,
      }),
      ventana,
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Herramienta y equipo</h1>
          <p className="text-sm text-slate-600">
            {opera
              ? "Alta de piezas con folio y etiqueta, solicitudes de las obras, resguardo para firma y devolución al almacén."
              : "Pide la herramienta que necesitas para tu obra y consulta lo que tienes a tu cargo."}
          </p>
        </div>
        {opera && <SelectorEmpresa value={empresa} onChange={setEmpresa} />}
      </div>

      {aviso && (
        <div className="flex items-start justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
          <span>{aviso}</span>
          <button className="text-xs underline" onClick={() => setAviso(null)}>cerrar</button>
        </div>
      )}
      {error && (
        <div className="flex items-start justify-between gap-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          <span>{error}</span>
          <button className="text-xs underline" onClick={() => setError(null)}>cerrar</button>
        </div>
      )}

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {(
          [
            ["solicitudes", `Solicitudes${porSurtir ? ` · ${porSurtir} por surtir` : ""}`],
            ["inventario", opera ? "Inventario" : "A mi cargo y en mis obras"],
            ["obras", `Por obra${vencidas ? ` · ${vencidas} vencidas` : ""}`],
          ] as [Pestana, string][]
        ).map(([clave, etiqueta]) => (
          <button
            key={clave}
            onClick={() => setPestana(clave)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${pestana === clave ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {etiqueta}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : pestana === "solicitudes" ? (
        <Solicitudes
          opera={opera}
          solicitudes={solicitudesVista}
          piezas={piezas}
          obras={obras}
          nombreObra={nombreObra}
          perfilId={perfil?.id ?? ""}
          onAviso={setAviso}
          onError={setError}
          imprimirResguardo={imprimirResguardo}
        />
      ) : pestana === "inventario" ? (
        <Inventario opera={opera} piezas={piezasVista} obras={obras} empresa={empresa} nombreObra={nombreObra} onAviso={setAviso} onError={setError} imprimirResguardo={imprimirResguardo} />
      ) : (
        <PorObra piezas={piezasVista} nombreObra={nombreObra} imprimirResguardo={imprimirResguardo} />
      )}
    </div>
  );
}

// ── Solicitudes ──────────────────────────────────────────────────────────

function Solicitudes({
  opera,
  solicitudes,
  piezas,
  obras,
  nombreObra,
  perfilId,
  onAviso,
  onError,
  imprimirResguardo,
}: {
  opera: boolean;
  solicitudes: Solicitud[];
  piezas: Pieza[];
  obras: Obra[];
  nombreObra: (id: string | null) => string;
  perfilId: string;
  onAviso: (s: string) => void;
  onError: (s: string) => void;
  imprimirResguardo: (lista: Pieza[], folio?: string | null) => void;
}) {
  const qc = useQueryClient();
  const [nueva, setNueva] = useState(false);
  const [verCerradas, setVerCerradas] = useState(false);
  const [surtiendo, setSurtiendo] = useState<{ solicitud: Solicitud; linea: LineaSolicitud } | null>(null);
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["herramienta-solicitudes"] });
    qc.invalidateQueries({ queryKey: ["herramientas"] });
  };

  const cerrar = useMutation({
    mutationFn: async ({ s, estado }: { s: Solicitud; estado: "cancelada" | "rechazada" }) => {
      const motivo = window.prompt(estado === "rechazada" ? `Motivo del rechazo de ${s.folio}:` : `¿Cancelar ${s.folio}? Motivo (opcional):`);
      if (motivo === null) return null;
      const { error } = await supabase.rpc("fn_herramienta_solicitud_cerrar", { p_solicitud: s.id, p_estado: estado, p_motivo: motivo });
      if (error) throw error;
      return `${s.folio} ${estado}.`;
    },
    onSuccess: (m) => {
      if (m) onAviso(m);
      refrescar();
    },
    onError: (e: Error) => onError(e.message),
  });

  const abiertas = solicitudes.filter((s) => s.estado === "pendiente" || s.estado === "parcial");
  const lista = verCerradas ? solicitudes : abiertas;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button className={boton} onClick={() => setNueva((v) => !v)}>
          {nueva ? "Cerrar" : "+ Pedir herramienta para una obra"}
        </button>
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input type="checkbox" checked={verCerradas} onChange={(e) => setVerCerradas(e.target.checked)} /> ver también surtidas, rechazadas y canceladas
        </label>
      </div>

      {nueva && (
        <NuevaSolicitud
          obras={obras}
          onListo={(folio) => {
            setNueva(false);
            onAviso(`Solicitud ${folio} enviada a almacén.`);
            refrescar();
          }}
          onError={onError}
        />
      )}

      {lista.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          {verCerradas ? "No hay solicitudes." : "No hay solicitudes por surtir."}
        </p>
      ) : (
        <div className="space-y-2">
          {lista.map((s) => {
            const entregadas = piezas.filter((p) => p.proyecto_id === s.proyecto_id && p.estado === "asignada" && p.responsable_id === s.solicitado_por);
            const abierta = s.estado === "pendiente" || s.estado === "parcial";
            return (
              <div key={s.id} className="rounded border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium">{s.folio}</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${CLASE_SOLICITUD[s.estado]}`}>{ETIQUETA_SOLICITUD[s.estado]}</span>
                      <span className="text-sm font-medium text-slate-900">{nombreObra(s.proyecto_id)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      Pidió {s.solicitante_nombre ?? "—"} el {fechaHora(s.created_at)}
                      {s.fecha_requerida && ` · la necesita el ${fechaCorta(s.fecha_requerida)}`}
                      {s.devolver_el && ` · regresa el ${fechaCorta(s.devolver_el)}`}
                    </div>
                    {s.nota && <div className="mt-1 text-sm text-slate-700">{s.nota}</div>}
                    {s.respuesta && <div className="mt-1 text-sm text-red-700">Almacén: {s.respuesta}</div>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {entregadas.length > 0 && (
                      <button className={botonSuave} onClick={() => imprimirResguardo(entregadas, s.folio)}>
                        Resguardo ({entregadas.length})
                      </button>
                    )}
                    {abierta && (s.solicitado_por === perfilId || opera) && (
                      <button className={botonSuave} disabled={cerrar.isPending} onClick={() => cerrar.mutate({ s, estado: "cancelada" })}>
                        Cancelar
                      </button>
                    )}
                    {abierta && opera && (
                      <button className={`${botonSuave} text-red-700`} disabled={cerrar.isPending} onClick={() => cerrar.mutate({ s, estado: "rechazada" })}>
                        Rechazar
                      </button>
                    )}
                  </div>
                </div>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="py-1 font-normal">Pide</th>
                      <th className="w-20 py-1 text-right font-normal">Cantidad</th>
                      <th className="w-20 py-1 text-right font-normal">Surtido</th>
                      <th className="w-28 py-1"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.herramienta_solicitud_lineas.map((l) => (
                      <tr key={l.id} className="border-t border-slate-100">
                        <td className="py-1">
                          {l.descripcion}
                          {l.nota && <span className="ml-1 text-xs text-slate-500">({l.nota})</span>}
                        </td>
                        <td className="py-1 text-right">{l.cantidad}</td>
                        <td className={`py-1 text-right ${faltaPorSurtir(l) === 0 ? "text-emerald-700" : "text-amber-700"}`}>{l.surtido}</td>
                        <td className="py-1 text-right">
                          {opera && abierta && faltaPorSurtir(l) > 0 && (
                            <button className={botonSuave} onClick={() => setSurtiendo({ solicitud: s, linea: l })}>
                              Surtir {faltaPorSurtir(l)}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {surtiendo && (
        <SurtirRenglon
          solicitud={surtiendo.solicitud}
          linea={surtiendo.linea}
          piezas={piezas}
          nombreObra={nombreObra}
          onCerrar={() => setSurtiendo(null)}
          onListo={(asignadas) => {
            setSurtiendo(null);
            onAviso(`Se asignaron ${asignadas.length} a ${nombreObra(surtiendo.solicitud.proyecto_id)}. Imprime el resguardo para que lo firme quien recibe.`);
            refrescar();
            imprimirResguardo(
              asignadas.map((p) => ({ ...p, estado: "asignada" as const, proyecto_id: surtiendo.solicitud.proyecto_id, responsable_nombre: surtiendo.solicitud.solicitante_nombre, devolver_el: surtiendo.solicitud.devolver_el })),
              surtiendo.solicitud.folio,
            );
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function NuevaSolicitud({ obras, onListo, onError }: { obras: Obra[]; onListo: (folio: string) => void; onError: (s: string) => void }) {
  const [proyecto, setProyecto] = useState("");
  const [buscaObra, setBuscaObra] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [devolver, setDevolver] = useState("");
  const [nota, setNota] = useState("");
  const [filas, setFilas] = useState<{ descripcion: string; cantidad: string }[]>([{ descripcion: "", cantidad: "1" }]);

  const opcionesObra = useMemo(() => {
    const t = buscaObra
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    return obras
      .filter((o) => !t || o.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(t))
      .slice(0, 30)
      .map((o) => ({ clave: o.id, titulo: o.nombre, detalle: o.empresas?.codigo ?? "" }));
  }, [obras, buscaObra]);

  const enviar = useMutation({
    mutationFn: async () => {
      if (!proyecto) throw new Error("Elige la obra.");
      const lineas = filas.filter((f) => f.descripcion.trim()).map((f) => ({ descripcion: f.descripcion.trim(), cantidad: Number(f.cantidad) || 1 }));
      if (!lineas.length) throw new Error("Escribe al menos qué herramienta necesitas.");
      const { data, error } = await supabase.rpc("fn_herramienta_solicitar", {
        p_proyecto: proyecto,
        p_lineas: lineas,
        p_fecha_requerida: fecha || null,
        p_devolver_el: devolver || null,
        p_nota: nota,
      });
      if (error) throw error;
      const { data: s } = await supabase.from("herramienta_solicitudes").select("folio").eq("id", data as string).single();
      return (s?.folio as string) ?? "";
    },
    onSuccess: onListo,
    onError: (e: Error) => onError(e.message.includes("row-level security") ? "No tienes esa obra asignada: pide que te asignen como responsable o comprador en el encabezado de la obra." : e.message),
  });

  const cambiarFila = (i: number, k: "descripcion" | "cantidad", v: string) => setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, [k]: v } : f)));

  return (
    <form
      className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3"
      data-sin-borrador
      onSubmit={(e) => {
        e.preventDefault();
        enviar.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm sm:col-span-3">
          <span className="text-slate-600">Obra</span>
          {obras.length === 0 ? (
            <p className="text-sm text-amber-700">No tienes obras asignadas. Pide que te asignen en el encabezado de la obra.</p>
          ) : (
            <CampoBuscador
              value={buscaObra}
              onChange={(t) => {
                setBuscaObra(t);
                setProyecto("");
              }}
              opciones={opcionesObra}
              onElegir={(id) => {
                setProyecto(id);
                setBuscaObra(obras.find((o) => o.id === id)?.nombre ?? "");
              }}
              placeholder="Escribe el nombre de la obra…"
              className={`${campo} w-full`}
              vacio="Sin obras con ese nombre"
            />
          )}
        </label>
        <label className="text-sm">
          <span className="text-slate-600">La necesito el</span>
          <input type="date" className={`${campo} w-full`} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">La regreso el (estimado)</span>
          <input type="date" className={`${campo} w-full`} value={devolver} onChange={(e) => setDevolver(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Nota</span>
          <input className={`${campo} w-full`} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Para qué actividad" />
        </label>
      </div>
      <div className="space-y-1">
        {filas.map((f, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={`${campo} flex-1`}
              placeholder="Herramienta o equipo (ej. rotomartillo, andamio, nivel láser)"
              value={f.descripcion}
              onChange={(e) => cambiarFila(i, "descripcion", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (f.descripcion.trim()) setFilas((fs) => [...fs, { descripcion: "", cantidad: "1" }]);
                }
              }}
            />
            <input type="number" min={1} className={`${campo} w-20`} value={f.cantidad} onChange={(e) => cambiarFila(i, "cantidad", e.target.value)} />
            {filas.length > 1 && (
              <button type="button" className="text-xs text-slate-500 hover:text-red-700" onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}>
                quitar
              </button>
            )}
          </div>
        ))}
        <button type="button" className="text-xs text-sky-700 underline" onClick={() => setFilas((fs) => [...fs, { descripcion: "", cantidad: "1" }])}>
          + otro renglón
        </button>
      </div>
      <button type="submit" className={boton} disabled={enviar.isPending || !proyecto}>
        {enviar.isPending ? "Enviando…" : "Enviar a almacén"}
      </button>
    </form>
  );
}

function SurtirRenglon({
  solicitud,
  linea,
  piezas,
  nombreObra,
  onCerrar,
  onListo,
  onError,
}: {
  solicitud: Solicitud;
  linea: LineaSolicitud;
  piezas: Pieza[];
  nombreObra: (id: string | null) => string;
  onCerrar: () => void;
  onListo: (asignadas: Pieza[]) => void;
  onError: (s: string) => void;
}) {
  const falta = faltaPorSurtir(linea);
  const [texto, setTexto] = useState("");
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [nota, setNota] = useState("");
  const disponibles = piezas.filter((p) => p.estado === "disponible");
  const sugeridas = sugerirParaRenglon(disponibles, linea.descripcion);
  const lista = texto.trim() ? filtrarHerramientas(disponibles, texto) : sugeridas.length ? sugeridas : disponibles;

  const surtir = useMutation({
    mutationFn: async () => {
      if (!elegidas.length) throw new Error("Elige las piezas que salen.");
      const { error } = await supabase.rpc("fn_herramienta_asignar", {
        p_herramientas: elegidas,
        p_proyecto: null,
        p_responsable: null,
        p_responsable_nombre: null,
        p_devolver_el: null,
        p_nota: nota,
        p_linea: linea.id,
      });
      if (error) throw error;
      return piezas.filter((p) => elegidas.includes(p.id));
    },
    onSuccess: onListo,
    onError: (e: Error) => onError(e.message),
  });

  const alternar = (id: string) =>
    setElegidas((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : xs.length >= falta ? xs : [...xs, id]));

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onCerrar}>
      <div className="mt-10 w-full max-w-2xl space-y-3 rounded bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="font-semibold text-slate-900">
            Surtir «{linea.descripcion}» · {falta} {falta === 1 ? "pieza" : "piezas"}
          </h2>
          <p className="text-sm text-slate-600">
            {solicitud.folio} · {nombreObra(solicitud.proyecto_id)} · queda a cargo de {solicitud.solicitante_nombre}
          </p>
        </div>
        <input
          className={`${campo} w-full`}
          placeholder="Busca o escanea el folio de la etiqueta…"
          value={texto}
          autoFocus
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const exacta = disponibles.find((p) => p.folio.toUpperCase() === texto.trim().toUpperCase());
            if (exacta) {
              alternar(exacta.id);
              setTexto("");
            }
          }}
        />
        <div className="max-h-80 overflow-y-auto rounded border border-slate-200">
          {lista.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">No hay piezas disponibles en almacén{texto ? " con ese texto" : ""}. Da de alta la herramienta en Inventario.</p>
          ) : (
            lista.slice(0, 80).map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-2 py-1.5 text-sm last:border-0 hover:bg-slate-50">
                <input type="checkbox" checked={elegidas.includes(p.id)} onChange={() => alternar(p.id)} disabled={!elegidas.includes(p.id) && elegidas.length >= falta} />
                <span className="font-mono text-xs">{p.folio}</span>
                <span className="flex-1">
                  {p.nombre}
                  {(p.marca || p.modelo) && <span className="text-xs text-slate-500"> · {[p.marca, p.modelo].filter(Boolean).join(" ")}</span>}
                </span>
                <span className="text-xs text-slate-500">{p.condicion}</span>
              </label>
            ))
          )}
        </div>
        <input className={`${campo} w-full`} placeholder="Nota de salida (accesorios, estuche…)" value={nota} onChange={(e) => setNota(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button className={botonSuave} onClick={onCerrar}>
            Cancelar
          </button>
          <button className={boton} disabled={!elegidas.length || surtir.isPending} onClick={() => surtir.mutate()}>
            {surtir.isPending ? "Asignando…" : `Asignar ${elegidas.length} y ver resguardo`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inventario ───────────────────────────────────────────────────────────

const CATEGORIAS = Object.keys(ETIQUETA_CATEGORIA) as CategoriaHerramienta[];
const ESTADOS = Object.keys(ETIQUETA_ESTADO) as EstadoHerramienta[];

function Inventario({
  opera,
  piezas,
  obras,
  empresa,
  nombreObra,
  onAviso,
  onError,
  imprimirResguardo,
}: {
  opera: boolean;
  piezas: Pieza[];
  obras: Obra[];
  empresa: string;
  nombreObra: (id: string | null) => string;
  onAviso: (s: string) => void;
  onError: (s: string) => void;
  imprimirResguardo: (lista: Pieza[]) => void;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<EstadoHerramienta | "" | "activas">("activas");
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [modo, setModo] = useState<"alta" | "asignar" | "devolver" | null>(null);
  const [editando, setEditando] = useState<Pieza | null>(null);
  const [historial, setHistorial] = useState<Pieza | null>(null);
  const refrescar = () => qc.invalidateQueries({ queryKey: ["herramientas"] });
  const c = conteoPorEstado(piezas);

  const lista = filtrarHerramientas(
    piezas.filter((p) => (estado === "activas" ? p.estado !== "baja" : !estado || p.estado === estado)),
    texto,
    nombreObra,
  );
  const elegidas = piezas.filter((p) => seleccion.includes(p.id));
  const alternar = (id: string) => setSeleccion((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const cambiarEstado = useMutation({
    mutationFn: async ({ p, tipo }: { p: Pieza; tipo: "reparacion" | "fin_reparacion" | "baja" | "extravio" }) => {
      const etiqueta = { reparacion: "mandar a reparación", fin_reparacion: "regresar de reparación", baja: "dar de baja", extravio: "marcar como extraviada" }[tipo];
      const nota = window.prompt(`${p.folio} ${p.nombre}: ${etiqueta}. ${tipo === "baja" || tipo === "extravio" ? "Motivo:" : "Nota (opcional):"}`);
      if (nota === null) return null;
      const { error } = await supabase.rpc("fn_herramienta_estado", { p_herramienta: p.id, p_tipo: tipo, p_nota: nota });
      if (error) throw error;
      return `${p.folio}: ${ETIQUETA_MOVIMIENTO[tipo].toLowerCase()}.`;
    },
    onSuccess: (m) => {
      if (m) onAviso(m);
      refrescar();
    },
    onError: (e: Error) => onError(e.message),
  });

  const etiquetas = () => {
    const xs = elegidas.length ? elegidas : lista;
    if (!xs.length) return;
    abrirParaImprimir(htmlEtiquetas([...xs].sort(porFolio), ""), abrirVentanaImpresion());
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {ESTADOS.map((e) => (
          <button key={e} onClick={() => setEstado(estado === e ? "activas" : e)} className={`rounded px-2 py-1 ${CLASE_ESTADO[e]} ${estado === e ? "ring-2 ring-slate-400" : ""}`}>
            {ETIQUETA_ESTADO[e]}: {c[e]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${campo} min-w-[16rem] flex-1`}
          placeholder="Busca por folio, nombre, marca, serie, obra o responsable — o escanea la etiqueta"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !opera) return;
            const exacta = piezas.find((p) => p.folio.toUpperCase() === texto.trim().toUpperCase());
            if (exacta) {
              e.preventDefault();
              alternar(exacta.id);
              setTexto("");
            }
          }}
        />
        <select className={campo} value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
          <option value="activas">Todas menos bajas</option>
          <option value="">Todas</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>
              {ETIQUETA_ESTADO[e]}
            </option>
          ))}
        </select>
        {opera && (
          <button className={boton} onClick={() => setModo(modo === "alta" ? null : "alta")}>
            + Alta de herramienta
          </button>
        )}
      </div>

      {opera && seleccion.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-sky-200 bg-sky-50 p-2 text-sm">
          <span>
            {seleccion.length} {seleccion.length === 1 ? "pieza elegida" : "piezas elegidas"}
          </span>
          <button className={botonSuave} disabled={elegidas.some((p) => p.estado !== "disponible" && p.estado !== "asignada")} onClick={() => setModo("asignar")}>
            Asignar a obra
          </button>
          <button className={botonSuave} disabled={elegidas.some((p) => p.estado !== "asignada")} onClick={() => setModo("devolver")}>
            Recibir en almacén
          </button>
          <button className={botonSuave} onClick={etiquetas}>
            Etiquetas
          </button>
          <button className="text-xs underline" onClick={() => setSeleccion([])}>
            quitar selección
          </button>
        </div>
      )}

      {modo === "alta" && (
        <FichaHerramienta
          empresaInicial={empresa}
          onCerrar={() => setModo(null)}
          onListo={(m) => {
            setModo(null);
            onAviso(m);
            refrescar();
          }}
          onError={onError}
        />
      )}
      {editando && (
        <FichaHerramienta
          pieza={editando}
          empresaInicial={editando.empresa_id}
          onCerrar={() => setEditando(null)}
          onListo={(m) => {
            setEditando(null);
            onAviso(m);
            refrescar();
          }}
          onError={onError}
        />
      )}
      {modo === "asignar" && (
        <AsignarObra
          piezas={elegidas}
          obras={obras}
          onCerrar={() => setModo(null)}
          onListo={(asignadas, m) => {
            setModo(null);
            setSeleccion([]);
            onAviso(m);
            refrescar();
            imprimirResguardo(asignadas);
          }}
          onError={onError}
        />
      )}
      {modo === "devolver" && (
        <RecibirAlmacen
          piezas={elegidas}
          onCerrar={() => setModo(null)}
          onListo={(m) => {
            setModo(null);
            setSeleccion([]);
            onAviso(m);
            refrescar();
          }}
          onError={onError}
        />
      )}

      {lista.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          {piezas.length === 0 ? (opera ? "Todavía no hay herramienta dada de alta. Empieza con «+ Alta de herramienta»." : "No tienes herramienta a tu cargo ni en tus obras.") : "Nada con ese filtro."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                {opera && (
                  <th className="w-8 px-2 py-2">
                    <input
                      type="checkbox"
                      checked={lista.length > 0 && lista.every((p) => seleccion.includes(p.id))}
                      onChange={(e) => setSeleccion(e.target.checked ? lista.map((p) => p.id) : [])}
                    />
                  </th>
                )}
                <th className="px-2 py-2">Folio</th>
                <th className="px-2 py-2">Herramienta</th>
                <th className="px-2 py-2">Estado</th>
                <th className="px-2 py-2">Obra · responsable</th>
                <th className="px-2 py-2">Regresa</th>
                <th className="px-2 py-2 text-right">Valor</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                const sem = semaforoDevolucion(p, hoy());
                return (
                  <tr key={p.id} className="border-t border-slate-100 align-top">
                    {opera && (
                      <td className="px-2 py-1.5">
                        <input type="checkbox" checked={seleccion.includes(p.id)} onChange={() => alternar(p.id)} />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{p.folio}</td>
                    <td className="px-2 py-1.5">
                      <div>{p.nombre}</div>
                      <div className="text-xs text-slate-500">
                        {[ETIQUETA_CATEGORIA[p.categoria], p.marca, p.modelo, p.numero_serie && `serie ${p.numero_serie}`].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${CLASE_ESTADO[p.estado]}`}>{ETIQUETA_ESTADO[p.estado]}</span>
                      {p.condicion !== "buena" && <div className="text-xs text-amber-700">condición {p.condicion}</div>}
                    </td>
                    <td className="px-2 py-1.5">
                      {p.proyecto_id ? (
                        <>
                          <div>{nombreObra(p.proyecto_id)}</div>
                          <div className="text-xs text-slate-500">{p.responsable_nombre}</div>
                        </>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={`whitespace-nowrap px-2 py-1.5 text-xs ${sem === "vencida" ? "font-medium text-red-700" : sem === "por_vencer" ? "text-amber-700" : "text-slate-600"}`}>
                      {p.estado === "asignada" ? fechaCorta(p.devolver_el) : ""}
                      {sem === "vencida" && " · vencida"}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{p.costo != null ? pesos(Number(p.costo)) : ""}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button className={botonSuave} onClick={() => setHistorial(p)}>
                          Historial
                        </button>
                        {opera && (
                          <>
                            <button className={botonSuave} onClick={() => setEditando(p)}>
                              Editar
                            </button>
                            {(p.estado === "disponible" || p.estado === "asignada") && (
                              <button className={botonSuave} onClick={() => cambiarEstado.mutate({ p, tipo: "reparacion" })}>
                                Reparación
                              </button>
                            )}
                            {p.estado === "reparacion" && (
                              <button className={botonSuave} onClick={() => cambiarEstado.mutate({ p, tipo: "fin_reparacion" })}>
                                Ya reparada
                              </button>
                            )}
                            {p.estado === "asignada" && (
                              <button className={botonSuave} onClick={() => cambiarEstado.mutate({ p, tipo: "extravio" })}>
                                Extraviada
                              </button>
                            )}
                            {p.estado !== "baja" && p.estado !== "asignada" && (
                              <button className={`${botonSuave} text-red-700`} onClick={() => cambiarEstado.mutate({ p, tipo: "baja" })}>
                                Baja
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {historial && <Historial pieza={historial} nombreObra={nombreObra} onCerrar={() => setHistorial(null)} />}
    </div>
  );
}

function FichaHerramienta({
  pieza,
  empresaInicial,
  onCerrar,
  onListo,
  onError,
}: {
  pieza?: Pieza;
  empresaInicial: string;
  onCerrar: () => void;
  onListo: (mensaje: string) => void;
  onError: (s: string) => void;
}) {
  const { empresasAlcance } = useAuth();
  const [empresa, setEmpresa] = useState(empresaInicial || (empresasAlcance.length === 1 ? empresasAlcance[0] : ""));
  const [cantidad, setCantidad] = useState("1");
  const [d, setD] = useState({
    nombre: pieza?.nombre ?? "",
    categoria: pieza?.categoria ?? ("herramienta" as CategoriaHerramienta),
    marca: pieza?.marca ?? "",
    modelo: pieza?.modelo ?? "",
    numero_serie: pieza?.numero_serie ?? "",
    costo: pieza?.costo != null ? String(pieza.costo) : "",
    fecha_compra: pieza?.fecha_compra ?? "",
    condicion: pieza?.condicion ?? ("buena" as CondicionHerramienta),
    notas: pieza?.notas ?? "",
  });
  const n = Math.max(1, Math.min(200, Number(cantidad) || 1));

  const guardar = useMutation({
    mutationFn: async () => {
      if (!d.nombre.trim()) throw new Error("Escribe el nombre de la herramienta.");
      if (pieza) {
        const { error } = await supabase.rpc("fn_herramienta_editar", { p_id: pieza.id, p_datos: d });
        if (error) throw error;
        return `${pieza.folio} actualizada.`;
      }
      if (!empresa) throw new Error("Elige la empresa dueña de la herramienta.");
      const { data, error } = await supabase.rpc("fn_herramienta_alta", { p_empresa: empresa, p_datos: d, p_cantidad: n });
      if (error) throw error;
      const ids = (data ?? []) as string[];
      const { data: nuevas } = await supabase.from("herramientas").select("folio, nombre").in("id", ids);
      const lista = ((nuevas ?? []) as { folio: string; nombre: string }[]).sort(porFolio);
      if (lista.length && window.confirm(`Se dieron de alta ${lista.length} (${lista[0].folio}${lista.length > 1 ? ` a ${lista[lista.length - 1].folio}` : ""}). ¿Imprimir etiquetas?`)) {
        abrirParaImprimir(htmlEtiquetas(lista, ""), abrirVentanaImpresion());
      }
      return `Alta de ${lista.length} ${lista.length === 1 ? "pieza" : "piezas"}: ${lista.map((x) => x.folio).join(", ")}.`;
    },
    onSuccess: onListo,
    onError: (e: Error) => onError(e.message),
  });

  const set = (k: keyof typeof d, v: string) => setD((x) => ({ ...x, [k]: v }));

  return (
    <form
      className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3"
      data-sin-borrador
      onSubmit={(e) => {
        e.preventDefault();
        guardar.mutate();
      }}
    >
      <h2 className="font-medium text-slate-900">{pieza ? `Editar ${pieza.folio}` : "Alta de herramienta o equipo"}</h2>
      <div className="grid gap-3 sm:grid-cols-4">
        {!pieza && (
          <label className="text-sm">
            <span className="text-slate-600">Empresa dueña</span>
            <SelectorEmpresa value={empresa} onChange={setEmpresa} vacio={null} required className={`${campo} w-full`} />
          </label>
        )}
        <label className="text-sm sm:col-span-2">
          <span className="text-slate-600">Nombre</span>
          <input className={`${campo} w-full`} value={d.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Rotomartillo, andamio tubular, nivel láser…" autoFocus />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Categoría</span>
          <select className={`${campo} w-full`} value={d.categoria} onChange={(e) => set("categoria", e.target.value)}>
            {CATEGORIAS.map((k) => (
              <option key={k} value={k}>
                {ETIQUETA_CATEGORIA[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Marca</span>
          <input className={`${campo} w-full`} value={d.marca} onChange={(e) => set("marca", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Modelo</span>
          <input className={`${campo} w-full`} value={d.modelo} onChange={(e) => set("modelo", e.target.value)} />
        </label>
        {(pieza || n === 1) && (
          <label className="text-sm">
            <span className="text-slate-600">Número de serie</span>
            <input className={`${campo} w-full`} value={d.numero_serie} onChange={(e) => set("numero_serie", e.target.value)} />
          </label>
        )}
        <label className="text-sm">
          <span className="text-slate-600">Costo por pieza</span>
          <input type="number" min={0} step="0.01" className={`${campo} w-full`} value={d.costo} onChange={(e) => set("costo", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Fecha de compra</span>
          <input type="date" className={`${campo} w-full`} value={d.fecha_compra} onChange={(e) => set("fecha_compra", e.target.value)} />
        </label>
        {!pieza && (
          <>
            <label className="text-sm">
              <span className="text-slate-600">Condición</span>
              <select className={`${campo} w-full`} value={d.condicion} onChange={(e) => set("condicion", e.target.value)}>
                <option value="buena">Buena</option>
                <option value="regular">Regular</option>
                <option value="mala">Mala</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="text-slate-600">Cuántas iguales</span>
              <input type="number" min={1} max={200} className={`${campo} w-full`} value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
            </label>
          </>
        )}
        <label className="text-sm sm:col-span-4">
          <span className="text-slate-600">Notas</span>
          <input className={`${campo} w-full`} value={d.notas} onChange={(e) => set("notas", e.target.value)} placeholder="Accesorios, factura, OC…" />
        </label>
      </div>
      {!pieza && n > 1 && <p className="text-xs text-slate-500">Se crean {n} piezas, cada una con su folio y su etiqueta.</p>}
      <div className="flex gap-2">
        <button type="submit" className={boton} disabled={guardar.isPending}>
          {guardar.isPending ? "Guardando…" : pieza ? "Guardar" : `Dar de alta ${n > 1 ? n : ""}`}
        </button>
        <button type="button" className={botonSuave} onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function AsignarObra({
  piezas,
  obras,
  onCerrar,
  onListo,
  onError,
}: {
  piezas: Pieza[];
  obras: Obra[];
  onCerrar: () => void;
  onListo: (asignadas: Pieza[], mensaje: string) => void;
  onError: (s: string) => void;
}) {
  const [proyecto, setProyecto] = useState("");
  const [buscaObra, setBuscaObra] = useState("");
  const [responsable, setResponsable] = useState<string | null>(null);
  const [nombre, setNombre] = useState("");
  const [devolver, setDevolver] = useState("");
  const [nota, setNota] = useState("");
  const { data: personas = [] } = useQuery({
    queryKey: ["directorio-activo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_directorio").select("id, nombre, rol").eq("activo", true).order("nombre");
      if (error) throw error;
      return (data ?? []) as { id: string; nombre: string; rol: string }[];
    },
  });
  const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const opcionesObra = obras
    .filter((o) => !buscaObra || sinAcentos(o.nombre).includes(sinAcentos(buscaObra)))
    .slice(0, 30)
    .map((o) => ({ clave: o.id, titulo: o.nombre, detalle: o.empresas?.codigo ?? "" }));
  const opcionesPersona = personas
    .filter((p) => p.nombre && (!nombre || sinAcentos(p.nombre).includes(sinAcentos(nombre))))
    .slice(0, 30)
    .map((p) => ({ clave: p.id, titulo: p.nombre, detalle: p.rol }));

  const asignar = useMutation({
    mutationFn: async () => {
      if (!proyecto) throw new Error("Elige la obra.");
      if (!nombre.trim()) throw new Error("Indica quién la recibe.");
      const { error } = await supabase.rpc("fn_herramienta_asignar", {
        p_herramientas: piezas.map((p) => p.id),
        p_proyecto: proyecto,
        p_responsable: responsable,
        p_responsable_nombre: nombre.trim(),
        p_devolver_el: devolver || null,
        p_nota: nota,
        p_linea: null,
      });
      if (error) throw error;
      const obra = obras.find((o) => o.id === proyecto)?.nombre ?? "";
      return {
        asignadas: piezas.map((p) => ({ ...p, estado: "asignada" as const, proyecto_id: proyecto, responsable_id: responsable, responsable_nombre: nombre.trim(), devolver_el: devolver || null })),
        mensaje: `${piezas.length} ${piezas.length === 1 ? "pieza asignada" : "piezas asignadas"} a ${obra} (${nombre.trim()}).`,
      };
    },
    onSuccess: (r) => onListo(r.asignadas, r.mensaje),
    onError: (e: Error) => onError(e.message),
  });

  return (
    <form
      className="space-y-3 rounded border border-sky-200 bg-white p-3"
      data-sin-borrador
      onSubmit={(e) => {
        e.preventDefault();
        asignar.mutate();
      }}
    >
      <h2 className="font-medium text-slate-900">Asignar {piezas.length} a una obra</h2>
      <p className="text-xs text-slate-500">{piezas.map((p) => p.folio).join(", ")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-slate-600">Obra</span>
          <CampoBuscador
            value={buscaObra}
            onChange={(t) => {
              setBuscaObra(t);
              setProyecto("");
            }}
            opciones={opcionesObra}
            onElegir={(id) => {
              setProyecto(id);
              setBuscaObra(obras.find((o) => o.id === id)?.nombre ?? "");
            }}
            placeholder="Escribe el nombre de la obra…"
            className={`${campo} w-full`}
            vacio="Sin obras con ese nombre"
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Recibe (responsable)</span>
          <CampoBuscador
            value={nombre}
            onChange={(t) => {
              setNombre(t);
              setResponsable(null);
            }}
            opciones={opcionesPersona}
            onElegir={(id) => {
              setResponsable(id);
              setNombre(personas.find((p) => p.id === id)?.nombre ?? "");
            }}
            placeholder="Supervisor o persona que la recibe"
            className={`${campo} w-full`}
          />
          {!responsable && nombre.trim() && <span className="text-xs text-amber-700">Sin cuenta en el sistema: no la verá en su pantalla.</span>}
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Regresa el</span>
          <input type="date" className={`${campo} w-full`} value={devolver} onChange={(e) => setDevolver(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Nota</span>
          <input className={`${campo} w-full`} value={nota} onChange={(e) => setNota(e.target.value)} />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={boton} disabled={asignar.isPending || !proyecto}>
          {asignar.isPending ? "Asignando…" : "Asignar y ver resguardo"}
        </button>
        <button type="button" className={botonSuave} onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function RecibirAlmacen({ piezas, onCerrar, onListo, onError }: { piezas: Pieza[]; onCerrar: () => void; onListo: (m: string) => void; onError: (s: string) => void }) {
  const [condicion, setCondicion] = useState<CondicionHerramienta>("buena");
  const [reparar, setReparar] = useState(false);
  const [nota, setNota] = useState("");
  const recibir = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("fn_herramienta_devolver", {
        p_herramientas: piezas.map((p) => p.id),
        p_condicion: condicion,
        p_nota: nota,
        p_a_reparacion: reparar,
      });
      if (error) throw error;
      return `${piezas.length} ${piezas.length === 1 ? "pieza recibida" : "piezas recibidas"} en almacén${reparar ? " y enviadas a reparación" : ""}.`;
    },
    onSuccess: onListo,
    onError: (e: Error) => onError(e.message),
  });
  return (
    <form
      className="space-y-3 rounded border border-emerald-200 bg-white p-3"
      data-sin-borrador
      onSubmit={(e) => {
        e.preventDefault();
        recibir.mutate();
      }}
    >
      <h2 className="font-medium text-slate-900">Recibir {piezas.length} en almacén</h2>
      <p className="text-xs text-slate-500">{piezas.map((p) => `${p.folio} (${p.responsable_nombre ?? "—"})`).join(", ")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="text-slate-600">Condición en que regresa</span>
          <select
            className={`${campo} block`}
            value={condicion}
            onChange={(e) => {
              setCondicion(e.target.value as CondicionHerramienta);
              if (e.target.value === "mala") setReparar(true);
            }}
          >
            <option value="buena">Buena</option>
            <option value="regular">Regular</option>
            <option value="mala">Mala</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={reparar} onChange={(e) => setReparar(e.target.checked)} /> mandar a reparación
        </label>
        <label className="flex-1 text-sm">
          <span className="text-slate-600">Nota</span>
          <input className={`${campo} w-full`} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Faltantes, daños…" />
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={boton} disabled={recibir.isPending}>
          {recibir.isPending ? "Recibiendo…" : "Recibir"}
        </button>
        <button type="button" className={botonSuave} onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Historial({ pieza, nombreObra, onCerrar }: { pieza: Pieza; nombreObra: (id: string | null) => string; onCerrar: () => void }) {
  const { data: movimientos = [], isLoading } = useQuery({
    queryKey: ["herramienta-movimientos", pieza.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("herramienta_movimientos").select("*").eq("herramienta_id", pieza.id).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Movimiento[];
    },
  });
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4" onClick={onCerrar}>
      <div className="mt-10 w-full max-w-xl space-y-3 rounded bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-900">
              {pieza.folio} · {pieza.nombre}
            </h2>
            <p className="text-sm text-slate-600">{ETIQUETA_ESTADO[pieza.estado]}{pieza.proyecto_id ? ` · ${nombreObra(pieza.proyecto_id)}` : ""}</p>
          </div>
          <button className={botonSuave} onClick={onCerrar}>
            Cerrar
          </button>
        </div>
        {isLoading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : (
          <ol className="space-y-2 text-sm">
            {movimientos.map((m) => (
              <li key={m.id} className="border-l-2 border-slate-200 pl-3">
                <div className="font-medium text-slate-800">{ETIQUETA_MOVIMIENTO[m.tipo]}</div>
                <div className="text-xs text-slate-500">
                  {fechaHora(m.created_at)}
                  {m.proyecto_id && ` · ${nombreObra(m.proyecto_id)}`}
                  {m.responsable_nombre && ` · ${m.responsable_nombre}`}
                  {m.condicion && ` · condición ${m.condicion}`}
                </div>
                {m.nota && <div className="text-xs text-slate-700">{m.nota}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ── Por obra ─────────────────────────────────────────────────────────────

function PorObra({ piezas, nombreObra, imprimirResguardo }: { piezas: Pieza[]; nombreObra: (id: string | null) => string; imprimirResguardo: (lista: Pieza[]) => void }) {
  const [abierta, setAbierta] = useState<string | null>(null);
  const resumen = resumenPorObra(piezas, hoy());
  if (!resumen.length) return <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">Ninguna obra tiene herramienta asignada.</p>;
  return (
    <div className="space-y-2">
      {resumen.map((r) => {
        const deObra = piezas.filter((p) => p.estado === "asignada" && p.proyecto_id === r.proyecto_id).sort(porFolio);
        return (
          <div key={r.proyecto_id} className="rounded border border-slate-200 bg-white">
            <button className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left" onClick={() => setAbierta(abierta === r.proyecto_id ? null : r.proyecto_id)}>
              <div>
                <div className="font-medium text-slate-900">{nombreObra(r.proyecto_id)}</div>
                <div className="text-xs text-slate-500">{r.responsables.join(", ")}</div>
              </div>
              <div className="flex items-center gap-3 text-sm">
                {r.vencidas > 0 && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">{r.vencidas} vencidas</span>}
                <span>
                  {r.piezas} {r.piezas === 1 ? "pieza" : "piezas"}
                </span>
                <span className="text-slate-600">{pesos(r.valor)}</span>
              </div>
            </button>
            {abierta === r.proyecto_id && (
              <div className="border-t border-slate-100 p-3">
                <div className="mb-2 flex flex-wrap gap-1">
                  {r.responsables.map((quien) => (
                    <button key={quien} className={botonSuave} onClick={() => imprimirResguardo(deObra.filter((p) => (p.responsable_nombre ?? "").trim() === quien))}>
                      Resguardo de {quien}
                    </button>
                  ))}
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {deObra.map((p) => {
                      const sem = semaforoDevolucion(p, hoy());
                      return (
                        <tr key={p.id} className="border-t border-slate-100">
                          <td className="py-1 font-mono text-xs">{p.folio}</td>
                          <td className="py-1">{p.nombre}</td>
                          <td className="py-1 text-xs text-slate-500">{p.responsable_nombre}</td>
                          <td className={`py-1 text-right text-xs ${sem === "vencida" ? "font-medium text-red-700" : sem === "por_vencer" ? "text-amber-700" : "text-slate-600"}`}>
                            regresa {fechaCorta(p.devolver_el)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
