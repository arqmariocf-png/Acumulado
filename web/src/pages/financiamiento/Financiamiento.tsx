import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir } from "../../lib/imprimir";
import { amortizar, htmlDocumentoFirmado, type FirmaGuardada } from "../../lib/creditoNomina";
import {
  CONFIG_LEY_2026,
  NIVELES,
  descuentoPorPago,
  dictamen,
  nivelPorClave,
  pagosMinimos,
  prestamoConIntereses,
  proximoViernes,
  type ConfigFinanciamiento,
  type FactoresEstudio,
} from "../../lib/cuentaNomina";
import { descargarCsv } from "../../lib/descargarArchivo";

// Cuentas de nómina y financiamiento a trabajadores (18-oct-2026, Mario: "por
// antigüedad y por buen comportamiento y pago daremos financiamiento estilo
// Mercado Pago"). Estudio con puntaje y nivel, líneas autorizadas, préstamos
// y anticipos, los descuentos de la semana para nómina y las reglas de ley.

const dinero = (n: number | null | undefined) => (n ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const campo = "rounded border border-slate-300 px-2 py-1.5 text-sm";
const boton = "rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const botonSuave = "rounded border border-slate-300 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50";

function hoyMexico(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

interface FilaEstudio extends FactoresEstudio {
  profile_id: string;
  personal_id: string;
  nombre: string;
  puesto: string | null;
  empresa: string | null;
  fecha_ingreso: string | null;
  sueldo_origen: string | null;
  saldo: number;
  linea: number;
  plazo_max_semanas: number | null;
  nivel: string;
  estatus: string | null;
  autorizada_en: string | null;
  deuda_maxima: number | null;
  descuento_maximo: number | null;
}

interface Cargo {
  id: string;
  profile_id: string;
  trabajador_nombre: string | null;
  empresa: string | null;
  origen: string;
  concepto: string;
  monto: number;
  pagos: number;
  descuento_por_pago: number;
  primer_descuento: string;
  estatus: string;
  pagado: number;
  saldo: number;
  atraso: number;
  siguiente_descuento: number;
  ultimo_descuento: string | null;
  created_at: string;
  total: number;
  interes: number;
  iva_interes: number;
  tasa_anual: number;
  cat: number | null;
  acreditante: string | null;
}

interface FirmaRh extends FirmaGuardada {
  id: string;
  profile_id: string;
  tipo: "afiliacion" | "consentimiento" | "pagare";
}

function useConfig() {
  const { perfilReal } = useAuth();
  return useQuery({
    queryKey: ["nomina-config", perfilReal?.grupo_id],
    queryFn: async () => {
      const { data, error } = await supabase.from("nomina_financiamiento_config").select("*").eq("grupo_id", perfilReal!.grupo_id!).maybeSingle();
      if (error) throw error;
      return (data as ConfigFinanciamiento | null) ?? CONFIG_LEY_2026;
    },
    enabled: !!perfilReal?.grupo_id,
  });
}

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas-financiamiento"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, codigo").order("nombre");
      if (error) throw error;
      return (data ?? []) as { id: string; nombre: string; codigo: string | null }[];
    },
  });
}

function useFirmas() {
  return useQuery({
    queryKey: ["credito-firmas"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credito_firmas")
        .select("id, profile_id, tipo, titulo, contenido, firma, hash, firmante_nombre, firmado_en, ip, version, revocada_en, revocada_motivo")
        .order("firmado_en", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FirmaRh[];
    },
  });
}

/** ¿Firmó afiliación y consentimiento (sin revocar)? */
function afiliados(firmas: FirmaRh[] | undefined): Set<string> {
  const por = new Map<string, Set<string>>();
  for (const f of firmas ?? []) if (!f.revocada_en) por.set(f.profile_id, new Set([...(por.get(f.profile_id) ?? []), f.tipo]));
  return new Set([...por.entries()].filter(([, t]) => t.has("afiliacion") && t.has("consentimiento")).map(([id]) => id));
}

function useEstudio() {
  return useQuery({
    queryKey: ["estudio-financiamiento"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("fn_estudio_financiamiento");
      if (error) throw error;
      return (data ?? []) as FilaEstudio[];
    },
  });
}

function useCargos() {
  return useQuery({
    queryKey: ["nomina-cargos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_nomina_cargos").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Cargo[];
    },
  });
}

const PESTANAS = [
  { clave: "estudio", titulo: "Estudio" },
  { clave: "cuentas", titulo: "Cuentas y cargos" },
  { clave: "descuentos", titulo: "Descuentos de la semana" },
  { clave: "documentos", titulo: "Documentos firmados" },
  { clave: "reglas", titulo: "Reglas" },
];

export function Financiamiento() {
  const [params, setParams] = useSearchParams();
  const actual = PESTANAS.find((p) => p.clave === params.get("tab"))?.clave ?? "estudio";
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Cuentas de nómina y financiamiento</h1>
      <p className="mb-3 text-sm text-slate-500">
        Línea de crédito por trabajador que crece con su antigüedad, comportamiento y pagos. Cada trabajador firma en su app su afiliación, su consentimiento de
        descuento y el pagaré de cada préstamo. Compras y anticipos van <b>sin intereses</b>; los préstamos con intereses los otorga la financiera (Reglas).
      </p>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {PESTANAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            onClick={() => setParams({ tab: p.clave })}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${actual === p.clave ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500"}`}
          >
            {p.titulo}
          </button>
        ))}
      </div>
      {actual === "estudio" && <Estudio />}
      {actual === "cuentas" && <Cuentas />}
      {actual === "descuentos" && <Descuentos />}
      {actual === "documentos" && <Documentos />}
      {actual === "reglas" && <Reglas />}
    </div>
  );
}

function Estudio() {
  const qc = useQueryClient();
  const { soloConsulta, perfil } = useAuth();
  // El sueldo lo fija Recursos Humanos (Mario, 18-oct-2026); dirección autoriza líneas.
  const fijaSueldo = perfil?.rol === "rh" || perfil?.rol === "admin";
  const estudio = useEstudio();
  const config = useConfig();
  const firmas = useFirmas();
  const conFirma = afiliados(firmas.data);
  const [filtro, setFiltro] = useState<"todos" | "con_acceso" | "falta_sueldo">("todos");
  const [abierto, setAbierto] = useState<string | null>(null);
  const filas = useMemo(
    () => (estudio.data ?? []).map((f) => ({ f, d: dictamen(f, config.data ?? CONFIG_LEY_2026) })),
    [estudio.data, config.data],
  );
  const lista = filas.filter(({ f, d }) => filtro === "todos" || (filtro === "con_acceso" ? d.nivel.clave !== "sin_acceso" : !f.sueldo_semanal));
  const resumen = {
    conAcceso: filas.filter((x) => x.d.nivel.clave !== "sin_acceso").length,
    sinSueldo: filas.filter((x) => !x.f.sueldo_semanal).length,
    lineas: filas.reduce((s, x) => s + (x.f.linea || 0), 0),
    saldo: filas.reduce((s, x) => s + (x.f.saldo || 0), 0),
  };

  const guardar = useMutation({
    mutationFn: async (v: { profile_id: string; sueldo_semanal?: number | null; linea?: number; plazo_max_semanas?: number; nivel?: string; puntaje?: number; estatus?: string }) => {
      const { error } = await supabase.from("cuentas_nomina").upsert(v, { onConflict: "profile_id" });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["estudio-financiamiento"] }),
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <Dato titulo="Con acceso" valor={`${resumen.conAcceso} de ${filas.length}`} />
        <Dato titulo="Sin sueldo capturado" valor={String(resumen.sinSueldo)} alerta={resumen.sinSueldo > 0} />
        <Dato titulo="Líneas autorizadas" valor={dinero(resumen.lineas)} />
        <Dato titulo="Saldo prestado hoy" valor={dinero(resumen.saldo)} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["todos", "con_acceso", "falta_sueldo"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setFiltro(k)} className={`rounded px-2 py-1 ${filtro === k ? "bg-slate-900 text-white" : "border border-slate-300"}`}>
            {k === "todos" ? "Todos" : k === "con_acceso" ? "Con acceso" : "Falta sueldo"}
          </button>
        ))}
        {!fijaSueldo && <span className="text-xs text-amber-700">El sueldo semanal lo fija Recursos Humanos.</span>}
        <span className="text-xs text-slate-500">Puntaje: antigüedad 30 · asistencia 15 · cumplimiento 15 · cuidado de herramienta/EPP 10 · historial de pago 30.</span>
      </div>
      {guardar.error && <p className="text-sm text-red-600">{(guardar.error as Error).message}</p>}
      {estudio.isLoading && <p className="text-sm text-slate-400">Calculando el estudio…</p>}
      {estudio.error && <p className="text-sm text-red-600">{(estudio.error as Error).message}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Trabajador</th>
              <th className="px-2 py-2">Antig.</th>
              <th className="px-2 py-2">Sueldo semanal</th>
              <th className="px-2 py-2">Puntaje</th>
              <th className="px-2 py-2">Nivel sugerido</th>
              <th className="px-2 py-2 text-right">Línea sugerida</th>
              <th className="px-2 py-2">Autorizado</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista.map(({ f, d }) => {
              const autorizado = nivelPorClave(f.nivel);
              return (
                <Fragment key={f.profile_id}>
                  <tr className="border-t border-slate-100 align-top">
                    <td className="px-2 py-2">
                      <button type="button" className="text-left font-medium text-slate-900 hover:underline" onClick={() => setAbierto(abierto === f.profile_id ? null : f.profile_id)}>
                        {f.nombre}
                      </button>
                      <div className="text-xs text-slate-500">
                        {f.puesto ?? "—"}
                        {f.empresa ? ` · ${f.empresa}` : ""}
                      </div>
                      <div className={`text-[11px] ${conFirma.has(f.profile_id) ? "text-emerald-700" : "text-slate-400"}`}>
                        {conFirma.has(f.profile_id) ? "✍️ afiliación firmada" : "sin afiliación firmada"}
                      </div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">{f.meses_antiguedad} m</td>
                    <td className="px-2 py-2">
                      <SueldoEditable
                        valor={f.sueldo_semanal}
                        origen={f.sueldo_origen}
                        deshabilitado={soloConsulta || !fijaSueldo}
                        onGuardar={(v) => guardar.mutate({ profile_id: f.profile_id, sueldo_semanal: v })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <span className="font-mono font-semibold">{d.puntaje}</span>
                    </td>
                    <td className="px-2 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${d.nivel.clase}`}>
                        {d.nivel.icono} {d.nivel.nombre}
                      </span>
                      {d.bloqueos.length > 0 && <div className="mt-0.5 text-xs text-amber-700">{d.bloqueos.join(" · ")}</div>}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {d.lineaSugerida ? dinero(d.lineaSugerida) : "—"}
                      {d.lineaSugerida > 0 && <div className="text-xs text-slate-500">hasta {d.plazo} semanas</div>}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {f.linea > 0 ? (
                        <>
                          <span className={`rounded px-1.5 py-0.5 text-xs ${autorizado.clase}`}>
                            {autorizado.icono} {dinero(f.linea)}
                          </span>
                          {f.estatus === "suspendida" && <div className="text-xs text-red-600">suspendida</div>}
                          {f.saldo > 0 && <div className="text-xs text-slate-500">debe {dinero(f.saldo)}</div>}
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">sin línea</span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {!soloConsulta && d.lineaSugerida > 0 && (f.linea !== d.lineaSugerida || f.nivel !== d.nivel.clave) && (
                        <button
                          type="button"
                          className={boton}
                          disabled={guardar.isPending}
                          onClick={() =>
                            guardar.mutate({
                              profile_id: f.profile_id,
                              sueldo_semanal: f.sueldo_semanal,
                              linea: d.lineaSugerida,
                              plazo_max_semanas: d.plazo,
                              nivel: d.nivel.clave,
                              puntaje: d.puntaje,
                              estatus: "activa",
                            })
                          }
                        >
                          {f.linea > 0 ? "Actualizar" : "Autorizar"}
                        </button>
                      )}
                      {!soloConsulta && f.linea > 0 && (
                        <button
                          type="button"
                          className={`${botonSuave} ml-1`}
                          onClick={() => guardar.mutate({ profile_id: f.profile_id, sueldo_semanal: f.sueldo_semanal, estatus: f.estatus === "suspendida" ? "activa" : "suspendida" })}
                        >
                          {f.estatus === "suspendida" ? "Reactivar" : "Suspender"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {abierto === f.profile_id && (
                    <tr className="bg-slate-50">
                      <td colSpan={8} className="px-3 py-2 text-xs text-slate-700">
                        <div className="grid gap-1 sm:grid-cols-5">
                          {d.partes.map((p) => (
                            <div key={p.clave}>
                              <div className="font-medium">
                                {p.nombre}: {p.puntos}/{p.maximo}
                              </div>
                              <div className="h-1.5 overflow-hidden rounded bg-slate-200">
                                <div className="h-full bg-sky-500" style={{ width: `${(p.puntos / p.maximo) * 100}%` }} />
                              </div>
                              <div className="text-slate-500">{p.nota}</div>
                            </div>
                          ))}
                        </div>
                        <p className="mt-2">
                          Tope de ley: deuda máxima {dinero(d.deudaMaxima)} (un mes de sueldo) · descuento máximo {dinero(d.descuentoMaximo)} por semana (30 % del
                          excedente del mínimo).
                          {d.siguiente && d.nivel.clave !== "sin_acceso" && ` Le faltan ${d.siguiente.faltan} puntos para ${d.siguiente.nivel.icono} ${d.siguiente.nivel.nombre}.`}
                          {f.fecha_ingreso && ` Ingreso: ${f.fecha_ingreso.split("-").reverse().join("/")}.`}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Niveles: {NIVELES.filter((n) => n.clave !== "sin_acceso").map((n) => `${n.icono} ${n.nombre} desde ${n.minimo} pts (${Math.round(n.pctTope * 100)} % del mes, ${n.plazo} semanas)`).join(" · ")}.
        La línea nunca pasa de lo que la ley deja descontar en su plazo.
      </p>
    </div>
  );
}

function SueldoEditable({ valor, origen, deshabilitado, onGuardar }: { valor: number | null; origen: string | null; deshabilitado: boolean; onGuardar: (v: number | null) => void }) {
  const [texto, setTexto] = useState(valor != null ? String(valor) : "");
  const cambiado = (texto === "" ? null : Number(texto)) !== valor;
  return (
    <span className="flex items-center gap-1">
      <input type="number" min={0} step="0.01" value={texto} disabled={deshabilitado} onChange={(e) => setTexto(e.target.value)} className={`${campo} w-24 py-1 text-right`} placeholder="$" />
      {cambiado && (
        <button type="button" className="text-xs text-sky-700 underline" onClick={() => onGuardar(texto === "" ? null : Number(texto))}>
          guardar
        </button>
      )}
      {!cambiado && origen && <span className="text-[10px] text-slate-400">{origen === "captura" ? "lo fijó RH" : origen === "contrato" ? "del contrato" : origen}</span>}
    </span>
  );
}

function Dato({ titulo, valor, alerta }: { titulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className={`rounded border p-2 ${alerta ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <div className="text-xs text-slate-500">{titulo}</div>
      <div className="text-lg font-semibold text-slate-900">{valor}</div>
    </div>
  );
}

function Cuentas() {
  const qc = useQueryClient();
  const { soloConsulta } = useAuth();
  const cargos = useCargos();
  const estudio = useEstudio();
  const config = useConfig();
  const empresas = useEmpresas();
  const firmas = useFirmas();
  const conFirma = afiliados(firmas.data);
  const [verTodos, setVerTodos] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState({ profile: "", origen: "prestamo", concepto: "", monto: "", pagos: "1" });
  const conLinea = (estudio.data ?? []).filter((f) => f.linea > 0 && f.estatus !== "suspendida");
  const elegido = conLinea.find((f) => f.profile_id === nuevo.profile);
  const monto = Number(nuevo.monto) || 0;
  const disponible = elegido ? Math.max(0, elegido.linea - elegido.saldo) : 0;
  const cfg = config.data ?? CONFIG_LEY_2026;
  // La empresa del trabajador se compara por nombre (el estudio trae el nombre).
  const empresaTrabajador = empresas.data?.find((e) => e.nombre === elegido?.empresa)?.id ?? null;
  const conInteres = nuevo.origen === "prestamo" && !!elegido && prestamoConIntereses(cfg, empresaTrabajador);
  const financiera = empresas.data?.find((e) => e.id === cfg.acreditante_empresa_id)?.nombre ?? "la financiera";
  const viernes = proximoViernes(hoyMexico());
  const tasa = conInteres ? (cfg.tasa_anual_prestamos ?? 0) : 0;
  const ivaInt = cfg.iva_intereses ?? 16;
  const tope = conInteres ? Math.round((elegido?.sueldo_semanal ?? 0) * (cfg.capacidad_pago_pct ?? 30)) / 100 : (elegido?.descuento_maximo ?? 0);
  const plazoMax = conInteres ? (cfg.plazo_max_semanas_intereses ?? 26) : (elegido?.plazo_max_semanas ?? 1);
  const minimo = elegido ? (conInteres ? (Array.from({ length: plazoMax }, (_, k) => k + 1).find((n) => amortizar(monto, tasa, ivaInt, n, viernes).descuentoPorPago <= tope + 0.005) ?? Infinity) : pagosMinimos(monto, tope)) : 1;
  const plan = amortizar(monto, tasa, ivaInt, Number(nuevo.pagos) || 1, viernes);

  const crear = useMutation({
    mutationFn: async () => {
      if (!elegido) throw new Error("Elige al trabajador.");
      const { error } = await supabase.rpc("fn_nomina_crear_cargo", {
        p_profile: elegido.profile_id,
        p_origen: nuevo.origen,
        p_concepto: nuevo.concepto.trim() || (nuevo.origen === "anticipo" ? "Anticipo de sueldo" : "Préstamo"),
        p_monto: monto,
        p_pagos: Number(nuevo.pagos),
        p_venta: null,
        p_primer_descuento: null,
      });
      if (error) throw error;
      return elegido.nombre;
    },
    onSuccess: (nombre) => {
      setAviso(`Listo. Queda esperando que ${nombre} firme su pagaré en su app (Mi personaje → Mi QR); no se descuenta nada hasta que firme.`);
      setNuevo({ profile: "", origen: "prestamo", concepto: "", monto: "", pagos: "1" });
      void qc.invalidateQueries({ queryKey: ["nomina-cargos"] });
      void qc.invalidateQueries({ queryKey: ["estudio-financiamiento"] });
    },
  });

  const cancelar = useMutation({
    mutationFn: async (c: Cargo) => {
      const motivo = window.prompt(`¿Por qué se cancela el préstamo de ${c.trabajador_nombre}?`, "No lo firmó");
      if (motivo == null) return;
      const { error } = await supabase.rpc("fn_nomina_cancelar_por_firmar", { p_cargo: c.id, p_motivo: motivo });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["nomina-cargos"] }),
  });

  const lista = (cargos.data ?? []).filter((c) => verTodos || c.estatus === "vigente" || c.estatus === "por_firmar");
  return (
    <div className="space-y-4">
      {!soloConsulta && (
        <form
          className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            crear.mutate();
          }}
        >
          <label className="text-sm sm:col-span-2">
            Trabajador con línea
            <select className={`${campo} w-full`} value={nuevo.profile} onChange={(e) => setNuevo({ ...nuevo, profile: e.target.value })}>
              <option value="">Elige…</option>
              {conLinea.map((f) => (
                <option key={f.profile_id} value={f.profile_id}>
                  {f.nombre} · disponible {dinero(Math.max(0, f.linea - f.saldo))}
                  {conFirma.has(f.profile_id) ? "" : " · falta que firme su afiliación"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Tipo
            <select className={`${campo} w-full`} value={nuevo.origen} onChange={(e) => setNuevo({ ...nuevo, origen: e.target.value })}>
              <option value="prestamo">Préstamo</option>
              <option value="anticipo">Anticipo de sueldo</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          <label className="text-sm">
            Monto
            <input type="number" min={0} step="0.01" className={`${campo} w-full`} value={nuevo.monto} onChange={(e) => setNuevo({ ...nuevo, monto: e.target.value })} />
          </label>
          <label className="text-sm">
            Pagos semanales
            <select className={`${campo} w-full`} value={nuevo.pagos} onChange={(e) => setNuevo({ ...nuevo, pagos: e.target.value })}>
              {Array.from({ length: plazoMax }, (_, k) => k + 1).map((n) => (
                <option key={n} value={n} disabled={n < minimo}>
                  {n} de {dinero(conInteres ? amortizar(monto, tasa, ivaInt, n, viernes).descuentoPorPago : descuentoPorPago(monto, n))}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button className={boton} disabled={crear.isPending || !elegido || monto <= 0}>
              Registrar
            </button>
          </div>
          <label className="text-sm sm:col-span-4">
            Concepto
            <input className={`${campo} w-full`} value={nuevo.concepto} placeholder="Ej. préstamo para útiles escolares" onChange={(e) => setNuevo({ ...nuevo, concepto: e.target.value })} />
          </label>
          <p className="text-xs text-slate-500 sm:col-span-6">
            {elegido
              ? `Disponible ${dinero(disponible)} · máximo ${dinero(tope)} por semana${conInteres ? ` (${cfg.capacidad_pago_pct} % del sueldo)` : ""} · primer descuento el viernes ${viernes.split("-").reverse().join("/")} · ${conInteres ? `lo presta ${financiera} a ${tasa} % anual` : "sin intereses (art. 111 LFT)"}.`
              : "Solo aparecen trabajadores con línea autorizada en el Estudio."}
            {elegido && !conFirma.has(elegido.profile_id) && <span className="text-amber-700"> Falta que firme su afiliación y consentimiento en su app.</span>}
          </p>
          {conInteres && monto > 0 && (
            <p className="rounded bg-white p-2 text-xs text-slate-700 sm:col-span-6">
              Capital {dinero(monto)} + interés {dinero(plan.interes)} + IVA {dinero(plan.iva)} = <b>{dinero(plan.total)}</b> en {plan.pagos} pago(s) de{" "}
              {dinero(plan.descuentoPorPago)} · CAT {plan.cat} % sin IVA. El trabajador ve la tabla completa y firma el pagaré en su app.
            </p>
          )}
          {crear.error && <p className="text-sm text-red-600 sm:col-span-6">{(crear.error as Error).message}</p>}
          {aviso && <p className="text-sm text-emerald-700 sm:col-span-6">{aviso}</p>}
        </form>
      )}
      <label className="flex items-center gap-1 text-sm text-slate-600">
        <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> ver también liquidados y cancelados
      </label>
      {cancelar.error && <p className="text-sm text-red-600">{(cancelar.error as Error).message}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Trabajador</th>
              <th className="px-2 py-2">Concepto</th>
              <th className="px-2 py-2 text-right">Monto</th>
              <th className="px-2 py-2 text-right">Total</th>
              <th className="px-2 py-2">Plan</th>
              <th className="px-2 py-2 text-right">Pagado</th>
              <th className="px-2 py-2 text-right">Saldo</th>
              <th className="px-2 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-2 py-1.5">
                  {c.trabajador_nombre}
                  <div className="text-xs text-slate-500">{c.empresa}</div>
                </td>
                <td className="px-2 py-1.5">{c.concepto}</td>
                <td className="px-2 py-1.5 text-right">{dinero(c.monto)}</td>
                <td className="px-2 py-1.5 text-right">
                  {dinero(c.total)}
                  {c.tasa_anual > 0 && (
                    <div className="text-[11px] text-slate-500">
                      {c.tasa_anual} % anual · {c.acreditante}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5 text-xs">
                  {c.pagos} × {dinero(c.descuento_por_pago)} desde {c.primer_descuento.split("-").reverse().join("/")}
                </td>
                <td className="px-2 py-1.5 text-right">{dinero(c.pagado)}</td>
                <td className="px-2 py-1.5 text-right">{dinero(c.saldo)}</td>
                <td className="px-2 py-1.5 text-xs">
                  {c.estatus === "por_firmar" ? (
                    <span className="text-sky-700">
                      espera firma del pagaré
                      {!soloConsulta && (
                        <button type="button" className="ml-1 text-red-600 underline" onClick={() => cancelar.mutate(c)}>
                          cancelar
                        </button>
                      )}
                    </span>
                  ) : c.atraso > 0 ? (
                    <span className="text-red-700">atrasado {dinero(c.atraso)}</span>
                  ) : (
                    c.estatus
                  )}
                </td>
              </tr>
            ))}
            {!lista.length && (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center text-sm text-slate-400">
                  Sin cargos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Descuentos() {
  const qc = useQueryClient();
  const { soloConsulta } = useAuth();
  const cargos = useCargos();
  const [fecha, setFecha] = useState(() => proximoViernes(hoyMexico()));
  const [referencia, setReferencia] = useState("");
  const porAplicar = (cargos.data ?? []).filter((c) => c.estatus === "vigente" && c.siguiente_descuento > 0 && c.primer_descuento <= fecha && c.ultimo_descuento !== fecha);
  const porEmpresa = new Map<string, Cargo[]>();
  for (const c of porAplicar) porEmpresa.set(c.empresa ?? "Sin empresa", [...(porEmpresa.get(c.empresa ?? "Sin empresa") ?? []), c]);
  const total = porAplicar.reduce((s, c) => s + c.siguiente_descuento, 0);

  const aplicar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("fn_nomina_aplicar_descuentos", { p_fecha: fecha, p_cargos: porAplicar.map((c) => c.id), p_referencia: referencia || null });
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["nomina-cargos"] });
      void qc.invalidateQueries({ queryKey: ["estudio-financiamiento"] });
    },
  });

  function csv() {
    const filas = [["Empresa", "Trabajador", "Concepto", "Descuento", "Saldo después"]];
    for (const c of porAplicar) filas.push([c.empresa ?? "", c.trabajador_nombre ?? "", c.concepto, c.siguiente_descuento.toFixed(2), (c.saldo - c.siguiente_descuento).toFixed(2)]);
    const texto = filas.map((f) => f.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    descargarCsv(`descuentos-nomina-${fecha}.csv`, texto);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          Nómina del (viernes)
          <input type="date" className={`${campo} block`} value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <button type="button" className={botonSuave} disabled={!porAplicar.length} onClick={csv}>
          Excel (CSV) para nómina
        </button>
        {!soloConsulta && (
          <>
            <input className={campo} value={referencia} placeholder="Referencia (ej. nómina sem 43)" onChange={(e) => setReferencia(e.target.value)} />
            <button type="button" className={boton} disabled={!porAplicar.length || aplicar.isPending} onClick={() => aplicar.mutate()}>
              Marcar {porAplicar.length} aplicado(s) · {dinero(total)}
            </button>
          </>
        )}
      </div>
      {aplicar.isSuccess && <p className="text-sm text-emerald-700">Listo: {aplicar.data} descuento(s) registrados.</p>}
      {aplicar.error && <p className="text-sm text-red-600">{(aplicar.error as Error).message}</p>}
      {!porAplicar.length && <p className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">No hay descuentos por aplicar en esa nómina.</p>}
      {[...porEmpresa.entries()].map(([empresa, lista]) => (
        <div key={empresa} className="rounded border border-slate-200 bg-white">
          <div className="flex justify-between border-b border-slate-100 px-3 py-1.5 text-sm font-medium">
            <span>{empresa}</span>
            <span>{dinero(lista.reduce((s, c) => s + c.siguiente_descuento, 0))}</span>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {lista.map((c) => (
              <li key={c.id} className="flex justify-between px-3 py-1.5">
                <span>
                  {c.trabajador_nombre} <span className="text-xs text-slate-500">· {c.concepto}</span>
                  {c.atraso > c.siguiente_descuento && <span className="text-xs text-red-600"> · atrasado</span>}
                </span>
                <span className="font-mono">{dinero(c.siguiente_descuento)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Reglas() {
  const qc = useQueryClient();
  const { perfilReal, soloConsulta } = useAuth();
  const config = useConfig();
  const empresas = useEmpresas();
  const [f, setF] = useState<ConfigFinanciamiento | null>(null);
  const v = f ?? config.data ?? CONFIG_LEY_2026;
  const puedeEditar = (perfilReal?.rol === "admin" || perfilReal?.rol === "direccion") && !soloConsulta;
  const guardar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("nomina_financiamiento_config").upsert({ grupo_id: perfilReal!.grupo_id, ...v }, { onConflict: "grupo_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      setF(null);
      void qc.invalidateQueries({ queryKey: ["nomina-config"] });
    },
  });
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded border border-amber-200 bg-amber-50 p-3 text-slate-700">
        <p className="font-medium">Lo que manda la Ley Federal del Trabajo</p>
        <ul className="mt-1 list-disc pl-5">
          <li>
            <b>Art. 111:</b> las deudas del trabajador con la empresa que lo emplea <b>no generan intereses</b>: compras, anticipos y préstamos del patrón van sin intereses; los préstamos con intereses solo los da la financiera (abajo).
          </li>
          <li>
            <b>Art. 110-I:</b> lo que se le preste no puede pasar del <b>salario de un mes</b>, y cada descuento no puede ser mayor al <b>30 % del excedente del
            salario mínimo</b>. El sistema no deja autorizar ni cobrar por encima de eso.
          </li>
          <li>Quien gana el salario mínimo no puede tener descuentos de este tipo.</li>
          <li>
            Cada trabajador firma en su app su <b>afiliación</b>, su <b>consentimiento de descuento</b> y el <b>pagaré</b> de cada préstamo; sin esas firmas el
            sistema no carga ni descuenta nada.
          </li>
        </ul>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label>
          Salario mínimo diario
          <input type="number" step="0.01" disabled={!puedeEditar} className={`${campo} block w-full`} value={v.salario_minimo_diario} onChange={(e) => setF({ ...v, salario_minimo_diario: Number(e.target.value) })} />
          <span className="text-xs text-slate-500">2026, zona general: $315.04</span>
        </label>
        <label>
          % del excedente que se puede descontar
          <input type="number" min={1} max={30} disabled={!puedeEditar} className={`${campo} block w-full`} value={v.pct_excedente} onChange={(e) => setF({ ...v, pct_excedente: Math.min(30, Number(e.target.value)) })} />
          <span className="text-xs text-slate-500">la ley permite hasta 30</span>
        </label>
        <label>
          Antigüedad mínima (meses)
          <input type="number" min={0} disabled={!puedeEditar} className={`${campo} block w-full`} value={v.antiguedad_minima_meses} onChange={(e) => setF({ ...v, antiguedad_minima_meses: Number(e.target.value) })} />
        </label>
      </div>
      <div className="rounded border border-slate-200 bg-white p-3">
        <p className="font-medium text-slate-800">Préstamos con intereses (negocio financiero)</p>
        <p className="mt-1 text-xs text-slate-600">
          Por el art. 111 LFT la empresa que emplea al trabajador no le cobra intereses. Los préstamos con intereses los otorga la <b>financiera</b>: una empresa
          del grupo distinta del patrón (de preferencia una SOFOM registrada; revisarlo con los abogados: registro ante CONDUSEF, contrato de adhesión, CAT y
          prevención de lavado). A quien trabaja en la propia financiera no se le cobran intereses. Sin financiera o con tasa 0, todo sigue sin intereses.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <label>
            Financiera que presta
            <select disabled={!puedeEditar} className={`${campo} block w-full`} value={v.acreditante_empresa_id ?? ""} onChange={(e) => setF({ ...v, acreditante_empresa_id: e.target.value || null })}>
              <option value="">— sin financiera (sin intereses) —</option>
              {(empresas.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tasa ordinaria anual %
            <input type="number" min={0} max={200} step="0.01" disabled={!puedeEditar} className={`${campo} block w-full`} value={v.tasa_anual_prestamos ?? 0} onChange={(e) => setF({ ...v, tasa_anual_prestamos: Number(e.target.value) })} />
            <span className="text-xs text-slate-500">fija, sobre saldo insoluto, pagos semanales iguales</span>
          </label>
          <label>
            Tasa moratoria anual %
            <input type="number" min={0} max={200} step="0.01" disabled={!puedeEditar} className={`${campo} block w-full`} value={v.tasa_moratoria_anual ?? 0} onChange={(e) => setF({ ...v, tasa_moratoria_anual: Number(e.target.value) })} />
            <span className="text-xs text-slate-500">va escrita en el pagaré</span>
          </label>
          <label>
            IVA sobre intereses %
            <input type="number" min={0} max={16} disabled={!puedeEditar} className={`${campo} block w-full`} value={v.iva_intereses ?? 16} onChange={(e) => setF({ ...v, iva_intereses: Number(e.target.value) })} />
          </label>
          <label>
            Capacidad de pago (% del sueldo semanal)
            <input type="number" min={1} max={50} disabled={!puedeEditar} className={`${campo} block w-full`} value={v.capacidad_pago_pct ?? 30} onChange={(e) => setF({ ...v, capacidad_pago_pct: Number(e.target.value) })} />
            <span className="text-xs text-slate-500">tope del descuento de cada semana</span>
          </label>
          <label>
            Plazo máximo (semanas)
            <input type="number" min={1} max={52} disabled={!puedeEditar} className={`${campo} block w-full`} value={v.plazo_max_semanas_intereses ?? 26} onChange={(e) => setF({ ...v, plazo_max_semanas_intereses: Number(e.target.value) })} />
          </label>
        </div>
      </div>
      {puedeEditar && f && (
        <button type="button" className={boton} disabled={guardar.isPending} onClick={() => guardar.mutate()}>
          Guardar reglas
        </button>
      )}
      {guardar.error && <p className="text-red-600">{(guardar.error as Error).message}</p>}
    </div>
  );
}

function Documentos() {
  const qc = useQueryClient();
  const { soloConsulta } = useAuth();
  const firmas = useFirmas();
  const [tipo, setTipo] = useState<"todos" | FirmaRh["tipo"]>("todos");
  const lista = (firmas.data ?? []).filter((f) => tipo === "todos" || f.tipo === tipo);
  const revocar = useMutation({
    mutationFn: async (f: FirmaRh) => {
      const motivo = window.prompt(`Motivo para revocar "${f.titulo}" de ${f.firmante_nombre}:`);
      if (!motivo) return;
      const { error } = await supabase.rpc("fn_credito_revocar", { p_firma: f.id, p_motivo: motivo });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["credito-firmas"] }),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 text-sm">
        {(["todos", "afiliacion", "consentimiento", "pagare"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTipo(t)} className={`rounded px-2 py-1 ${tipo === t ? "bg-slate-900 text-white" : "border border-slate-300"}`}>
            {t === "todos" ? "Todos" : t === "afiliacion" ? "Afiliaciones" : t === "consentimiento" ? "Consentimientos" : "Pagarés"}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Cada documento guarda el texto tal cual lo leyó el trabajador, su firma, fecha y hora, IP y una huella SHA-256; no se edita ni se borra. Los textos son
        borrador: que los revisen los abogados antes de usarlos en un juicio.
      </p>
      {revocar.error && <p className="text-sm text-red-600">{(revocar.error as Error).message}</p>}
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Trabajador</th>
              <th className="px-2 py-2">Documento</th>
              <th className="px-2 py-2">Firmado</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => (
              <tr key={f.id} className="border-t border-slate-100">
                <td className="px-2 py-1.5">{f.firmante_nombre}</td>
                <td className={`px-2 py-1.5 ${f.revocada_en ? "text-slate-400 line-through" : ""}`}>{f.titulo}</td>
                <td className="px-2 py-1.5 text-xs">{new Date(f.firmado_en).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <button type="button" className="text-xs text-sky-700 underline" onClick={() => abrirParaImprimir(htmlDocumentoFirmado(f))}>
                    ver / imprimir
                  </button>
                  {!soloConsulta && f.tipo !== "pagare" && !f.revocada_en && (
                    <button type="button" className="ml-2 text-xs text-red-600 underline" onClick={() => revocar.mutate(f)}>
                      revocar
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!lista.length && (
              <tr>
                <td colSpan={4} className="px-2 py-4 text-center text-sm text-slate-400">
                  {firmas.isLoading ? "Cargando…" : "Todavía nadie ha firmado."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
