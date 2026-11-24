import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { rutaVerArchivo } from "../../lib/verArchivo";
import { emparejarCliente, fechaConsultaDeHoja, folioSaldoInicial, saldosDesdeHoja, saldosQueSustituye, type CandidatoCliente, type ClienteCxc, type DocumentoCxc, type SaldoHoja } from "../../lib/cuentasPorCobrar";

// Estados de cuenta de clientes (Mario, 4-nov-2026: "poder consultar el
// archivo que adjunto para tomar esta base para la conciliación y de ahí
// arrancamos de ceros"). Se sube el Excel (o PDF) por empresa con su fecha de
// corte; queda consultable en /archivo?f=cxc y, si se quiere, de la hoja
// resumen (Cliente · Total) salen los saldos iniciales por cliente: desde ese
// corte la cartera ya no cuenta las facturas ni OV anteriores de ese cliente.

export interface ArchivoCxc {
  id: string;
  empresa_id: string;
  nombre: string;
  tamano: number | null;
  corte: string;
  nota: string | null;
  resumen: { total?: number; clientes?: { nombre: string; saldo: number; clave?: string | null }[] } | null;
  subido_por_nombre: string | null;
  created_at: string;
}

interface Empresa { id: string; codigo: string; nombre: string }

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "text-xs text-slate-600";
const btnPrimario = "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50";
const btnSecundario = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800";

function dinero(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}
function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function llamarEdge(metodo: "POST" | "DELETE", cuerpo?: FormData, id?: string): Promise<{ id?: string }> {
  const { data: sesion } = await supabase.auth.getSession();
  const base = urlFuncion("cxc-archivos");
  const resp = await fetch(id ? `${base}?id=${encodeURIComponent(id)}` : base, {
    method: metodo,
    headers: { Authorization: `Bearer ${sesion.session?.access_token ?? ""}` },
    body: cuerpo,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error ?? `Error ${resp.status}`);
  return json;
}

type Hoja = { nombre: string; filas: (string | number | null)[][] };
const FILAS_POR_HOJA = 200;

/** Lee las hojas del Excel como matrices de celdas (texto o número), solo las
 * primeras 200 filas de cada una: el resumen Cliente · Total va arriba. Primero
 * SheetJS con `sheetRows` (el Excel de Laura pesa 3.8 MB y trae ~25,000 filas
 * con fórmulas en 8 hojas; ExcelJS lo cargaba completo y la pantalla se quedaba
 * sin saldos: 11 y 23-nov-2026, los dos archivos quedaron con resumen vacío);
 * si SheetJS falla, ExcelJS como respaldo. */
async function hojasDeExcel(archivo: File): Promise<Hoja[]> {
  const bytes = await archivo.arrayBuffer();
  try {
    return await hojasConSheetJs(bytes);
  } catch (e) {
    console.warn("SheetJS no pudo leer el Excel; se intenta con ExcelJS", e);
    return hojasConExcelJs(bytes);
  }
}

async function hojasConSheetJs(bytes: ArrayBuffer): Promise<Hoja[]> {
  const XLSX = await import("xlsx");
  const libro = XLSX.read(new Uint8Array(bytes), { type: "array", sheetRows: FILAS_POR_HOJA, cellFormula: false, cellHTML: false, cellText: false, cellDates: true, dense: true });
  return libro.SheetNames.map((nombre) => {
    const hoja = libro.Sheets[nombre];
    const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, raw: true, defval: null, blankrows: true }).slice(0, FILAS_POR_HOJA);
    return { nombre, filas: filas.map((f) => (f as unknown[]).map(celdaATexto)) };
  });
}

async function hojasConExcelJs(bytes: ArrayBuffer): Promise<Hoja[]> {
  const { default: ExcelJS } = await import("exceljs");
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(bytes);
  return libro.worksheets.map((hoja) => {
    const filas: (string | number | null)[][] = [];
    const tope = Math.min(hoja.rowCount, FILAS_POR_HOJA);
    for (let r = 1; r <= tope; r++) {
      const fila = hoja.getRow(r);
      const celdas: (string | number | null)[] = [];
      fila.eachCell({ includeEmpty: true }, (celda, col) => {
        let v: unknown = celda.value;
        if (v && typeof v === "object" && "result" in (v as object)) v = (v as { result: unknown }).result;
        if (v && typeof v === "object" && "richText" in (v as object)) v = (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
        celdas[col - 1] = celdaATexto(v);
      });
      filas.push(celdas);
    }
    return { nombre: hoja.name, filas };
  });
}

function celdaATexto(v: unknown): string | number | null {
  if (typeof v === "number") return v;
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v);
}

interface RenglonSaldo extends SaldoHoja {
  clave: string;
  nombreCliente: string;
  obra: string;
  incluir: boolean;
}

export function CxcEstadosCuenta({
  empresas, clientes, docs, puedeOperar, empresaFiltro,
}: { empresas: Empresa[]; clientes: ClienteCxc[]; docs: DocumentoCxc[]; puedeOperar: boolean; empresaFiltro: string | null }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [empresaId, setEmpresaId] = useState(empresaFiltro ?? empresas[0]?.id ?? "");
  useEffect(() => { if (!empresaId && empresas[0]) setEmpresaId(empresaFiltro ?? empresas[0].id); }, [empresas, empresaId, empresaFiltro]);
  const [corte, setCorte] = useState(hoyIso());
  const [nota, setNota] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [hojas, setHojas] = useState<Hoja[] | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [corteSugerido, setCorteSugerido] = useState<string | null>(null);
  const [hojaElegida, setHojaElegida] = useState("");
  const [crearSaldos, setCrearSaldos] = useState(true);
  const [renglones, setRenglones] = useState<RenglonSaldo[]>([]);

  const { data: archivos } = useQuery({
    queryKey: ["cxc-archivos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cxc_archivos").select("id, empresa_id, nombre, tamano, corte, nota, resumen, subido_por_nombre, created_at").order("corte", { ascending: false }).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as ArchivoCxc[];
    },
  });
  // Empresas del grupo con RFC: los clientes de Laura son casi todos del grupo.
  const { data: grupo } = useQuery({
    queryKey: ["cxc-empresas-rfc"],
    enabled: abierto,
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, codigo, nombre, razon_social, rfc").eq("activo", true);
      if (error) throw error;
      return (data ?? []) as { id: string; codigo: string; nombre: string; razon_social: string | null; rfc: string | null }[];
    },
  });
  const candidatos = useMemo<CandidatoCliente[]>(() => {
    const m = new Map<string, CandidatoCliente>();
    for (const g of grupo ?? []) {
      if (!g.rfc || g.id === empresaId) continue;
      m.set(g.rfc.toUpperCase(), { clave: g.rfc.toUpperCase(), nombre: g.nombre, rfc: g.rfc, alias: [g.codigo, g.razon_social ?? ""].filter(Boolean) });
    }
    for (const c of clientes) {
      const prev = m.get(c.clave);
      if (prev) prev.alias = [...(prev.alias ?? []), c.nombre];
      else m.set(c.clave, { clave: c.clave, nombre: c.nombre, rfc: c.rfc, alias: [] });
    }
    for (const d of docs) {
      const prev = m.get(d.cliente_clave);
      if (prev) { if (!prev.alias?.includes(d.cliente)) prev.alias = [...(prev.alias ?? []), d.cliente]; }
      else m.set(d.cliente_clave, { clave: d.cliente_clave, nombre: d.cliente, rfc: d.rfc, alias: [] });
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [grupo, clientes, docs, empresaId]);

  // Saldos iniciales que ya existen para esa empresa y corte (se ligan al archivo en vez de duplicarse).
  const yaExisten = useMemo(() => docs.filter((d) => d.origen === "manual" && d.tipo === "saldo_inicial" && d.empresa_id === empresaId && d.fecha === corte), [docs, empresaId, corte]);

  async function leer(f: File | undefined) {
    setArchivo(f ?? null);
    setHojas(null);
    setRenglones([]);
    setCorteSugerido(null);
    setErr(null);
    if (!f || !/\.xlsx$/i.test(f.name)) return;
    setLeyendo(true);
    try {
      const hs = await hojasDeExcel(f);
      setHojas(hs);
      const resumen = hs.find((h) => /^cxc$|resumen|saldos/i.test(h.nombre) && saldosDesdeHoja(h.filas).length > 0) ?? hs.find((h) => saldosDesdeHoja(h.filas).length > 0) ?? hs[0];
      setHojaElegida(resumen?.nombre ?? "");
      // "Fecha de Consulta" de la hoja = a qué día están los saldos: se toma como corte.
      const consulta = resumen ? fechaConsultaDeHoja(resumen.filas) : null;
      if (consulta) { setCorte(consulta); setCorteSugerido(consulta); }
    } catch (e) {
      setErr(`No se pudo leer el Excel: ${(e as Error).message}. Puedes subirlo igual, pero sin saldos iniciales: captúralos después en Registrar cobro › Documentos.`);
    } finally {
      setLeyendo(false);
    }
  }
  useEffect(() => {
    const h = hojas?.find((x) => x.nombre === hojaElegida);
    if (!h) { setRenglones([]); return; }
    setRenglones(saldosDesdeHoja(h.filas).map((s) => {
      const c = emparejarCliente(s.nombre, candidatos);
      return { ...s, clave: c?.clave ?? "", nombreCliente: c?.nombre ?? s.nombre, obra: "", incluir: s.saldo > 0 };
    }));
  }, [hojas, hojaElegida, candidatos]);

  const sumaIncluidos = renglones.filter((r) => r.incluir).reduce((s, r) => s + r.saldo, 0);
  const sinClave = renglones.filter((r) => r.incluir && !r.clave);
  // Saldos iniciales de cortes anteriores de esta empresa: el estado de cuenta
  // nuevo trae el saldo completo de cada cliente, así que se cierran.
  const sustituye = useMemo(() => saldosQueSustituye(docs, empresaId, corte), [docs, empresaId, corte]);
  const sustituyeTotal = useMemo(() => docs.filter((d) => sustituye.includes(d.id)).reduce((s, d) => s + d.total, 0), [docs, sustituye]);

  const subir = useMutation({
    mutationFn: async () => {
      if (!archivo) throw new Error("Elige el archivo.");
      if (!empresaId) throw new Error("Elige la empresa.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(corte)) throw new Error("Indica la fecha de corte.");
      if (leyendo) throw new Error("Espera a que termine de leerse el Excel.");
      if (crearSaldos && yaExisten.length === 0 && sinClave.length > 0) throw new Error(`Elige a qué cliente corresponde: ${sinClave.map((r) => r.nombre).join(", ")}.`);
      if (/\.xlsx$/i.test(archivo.name) && renglones.length === 0 && !window.confirm("No se leyó ningún saldo por cliente del Excel (hoja Cliente · Total). ¿Subir el archivo de todos modos, sin crear saldos iniciales?")) {
        throw new Error("No se subió: revisa la hoja con el resumen por cliente.");
      }
      const fd = new FormData();
      fd.append("empresaId", empresaId);
      fd.append("corte", corte);
      fd.append("nota", nota);
      fd.append("file", archivo);
      const resumen = renglones.length > 0 ? { total: Math.round(renglones.reduce((s, r) => s + r.saldo, 0) * 100) / 100, clientes: renglones.map((r) => ({ nombre: r.nombre, saldo: r.saldo, clave: r.clave || null })) } : null;
      if (resumen) fd.append("resumen", JSON.stringify(resumen));
      const { id } = await llamarEdge("POST", fd);
      if (!id) throw new Error("No se recibió el id del archivo.");
      let creados = 0;
      if (crearSaldos) {
        if (yaExisten.length > 0) {
          const { error } = await supabase.from("cxc_documentos").update({ archivo_id: id }).eq("empresa_id", empresaId).eq("tipo", "saldo_inicial").eq("fecha", corte).is("archivo_id", null);
          if (error) throw error;
        } else {
          const filas = renglones.filter((r) => r.incluir && r.clave).map((r) => {
            const c = candidatos.find((x) => x.clave === r.clave);
            return {
              empresa_id: empresaId,
              tipo: "saldo_inicial",
              folio: folioSaldoInicial(corte, r.nombre + (r.nota ? ` (${r.nota})` : "")),
              cliente_clave: r.clave,
              cliente_nombre: c?.nombre ?? r.nombreCliente,
              cliente_rfc: c?.rfc ?? (r.clave.startsWith("N:") ? null : r.clave),
              obra: r.obra || null,
              fecha: corte,
              vence: corte,
              total: r.saldo,
              retenido: 0,
              concepto: `Saldo según ${archivo.name}${r.nota ? ` · ${r.nota}` : ""}`,
              archivo_id: id,
            };
          });
          if (filas.length > 0) {
            const { error } = await supabase.from("cxc_documentos").insert(filas);
            if (error) throw error;
            creados = filas.length;
            if (sustituye.length > 0) {
              const { error: errCierre } = await supabase
                .from("cxc_documentos")
                .update({ cancelado_en: new Date().toISOString(), cancelado_motivo: `Sustituido por el estado de cuenta al ${fechaCorta(corte)} (${archivo.name})` })
                .in("id", sustituye)
                .is("cancelado_en", null);
              if (errCierre) throw errCierre;
            }
          }
        }
      }
      return creados;
    },
    onSuccess: (creados) => {
      setOk(creados > 0
        ? `Archivo guardado y ${creados} saldos iniciales creados al ${fechaCorta(corte)}: la cartera arranca desde ahí${sustituye.length > 0 ? ` (se cerraron los ${sustituye.length} del corte anterior)` : ""}.`
        : yaExisten.length > 0 && crearSaldos ? "Archivo guardado y ligado a los saldos iniciales que ya existían." : "Archivo guardado, sin saldos iniciales.");
      setErr(null);
      setArchivo(null); setHojas(null); setRenglones([]); setNota("");
      qc.invalidateQueries({ queryKey: ["cxc-archivos"] });
      qc.invalidateQueries({ queryKey: ["cxc-cartera"] });
      qc.invalidateQueries({ queryKey: ["cxc-ov-pendientes"] });
    },
    onError: (e) => { setOk(null); setErr((e as Error).message); },
  });
  const quitar = useMutation({
    mutationFn: async (a: ArchivoCxc) => {
      if (!window.confirm(`¿Quitar "${a.nombre}"? Los saldos iniciales que se crearon con él se quedan; solo pierden la liga al archivo.`)) return;
      await llamarEdge("DELETE", undefined, a.id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cxc-archivos"] }); qc.invalidateQueries({ queryKey: ["cxc-cartera"] }); },
    onError: (e) => setErr((e as Error).message),
  });

  const lista = (archivos ?? []).filter((a) => !empresaFiltro || a.empresa_id === empresaFiltro);
  const codigo = (id: string) => empresas.find((e) => e.id === id)?.codigo ?? "—";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" id="estados-cuenta">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Estados de cuenta de clientes</h2>
          <p className="text-xs text-slate-600">
            El archivo con el que se concilia (el Excel de cuentas por cobrar por cliente). Con su fecha de corte salen los saldos iniciales por cliente y desde ahí la cartera arranca de ceros: las facturas y OV anteriores al corte ya no se cuentan.
          </p>
        </div>
        {puedeOperar && <button type="button" onClick={() => setAbierto((v) => !v)} className={btnSecundario}>{abierto ? "Cerrar" : "+ Subir estado de cuenta"}</button>}
      </div>
      {abierto && puedeOperar && (
        <form className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-4" data-sin-borrador onSubmit={(e) => { e.preventDefault(); subir.mutate(); }}>
          <label className={etiqueta}>
            Empresa que cobra
            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className={campo}>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nombre}</option>)}
            </select>
          </label>
          <label className={etiqueta}>
            Fecha de corte (a qué día están los saldos)
            <input type="date" value={corte} onChange={(e) => setCorte(e.target.value)} className={campo} />
            {corteSugerido && corteSugerido === corte && <span className="text-emerald-700">tomada de la "Fecha de Consulta" del archivo</span>}
          </label>
          <label className={`${etiqueta} lg:col-span-2`}>Nota<input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. Estado de cuenta de Laura, hoja CxC" className={campo} /></label>
          <label className={`${etiqueta} sm:col-span-2`}>
            Archivo (Excel, CSV, PDF o imagen)
            <input type="file" accept=".xlsx,.xlsm,.xls,.csv,.pdf,image/*" onChange={(e) => leer(e.target.files?.[0])} className="block text-xs" />
            {leyendo && <span className="text-sky-700">Leyendo el Excel…</span>}
            {!leyendo && hojas && renglones.length === 0 && <span className="text-amber-700">No se encontró el resumen Cliente · Total; elige otra hoja o revisa el archivo.</span>}
          </label>
          {hojas && (
            <label className={`${etiqueta} sm:col-span-2`}>
              Hoja con el resumen por cliente (Cliente · Total)
              <select value={hojaElegida} onChange={(e) => setHojaElegida(e.target.value)} className={campo}>
                {hojas.map((h) => <option key={h.nombre} value={h.nombre}>{h.nombre}</option>)}
              </select>
            </label>
          )}
          {renglones.length > 0 && (
            <div className="sm:col-span-2 lg:col-span-4">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input type="checkbox" checked={crearSaldos} onChange={(e) => setCrearSaldos(e.target.checked)} />
                {yaExisten.length > 0
                  ? `Ligar el archivo a los ${yaExisten.length} saldos iniciales que ya existen al ${fechaCorta(corte)} (${dinero(yaExisten.reduce((s, d) => s + d.total, 0))})`
                  : `Crear los saldos iniciales al ${fechaCorta(corte)} con estos renglones (${dinero(sumaIncluidos)}) y arrancar la cartera desde ahí`}
              </label>
              {yaExisten.length === 0 && crearSaldos && sustituye.length > 0 && (
                <p className="mt-1 text-xs text-amber-800">
                  Se cierran los {sustituye.length} saldos iniciales del corte anterior ({dinero(sustituyeTotal)}): el estado de cuenta nuevo ya trae el saldo completo de cada cliente, así no se suman dos veces.
                </p>
              )}
              {yaExisten.length === 0 && (
                <div className="mt-2 overflow-x-auto rounded border border-slate-200 bg-white">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-left text-slate-500">
                      <tr><th className="px-2 py-1" /><th className="px-2 py-1">En el archivo</th><th className="px-2 py-1">Cliente en el sistema</th><th className="px-2 py-1">Obra (opcional)</th><th className="px-2 py-1 text-right">Saldo</th></tr>
                    </thead>
                    <tbody>
                      {renglones.map((r, i) => (
                        <tr key={`${r.fila}-${i}`} className={`border-t border-slate-100 ${!r.incluir ? "text-slate-400" : ""}`}>
                          <td className="px-2 py-1"><input type="checkbox" checked={r.incluir} onChange={(e) => setRenglones((prev) => prev.map((x, j) => (j === i ? { ...x, incluir: e.target.checked } : x)))} aria-label={`Incluir ${r.nombre}`} /></td>
                          <td className="px-2 py-1">{r.nombre}{r.nota && <span className="ml-1 text-amber-700">({r.nota})</span>}<div className="text-[10px] text-slate-400">fila {r.fila}</div></td>
                          <td className="px-2 py-1">
                            <select value={r.clave} onChange={(e) => setRenglones((prev) => prev.map((x, j) => (j === i ? { ...x, clave: e.target.value } : x)))} className={`${campo} ${r.incluir && !r.clave ? "border-red-400" : ""}`}>
                              <option value="">Elige…</option>
                              {candidatos.map((c) => <option key={c.clave} value={c.clave}>{c.nombre}{c.rfc ? ` · ${c.rfc}` : ""}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1"><input value={r.obra} onChange={(e) => setRenglones((prev) => prev.map((x, j) => (j === i ? { ...x, obra: e.target.value } : x)))} className={campo} placeholder="—" /></td>
                          <td className="px-2 py-1 text-right tabular-nums">{dinero(r.saldo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-1 text-xs text-slate-500">Un cliente que no esté en la lista se da de alta primero en Registrar cobro › Documentos (con su RFC) o con el nombre tal cual en el Excel.</p>
            </div>
          )}
          {archivo && !hojas && !/\.xlsx$/i.test(archivo.name) && <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">Este archivo se guarda para consulta; los saldos iniciales se capturan a mano (Registrar cobro › Documentos, tipo "Saldo inicial").</p>}
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4">
            <button type="submit" disabled={subir.isPending || leyendo || !archivo} className={btnPrimario}>{subir.isPending ? "Subiendo…" : leyendo ? "Leyendo el Excel…" : "Guardar archivo"}</button>
            {err && <span className="text-sm text-red-700">{err}</span>}
            {ok && <span className="text-sm text-emerald-700">{ok}</span>}
          </div>
        </form>
      )}
      {!abierto && err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      {!abierto && ok && <p className="mt-2 text-sm text-emerald-700">{ok}</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="px-2 py-1">Corte</th><th className="px-2 py-1">Empresa</th><th className="px-2 py-1">Archivo</th><th className="px-2 py-1 text-right">Total en el archivo</th><th className="px-2 py-1">Subió</th><th className="px-2 py-1" /></tr>
          </thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-2 py-1.5 whitespace-nowrap">{fechaCorta(a.corte)}</td>
                <td className="px-2 py-1.5">{codigo(a.empresa_id)}</td>
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => window.open(rutaVerArchivo("cxc", a.id), "_blank")} className="text-left font-semibold text-sky-700 underline">{a.nombre}</button>
                  {a.nota && <div className="text-xs text-slate-500">{a.nota}</div>}
                  {a.resumen?.clientes && <div className="text-xs text-slate-500">{a.resumen.clientes.length} clientes en el resumen</div>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{a.resumen?.total != null ? dinero(a.resumen.total) : "—"}</td>
                <td className="px-2 py-1.5 text-xs text-slate-600">{a.subido_por_nombre ?? "—"} · {fechaCorta(a.created_at)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">
                  <button type="button" onClick={() => window.open(rutaVerArchivo("cxc", a.id, { descargar: a.nombre }), "_blank")} className="text-xs text-slate-700 underline">descargar</button>
                  {puedeOperar && <button type="button" onClick={() => quitar.mutate(a)} className="ml-2 text-xs text-red-700 underline">quitar</button>}
                </td>
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={6} className="px-2 py-3 text-center text-slate-500">Todavía no hay estados de cuenta subidos{empresaFiltro ? " para esta empresa" : ""}.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
