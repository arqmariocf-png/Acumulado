import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa, useEmpresasAlcance } from "../../components/SelectorEmpresa";
import {
  AMORTIZACIONES,
  ESTATUS_CREDITO,
  PERIODICIDADES,
  TIPOS_CREDITO,
  calendarioPagos,
  creditosDesdeTabla,
  csvPlantilla,
  estadoPagos,
  estatusRenglones,
  pagosParaProgramar,
  resumenGrupo,
  type Amortizacion,
  type CreditoCarga,
  type EstatusCredito,
  type EstatusRenglon,
  type Periodicidad,
  type TipoCredito,
} from "../../lib/deudaFinanciera";
import { tablaDesdeCsv } from "../../lib/importarBancarios";

// Deuda financiera del grupo (21-oct-2026, Mario: "crear un módulo de deuda
// financiera para subir los préstamos", y después el diseño con Resumen /
// Calendario de pagos / Registrar crédito). Créditos de bancos, arrendadoras y
// particulares por empresa: saldo calculado en v_deuda_creditos, tabla de
// amortización proyectada, pagos con "Registrar pago N" / "Deshacer último
// pago", y los pagos de los próximos 60 días se mandan solos a Programación de
// pagos (fn_deuda_enviar_pagos). Capturan dirección, admin y tesorería;
// contabilidad consulta (RLS: auth_opera_deuda / auth_ve_deuda).

interface Credito {
  id: string;
  empresa_id: string;
  empresa_codigo: string | null;
  empresa_nombre: string | null;
  folio: string;
  acreedor: string;
  tipo: TipoCredito;
  contrato: string | null;
  moneda: "MXN" | "USD";
  monto: number;
  fecha_disposicion: string;
  fecha_vencimiento: string | null;
  tasa_anual: number | null;
  tasa_tipo: "fija" | "variable";
  tasa_referencia: string | null;
  iva_intereses: boolean;
  comision_apertura: number | null;
  plazo_meses: number | null;
  periodicidad: Periodicidad;
  amortizacion: Amortizacion;
  primer_pago: string | null;
  cuenta_id: string | null;
  cuenta_banco: string | null;
  cuenta_ultimos_4: string | null;
  garantia: string | null;
  aval: string | null;
  aval_empresa_id: string | null;
  aval_empresa_codigo: string | null;
  destino: string | null;
  saldo_corte: number | null;
  saldo_corte_al: string | null;
  estatus: EstatusCredito;
  notas: string | null;
  updated_at: string;
  capital_pagado: number;
  intereses_pagados: number;
  num_pagos: number;
  ultimo_pago: string | null;
  numeros_pagados: number[];
  numeros_programados: number[];
  saldo: number;
}

interface Pago {
  id: string;
  fecha: string;
  numero: number | null;
  capital: number;
  interes: number;
  iva_interes: number;
  comisiones: number;
  total: number;
  referencia: string | null;
  created_at: string;
}

type Vista = "resumen" | "calendario" | "registrar";

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "text-xs text-slate-600";
const tarjeta = "rounded-xl border border-slate-200 bg-white";

const ESTATUS_PAGO: Record<EstatusRenglon, { texto: string; clase: string }> = {
  pagado: { texto: "Pagado", clase: "bg-emerald-50 text-emerald-700" },
  vencido: { texto: "Vencido", clase: "bg-red-50 text-red-700" },
  programado: { texto: "En programación", clase: "bg-sky-50 text-sky-700" },
  pendiente: { texto: "Pendiente", clase: "bg-slate-100 text-slate-600" },
};

function dinero(n: number | null | undefined, moneda = "MXN", decimales = 2): string {
  return Number(n ?? 0).toLocaleString("es-MX", { style: "currency", currency: moneda, minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}
function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}
function nombreMes(mes: string): string {
  return new Date(`${mes}-15T12:00:00`).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}
function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function descargar(nombre: string, texto: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
function csv(filas: (string | number)[][]): string {
  return filas.map((v) => v.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x))).join(",")).join("\n");
}
const tituloCredito = (c: Credito) => `${c.acreedor} · ${TIPOS_CREDITO[c.tipo]}`;

export function DeudaFinanciera() {
  const { perfil, soloConsulta } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const vista = (["resumen", "calendario", "registrar"].includes(params.get("vista") ?? "") ? params.get("vista") : "resumen") as Vista;
  const irA = (v: Vista) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("vista", v);
        return n;
      },
      { replace: true },
    );
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const [texto, setTexto] = useState("");
  const [verCerrados, setVerCerrados] = useState(false);
  const [elegido, setElegido] = useState<string | null>(null);
  const [editando, setEditando] = useState<Credito | null>(null);
  const hoy = hoyIso();
  const puedeCapturar =
    !soloConsulta && !!perfil && (perfil.rol === "admin" || perfil.rol === "direccion" || (perfil.modulos ?? []).includes("tesoreria"));

  const { data: creditos, isLoading, error } = useQuery({
    queryKey: ["deuda-creditos"],
    queryFn: async () => {
      const { data, error: e } = await supabase.from("v_deuda_creditos").select("*").order("fecha_disposicion", { ascending: false });
      if (e) throw e;
      return (data ?? []) as Credito[];
    },
  });

  // Los pagos de los próximos 60 días (y los vencidos) se mandan solos a
  // Programación de pagos; al editar un crédito se corrigen los pendientes.
  const enviados = useRef(new Set<string>());
  useEffect(() => {
    if (!puedeCapturar || !creditos) return;
    let cambio = false;
    (async () => {
      for (const c of creditos) {
        const pagos = pagosParaProgramar(c, hoy, 60);
        const firma = `${c.id}|${c.updated_at}|${pagos.map((p) => `${p.numero}:${p.total}`).join(",")}`;
        if (!pagos.length || enviados.current.has(firma)) continue;
        enviados.current.add(firma);
        const { data } = await supabase.rpc("fn_deuda_enviar_pagos", { p_credito: c.id, p_pagos: pagos });
        if (Number(data) > 0) cambio = true;
      }
      if (cambio) qc.invalidateQueries({ queryKey: ["deuda-creditos"] });
    })();
  }, [creditos, puedeCapturar, hoy, qc]);

  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (creditos ?? []).filter(
      (c) =>
        (!empresaId || c.empresa_id === empresaId) &&
        (verCerrados || c.estatus === "vigente") &&
        (!t || `${c.folio} ${c.acreedor} ${c.contrato ?? ""} ${c.empresa_codigo ?? ""} ${c.destino ?? ""}`.toLowerCase().includes(t)),
    );
  }, [creditos, empresaId, texto, verCerrados]);
  const resumen = useMemo(() => resumenGrupo(lista, hoy), [lista, hoy]);
  const seleccionado = lista.find((c) => c.id === elegido) ?? lista[0] ?? null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500">Finanzas / Deuda financiera</p>
          <h1 className="text-2xl font-semibold text-slate-900">Deuda financiera del grupo</h1>
          <p className="text-sm text-slate-500">Créditos, arrendamientos y préstamos de terceros, con su tabla de pagos. Los pagos se envían a Programación de pagos.</p>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1 text-sm">
          {(
            [
              ["resumen", "Resumen"],
              ["calendario", "Calendario de pagos"],
              ...(puedeCapturar ? [["registrar", editando ? "Editar crédito" : "Registrar crédito"]] : []),
            ] as [Vista, string][]
          ).map(([v, t]) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                if (v === "registrar" && vista !== "registrar") setEditando(null);
                irA(v);
              }}
              className={`rounded-lg px-4 py-1.5 ${vista === v ? "bg-white font-semibold text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-700">{(error as Error).message}</p>}

      {vista !== "registrar" && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />
          <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar acreedor, folio, contrato o destino…" className="w-full max-w-xs rounded border border-slate-300 px-2 py-1.5 text-sm" />
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={verCerrados} onChange={(e) => setVerCerrados(e.target.checked)} /> ver también liquidados y cancelados
          </label>
        </div>
      )}

      {vista === "resumen" && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador titulo="Deuda total (saldo)" valor={dinero(resumen.deuda, "MXN", 0)} detalle={`${resumen.creditos} crédito(s) vigente(s)${resumen.otrasMonedas.map((o) => ` · ${dinero(o.saldo, o.moneda, 0)}`).join("")}`} />
            <Indicador
              titulo="Pagos próximos 30 días"
              valor={dinero(resumen.pagos30, "MXN", 0)}
              detalle={`${resumen.n30} pago(s)${resumen.vencidos ? " (incluye vencidos)" : ""}`}
              tonoDetalle={resumen.vencidos ? "text-red-700" : undefined}
            />
            <Indicador titulo="Tasa promedio ponderada" valor={resumen.tasaPonderada != null ? `${resumen.tasaPonderada.toFixed(2)}%` : "—"} detalle="Anual, ponderada por saldo" />
            <Indicador titulo="Vence en los próximos 12 meses" valor={dinero(resumen.vence12, "MXN", 0)} detalle={`${resumen.cortoPlazoPct}% de la deuda es de corto plazo`} />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-3">
            <section className={`${tarjeta} p-4 lg:col-span-2`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Créditos {verCerrados ? "" : "vigentes"}</h2>
                {puedeCapturar && (
                  <button type="button" onClick={() => { setEditando(null); irA("registrar"); }} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                    + Registrar crédito
                  </button>
                )}
              </div>
              {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
              {!isLoading && lista.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-400">{creditos?.length ? "Ningún crédito con ese filtro." : "Todavía no hay créditos. Dalos de alta en Registrar crédito, uno por uno o desde Excel."}</p>
              )}
              {lista.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-2 py-2">Crédito</th>
                        <th className="px-2 py-2">Empresa</th>
                        <th className="px-2 py-2 text-right">Monto</th>
                        <th className="px-2 py-2 text-right">Saldo</th>
                        <th className="px-2 py-2 text-right">Tasa</th>
                        <th className="px-2 py-2">Próximo pago</th>
                        <th className="px-2 py-2">Pagado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((c) => {
                        const e = estadoPagos(c, hoy);
                        const pct = c.monto > 0 ? Math.max(0, Math.min(100, Math.round(((c.monto - c.saldo) / c.monto) * 100))) : 0;
                        const activo = seleccionado?.id === c.id;
                        return (
                          <tr key={c.id} onClick={() => setElegido(c.id)} className={`cursor-pointer border-t border-slate-100 align-top ${activo ? "bg-slate-50" : "hover:bg-slate-50/60"}`}>
                            <td className="px-2 py-3">
                              <div className="font-medium text-slate-900 underline decoration-slate-300 underline-offset-2">{tituloCredito(c)}</div>
                              <div className="text-xs text-slate-500">{c.destino ?? c.folio}</div>
                              {c.estatus !== "vigente" && <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{ESTATUS_CREDITO[c.estatus]}</span>}
                            </td>
                            <td className="px-2 py-3 text-slate-700">{c.empresa_nombre ?? c.empresa_codigo}</td>
                            <td className="px-2 py-3 text-right tabular-nums">{dinero(c.monto, c.moneda, 0)}</td>
                            <td className="px-2 py-3 text-right font-semibold tabular-nums">{dinero(c.saldo, c.moneda, 0)}</td>
                            <td className="px-2 py-3 text-right tabular-nums">{c.tasa_anual != null ? `${Number(c.tasa_anual).toFixed(2)}%` : "—"}</td>
                            <td className="px-2 py-3 text-xs">
                              {e.proximo ? (
                                <>
                                  <div className={e.proximo.fecha < hoy ? "font-medium text-red-700" : "text-slate-800"}>{fechaCorta(e.proximo.fecha)}</div>
                                  <div className="text-slate-500 tabular-nums">{dinero(e.proximo.pago, c.moneda)}</div>
                                  {e.vencidos > 0 && <div className="text-red-700">{e.vencidos} vencido(s)</div>}
                                </>
                              ) : (
                                <span className="text-slate-400">{c.amortizacion === "personalizado" ? "sin tabla" : "—"}</span>
                              )}
                            </td>
                            <td className="px-2 py-3">
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-24 rounded-full bg-slate-100">
                                  <div className="h-1.5 rounded-full bg-slate-900" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs tabular-nums text-slate-600">{pct}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className={`${tarjeta} p-4`}>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">Saldo por empresa</h2>
              {resumen.porEmpresa.length === 0 && <p className="text-sm text-slate-400">Sin deuda vigente.</p>}
              <div className="space-y-3">
                {resumen.porEmpresa.map((e) => (
                  <div key={e.empresa}>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-slate-800">{e.empresa}</span>
                      <span className="tabular-nums text-slate-700">{dinero(e.saldo, "MXN", 0)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-slate-700" style={{ width: `${resumen.porEmpresa[0].saldo > 0 ? (e.saldo / resumen.porEmpresa[0].saldo) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              {resumen.avalesCruzados > 0 && (
                <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-600">
                  {resumen.avalesCruzados === 1 ? "1 crédito tiene" : `${resumen.avalesCruzados} créditos tienen`} aval de otra empresa del grupo: si esa empresa también se endeuda, el riesgo se suma.
                </p>
              )}
            </section>
          </div>

          {seleccionado && (
            <PanelAmortizacion
              key={seleccionado.id}
              c={seleccionado}
              hoy={hoy}
              puedeCapturar={puedeCapturar}
              onEditar={() => {
                setEditando(seleccionado);
                irA("registrar");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          )}
        </>
      )}

      {vista === "calendario" && <Calendario creditos={lista} hoy={hoy} />}

      {vista === "registrar" && puedeCapturar && (
        <>
          <FormCredito
            key={editando?.id ?? "nuevo"}
            credito={editando}
            onListo={(id) => {
              setEditando(null);
              if (id) setElegido(id);
              irA("resumen");
            }}
          />
          {!editando && <CargaExcel onListo={() => irA("resumen")} />}
        </>
      )}
    </div>
  );
}

function Indicador({ titulo, valor, detalle, tonoDetalle }: { titulo: string; valor: string; detalle?: string; tonoDetalle?: string }) {
  return (
    <div className={`${tarjeta} px-5 py-4`}>
      <div className="text-sm text-slate-600">{titulo}</div>
      <div className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{valor}</div>
      {detalle && <div className={`mt-1 text-sm ${tonoDetalle ?? "text-slate-500"}`}>{detalle}</div>}
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{titulo}</div>
      <div className="font-semibold text-slate-900">{valor}</div>
    </div>
  );
}

function PanelAmortizacion({ c, hoy, puedeCapturar, onEditar }: { c: Credito; hoy: string; puedeCapturar: boolean; onEditar: () => void }) {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [otroImporte, setOtroImporte] = useState(false);
  const filas = useMemo(() => estatusRenglones(c, hoy), [c, hoy]);
  const estado = useMemo(() => estadoPagos(c, hoy), [c, hoy]);
  const interesesTotales = filas.reduce((s, f) => s + f.renglon.interes, 0);
  const pagos = useQuery({
    queryKey: ["deuda-pagos", c.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deuda_pagos")
        .select("id, fecha, numero, capital, interes, iva_interes, comisiones, total, referencia, created_at")
        .eq("credito_id", c.id)
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Pago[];
    },
  });
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ["deuda-pagos", c.id] });
    qc.invalidateQueries({ queryKey: ["deuda-creditos"] });
    qc.invalidateQueries({ queryKey: ["pagos-programados"] });
  };
  const registrar = useMutation({
    mutationFn: async (p: { fecha: string; numero: number | null; capital: number; interes: number; iva_interes: number; comisiones: number; referencia: string | null }) => {
      const { error } = await supabase.from("deuda_pagos").insert({ credito_id: c.id, ...p });
      if (error) throw error;
    },
    onSuccess: () => {
      setErr(null);
      setOtroImporte(false);
      refrescar();
    },
    onError: (e) => setErr((e as Error).message),
  });
  const deshacer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("deuda_pagos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setErr(null);
      refrescar();
    },
    onError: (e) => setErr((e as Error).message),
  });
  const ultimo = pagos.data?.[0] ?? null;
  const proximo = estado.proximo;

  function onOtro(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const num = (k: string) => Number(String(fd.get(k) ?? "").replace(/[$,\s]/g, "")) || 0;
    const p = {
      fecha: String(fd.get("fecha")),
      numero: proximo && fd.get("ligar") === "on" ? proximo.numero : null,
      capital: num("capital"),
      interes: num("interes"),
      iva_interes: num("iva_interes"),
      comisiones: num("comisiones"),
      referencia: String(fd.get("referencia") ?? "").trim() || null,
    };
    if (p.capital + p.interes + p.iva_interes + p.comisiones <= 0) return setErr("Captura al menos un importe.");
    if (p.capital > c.saldo + 0.01) return setErr(`El capital no puede pasar del saldo (${dinero(c.saldo, c.moneda)}).`);
    registrar.mutate(p);
  }

  function exportar() {
    descargar(
      `amortizacion-${c.folio}.csv`,
      csv([
        ["Pago", "Fecha", "Saldo inicial", "Capital", "Interés", "IVA", "Pago total", "Saldo final", "Estatus"],
        ...filas.map((f) => [f.renglon.numero, f.renglon.fecha, f.renglon.saldoInicial, f.renglon.capital, f.renglon.interes, f.renglon.iva, f.renglon.pago, f.renglon.saldoFinal, ESTATUS_PAGO[f.estatus].texto]),
      ]),
    );
  }

  const conIva = filas.some((f) => f.renglon.iva > 0);
  return (
    <section className={`${tarjeta} p-5`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tabla de amortización</p>
          <h2 className="text-xl font-semibold text-slate-900">
            {tituloCredito(c)} · {c.empresa_nombre ?? c.empresa_codigo}
          </h2>
          <p className="text-sm text-slate-500">
            {[c.destino, AMORTIZACIONES[c.amortizacion], c.folio, c.contrato ? `contrato ${c.contrato}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {puedeCapturar && c.estatus === "vigente" && proximo && (
            <button
              type="button"
              disabled={registrar.isPending}
              onClick={() =>
                window.confirm(`¿Registrar el pago ${proximo.numero} por ${dinero(proximo.pago, c.moneda)} con fecha de hoy?`) &&
                registrar.mutate({ fecha: hoy, numero: proximo.numero, capital: proximo.capital, interes: proximo.interes, iva_interes: proximo.iva, comisiones: 0, referencia: null })
              }
              className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Registrar pago {proximo.numero} · {dinero(proximo.pago, c.moneda)}
            </button>
          )}
          {puedeCapturar && ultimo && (
            <button
              type="button"
              disabled={deshacer.isPending}
              onClick={() => window.confirm(`¿Deshacer el pago${ultimo.numero ? ` ${ultimo.numero}` : ""} del ${fechaCorta(ultimo.fecha)} por ${dinero(ultimo.total, c.moneda)}?`) && deshacer.mutate(ultimo.id)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50"
            >
              Deshacer último pago
            </button>
          )}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Dato titulo="Monto dispuesto" valor={dinero(c.monto, c.moneda)} />
        <Dato titulo="Saldo actual" valor={dinero(c.saldo, c.moneda)} />
        <Dato titulo="Tasa anual" valor={c.tasa_anual != null ? `${Number(c.tasa_anual).toFixed(2)}%${c.tasa_tipo === "variable" ? " variable" : ""}` : "—"} />
        <Dato titulo="Plazo" valor={`${c.plazo_meses ? `${c.plazo_meses} meses · ` : ""}vence ${fechaCorta(c.fecha_vencimiento ?? filas[filas.length - 1]?.renglon.fecha)}`} />
        <Dato titulo="Pagos hechos" valor={estado.totalPagos ? `${estado.pagosHechos} de ${estado.totalPagos}` : `${c.num_pagos}`} />
        <Dato titulo="Intereses totales del crédito" valor={filas.length ? dinero(interesesTotales, c.moneda) : "—"} />
        <Dato titulo="Cuenta de cargo" valor={c.cuenta_banco ? `${c.cuenta_banco} ${c.cuenta_ultimos_4}` : "—"} />
        {(c.garantia || c.aval || c.aval_empresa_codigo) && (
          <Dato titulo="Garantía o aval" valor={[c.garantia, c.aval_empresa_codigo ? `Aval de ${c.aval_empresa_codigo}` : null, c.aval].filter(Boolean).join(" · ")} />
        )}
      </div>

      {err && <p className="mb-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        {puedeCapturar && c.estatus === "vigente" && (
          <button type="button" onClick={() => setOtroImporte((v) => !v)} className="text-sky-700 underline">
            {otroImporte ? "Cerrar" : "Registrar un pago con otros importes"}
          </button>
        )}
        {puedeCapturar && (
          <button type="button" onClick={onEditar} className="text-sky-700 underline">
            Editar crédito
          </button>
        )}
        {filas.length > 0 && (
          <button type="button" onClick={exportar} className="text-sky-700 underline">
            Descargar tabla
          </button>
        )}
      </div>

      {otroImporte && (
        <form onSubmit={onOtro} className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 p-3" data-sin-borrador>
          <label className={etiqueta}>Fecha<input name="fecha" type="date" required defaultValue={hoy} className={campo} /></label>
          <label className={etiqueta}>Capital<input name="capital" inputMode="decimal" defaultValue={proximo?.capital ?? ""} className={`${campo} w-28`} /></label>
          <label className={etiqueta}>Interés<input name="interes" inputMode="decimal" defaultValue={proximo?.interes ?? ""} className={`${campo} w-24`} /></label>
          <label className={etiqueta}>IVA interés<input name="iva_interes" inputMode="decimal" defaultValue={proximo?.iva ?? ""} className={`${campo} w-24`} /></label>
          <label className={etiqueta}>Comisiones<input name="comisiones" inputMode="decimal" className={`${campo} w-24`} /></label>
          <label className={etiqueta}>Referencia<input name="referencia" className={`${campo} w-40`} /></label>
          {proximo && (
            <label className="flex items-center gap-1 pb-2 text-xs text-slate-600">
              <input name="ligar" type="checkbox" defaultChecked /> es el pago {proximo.numero}
            </label>
          )}
          <button type="submit" disabled={registrar.isPending} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            Registrar
          </button>
          <span className="w-full text-[11px] text-slate-500">Para prepagos o pagos que no coinciden con la tabla (desmarca "es el pago N" si es un abono extra a capital).</span>
        </form>
      )}

      {filas.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2">Pago</th>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2 text-right">Saldo inicial</th>
                <th className="px-3 py-2 text-right">Capital</th>
                <th className="px-3 py-2 text-right">Interés</th>
                {conIva && <th className="px-3 py-2 text-right">IVA</th>}
                <th className="px-3 py-2 text-right">Pago total</th>
                <th className="px-3 py-2 text-right">Saldo final</th>
                <th className="px-3 py-2">Estatus</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(({ renglon: t, estatus }) => (
                <tr key={t.numero} className={`border-t border-slate-100 ${proximo?.numero === t.numero ? "bg-amber-50/60" : ""}`}>
                  <td className="px-3 py-2">{t.numero}</td>
                  <td className="px-3 py-2">{fechaCorta(t.fecha)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{dinero(t.saldoInicial, c.moneda)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{dinero(t.capital, c.moneda)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{dinero(t.interes, c.moneda)}</td>
                  {conIva && <td className="px-3 py-2 text-right tabular-nums">{dinero(t.iva, c.moneda)}</td>}
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{dinero(t.pago, c.moneda)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{dinero(t.saldoFinal, c.moneda)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTATUS_PAGO[estatus].clase}`}>{ESTATUS_PAGO[estatus].texto}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg bg-slate-50 px-3 py-4 text-sm text-slate-500">
          {c.amortizacion === "personalizado" ? "Crédito personalizado: sin tabla; registra cada pago con otros importes." : "Faltan plazo o primer pago para armar la tabla: complétalos en Editar crédito."}
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Proyección con los términos del contrato{c.tasa_tipo === "variable" ? " (tasa variable: el estado de cuenta del banco manda)" : ""}. Los pagos de los próximos 60 días se envían a Programación de pagos; al pagarlos en Tesorería
        quedan registrados aquí.
      </p>

      {(pagos.data?.length ?? 0) > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs font-semibold uppercase text-slate-500">Pagos registrados ({pagos.data!.length})</summary>
          <table className="mt-2 w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">Fecha</th>
                <th className="py-1">Pago</th>
                <th className="py-1 text-right">Capital</th>
                <th className="py-1 text-right">Interés + IVA</th>
                <th className="py-1 text-right">Comisiones</th>
                <th className="py-1 text-right">Total</th>
                <th className="py-1">Referencia</th>
              </tr>
            </thead>
            <tbody>
              {pagos.data!.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-1">{fechaCorta(p.fecha)}</td>
                  <td className="py-1">{p.numero ?? "extra"}</td>
                  <td className="py-1 text-right tabular-nums">{dinero(p.capital, c.moneda)}</td>
                  <td className="py-1 text-right tabular-nums">{dinero(Number(p.interes) + Number(p.iva_interes), c.moneda)}</td>
                  <td className="py-1 text-right tabular-nums">{dinero(p.comisiones, c.moneda)}</td>
                  <td className="py-1 text-right font-medium tabular-nums">{dinero(p.total, c.moneda)}</td>
                  <td className="py-1">{p.referencia ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function Calendario({ creditos, hoy }: { creditos: Credito[]; hoy: string }) {
  const meses = useMemo(() => calendarioPagos(creditos, hoy, 12), [creditos, hoy]);
  function exportar() {
    descargar(
      `calendario-deuda-${hoy}.csv`,
      csv([
        ["Fecha", "Acreedor", "Folio", "Empresa", "Pago", "Capital", "Interés", "IVA", "Total", "Moneda", "Estatus"],
        ...meses.flatMap((m) =>
          m.renglones.map((r) => [r.renglon.fecha, r.credito.acreedor, r.credito.folio, r.credito.empresa_codigo ?? "", r.renglon.numero, r.renglon.capital, r.renglon.interes, r.renglon.iva, r.renglon.pago, r.credito.moneda, ESTATUS_PAGO[r.estatus].texto]),
        ),
      ]),
    );
  }
  if (!meses.length) return <p className={`${tarjeta} p-6 text-center text-sm text-slate-400`}>Sin pagos por hacer en los próximos 12 meses.</p>;
  return (
    <section className={`${tarjeta} p-5`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Calendario de pagos · próximos 12 meses</h2>
        <button type="button" onClick={exportar} className="rounded border border-slate-300 px-3 py-1.5 text-xs text-slate-700">
          Descargar Excel
        </button>
      </div>
      <div className="space-y-5">
        {meses.map((m) => (
          <div key={m.mes}>
            <div className="mb-1 flex items-baseline justify-between border-b border-slate-200 pb-1">
              <h3 className="text-sm font-semibold capitalize text-slate-800">{nombreMes(m.mes)}</h3>
              <span className="text-sm font-semibold tabular-nums text-slate-800">{dinero(m.total)}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {m.renglones.map((r) => (
                  <tr key={`${r.credito.id}-${r.renglon.numero}`} className="border-t border-slate-50">
                    <td className="w-28 py-1.5 text-slate-600">{fechaCorta(r.renglon.fecha)}</td>
                    <td className="py-1.5">
                      <span className="font-medium text-slate-900">{r.credito.acreedor}</span>
                      <span className="text-xs text-slate-500">
                        {" "}
                        · {r.credito.empresa_nombre ?? r.credito.empresa_codigo} · pago {r.renglon.numero}
                      </span>
                    </td>
                    <td className="hidden py-1.5 text-right text-xs text-slate-500 sm:table-cell">
                      capital {dinero(r.renglon.capital, r.credito.moneda)} · interés {dinero(r.renglon.interes + r.renglon.iva, r.credito.moneda)}
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">{dinero(r.renglon.pago, r.credito.moneda)}</td>
                    <td className="w-36 py-1.5 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTATUS_PAGO[r.estatus].clase}`}>{ESTATUS_PAGO[r.estatus].texto}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}

function FormCredito({ credito, onListo }: { credito: Credito | null; onListo: (id: string | null) => void }) {
  const qc = useQueryClient();
  const { data: empresas } = useEmpresasAlcance();
  const [empresaId, setEmpresaId] = useState(credito?.empresa_id ?? "");
  const [err, setErr] = useState<string | null>(null);
  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-bancarias", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("cuentas_bancarias").select("id, banco, ultimos_4, alias").eq("empresa_id", empresaId).eq("activo", true);
      if (error) throw error;
      return data as { id: string; banco: string; ultimos_4: string; alias: string | null }[];
    },
  });
  const guardar = useMutation({
    mutationFn: async (fila: Record<string, unknown>) => {
      if (credito) {
        const { error } = await supabase.from("deuda_creditos").update(fila).eq("id", credito.id);
        if (error) throw error;
        return credito.id;
      }
      const { data, error } = await supabase.from("deuda_creditos").insert(fila).select("id").single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["deuda-creditos"] });
      onListo(id);
    },
    onError: (e) => setErr((e as Error).message),
  });

  function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const txt = (k: string) => String(fd.get(k) ?? "").trim() || null;
    const num = (k: string) => {
      const v = txt(k);
      return v == null ? null : Number(v.replace(/[$,%\s]/g, ""));
    };
    const fila = {
      empresa_id: empresaId,
      acreedor: txt("acreedor"),
      tipo: txt("tipo"),
      destino: txt("destino"),
      contrato: txt("contrato"),
      moneda: txt("moneda"),
      monto: num("monto"),
      fecha_disposicion: txt("fecha_disposicion"),
      fecha_vencimiento: txt("fecha_vencimiento"),
      tasa_anual: num("tasa_anual"),
      tasa_tipo: txt("tasa_tipo"),
      tasa_referencia: txt("tasa_referencia"),
      iva_intereses: fd.get("iva_intereses") === "on",
      comision_apertura: num("comision_apertura"),
      plazo_meses: num("plazo_meses"),
      periodicidad: txt("periodicidad"),
      amortizacion: txt("amortizacion"),
      primer_pago: txt("primer_pago"),
      cuenta_id: txt("cuenta_id"),
      garantia: txt("garantia"),
      aval: txt("aval"),
      aval_empresa_id: txt("aval_empresa_id"),
      saldo_corte: num("saldo_corte"),
      saldo_corte_al: txt("saldo_corte_al"),
      estatus: txt("estatus") ?? "vigente",
      notas: txt("notas"),
    };
    if (!fila.empresa_id) return setErr("Elige la empresa.");
    if (!fila.acreedor) return setErr("Falta el acreedor.");
    if (!(Number(fila.monto) > 0)) return setErr("El monto debe ser mayor a cero.");
    if (!fila.fecha_disposicion) return setErr("Falta la fecha de disposición.");
    if (fila.saldo_corte != null && !fila.saldo_corte_al) return setErr("Si capturas el saldo del estado de cuenta, pon a qué fecha.");
    if (fila.aval_empresa_id && fila.aval_empresa_id === fila.empresa_id) return setErr("El aval de otra empresa no puede ser la misma empresa que debe.");
    guardar.mutate(fila);
  }

  const c = credito;
  return (
    <form onSubmit={onSubmit} className={`${tarjeta} mb-4 p-5`} data-sin-borrador>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">{c ? `Editar ${c.folio}` : "Registrar crédito"}</h2>
        <button type="button" onClick={() => onListo(null)} className="text-xs text-slate-500 underline">
          Cancelar
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={etiqueta}>
          Empresa que debe *
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className={campo} disabled={!!c}>
            <option value="">Elige…</option>
            {(empresas ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.codigo} · {e.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className={etiqueta}>Acreedor (banco, arrendadora o persona) *<input name="acreedor" defaultValue={c?.acreedor} className={campo} /></label>
        <label className={etiqueta}>
          Tipo
          <select name="tipo" defaultValue={c?.tipo ?? "simple"} className={campo}>
            {Object.entries(TIPOS_CREDITO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={etiqueta}>Para qué (destino)<input name="destino" defaultValue={c?.destino ?? ""} placeholder="Capital de trabajo para obra" className={campo} /></label>
        <label className={etiqueta}>Monto dispuesto *<input name="monto" inputMode="decimal" defaultValue={c?.monto ?? ""} className={campo} /></label>
        <label className={etiqueta}>
          Moneda
          <select name="moneda" defaultValue={c?.moneda ?? "MXN"} className={campo}>
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className={etiqueta}>Fecha de disposición *<input name="fecha_disposicion" type="date" defaultValue={c?.fecha_disposicion ?? ""} className={campo} /></label>
        <label className={etiqueta}>Vencimiento<input name="fecha_vencimiento" type="date" defaultValue={c?.fecha_vencimiento ?? ""} className={campo} /></label>
        <label className={etiqueta}>Tasa anual (%)<input name="tasa_anual" inputMode="decimal" defaultValue={c?.tasa_anual ?? ""} className={campo} /></label>
        <label className={etiqueta}>
          Tipo de tasa
          <select name="tasa_tipo" defaultValue={c?.tasa_tipo ?? "fija"} className={campo}>
            <option value="fija">Fija</option>
            <option value="variable">Variable</option>
          </select>
        </label>
        <label className={etiqueta}>Referencia (p. ej. TIIE 28 + 4)<input name="tasa_referencia" defaultValue={c?.tasa_referencia ?? ""} className={campo} /></label>
        <label className={`${etiqueta} flex items-center gap-2 pt-5`}>
          <input name="iva_intereses" type="checkbox" defaultChecked={c?.iva_intereses ?? true} /> Intereses con IVA
        </label>
        <label className={etiqueta}>Plazo (meses)<input name="plazo_meses" inputMode="numeric" defaultValue={c?.plazo_meses ?? ""} className={campo} /></label>
        <label className={etiqueta}>
          Periodicidad de pago
          <select name="periodicidad" defaultValue={c?.periodicidad ?? "mensual"} className={campo}>
            {Object.entries(PERIODICIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={etiqueta}>
          Amortización
          <select name="amortizacion" defaultValue={c?.amortizacion ?? "pagos_iguales"} className={campo}>
            {Object.entries(AMORTIZACIONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={etiqueta}>Primer pago<input name="primer_pago" type="date" defaultValue={c?.primer_pago ?? ""} className={campo} /></label>
        <label className={etiqueta}>Número de contrato<input name="contrato" defaultValue={c?.contrato ?? ""} className={campo} /></label>
        <label className={etiqueta}>Comisión por apertura<input name="comision_apertura" inputMode="decimal" defaultValue={c?.comision_apertura ?? ""} className={campo} /></label>
        <label className={etiqueta}>
          Cuenta de cargo
          <select name="cuenta_id" defaultValue={c?.cuenta_id ?? ""} className={campo}>
            <option value="">—</option>
            {(cuentas ?? []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.banco} ···{k.ultimos_4} {k.alias ?? ""}
              </option>
            ))}
          </select>
        </label>
        <label className={etiqueta}>Garantía<input name="garantia" defaultValue={c?.garantia ?? ""} className={campo} /></label>
        <label className={etiqueta}>
          Aval de otra empresa del grupo
          <select name="aval_empresa_id" defaultValue={c?.aval_empresa_id ?? ""} className={campo}>
            <option value="">— ninguna —</option>
            {(empresas ?? [])
              .filter((e) => e.id !== empresaId)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.codigo} · {e.nombre}
                </option>
              ))}
          </select>
        </label>
        <label className={etiqueta}>Aval u obligado solidario (persona)<input name="aval" defaultValue={c?.aval ?? ""} className={campo} /></label>
        <label className={etiqueta}>Saldo según estado de cuenta<input name="saldo_corte" inputMode="decimal" defaultValue={c?.saldo_corte ?? ""} placeholder="si ya lleva pagos" className={campo} /></label>
        <label className={etiqueta}>Saldo al<input name="saldo_corte_al" type="date" defaultValue={c?.saldo_corte_al ?? ""} className={campo} /></label>
        <label className={etiqueta}>
          Estatus
          <select name="estatus" defaultValue={c?.estatus ?? "vigente"} className={campo}>
            {Object.entries(ESTATUS_CREDITO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={`${etiqueta} sm:col-span-2 lg:col-span-3`}>Notas<input name="notas" defaultValue={c?.notas ?? ""} className={campo} /></label>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Si el crédito ya lleva tiempo, captura el saldo de su último estado de cuenta y la fecha: los pagos de antes de esa fecha se toman por hechos y el saldo baja con lo que registres
        después. Liquidado o cancelado: sus pagos pendientes en Programación se cancelan.
      </p>
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
      <button type="submit" disabled={guardar.isPending} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {guardar.isPending ? "Guardando…" : c ? "Guardar cambios" : "Registrar crédito"}
      </button>
    </form>
  );
}

async function tablaDeArchivo(archivo: File): Promise<(string | null)[][]> {
  if (/\.csv$/i.test(archivo.name) || archivo.type === "text/csv") return tablaDesdeCsv(await archivo.text());
  const { default: ExcelJS } = await import("exceljs");
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await archivo.arrayBuffer());
  const hoja = libro.worksheets[0];
  if (!hoja) return [];
  const tabla: (string | null)[][] = [];
  hoja.eachRow({ includeEmpty: true }, (fila) => {
    const celdas: (string | null)[] = [];
    fila.eachCell({ includeEmpty: true }, (celda, col) => {
      // Las fechas de Excel llegan como Date: se pasan a AAAA-MM-DD.
      const v = celda.value;
      celdas[col - 1] = v instanceof Date ? v.toISOString().slice(0, 10) : celda.text?.trim() || null;
    });
    tabla.push(celdas);
  });
  return tabla;
}

function CargaExcel({ onListo }: { onListo: () => void }) {
  const qc = useQueryClient();
  const { data: empresas } = useEmpresasAlcance();
  const [filas, setFilas] = useState<CreditoCarga[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const buenas = (filas ?? []).filter((f) => f.errores.length === 0);

  async function leer(archivo: File | undefined) {
    if (!archivo) return;
    setAviso(null);
    try {
      const { creditos, faltan } = creditosDesdeTabla(await tablaDeArchivo(archivo), empresas ?? []);
      if (faltan.length) setAviso(faltan.join(" "));
      setFilas(creditos);
    } catch (e) {
      setAviso(`No se pudo leer el archivo: ${(e as Error).message}`);
    }
  }

  async function subir() {
    setSubiendo(true);
    const registros = buenas.map(({ fila: _f, empresa: _e, errores: _x, ...r }) => r);
    const { error } = await supabase.from("deuda_creditos").insert(registros);
    setSubiendo(false);
    if (error) return setAviso(error.message);
    qc.invalidateQueries({ queryKey: ["deuda-creditos"] });
    setFilas(null);
    onListo();
  }

  return (
    <section className={`${tarjeta} p-5 text-sm`}>
      <h2 className="mb-1 text-lg font-semibold text-slate-900">O súbelos desde Excel</h2>
      <p className="mb-2 text-xs text-slate-600">
        Una fila por crédito. Mínimo: Empresa (código, p. ej. AEP), Acreedor, Monto y Fecha de disposición. Opcionales: Tipo, Contrato, Moneda, Vencimiento, Tasa anual, Tipo de tasa, Referencia, Plazo meses, Periodicidad, Amortización,
        Primer pago, Saldo y Saldo al (del último estado de cuenta), Garantía, Aval y Notas.{" "}
        <button type="button" onClick={() => descargar("plantilla-deuda-financiera.csv", csvPlantilla())} className="text-sky-700 underline">
          Descargar plantilla
        </button>
      </p>
      <input type="file" accept=".xlsx,.csv" onChange={(e) => leer(e.target.files?.[0])} className="text-xs" />
      {aviso && <p className="mt-2 text-xs text-amber-800">{aviso}</p>}
      {filas && (
        <>
          <div className="mt-3 max-h-80 overflow-auto rounded border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-2 py-1">Fila</th>
                  <th className="px-2 py-1">Empresa</th>
                  <th className="px-2 py-1">Acreedor</th>
                  <th className="px-2 py-1">Tipo</th>
                  <th className="px-2 py-1 text-right">Monto</th>
                  <th className="px-2 py-1">Disposición</th>
                  <th className="px-2 py-1">Tasa</th>
                  <th className="px-2 py-1">Plazo</th>
                  <th className="px-2 py-1 text-right">Saldo</th>
                  <th className="px-2 py-1">Revisión</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.fila} className={`border-t border-slate-100 ${f.errores.length ? "bg-red-50" : ""}`}>
                    <td className="px-2 py-1">{f.fila}</td>
                    <td className="px-2 py-1">{f.empresa}</td>
                    <td className="px-2 py-1">{f.acreedor}</td>
                    <td className="px-2 py-1">{TIPOS_CREDITO[f.tipo]}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{f.monto != null ? dinero(f.monto, f.moneda) : "—"}</td>
                    <td className="px-2 py-1">{fechaCorta(f.fecha_disposicion)}</td>
                    <td className="px-2 py-1">{f.tasa_anual != null ? `${f.tasa_anual} %` : "—"}</td>
                    <td className="px-2 py-1">{f.plazo_meses ? `${f.plazo_meses} m · ${PERIODICIDADES[f.periodicidad].toLowerCase()}` : PERIODICIDADES[f.periodicidad].toLowerCase()}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{f.saldo_corte != null ? `${dinero(f.saldo_corte, f.moneda)} al ${fechaCorta(f.saldo_corte_al)}` : "—"}</td>
                    <td className="px-2 py-1">{f.errores.length ? <span className="text-red-700">{f.errores.join("; ")}</span> : <span className="text-emerald-700">ok</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={subir} disabled={!buenas.length || subiendo} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {subiendo ? "Subiendo…" : `Subir ${buenas.length} crédito(s)`}
            </button>
            {filas.length > buenas.length && <span className="text-xs text-red-700">{filas.length - buenas.length} con errores no se suben: corrígelos en el archivo y vuelve a subirlo.</span>}
          </div>
        </>
      )}
    </section>
  );
}
