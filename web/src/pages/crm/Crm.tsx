import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa, useEmpresasAlcance } from "../../components/SelectorEmpresa";
import { CampoBuscador } from "../../components/CampoBuscador";
import { abrirParaImprimir, abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import { htmlCotizacionPlanta, sinIva, totalesCotizacion, type LineaCotizacionPlanta } from "../../lib/cotizacionPlanta";
import { buscarProductos, detalleProducto, lineasParaOrdenVenta, type ProductoCotizador } from "../../lib/cotizador";
import {
  CLASE_ETAPA_CRM,
  ETAPAS_CRM,
  ETIQUETA_CANAL,
  ETIQUETA_ETAPA_CRM,
  enlaceWhatsapp,
  esperaRespuesta,
  interpretarPedido,
  mensajeCotizacion,
  minutosEsperando,
  type CanalCrm,
  type EtapaCrm,
} from "../../lib/crmVentas";
import { useCatalogoCotizador, useEmpresaCotizadora } from "../cotizador/datosCotizador";

// CRM de ventas por WhatsApp y redes (17-oct-2026, Mario: "un CRM de atención
// que genere las cotizaciones de manera automática"; la cotización la revisa
// una persona antes de enviarse). Se pega lo que escribió el cliente, el
// sistema propone las partidas con los productos de la empresa, el vendedor
// ajusta, guarda (folio COT-…, mismo cotizador) y la manda por WhatsApp con
// el texto armado. Sin cuenta de Meta todavía: los mensajes se registran a
// mano y WhatsApp se abre con wa.me.

interface Prospecto {
  id: string;
  empresa_id: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  canal: CanalCrm;
  etapa: EtapaCrm;
  motivo_perdida: string | null;
  cliente_id: string | null;
  asignado_nombre: string | null;
  notas: string | null;
  ultimo_entrante_en: string | null;
  ultimo_saliente_en: string | null;
  created_at: string;
}
interface Mensaje {
  id: string;
  direccion: "entrante" | "saliente";
  texto: string;
  cotizacion_id: string | null;
  created_by_nombre: string | null;
  created_at: string;
}
interface CotizacionCrm {
  id: string;
  folio: string;
  fecha: string;
  contraparte: string;
  obra: string | null;
  vigencia_dias: number;
  condicion_pago: "contado" | "credito" | null;
  dias_credito: number | null;
  notas: string | null;
  cliente_id: string | null;
  estatus: "enviada" | "aceptada" | "rechazada";
  created_by_nombre: string | null;
  orden_venta_id: string | null;
  cotizaciones_produccion_lineas: (LineaCotizacionPlanta & { orden: number; producto_id: string | null })[];
}
interface Renglon {
  texto: string;
  descripcion: string;
  cantidad: string;
  unidad: string;
  /** Precio c/IVA como lo ve el cliente. */
  precio: string;
  costo: number | null;
  productoPlantaId: string | null;
  confianza: number;
  alternativas: ProductoCotizador[];
}

const campo = "rounded border border-slate-300 px-2 py-1 text-sm";
const boton = "rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const botonSuave = "rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50";
const $ = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
const hora = (iso: string) => new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const conIva = (sin: number | null) => (sin == null ? "" : String(Math.round(sin * 1.16 * 100) / 100));

function espera(min: number | null) {
  if (min == null) return null;
  const texto = min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} d`;
  const clase = min >= 120 ? "bg-red-100 text-red-800" : min >= 30 ? "bg-amber-100 text-amber-800" : "bg-sky-50 text-sky-700";
  return <span className={`rounded px-1.5 py-0.5 text-xs ${clase}`}>espera {texto}</span>;
}

export function Crm() {
  const { soloConsulta } = useAuth();
  const [empresaFiltro] = useEmpresaFiltro();
  const { data: empresas = [] } = useEmpresasAlcance();
  const [empresaId, setEmpresaId] = useState(empresaFiltro);
  useEffect(() => {
    if (!empresaId && empresas.length) setEmpresaId(empresas[0].id);
  }, [empresaId, empresas]);
  const [vista, setVista] = useState<EtapaCrm | "espera" | "activos">("activos");
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const { data: prospectos = [], isLoading } = useQuery({
    queryKey: ["crm-prospectos", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_prospectos").select("*").eq("empresa_id", empresaId).order("updated_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as Prospecto[];
    },
  });

  const cuenta = (f: (p: Prospecto) => boolean) => prospectos.filter(f).length;
  const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const lista = prospectos
    .filter((p) => (vista === "activos" ? p.etapa !== "ganado" && p.etapa !== "perdido" : vista === "espera" ? esperaRespuesta(p) : p.etapa === vista))
    .filter((p) => !texto.trim() || sinAcentos(`${p.nombre} ${p.telefono ?? ""}`).includes(sinAcentos(texto.trim())))
    .sort((a, b) => (minutosEsperando(b) ?? -1) - (minutosEsperando(a) ?? -1));
  const seleccionado = prospectos.find((p) => p.id === abierto) ?? null;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">CRM de ventas</h1>
          <p className="text-sm text-slate-600">
            Contactos de WhatsApp y redes: pega lo que escribió el cliente, el sistema arma la cotización con los productos de la empresa, la revisas y la mandas por WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SelectorEmpresa value={empresaId} onChange={(v) => { setEmpresaId(v); setAbierto(null); }} vacio={null} />
          {!soloConsulta && (
            <button className={boton} onClick={() => setNuevo((v) => !v)}>
              + Nuevo contacto
            </button>
          )}
        </div>
      </div>

      {nuevo && empresaId && (
        <NuevoContacto
          empresaId={empresaId}
          onListo={(id) => {
            setNuevo(false);
            setAbierto(id);
          }}
        />
      )}

      <div className="flex flex-wrap gap-1 text-sm">
        {(
          [
            ["activos", `Activos (${cuenta((p) => p.etapa !== "ganado" && p.etapa !== "perdido")})`],
            ["espera", `Esperan respuesta (${cuenta(esperaRespuesta)})`],
            ...ETAPAS_CRM.map((e) => [e, `${ETIQUETA_ETAPA_CRM[e]} (${cuenta((p) => p.etapa === e)})`] as [EtapaCrm, string]),
          ] as [typeof vista, string][]
        ).map(([clave, etiqueta]) => (
          <button key={clave} onClick={() => setVista(clave)} className={`rounded-full px-3 py-1 ${vista === clave ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
            {etiqueta}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-2">
          <input className={`${campo} w-full`} placeholder="Buscar por nombre o teléfono" value={texto} onChange={(e) => setTexto(e.target.value)} />
          {isLoading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : lista.length === 0 ? (
            <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">Sin contactos en esta vista.</p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200 bg-white">
              {lista.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setAbierto(p.id)} className={`w-full px-3 py-2 text-left hover:bg-slate-50 ${abierto === p.id ? "bg-sky-50" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-slate-900">{p.nombre}</span>
                      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${CLASE_ETAPA_CRM[p.etapa]}`}>{ETIQUETA_ETAPA_CRM[p.etapa]}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{ETIQUETA_CANAL[p.canal]}</span>
                      {p.telefono && <span>{p.telefono}</span>}
                      {espera(minutosEsperando(p))}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>{seleccionado ? <Detalle key={seleccionado.id} prospecto={seleccionado} /> : <p className="rounded border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">Elige un contacto o da de alta uno nuevo.</p>}</div>
      </div>
    </div>
  );
}

function NuevoContacto({ empresaId, onListo }: { empresaId: string; onListo: (id: string) => void }) {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [canal, setCanal] = useState<CanalCrm>("whatsapp");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState<string | null>(null);
  const crear = useMutation({
    mutationFn: async () => {
      if (!nombre.trim()) throw new Error("Escribe el nombre del cliente.");
      const { data, error } = await supabase.from("crm_prospectos").insert({ empresa_id: empresaId, nombre: nombre.trim(), telefono: telefono.trim() || null, canal }).select("id").single();
      if (error) throw error;
      if (mensaje.trim()) {
        const { error: e2 } = await supabase.from("crm_mensajes").insert({ prospecto_id: data.id, empresa_id: empresaId, direccion: "entrante", texto: mensaje.trim() });
        if (e2) throw e2;
      }
      return data.id as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["crm-prospectos", empresaId] });
      onListo(id);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <form
      className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3"
      data-sin-borrador
      onSubmit={(e) => {
        e.preventDefault();
        crear.mutate();
      }}
    >
      <label className="text-sm">
        <span className="text-slate-600">Nombre</span>
        <input className={`${campo} w-full`} value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
      </label>
      <label className="text-sm">
        <span className="text-slate-600">Teléfono / WhatsApp</span>
        <input className={`${campo} w-full`} value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="10 dígitos" inputMode="tel" />
      </label>
      <label className="text-sm">
        <span className="text-slate-600">Llegó por</span>
        <select className={`${campo} w-full`} value={canal} onChange={(e) => setCanal(e.target.value as CanalCrm)}>
          {(Object.keys(ETIQUETA_CANAL) as CanalCrm[]).map((c) => (
            <option key={c} value={c}>
              {ETIQUETA_CANAL[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm sm:col-span-3">
        <span className="text-slate-600">Lo que escribió el cliente (pégalo tal cual)</span>
        <textarea className={`${campo} w-full`} rows={3} value={mensaje} onChange={(e) => setMensaje(e.target.value)} placeholder="Ej. Buenas tardes, me cotiza 10 rollos de malla 10.5 y 20 varillas de 3/8" />
      </label>
      {error && <p className="text-sm text-red-700 sm:col-span-3">{error}</p>}
      <div className="sm:col-span-3">
        <button type="submit" className={boton} disabled={crear.isPending}>
          {crear.isPending ? "Guardando…" : "Guardar y abrir"}
        </button>
      </div>
    </form>
  );
}

function Detalle({ prospecto }: { prospecto: Prospecto }) {
  const { perfil, soloConsulta } = useAuth();
  const qc = useQueryClient();
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nuevoMsg, setNuevoMsg] = useState("");
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["crm-prospectos", prospecto.empresa_id] });
    qc.invalidateQueries({ queryKey: ["crm-mensajes", prospecto.id] });
    qc.invalidateQueries({ queryKey: ["crm-cotizaciones", prospecto.id] });
  };

  const { data: mensajes = [] } = useQuery({
    queryKey: ["crm-mensajes", prospecto.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_mensajes").select("id, direccion, texto, cotizacion_id, created_by_nombre, created_at").eq("prospecto_id", prospecto.id).order("created_at");
      if (error) throw error;
      return (data ?? []) as Mensaje[];
    },
  });
  const { data: cotizaciones = [] } = useQuery({
    queryKey: ["crm-cotizaciones", prospecto.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cotizaciones_produccion")
        .select("id, folio, fecha, contraparte, obra, vigencia_dias, condicion_pago, dias_credito, notas, cliente_id, estatus, created_by_nombre, orden_venta_id, cotizaciones_produccion_lineas(orden, producto_id, descripcion, cantidad, unidad, precio_unitario, costo_unitario)")
        .eq("crm_prospecto_id", prospecto.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CotizacionCrm[];
    },
  });
  const { data: empresa } = useEmpresaCotizadora(prospecto.empresa_id);

  // Lo que el cliente escribió después de nuestra última respuesta: es lo que
  // hay que cotizar.
  const pendienteDeCotizar = useMemo(() => {
    const ultimaSalida = [...mensajes].reverse().find((m) => m.direccion === "saliente");
    const nuevos = mensajes.filter((m) => m.direccion === "entrante" && (!ultimaSalida || m.created_at > ultimaSalida.created_at));
    return (nuevos.length ? nuevos : mensajes.filter((m) => m.direccion === "entrante").slice(-1)).map((m) => m.texto).join("\n");
  }, [mensajes]);

  const registrar = useMutation({
    mutationFn: async ({ direccion, textoMsg, cotizacionId }: { direccion: "entrante" | "saliente"; textoMsg: string; cotizacionId?: string | null }) => {
      const { error } = await supabase.from("crm_mensajes").insert({ prospecto_id: prospecto.id, empresa_id: prospecto.empresa_id, direccion, texto: textoMsg, cotizacion_id: cotizacionId ?? null });
      if (error) throw error;
    },
    onSuccess: () => {
      setNuevoMsg("");
      refrescar();
    },
    onError: (e: Error) => setError(e.message),
  });

  const cambiar = useMutation({
    mutationFn: async (cambios: Partial<Prospecto>) => {
      const { error } = await supabase.from("crm_prospectos").update(cambios).eq("id", prospecto.id);
      if (error) throw error;
    },
    onSuccess: refrescar,
    onError: (e: Error) => setError(e.message),
  });

  const imprimir = (c: CotizacionCrm, ventana: Window | null) => {
    const ls = [...c.cotizaciones_produccion_lineas].sort((a, b) => a.orden - b.orden);
    const html = htmlCotizacionPlanta(
      { ...c, empresa_nombre: empresa?.nombre ?? "", empresa_rfc: empresa?.rfc ?? null, elaboro: c.created_by_nombre, firma_nombre: c.created_by_nombre, membrete: empresa?.membrete ?? null },
      ls,
      empresa?.codigo ? `${window.location.origin}/logos/${empresa.codigo.toLowerCase()}.png` : null,
    );
    if (!abrirParaImprimir(html, ventana)) {
      cerrarVentanaImpresion(ventana);
      setAviso("El navegador bloqueó la ventana. Permite ventanas emergentes.");
    }
  };

  const enviarWhatsapp = (c: CotizacionCrm) => {
    const ls = [...c.cotizaciones_produccion_lineas].sort((a, b) => a.orden - b.orden);
    const textoMsg = mensajeCotizacion({ empresa: empresa?.nombre ?? "", folio: c.folio, cliente: prospecto.nombre, vigenciaDias: c.vigencia_dias, lineas: ls, vendedor: perfil?.nombre });
    window.open(enlaceWhatsapp(prospecto.telefono, textoMsg), "_blank", "noopener");
    registrar.mutate({ direccion: "saliente", textoMsg, cotizacionId: c.id });
  };

  const ganar = useMutation({
    mutationFn: async (c: CotizacionCrm) => {
      if (!window.confirm(`¿${prospecto.nombre} aceptó la ${c.folio}? Se genera la orden de venta.`)) return null;
      const ls = [...c.cotizaciones_produccion_lineas].sort((a, b) => a.orden - b.orden);
      const { data, error } = await supabase.rpc("fn_orden_ia_guardar", {
        p_id: null,
        p_tipo: "OV",
        p_empresa: prospecto.empresa_id,
        p_contraparte: c.contraparte,
        p_proyecto: c.obra,
        p_fecha: hoy(),
        p_lineas: lineasParaOrdenVenta(ls),
        p_forma_pago: null,
        p_condicion: c.condicion_pago,
        p_fecha_entrega: null,
        p_lugar_entrega: null,
        p_notas: `De la cotización ${c.folio} (CRM, ${ETIQUETA_CANAL[prospecto.canal]})`,
      });
      if (error) throw error;
      const ov = data as { id: string; folio: string };
      const { error: e2 } = await supabase.from("cotizaciones_produccion").update({ orden_venta_id: ov.id, estatus: "aceptada" }).eq("id", c.id);
      if (e2) throw e2;
      const { error: e3 } = await supabase.from("crm_prospectos").update({ etapa: "ganado" }).eq("id", prospecto.id);
      if (e3) throw e3;
      return ov.folio;
    },
    onSuccess: (folio) => {
      if (folio) setAviso(`¡Venta ganada! Orden de venta ${folio} generada (Compras → Órdenes de venta).`);
      refrescar();
    },
    onError: (e: Error) => setError(e.message),
  });

  const perder = () => {
    const motivo = window.prompt("¿Por qué se perdió? (precio, tiempo de entrega, no contestó…)");
    if (motivo === null) return;
    cambiar.mutate({ etapa: "perdido", motivo_perdida: motivo.trim() || "Sin motivo" });
    cotizaciones.filter((c) => c.estatus === "enviada").forEach((c) => supabase.from("cotizaciones_produccion").update({ estatus: "rechazada" }).eq("id", c.id).then(refrescar));
  };

  return (
    <div className="space-y-4">
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{prospecto.nombre}</h2>
            <p className="text-sm text-slate-600">
              {ETIQUETA_CANAL[prospecto.canal]}
              {prospecto.telefono && (
                <>
                  {" · "}
                  <a className="text-emerald-700 underline" href={enlaceWhatsapp(prospecto.telefono, "")} target="_blank" rel="noreferrer">
                    {prospecto.telefono}
                  </a>
                </>
              )}
              {prospecto.asignado_nombre && ` · atiende ${prospecto.asignado_nombre}`}
            </p>
            {prospecto.motivo_perdida && <p className="text-xs text-slate-500">Perdido: {prospecto.motivo_perdida}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={campo} value={prospecto.etapa} disabled={soloConsulta} onChange={(e) => (e.target.value === "perdido" ? perder() : cambiar.mutate({ etapa: e.target.value as EtapaCrm }))}>
              {ETAPAS_CRM.map((e) => (
                <option key={e} value={e}>
                  {ETIQUETA_ETAPA_CRM[e]}
                </option>
              ))}
            </select>
            {!soloConsulta && perfil && (
              <button className={botonSuave} onClick={() => cambiar.mutate({ asignado_a: perfil.id } as Partial<Prospecto>)}>
                Lo atiendo yo
              </button>
            )}
          </div>
        </div>
      </div>

      {aviso && (
        <div className="flex justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
          <span>{aviso}</span>
          <button className="text-xs underline" onClick={() => setAviso(null)}>cerrar</button>
        </div>
      )}
      {error && (
        <div className="flex justify-between gap-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          <span>{error}</span>
          <button className="text-xs underline" onClick={() => setError(null)}>cerrar</button>
        </div>
      )}

      <div className="rounded border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Conversación</h3>
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {mensajes.length === 0 && <p className="text-sm text-slate-500">Sin mensajes todavía.</p>}
          {mensajes.map((m) => (
            <div key={m.id} className={`flex ${m.direccion === "saliente" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.direccion === "saliente" ? "bg-emerald-50 text-slate-800" : "bg-slate-100 text-slate-800"}`}>
                {m.texto}
                <div className="mt-1 text-right text-[11px] text-slate-500">
                  {hora(m.created_at)}
                  {m.direccion === "saliente" && m.created_by_nombre && ` · ${m.created_by_nombre}`}
                </div>
              </div>
            </div>
          ))}
        </div>
        {!soloConsulta && (
          <div className="mt-3 space-y-2">
            <textarea className={`${campo} w-full`} rows={2} value={nuevoMsg} onChange={(e) => setNuevoMsg(e.target.value)} placeholder="Pega aquí lo que escribió el cliente, o escribe tu respuesta" />
            <div className="flex flex-wrap gap-2">
              <button className={botonSuave} disabled={!nuevoMsg.trim() || registrar.isPending} onClick={() => registrar.mutate({ direccion: "entrante", textoMsg: nuevoMsg.trim() })}>
                Registrar mensaje del cliente
              </button>
              <button
                className={botonSuave}
                disabled={!nuevoMsg.trim() || registrar.isPending}
                onClick={() => {
                  window.open(enlaceWhatsapp(prospecto.telefono, nuevoMsg.trim()), "_blank", "noopener");
                  registrar.mutate({ direccion: "saliente", textoMsg: nuevoMsg.trim() });
                }}
              >
                Responder por WhatsApp
              </button>
            </div>
          </div>
        )}
      </div>

      {!soloConsulta && (
        <CotizacionAutomatica
          prospecto={prospecto}
          textoInicial={pendienteDeCotizar}
          onGuardada={(c) => {
            setAviso(`Cotización ${c.folio} guardada. Revísala y mándala por WhatsApp.`);
            refrescar();
          }}
          onError={setError}
        />
      )}

      {cotizaciones.length > 0 && (
        <div className="rounded border border-slate-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Cotizaciones de este contacto</h3>
          <ul className="divide-y divide-slate-100">
            {cotizaciones.map((c) => {
              const t = totalesCotizacion(c.cotizaciones_produccion_lineas);
              const enviada = mensajes.some((m) => m.cotizacion_id === c.id);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <span className="font-mono text-xs">{c.folio}</span> · {c.fecha} · <b>{$(t.total)}</b>
                    <span className="ml-2 text-xs text-slate-500">
                      {c.estatus === "aceptada" ? "aceptada" : c.estatus === "rechazada" ? "rechazada" : enviada ? "enviada por WhatsApp" : "sin enviar"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button className={botonSuave} onClick={() => imprimir(c, abrirVentanaImpresion())}>
                      PDF
                    </button>
                    {!soloConsulta && c.estatus === "enviada" && (
                      <>
                        <button className={`${botonSuave} border-emerald-300 text-emerald-800`} onClick={() => enviarWhatsapp(c)}>
                          {enviada ? "Reenviar por WhatsApp" : "Enviar por WhatsApp"}
                        </button>
                        <button className={botonSuave} disabled={ganar.isPending} onClick={() => ganar.mutate(c)}>
                          Aceptó → orden de venta
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function CotizacionAutomatica({
  prospecto,
  textoInicial,
  onGuardada,
  onError,
}: {
  prospecto: Prospecto;
  textoInicial: string;
  onGuardada: (c: { id: string; folio: string }) => void;
  onError: (s: string) => void;
}) {
  const { perfil } = useAuth();
  const veMargen = !!perfil && ["admin", "corporativo", "direccion", "empresa"].includes(perfil.rol);
  const { data: catalogo, isLoading } = useCatalogoCotizador(prospecto.empresa_id);
  const [pedido, setPedido] = useState(textoInicial);
  useEffect(() => setPedido(textoInicial), [textoInicial]);
  const [renglones, setRenglones] = useState<Renglon[] | null>(null);
  const [buscando, setBuscando] = useState<number | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [vigencia, setVigencia] = useState("15");

  const productos = catalogo?.productos ?? [];
  const desdeProducto = (p: ProductoCotizador, base: Partial<Renglon>): Renglon => ({
    texto: base.texto ?? "",
    descripcion: p.descripcion,
    cantidad: base.cantidad ?? "1",
    unidad: p.unidad,
    precio: conIva(p.precio),
    costo: p.costo,
    productoPlantaId: p.productoPlantaId,
    confianza: base.confianza ?? 1,
    alternativas: base.alternativas ?? [],
  });

  const armar = () => {
    const r = interpretarPedido(pedido, productos).map((x) =>
      x.producto
        ? desdeProducto(x.producto, { texto: x.texto, cantidad: String(x.cantidad), confianza: x.confianza, alternativas: x.alternativas })
        : { texto: x.texto, descripcion: "", cantidad: String(x.cantidad), unidad: x.unidad ?? "pza", precio: "", costo: null, productoPlantaId: null, confianza: 0, alternativas: x.alternativas },
    );
    setRenglones(r.length ? r : [{ texto: "", descripcion: "", cantidad: "1", unidad: "pza", precio: "", costo: null, productoPlantaId: null, confianza: 0, alternativas: [] }]);
  };
  const setR = (i: number, cambios: Partial<Renglon>) => setRenglones((rs) => rs!.map((r, j) => (j === i ? { ...r, ...cambios } : r)));
  const elegir = (i: number, p: ProductoCotizador) => {
    setRenglones((rs) => rs!.map((r, j) => (j === i ? desdeProducto(p, { texto: r.texto, cantidad: r.cantidad, alternativas: r.alternativas }) : r)));
    setBuscando(null);
  };

  const validas = (renglones ?? []).filter((r) => r.descripcion.trim() && Number(r.cantidad) > 0 && r.precio !== "" && Number(r.precio) > 0);
  const calculo: LineaCotizacionPlanta[] = validas.map((r) => ({ descripcion: r.descripcion.trim(), cantidad: Number(r.cantidad), unidad: r.unidad || "pza", precio_unitario: sinIva(Number(r.precio)), costo_unitario: r.costo }));
  const t = totalesCotizacion(calculo);
  const faltan = (renglones ?? []).length - validas.length;

  const guardar = useMutation({
    mutationFn: async () => {
      if (!validas.length) throw new Error("Ninguna partida tiene producto, cantidad y precio.");
      if (faltan > 0 && !window.confirm(`${faltan} renglón(es) sin producto o sin precio no se van a incluir. ¿Guardar así?`)) return null;
      const { data: cot, error } = await supabase
        .from("cotizaciones_produccion")
        .insert({
          empresa_id: prospecto.empresa_id,
          contraparte: prospecto.nombre,
          cliente_id: prospecto.cliente_id,
          vigencia_dias: Number(vigencia) > 0 ? Math.round(Number(vigencia)) : 15,
          notas: `Pedido por ${ETIQUETA_CANAL[prospecto.canal]}${prospecto.telefono ? ` (${prospecto.telefono})` : ""}`,
          crm_prospecto_id: prospecto.id,
        })
        .select("id, folio")
        .single();
      if (error) throw error;
      const { error: e2 } = await supabase.from("cotizaciones_produccion_lineas").insert(
        validas.map((r, i) => ({
          cotizacion_id: cot.id,
          orden: i,
          producto_id: r.productoPlantaId,
          descripcion: r.descripcion.trim(),
          cantidad: Number(r.cantidad),
          unidad: r.unidad || "pza",
          precio_unitario: sinIva(Number(r.precio)),
          costo_unitario: r.costo,
        })),
      );
      if (e2) throw e2;
      return cot as { id: string; folio: string };
    },
    onSuccess: (c) => {
      if (!c) return;
      setRenglones(null);
      onGuardada(c);
    },
    onError: (e: Error) => onError(e.message),
  });

  return (
    <div className="rounded border border-sky-200 bg-white p-3">
      <h3 className="text-sm font-semibold text-slate-800">Cotización automática</h3>
      <p className="mb-2 text-xs text-slate-500">El sistema lee el pedido y propone productos, cantidades y precios de lista (con IVA). Revisa cada renglón antes de guardar.</p>
      <textarea className={`${campo} w-full`} rows={3} value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Lo que pidió el cliente" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button className={boton} disabled={!pedido.trim() || isLoading} onClick={armar}>
          {isLoading ? "Cargando productos…" : "Armar cotización"}
        </button>
        {!isLoading && productos.length === 0 && <span className="text-xs text-amber-700">Esta empresa no tiene productos con precio: da de alta su catálogo en Almacén → Productos.</span>}
      </div>

      {renglones && (
        <div className="mt-3 space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr>
                  <th className="py-1 pr-2">Pidió</th>
                  <th className="py-1 pr-2">Producto</th>
                  <th className="w-20 py-1 pr-2">Cant.</th>
                  <th className="w-20 py-1 pr-2">Unidad</th>
                  <th className="w-28 py-1 pr-2">Precio c/IVA</th>
                  <th className="w-28 py-1 text-right">Importe</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody>
                {renglones.map((r, i) => (
                  <tr key={i} className={`border-t border-slate-100 align-top ${!r.descripcion ? "bg-amber-50" : r.confianza < 0.75 ? "bg-amber-50/40" : ""}`}>
                    <td className="py-1 pr-2 text-xs text-slate-500">{r.texto || "—"}</td>
                    <td className="py-1 pr-2">
                      <CampoBuscador
                        value={buscando === i ? busqueda : r.descripcion}
                        onChange={(v) => {
                          setBuscando(i);
                          setBusqueda(v);
                          setR(i, { descripcion: v, productoPlantaId: null, costo: null });
                        }}
                        opciones={buscarProductos(productos, buscando === i ? busqueda : r.descripcion, 12).map((p) => ({ clave: p.clave, titulo: p.descripcion, detalle: detalleProducto(p, true, veMargen) }))}
                        onElegir={(clave) => {
                          const p = productos.find((x) => x.clave === clave);
                          if (p) elegir(i, p);
                        }}
                        placeholder={r.descripcion ? "" : "No lo encontré: busca el producto"}
                        className={`${campo} w-full min-w-[14rem]`}
                      />
                      {r.alternativas.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {r.alternativas.slice(0, 3).map((a) => (
                            <button key={a.clave} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-200" onClick={() => elegir(i, a)}>
                              {a.descripcion}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <input className={`${campo} w-full`} type="number" min={0} value={r.cantidad} onChange={(e) => setR(i, { cantidad: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <input className={`${campo} w-full`} value={r.unidad} onChange={(e) => setR(i, { unidad: e.target.value })} />
                    </td>
                    <td className="py-1 pr-2">
                      <input className={`${campo} w-full ${r.descripcion && !r.precio ? "border-amber-400" : ""}`} type="number" min={0} step="0.01" value={r.precio} onChange={(e) => setR(i, { precio: e.target.value })} placeholder="sin precio" />
                    </td>
                    <td className="py-1 text-right">{Number(r.cantidad) > 0 && Number(r.precio) > 0 ? $(Number(r.cantidad) * Number(r.precio)) : ""}</td>
                    <td className="py-1 text-right">
                      <button className="text-xs text-slate-400 hover:text-red-700" onClick={() => setRenglones((rs) => rs!.filter((_, j) => j !== i))} title="Quitar">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="text-xs text-sky-700 underline" onClick={() => setRenglones((rs) => [...(rs ?? []), { texto: "", descripcion: "", cantidad: "1", unidad: "pza", precio: "", costo: null, productoPlantaId: null, confianza: 1, alternativas: [] }])}>
            + agregar renglón
          </button>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2 text-sm">
            <div className="text-slate-600">
              Subtotal {$(t.subtotal)} · IVA {$(t.iva)} · <b className="text-slate-900">Total {$(t.total)}</b>
              {veMargen && t.margen != null && <span className="ml-2 text-xs text-slate-500">margen {t.margenPct}% s/IVA</span>}
              {faltan > 0 && <span className="ml-2 text-xs text-amber-700">{faltan} renglón(es) por completar</span>}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600">
                Vigencia
                <input className={`${campo} ml-1 w-14`} type="number" min={1} value={vigencia} onChange={(e) => setVigencia(e.target.value)} /> días
              </label>
              <button className={boton} disabled={guardar.isPending || !validas.length} onClick={() => guardar.mutate()}>
                {guardar.isPending ? "Guardando…" : "Guardar cotización"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
