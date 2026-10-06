import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import { ComprobantePago } from "../../components/ComprobantePago";
import { BaseOrdenes } from "./BaseOrdenes";
import { normalizarTexto } from "../../lib/cuentasPorPagar";
import { agruparPorDia, csvHistorial, moverRango, rangoAtajo, totalesHistorial, type AtajoRango, type PagoHistorial } from "../../lib/historialPagos";

// Historial de pagos y comprobantes (Mario, 6-oct-2026: "revisar otras
// semanas y otros días de comprobantes y consultarlas en el pasado"). Lee
// pagos_programados pagados por fecha de pago; nada se captura aquí salvo
// subir el comprobante que falte.

const ATAJOS: [AtajoRango, string][] = [
  ["hoy", "Hoy"],
  ["ayer", "Ayer"],
  ["semana", "Esta semana"],
  ["semana_pasada", "Semana pasada"],
  ["mes", "Este mes"],
  ["mes_pasado", "Mes pasado"],
];

function hoyMx(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

interface FilaBd {
  id: string;
  empresa_id: string;
  beneficiario: string;
  concepto: string | null;
  monto: number;
  fecha_programada: string;
  pagado_en: string | null;
  metodo: string;
  referencia: string | null;
  comprobante_nombre: string | null;
  comprobante_path: string | null;
  confirmado_en: string | null;
  empresas: { nombre: string } | null;
  ordenes_compra: { id_orden: string | null; proyecto: string | null } | null;
}

export function HistorialPagos() {
  const hoy = hoyMx();
  const [rango, setRango] = useState(() => rangoAtajo("semana", hoy));
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const [metodo, setMetodo] = useState("");
  const [texto, setTexto] = useState("");
  const [comprobante, setComprobante] = useState<"" | "con" | "sin">("");
  const [params] = useSearchParams();
  const [vista, setVista] = useState<"oc" | "pagos">(params.get("ver") === "pagos" ? "pagos" : "oc");
  const { data: empresas } = useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, codigo").order("nombre");
      if (error) throw error;
      return data as { id: string; nombre: string; codigo: string }[];
    },
  });
  const nombreEmpresa = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.codigo || e.nombre])), [empresas]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["tesoreria", "historial", rango.desde, rango.hasta, empresaId],
    enabled: vista === "pagos",
    queryFn: async () => {
      let q = supabase
        .from("pagos_programados")
        .select("id, empresa_id, beneficiario, concepto, monto, fecha_programada, pagado_en, metodo, referencia, comprobante_nombre, comprobante_path, confirmado_en, empresas(nombre), ordenes_compra(id_orden, proyecto)")
        .eq("estatus", "pagado")
        .gte("pagado_en", rango.desde)
        .lte("pagado_en", rango.hasta)
        .order("pagado_en", { ascending: false })
        .limit(2000);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as unknown as FilaBd[]).map(
        (f): PagoHistorial => ({
          ...f,
          empresa_nombre: f.empresas?.nombre ?? "",
          id_orden: f.ordenes_compra?.id_orden ?? null,
          oc_proyecto: f.ordenes_compra?.proyecto ?? null,
        }),
      );
    },
  });

  const filtrados = useMemo(() => {
    const q = normalizarTexto(texto);
    return (data ?? []).filter((p) => {
      if (metodo && p.metodo !== metodo) return false;
      if (comprobante === "con" && !p.comprobante_path) return false;
      if (comprobante === "sin" && p.comprobante_path) return false;
      if (q && !normalizarTexto(`${p.beneficiario} ${p.concepto ?? ""} ${p.id_orden ?? ""} ${p.oc_proyecto ?? ""} ${p.referencia ?? ""}`).includes(q)) return false;
      return true;
    });
  }, [data, metodo, comprobante, texto]);
  const dias = useMemo(() => agruparPorDia(filtrados), [filtrados]);
  const tot = useMemo(() => totalesHistorial(filtrados), [filtrados]);

  function descargar() {
    const url = URL.createObjectURL(new Blob([csvHistorial(filtrados)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pagos-${rango.desde}-a-${rango.hasta}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Base de órdenes de compra y pagos</h1>
          <p className="text-sm text-slate-500">OC · proveedor · fecha · estatus · detalle · comprobante, de cualquier día, semana o mes. Elige el periodo o recórrelo con las flechas.</p>
        </div>
        <Link to="/finanzas/tesoreria" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
          Tesorería de hoy
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white p-3 text-sm">
        <button onClick={() => setRango((r) => moverRango(r, -1))} className="rounded border border-slate-300 px-2 py-1" title="Periodo anterior">
          ◀
        </button>
        <input type="date" value={rango.desde} onChange={(e) => e.target.value && setRango((r) => ({ desde: e.target.value, hasta: e.target.value > r.hasta ? e.target.value : r.hasta }))} className="rounded border border-slate-300 px-2 py-1" />
        <span className="text-slate-400">a</span>
        <input type="date" value={rango.hasta} onChange={(e) => e.target.value && setRango((r) => ({ hasta: e.target.value, desde: e.target.value < r.desde ? e.target.value : r.desde }))} className="rounded border border-slate-300 px-2 py-1" />
        <button onClick={() => setRango((r) => moverRango(r, 1))} className="rounded border border-slate-300 px-2 py-1" title="Periodo siguiente">
          ▶
        </button>
        {ATAJOS.map(([k, etiqueta]) => {
          const r = rangoAtajo(k, hoy);
          const activo = r.desde === rango.desde && r.hasta === rango.hasta;
          return (
            <button key={k} onClick={() => setRango(r)} className={`rounded px-2 py-1 text-xs ${activo ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-100"}`}>
              {etiqueta}
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-slate-300 text-sm">
          <button onClick={() => setVista("oc")} className={`px-3 py-1.5 ${vista === "oc" ? "bg-slate-900 text-white" : "text-slate-700"}`}>
            Órdenes de compra
          </button>
          <button onClick={() => setVista("pagos")} className={`px-3 py-1.5 ${vista === "pagos" ? "bg-slate-900 text-white" : "text-slate-700"}`}>
            Pagos por día
          </button>
        </div>
        {vista === "oc" && <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />}
      </div>

      {vista === "oc" ? (
        <BaseOrdenes desde={rango.desde} hasta={rango.hasta} empresaId={empresaId} nombreEmpresa={nombreEmpresa} />
      ) : (
        <>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />
          <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5">
            <option value="">Todo método</option>
            <option value="transferencia">Transferencia</option>
            <option value="efectivo">Efectivo</option>
            <option value="cheque">Cheque</option>
          </select>
          <select value={comprobante} onChange={(e) => setComprobante(e.target.value as "" | "con" | "sin")} className="rounded border border-slate-300 px-2 py-1.5">
            <option value="">Con y sin comprobante</option>
            <option value="con">Solo con comprobante</option>
            <option value="sin">Solo sin comprobante</option>
          </select>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Proveedor, OC, obra o referencia" className="min-w-[14rem] flex-1 rounded border border-slate-300 px-2 py-1.5" />
          <button onClick={descargar} disabled={filtrados.length === 0} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            Descargar (Excel)
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Dato etiqueta="Pagos" valor={String(tot.n)} />
          <Dato etiqueta="Total pagado" valor={moneda(tot.total)} fuerte />
          <Dato etiqueta="Transferencia" valor={moneda(tot.transferencia)} />
          <Dato etiqueta="Efectivo" valor={moneda(tot.efectivo)} />
          <Dato etiqueta="Sin comprobante" valor={String(tot.sinComprobante)} alerta={tot.sinComprobante > 0} />
        </div>

        {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>}
        {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
        {!isLoading && dias.length === 0 && <p className="text-sm text-slate-500">No hay pagos en este periodo.</p>}

        {dias.map((d) => (
          <section key={d.fecha} className="mb-4 rounded border border-slate-200 bg-white">
            <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-3 py-2">
              <h2 className="text-sm font-semibold capitalize text-slate-800">{fechaLarga(d.fecha)}</h2>
              <span className="text-xs text-slate-500">
                {d.pagos.length} pago(s) · {moneda(d.total)}
              </span>
              {d.sinComprobante > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">{d.sinComprobante} sin comprobante</span>}
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {d.pagos.map((p) => (
                    <tr key={p.id} className="border-t border-slate-50 first:border-t-0">
                      <td className="px-3 py-1.5">
                        <div className="font-medium text-slate-900">{p.beneficiario}</div>
                        <div className="text-[11px] text-slate-500">
                          {p.empresa_nombre}
                          {p.id_orden ? ` · OC ${p.id_orden}` : ""}
                          {p.oc_proyecto ? ` · ${p.oc_proyecto}` : ""}
                          {p.concepto && !p.id_orden ? ` · ${p.concepto}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-600">
                        {p.metodo}
                        {p.referencia && <div className="text-[11px] text-slate-400">ref. {p.referencia}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{moneda(Number(p.monto))}</td>
                      <td className="px-3 py-1.5 text-xs">{p.confirmado_en ? <span className="text-emerald-700">confirmado</span> : null}</td>
                      <td className="px-3 py-1.5 text-right">
                        <ComprobantePago pagoId={p.id} nombre={p.comprobante_path ? p.comprobante_nombre ?? "comprobante" : null} compacto />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        </>
      )}
    </div>
  );
}

function Dato({ etiqueta, valor, fuerte = false, alerta = false }: { etiqueta: string; valor: string; fuerte?: boolean; alerta?: boolean }) {
  return (
    <div className={`rounded border px-3 py-2 ${fuerte ? "border-slate-900 bg-slate-900 text-white" : alerta ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className={`text-[11px] uppercase ${fuerte ? "text-slate-300" : "text-slate-500"}`}>{etiqueta}</p>
      <p className="text-lg font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
