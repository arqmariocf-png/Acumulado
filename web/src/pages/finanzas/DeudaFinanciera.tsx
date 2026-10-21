import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa, useEmpresasAlcance } from "../../components/SelectorEmpresa";
import {
  AMORTIZACIONES,
  ESTATUS_CREDITO,
  PERIODICIDADES,
  TIPOS_CREDITO,
  creditosDesdeTabla,
  csvPlantilla,
  estadoPagos,
  resumenDeuda,
  tablaAmortizacion,
  type Amortizacion,
  type CreditoCarga,
  type EstatusCredito,
  type Periodicidad,
  type TipoCredito,
} from "../../lib/deudaFinanciera";
import { tablaDesdeCsv } from "../../lib/importarBancarios";

// Deuda financiera (21-oct-2026, Mario: "crear un módulo de deuda financiera
// para subir los préstamos"): créditos de bancos, arrendadoras y particulares
// por empresa, con su saldo (calculado en v_deuda_creditos), pagos, tabla de
// amortización proyectada y carga desde Excel. Capturan dirección, admin y
// tesorería; contabilidad consulta (RLS: auth_opera_deuda / auth_ve_deuda).

interface Credito {
  id: string;
  empresa_id: string;
  empresa_codigo: string | null;
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
  garantia: string | null;
  aval: string | null;
  saldo_corte: number | null;
  saldo_corte_al: string | null;
  estatus: EstatusCredito;
  notas: string | null;
  capital_pagado: number;
  intereses_pagados: number;
  num_pagos: number;
  ultimo_pago: string | null;
  saldo: number;
}

interface Pago {
  id: string;
  fecha: string;
  capital: number;
  interes: number;
  iva_interes: number;
  comisiones: number;
  total: number;
  referencia: string | null;
}

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "text-xs text-slate-600";

function dinero(n: number | null | undefined, moneda = "MXN"): string {
  return Number(n ?? 0).toLocaleString("es-MX", { style: "currency", currency: moneda, minimumFractionDigits: 2 });
}
function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
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

export function DeudaFinanciera() {
  const { perfil, soloConsulta } = useAuth();
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const [texto, setTexto] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const [editando, setEditando] = useState<Credito | "nuevo" | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [cargar, setCargar] = useState(false);
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

  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (creditos ?? []).filter(
      (c) =>
        (!empresaId || c.empresa_id === empresaId) &&
        (verTodos || c.estatus === "vigente") &&
        (!t || `${c.folio} ${c.acreedor} ${c.contrato ?? ""} ${c.empresa_codigo ?? ""}`.toLowerCase().includes(t)),
    );
  }, [creditos, empresaId, texto, verTodos]);
  const estados = useMemo(() => new Map(lista.map((c) => [c.id, estadoPagos(c, hoy)])), [lista, hoy]);
  const resumen = useMemo(() => resumenDeuda(lista), [lista]);
  const proximos30 = lista.filter((c) => {
    const p = estados.get(c.id)?.proximo;
    if (!p) return false;
    const dias = (new Date(`${p.fecha}T12:00:00`).getTime() - new Date(`${hoy}T12:00:00`).getTime()) / 86400000;
    return dias <= 30;
  });
  const vencidos = lista.filter((c) => (estados.get(c.id)?.vencidos ?? 0) > 0);

  function exportar() {
    const enc = ["Empresa", "Folio", "Acreedor", "Tipo", "Contrato", "Moneda", "Monto", "Disposición", "Vencimiento", "Tasa anual", "Plazo meses", "Periodicidad", "Saldo", "Próximo pago", "Importe próximo", "Pagos vencidos", "Estatus"];
    const filas = lista.map((c) => {
      const e = estados.get(c.id);
      return [c.empresa_codigo ?? "", c.folio, c.acreedor, TIPOS_CREDITO[c.tipo], c.contrato ?? "", c.moneda, c.monto, c.fecha_disposicion, c.fecha_vencimiento ?? "", c.tasa_anual ?? "", c.plazo_meses ?? "", PERIODICIDADES[c.periodicidad], c.saldo, e?.proximo?.fecha ?? "", e?.proximo?.pago ?? "", e?.vencidos ?? 0, ESTATUS_CREDITO[c.estatus]];
    });
    const linea = (v: (string | number)[]) => v.map((x) => (/[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x))).join(",");
    descargar(`deuda-financiera-${hoy}.csv`, [linea(enc), ...filas.map(linea)].join("\n"));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Deuda financiera</h1>
          <p className="text-sm text-slate-500">Créditos de bancos, arrendadoras y particulares por empresa: saldo, próximos pagos y tabla de amortización.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {puedeCapturar && (
            <>
              <button type="button" onClick={() => { setEditando("nuevo"); setCargar(false); }} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
                + Nuevo préstamo
              </button>
              <button type="button" onClick={() => { setCargar((v) => !v); setEditando(null); }} className="rounded border border-slate-900 px-3 py-1.5 text-sm font-medium text-slate-900">
                Subir desde Excel
              </button>
            </>
          )}
          <button type="button" onClick={exportar} disabled={!lista.length} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50">
            Descargar Excel
          </button>
        </div>
      </div>

      {cargar && <CargaExcel onCerrar={() => setCargar(false)} />}
      {editando && <FormCredito credito={editando === "nuevo" ? null : editando} onCerrar={() => setEditando(null)} />}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {resumen.porMoneda.length === 0 && <Tarjeta titulo="Deuda vigente" valor={dinero(0)} />}
        {resumen.porMoneda.map((m) => (
          <Tarjeta key={m.moneda} titulo={`Deuda vigente ${m.moneda}`} valor={dinero(m.saldo, m.moneda)} detalle={`${m.creditos} crédito(s)${m.tasaPonderada != null ? ` · tasa prom. ${m.tasaPonderada.toFixed(2)} %` : ""}`} />
        ))}
        <Tarjeta titulo="Pagos en 30 días" valor={String(proximos30.length)} detalle={dinero(proximos30.reduce((s, c) => s + (estados.get(c.id)?.proximo?.pago ?? 0), 0))} />
        <Tarjeta titulo="Con pagos vencidos" valor={String(vencidos.length)} tono={vencidos.length ? "text-red-700" : "text-emerald-700"} detalle={vencidos.length ? dinero(vencidos.reduce((s, c) => s + (estados.get(c.id)?.montoVencido ?? 0), 0)) : "al corriente"} />
      </div>

      {resumen.porEmpresa.length > 1 && (
        <p className="mb-3 text-xs text-slate-600">
          Por empresa:{" "}
          {resumen.porEmpresa.map((e, i) => (
            <span key={`${e.empresa}-${e.moneda}`}>
              {i > 0 && " · "}
              <b>{e.empresa}</b> {dinero(e.saldo, e.moneda)}
            </span>
          ))}
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />
        <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar acreedor, folio o contrato…" className="w-full max-w-xs rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} /> ver también liquidados y cancelados
        </label>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}

      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Préstamo</th>
              <th className="px-3 py-2">Condiciones</th>
              <th className="px-3 py-2 text-right">Monto</th>
              <th className="px-3 py-2 text-right">Saldo</th>
              <th className="px-3 py-2">Próximo pago</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => {
              const e = estados.get(c.id);
              return (
                <FilaCredito
                  key={c.id}
                  c={c}
                  e={e}
                  abierto={abierto === c.id}
                  onAbrir={() => setAbierto(abierto === c.id ? null : c.id)}
                  onEditar={puedeCapturar ? () => { setEditando(c); setCargar(false); window.scrollTo({ top: 0, behavior: "smooth" }); } : undefined}
                  puedeCapturar={puedeCapturar}
                  hoy={hoy}
                />
              );
            })}
            {!isLoading && lista.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  {creditos?.length ? "Ningún préstamo con ese filtro." : "Todavía no hay préstamos. Dalos de alta uno por uno o súbelos desde Excel."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tarjeta({ titulo, valor, detalle, tono = "text-slate-900" }: { titulo: string; valor: string; detalle?: string; tono?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase text-slate-500">{titulo}</div>
      <div className={`text-lg font-semibold tabular-nums ${tono}`}>{valor}</div>
      {detalle && <div className="text-xs text-slate-500">{detalle}</div>}
    </div>
  );
}

function FilaCredito({
  c,
  e,
  abierto,
  onAbrir,
  onEditar,
  puedeCapturar,
  hoy,
}: {
  c: Credito;
  e: ReturnType<typeof estadoPagos> | undefined;
  abierto: boolean;
  onAbrir: () => void;
  onEditar?: () => void;
  puedeCapturar: boolean;
  hoy: string;
}) {
  return (
    <>
      <tr className="border-t border-slate-100 align-top">
        <td className="px-3 py-2">
          <div className="font-medium text-slate-900">{c.acreedor}</div>
          <div className="text-xs text-slate-500">
            <span className="font-mono">{c.folio}</span> · {c.empresa_codigo} · {TIPOS_CREDITO[c.tipo]}
            {c.contrato && <> · contrato {c.contrato}</>}
          </div>
          {c.estatus !== "vigente" && <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{ESTATUS_CREDITO[c.estatus]}</span>}
        </td>
        <td className="px-3 py-2 text-xs text-slate-600">
          {c.tasa_anual != null ? `${Number(c.tasa_anual).toFixed(2)} % ${c.tasa_tipo}` : "sin tasa"}
          {c.tasa_referencia && ` (${c.tasa_referencia})`}
          <div>
            {c.plazo_meses ? `${c.plazo_meses} meses · ` : ""}
            {PERIODICIDADES[c.periodicidad].toLowerCase()} · {fechaCorta(c.fecha_disposicion)} → {fechaCorta(c.fecha_vencimiento)}
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{dinero(c.monto, c.moneda)}</td>
        <td className="px-3 py-2 text-right">
          <div className="font-semibold tabular-nums">{dinero(c.saldo, c.moneda)}</div>
          <div className="text-[11px] text-slate-500">{c.saldo_corte != null ? `estado de cuenta al ${fechaCorta(c.saldo_corte_al)}` : `${c.num_pagos} pago(s) registrados`}</div>
        </td>
        <td className="px-3 py-2 text-xs">
          {e?.proximo ? (
            <>
              <div className={e.proximo.fecha < hoy ? "font-medium text-red-700" : "text-slate-800"}>
                {fechaCorta(e.proximo.fecha)} · {dinero(e.proximo.pago, c.moneda)}
              </div>
              {e.vencidos > 0 && <div className="text-red-700">{e.vencidos} vencido(s) · {dinero(e.montoVencido, c.moneda)}</div>}
            </>
          ) : (
            <span className="text-slate-400">{c.amortizacion === "personalizado" ? "sin tabla" : "—"}</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onAbrir} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
              {abierto ? "Cerrar" : "Pagos y tabla"}
            </button>
            {onEditar && (
              <button type="button" onClick={onEditar} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
                Editar
              </button>
            )}
          </div>
        </td>
      </tr>
      {abierto && (
        <tr className="border-t border-slate-100 bg-slate-50/60">
          <td colSpan={6} className="px-3 py-3">
            <DetalleCredito c={c} proximo={e?.proximo ?? null} puedeCapturar={puedeCapturar} />
          </td>
        </tr>
      )}
    </>
  );
}

function DetalleCredito({ c, proximo, puedeCapturar }: { c: Credito; proximo: ReturnType<typeof estadoPagos>["proximo"]; puedeCapturar: boolean }) {
  const qc = useQueryClient();
  const [verTabla, setVerTabla] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pagos = useQuery({
    queryKey: ["deuda-pagos", c.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("deuda_pagos").select("id, fecha, capital, interes, iva_interes, comisiones, total, referencia").eq("credito_id", c.id).order("fecha", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Pago[];
    },
  });
  const tabla = useMemo(() => tablaAmortizacion(c), [c]);
  const registrar = useMutation({
    mutationFn: async (p: Omit<Pago, "id" | "total">) => {
      const { error } = await supabase.from("deuda_pagos").insert({ credito_id: c.id, ...p });
      if (error) throw error;
    },
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries({ queryKey: ["deuda-pagos", c.id] });
      qc.invalidateQueries({ queryKey: ["deuda-creditos"] });
    },
    onError: (e) => setErr((e as Error).message),
  });
  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("deuda_pagos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deuda-pagos", c.id] });
      qc.invalidateQueries({ queryKey: ["deuda-creditos"] });
    },
    onError: (e) => setErr((e as Error).message),
  });

  function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const num = (k: string) => Number(String(fd.get(k) ?? "").replace(/,/g, "")) || 0;
    const p = { fecha: String(fd.get("fecha")), capital: num("capital"), interes: num("interes"), iva_interes: num("iva_interes"), comisiones: num("comisiones"), referencia: String(fd.get("referencia") ?? "").trim() || null };
    if (p.capital + p.interes + p.iva_interes + p.comisiones <= 0) return setErr("Captura al menos un importe.");
    if (p.capital > c.saldo + 0.01) return setErr(`El capital no puede pasar del saldo (${dinero(c.saldo, c.moneda)}).`);
    registrar.mutate(p);
    ev.currentTarget.reset();
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-4">
        <div>Capital pagado: <b className="tabular-nums">{dinero(c.capital_pagado, c.moneda)}</b></div>
        <div>Intereses pagados (con IVA): <b className="tabular-nums">{dinero(c.intereses_pagados, c.moneda)}</b></div>
        <div>Garantía: {c.garantia ?? "—"} · Aval: {c.aval ?? "—"}</div>
        <div>{c.notas ?? ""}</div>
      </div>

      {puedeCapturar && c.estatus === "vigente" && (
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-white p-2" data-sin-borrador>
          <label className={etiqueta}>Fecha<input name="fecha" type="date" required defaultValue={hoyIso()} className={campo} /></label>
          <label className={etiqueta}>Capital<input name="capital" inputMode="decimal" defaultValue={proximo?.capital ?? ""} className={`${campo} w-28`} /></label>
          <label className={etiqueta}>Interés<input name="interes" inputMode="decimal" defaultValue={proximo?.interes ?? ""} className={`${campo} w-24`} /></label>
          <label className={etiqueta}>IVA interés<input name="iva_interes" inputMode="decimal" defaultValue={proximo?.iva ?? ""} className={`${campo} w-24`} /></label>
          <label className={etiqueta}>Comisiones<input name="comisiones" inputMode="decimal" className={`${campo} w-24`} /></label>
          <label className={etiqueta}>Referencia<input name="referencia" className={`${campo} w-40`} /></label>
          <button type="submit" disabled={registrar.isPending} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            Registrar pago
          </button>
          {proximo && <span className="text-[11px] text-slate-500">Sugerido: pago {proximo.numero} de la tabla ({fechaCorta(proximo.fecha)}); corrígelo con el estado de cuenta.</span>}
        </form>
      )}
      {err && <p className="text-xs text-red-700">{err}</p>}

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Pagos registrados</h3>
        {pagos.data?.length ? (
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">Fecha</th>
                <th className="py-1 text-right">Capital</th>
                <th className="py-1 text-right">Interés</th>
                <th className="py-1 text-right">IVA</th>
                <th className="py-1 text-right">Comisiones</th>
                <th className="py-1 text-right">Total</th>
                <th className="py-1">Referencia</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pagos.data.map((p) => (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="py-1">{fechaCorta(p.fecha)}</td>
                  <td className="py-1 text-right tabular-nums">{dinero(p.capital, c.moneda)}</td>
                  <td className="py-1 text-right tabular-nums">{dinero(p.interes, c.moneda)}</td>
                  <td className="py-1 text-right tabular-nums">{dinero(p.iva_interes, c.moneda)}</td>
                  <td className="py-1 text-right tabular-nums">{dinero(p.comisiones, c.moneda)}</td>
                  <td className="py-1 text-right font-medium tabular-nums">{dinero(p.total, c.moneda)}</td>
                  <td className="py-1">{p.referencia ?? ""}</td>
                  <td className="py-1 text-right">
                    {puedeCapturar && (
                      <button type="button" onClick={() => window.confirm("¿Quitar este pago?") && quitar.mutate(p.id)} className="text-red-700 underline">
                        quitar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-slate-400">{pagos.isLoading ? "Cargando…" : "Sin pagos registrados."}</p>
        )}
      </div>

      {tabla.length > 0 && (
        <div>
          <button type="button" onClick={() => setVerTabla((v) => !v)} className="text-xs text-sky-700 underline">
            {verTabla ? "Ocultar" : "Ver"} tabla de amortización proyectada ({tabla.length} pagos)
          </button>
          {verTabla && (
            <div className="mt-1 max-h-80 overflow-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-1">#</th>
                    <th className="px-2 py-1">Fecha</th>
                    <th className="px-2 py-1 text-right">Saldo inicial</th>
                    <th className="px-2 py-1 text-right">Capital</th>
                    <th className="px-2 py-1 text-right">Interés</th>
                    <th className="px-2 py-1 text-right">IVA</th>
                    <th className="px-2 py-1 text-right">Pago</th>
                    <th className="px-2 py-1 text-right">Saldo final</th>
                  </tr>
                </thead>
                <tbody>
                  {tabla.map((t) => (
                    <tr key={t.numero} className={`border-t border-slate-100 ${proximo?.numero === t.numero ? "bg-amber-50" : ""}`}>
                      <td className="px-2 py-1">{t.numero}</td>
                      <td className="px-2 py-1">{fechaCorta(t.fecha)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{dinero(t.saldoInicial, c.moneda)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{dinero(t.capital, c.moneda)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{dinero(t.interes, c.moneda)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{dinero(t.iva, c.moneda)}</td>
                      <td className="px-2 py-1 text-right font-medium tabular-nums">{dinero(t.pago, c.moneda)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{dinero(t.saldoFinal, c.moneda)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1 text-[11px] text-slate-500">Proyección con los términos del contrato (tasa fija); con tasa variable o pagos anticipados, el estado de cuenta del banco manda.</p>
        </div>
      )}
    </div>
  );
}

function FormCredito({ credito, onCerrar }: { credito: Credito | null; onCerrar: () => void }) {
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
      const { error } = credito ? await supabase.from("deuda_creditos").update(fila).eq("id", credito.id) : await supabase.from("deuda_creditos").insert(fila);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deuda-creditos"] });
      onCerrar();
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
    guardar.mutate(fila);
  }

  const c = credito;
  return (
    <form onSubmit={onSubmit} className="mb-4 rounded border border-slate-300 bg-white p-4" data-sin-borrador>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{c ? `Editar ${c.folio}` : "Nuevo préstamo"}</h2>
        <button type="button" onClick={onCerrar} className="text-xs text-slate-500 underline">
          Cerrar
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
        <label className={etiqueta}>Acreedor (banco o persona) *<input name="acreedor" defaultValue={c?.acreedor} className={campo} /></label>
        <label className={etiqueta}>
          Tipo
          <select name="tipo" defaultValue={c?.tipo ?? "simple"} className={campo}>
            {Object.entries(TIPOS_CREDITO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={etiqueta}>Número de contrato<input name="contrato" defaultValue={c?.contrato ?? ""} className={campo} /></label>
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
        <label className={etiqueta}>Aval / obligado solidario<input name="aval" defaultValue={c?.aval ?? ""} className={campo} /></label>
        <label className={etiqueta}>Saldo según estado de cuenta<input name="saldo_corte" inputMode="decimal" defaultValue={c?.saldo_corte ?? ""} placeholder="si ya lleva pagos" className={campo} /></label>
        <label className={etiqueta}>Saldo al<input name="saldo_corte_al" type="date" defaultValue={c?.saldo_corte_al ?? ""} className={campo} /></label>
        <label className={etiqueta}>
          Estatus
          <select name="estatus" defaultValue={c?.estatus ?? "vigente"} className={campo}>
            {Object.entries(ESTATUS_CREDITO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={`${etiqueta} sm:col-span-2 lg:col-span-4`}>Notas<input name="notas" defaultValue={c?.notas ?? ""} className={campo} /></label>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Si el préstamo ya lleva tiempo, captura el saldo de su último estado de cuenta y la fecha: el saldo de aquí en adelante baja con el capital de los pagos que registres después de esa fecha.
      </p>
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
      <button type="submit" disabled={guardar.isPending} className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {guardar.isPending ? "Guardando…" : c ? "Guardar cambios" : "Dar de alta"}
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

function CargaExcel({ onCerrar }: { onCerrar: () => void }) {
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
    setAviso(`Listo: ${registros.length} préstamo(s) dados de alta.`);
    setFilas(null);
  }

  return (
    <div className="mb-4 rounded border border-slate-300 bg-white p-4 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">Subir préstamos desde Excel o CSV</h2>
        <button type="button" onClick={onCerrar} className="text-xs text-slate-500 underline">
          Cerrar
        </button>
      </div>
      <p className="mb-2 text-xs text-slate-600">
        Una fila por préstamo. Mínimo: Empresa (código, p. ej. AEP), Acreedor, Monto y Fecha de disposición. Opcionales: Tipo, Contrato, Moneda, Vencimiento, Tasa anual, Tipo de tasa, Referencia, Plazo meses, Periodicidad, Amortización, Primer
        pago, Saldo y Saldo al (del último estado de cuenta), Garantía, Aval y Notas.{" "}
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
            <button type="button" onClick={subir} disabled={!buenas.length || subiendo} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {subiendo ? "Subiendo…" : `Subir ${buenas.length} préstamo(s)`}
            </button>
            {filas.length > buenas.length && <span className="text-xs text-red-700">{filas.length - buenas.length} con errores no se suben: corrígelos en el archivo y vuelve a subirlo.</span>}
          </div>
        </>
      )}
    </div>
  );
}
