import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { abrirParaImprimir } from "../../lib/imprimir";
import { moneda } from "../../lib/saldosEmpresas";
import { useSaldosDia } from "./SaldosEmpresas";

interface PagoProgramado {
  id: string;
  empresa_id: string;
  cuenta_id: string | null;
  beneficiario: string;
  concepto: string | null;
  monto: number;
  fecha_programada: string;
  estatus: "pendiente" | "pagado" | "cancelado";
  pagado_en: string | null;
  referencia: string | null;
  notas: string | null;
  created_at: string;
}

interface Cuenta {
  id: string;
  empresa_id: string;
  banco: string;
  ultimos_4: string;
  alias: string | null;
  activo: boolean;
}

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function fechaCorta(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });
}

/** Programación de pagos de Finanzas: calendario de pagos por empresa y
 * cuenta, comparado contra el saldo de cierre de hoy. */
export function ProgramacionPagos() {
  const queryClient = useQueryClient();
  const hoy = hoyIso();
  const [mostrarForm, setMostrarForm] = useState(false);
  const [empresaForm, setEmpresaForm] = useState("");
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [verCerrados, setVerCerrados] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: empresas } = useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (err) throw err;
      return data as { id: string; nombre: string }[];
    },
  });
  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-bancarias-todas"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("cuentas_bancarias").select("id, empresa_id, banco, ultimos_4, alias, activo").eq("activo", true).order("banco");
      if (err) throw err;
      return data as Cuenta[];
    },
  });
  const { data: pagos, isLoading } = useQuery({
    queryKey: ["pagos-programados"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("pagos_programados").select("*").order("fecha_programada").order("created_at");
      if (err) throw err;
      return data as PagoProgramado[];
    },
  });
  const { data: saldos } = useSaldosDia(hoy);

  const invalidar = () => queryClient.invalidateQueries({ queryKey: ["pagos-programados"] });

  const crear = useMutation({
    mutationFn: async (fila: Record<string, unknown>) => {
      const { data: sesion } = await supabase.auth.getSession();
      const { error: err } = await supabase.from("pagos_programados").insert({ ...fila, created_by: sesion.session?.user.id });
      if (err) throw err;
    },
    onSuccess: () => {
      setMostrarForm(false);
      invalidar();
    },
    onError: (err) => setError((err as Error).message),
  });
  const actualizar = useMutation({
    mutationFn: async (p: { id: string; cambios: Record<string, unknown> }) => {
      const { error: err } = await supabase.from("pagos_programados").update(p.cambios).eq("id", p.id);
      if (err) throw err;
    },
    onSuccess: invalidar,
    onError: (err) => setError((err as Error).message),
  });

  function onCrear(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    crear.mutate({
      empresa_id: String(fd.get("empresa_id") ?? ""),
      cuenta_id: String(fd.get("cuenta_id") ?? "") || null,
      beneficiario: String(fd.get("beneficiario") ?? "").trim(),
      concepto: String(fd.get("concepto") ?? "").trim() || null,
      monto: Number(fd.get("monto")),
      fecha_programada: String(fd.get("fecha_programada") ?? hoy),
      referencia: String(fd.get("referencia") ?? "").trim() || null,
      notas: String(fd.get("notas") ?? "").trim() || null,
    });
  }

  const nombreEmpresa = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.nombre])), [empresas]);
  const cuentaTexto = useMemo(() => new Map((cuentas ?? []).map((c) => [c.id, `${c.banco} ${c.ultimos_4}${c.alias ? ` · ${c.alias}` : ""}`])), [cuentas]);

  const visibles = (pagos ?? []).filter((p) => (!filtroEmpresa || p.empresa_id === filtroEmpresa) && (verCerrados || p.estatus === "pendiente"));
  const pendientes = (pagos ?? []).filter((p) => p.estatus === "pendiente");
  const grupos = useMemo(() => {
    const en7 = sumarDias(hoy, 7);
    const g: Record<string, PagoProgramado[]> = { vencidos: [], hoy: [], semana: [], despues: [], cerrados: [] };
    for (const p of visibles) {
      if (p.estatus !== "pendiente") g.cerrados.push(p);
      else if (p.fecha_programada < hoy) g.vencidos.push(p);
      else if (p.fecha_programada === hoy) g.hoy.push(p);
      else if (p.fecha_programada <= en7) g.semana.push(p);
      else g.despues.push(p);
    }
    return g;
  }, [visibles, hoy]);

  // Disponible por empresa: saldo de cierre de hoy menos pendientes de los
  // próximos 7 días (incluye vencidos).
  const resumenEmpresas = useMemo(() => {
    const en7 = sumarDias(hoy, 7);
    const saldoPorEmpresa = new Map<string, number>();
    for (const s of saldos ?? []) saldoPorEmpresa.set(s.empresa_id, (saldoPorEmpresa.get(s.empresa_id) ?? 0) + Number(s.saldo_final));
    const comprometido = new Map<string, number>();
    for (const p of pendientes) if (p.fecha_programada <= en7) comprometido.set(p.empresa_id, (comprometido.get(p.empresa_id) ?? 0) + Number(p.monto));
    const ids = new Set([...saldoPorEmpresa.keys(), ...comprometido.keys()]);
    return [...ids]
      .map((id) => ({ id, nombre: nombreEmpresa.get(id) ?? "—", saldo: saldoPorEmpresa.get(id) ?? 0, comprometido: comprometido.get(id) ?? 0 }))
      .filter((r) => !filtroEmpresa || r.id === filtroEmpresa)
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [saldos, pendientes, nombreEmpresa, hoy, filtroEmpresa]);

  function imprimir() {
    const filas = pendientes
      .filter((p) => !filtroEmpresa || p.empresa_id === filtroEmpresa)
      .map((p) => `<tr><td>${fechaCorta(p.fecha_programada)}</td><td>${nombreEmpresa.get(p.empresa_id) ?? ""}</td><td>${p.cuenta_id ? cuentaTexto.get(p.cuenta_id) ?? "" : ""}</td><td>${p.beneficiario}</td><td>${p.concepto ?? ""}</td><td style="text-align:right">${moneda(Number(p.monto))}</td></tr>`)
      .join("");
    const total = pendientes.filter((p) => !filtroEmpresa || p.empresa_id === filtroEmpresa).reduce((s, p) => s + Number(p.monto), 0);
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Programación de pagos</title><style>
      body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:0}.hoja{max-width:190mm;margin:0 auto;padding:12px}h1{font-size:16px;margin:0 0 8px}
      table{width:100%;border-collapse:collapse}th,td{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left}th{background:#eee;font-size:10px;text-transform:uppercase}
      .btn{position:fixed;top:10px;right:10px;padding:8px 14px;background:#0f172a;color:#fff;border:0;border-radius:6px}@media print{.btn{display:none}}</style></head><body>
      <button class="btn" onclick="window.print()">Imprimir / guardar PDF</button><div class="hoja"><h1>Programación de pagos · pendientes al ${fechaCorta(hoy)}</h1>
      <table><thead><tr><th>Fecha</th><th>Empresa</th><th>Cuenta</th><th>Beneficiario</th><th>Concepto</th><th style="text-align:right">Monto</th></tr></thead><tbody>${filas}
      <tr><td colspan="5"><b>Total pendiente</b></td><td style="text-align:right"><b>${moneda(total)}</b></td></tr></tbody></table></div></body></html>`;
    if (!abrirParaImprimir(html)) setError("El navegador bloqueó la ventana. Permite ventanas emergentes.");
  }

  const cuentasForm = (cuentas ?? []).filter((c) => c.empresa_id === empresaForm);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Programación de pagos</h1>
          <p className="text-sm text-slate-500">
            Pagos comprometidos por empresa contra el saldo de cierre de hoy.{" "}
            <Link to="/finanzas/saldos" className="underline">
              Ver saldos
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Todas las empresas</option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="checkbox" checked={verCerrados} onChange={(e) => setVerCerrados(e.target.checked)} /> ver pagados y cancelados
          </label>
          <button onClick={imprimir} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
            Imprimir / PDF
          </button>
          <button onClick={() => setMostrarForm((v) => !v)} className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white">
            {mostrarForm ? "Cancelar" : "+ Programar pago"}
          </button>
        </div>
      </div>

      {mostrarForm && (
        <form onSubmit={onCrear} className="mb-4 grid grid-cols-1 gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-4">
          <div>
            <label className={etiqueta}>Empresa *</label>
            <select name="empresa_id" required value={empresaForm} onChange={(e) => setEmpresaForm(e.target.value)} className={campo}>
              <option value="" disabled>
                Selecciona…
              </option>
              {empresas?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiqueta}>Cuenta de salida</label>
            <select name="cuenta_id" className={campo} defaultValue="">
              <option value="">Por definir</option>
              {cuentasForm.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.banco} {c.ultimos_4}
                  {c.alias ? ` · ${c.alias}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={etiqueta}>Beneficiario *</label>
            <input name="beneficiario" required placeholder="Proveedor, nómina, impuestos…" className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Monto *</label>
            <input name="monto" type="number" step="0.01" min="0.01" required className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Fecha programada *</label>
            <input name="fecha_programada" type="date" required defaultValue={hoy} className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Concepto</label>
            <input name="concepto" className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Referencia (factura, OC…)</label>
            <input name="referencia" className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Notas</label>
            <input name="notas" className={campo} />
          </div>
          <div className="sm:col-span-4">
            <button disabled={crear.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {crear.isPending ? "Guardando…" : "Programar"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {resumenEmpresas.length > 0 && (
        <div className="mb-4 overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2 text-right">Saldo de cierre hoy</th>
                <th className="px-3 py-2 text-right">Pagos próximos 7 días</th>
                <th className="px-3 py-2 text-right">Disponible después de pagar</th>
              </tr>
            </thead>
            <tbody>
              {resumenEmpresas.map((r) => {
                const disponible = r.saldo - r.comprometido;
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{r.nombre}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{moneda(r.saldo)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.comprometido ? moneda(r.comprometido) : "—"}</td>
                    <td className={`px-3 py-2 text-right font-medium tabular-nums ${disponible < 0 ? "text-red-700" : "text-slate-900"}`}>{moneda(disponible)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {(
        [
          ["vencidos", "Vencidos", "border-red-200"],
          ["hoy", "Hoy", "border-amber-200"],
          ["semana", "Próximos 7 días", "border-slate-200"],
          ["despues", "Más adelante", "border-slate-200"],
          ["cerrados", "Pagados y cancelados", "border-slate-100"],
        ] as const
      ).map(([clave, titulo, borde]) =>
        grupos[clave].length === 0 ? null : (
          <div key={clave} className={`mb-4 rounded border bg-white ${borde}`}>
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
              <p className="text-sm font-semibold text-slate-700">{titulo}</p>
              <p className="text-sm tabular-nums text-slate-600">{moneda(grupos[clave].reduce((s, p) => s + Number(p.monto), 0))}</p>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {grupos[clave].map((p) => (
                  <tr key={p.id} className={`border-t border-slate-100 ${p.estatus !== "pendiente" ? "text-slate-400" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-2">{fechaCorta(p.fecha_programada)}</td>
                    <td className="px-3 py-2">
                      {p.beneficiario}
                      <div className="text-xs text-slate-400">
                        {nombreEmpresa.get(p.empresa_id)}
                        {p.cuenta_id && ` · ${cuentaTexto.get(p.cuenta_id) ?? ""}`}
                        {p.concepto && ` · ${p.concepto}`}
                        {p.referencia && ` · ref. ${p.referencia}`}
                        {p.estatus === "pagado" && p.pagado_en && ` · pagado ${p.pagado_en}`}
                        {p.estatus === "cancelado" && " · cancelado"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{moneda(Number(p.monto))}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                      {p.estatus === "pendiente" ? (
                        <>
                          <button onClick={() => actualizar.mutate({ id: p.id, cambios: { estatus: "pagado", pagado_en: hoy } })} className="mr-2 text-emerald-700 underline">
                            Pagado
                          </button>
                          <button onClick={() => actualizar.mutate({ id: p.id, cambios: { fecha_programada: sumarDias(p.fecha_programada < hoy ? hoy : p.fecha_programada, 7) } })} className="mr-2 text-slate-600 underline">
                            +7 días
                          </button>
                          <button onClick={() => window.confirm("¿Cancelar este pago programado?") && actualizar.mutate({ id: p.id, cambios: { estatus: "cancelado" } })} className="text-slate-500 underline">
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button onClick={() => actualizar.mutate({ id: p.id, cambios: { estatus: "pendiente", pagado_en: null } })} className="text-slate-500 underline">
                          Reabrir
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
      {!isLoading && visibles.length === 0 && <p className="rounded border border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-400">No hay pagos programados. Usa "+ Programar pago".</p>}
    </div>
  );
}
