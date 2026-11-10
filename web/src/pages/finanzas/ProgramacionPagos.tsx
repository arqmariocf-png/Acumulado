import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { abrirParaImprimir } from "../../lib/imprimir";
import { moneda } from "../../lib/saldosEmpresas";
import { OrdenesPorPagar } from "./OrdenesPorPagar";
import { HojaPagosDia } from "./HojaPagosDia";
import { BotonSincronizarOcOv } from "../../components/BotonSincronizarOcOv";
import { AltaOcManual } from "../../components/AltaOcManual";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";
import { ComprobantePago } from "../../components/ComprobantePago";
import { TraspasosNomina } from "./TraspasosNomina";
import { estaDevuelto, textoDevolucion } from "../../lib/regresarPago";
import { CuentasDeCargo } from "../../components/CuentasDeCargo";
import { necesitaCuenta } from "../../lib/cuentaCargo";

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
  metodo: "transferencia" | "efectivo" | "cheque";
  orden_compra_id: string | null;
  id_orden: string | null;
  clabe: string | null;
  banco_proveedor: string | null;
  comprobante_nombre: string | null;
  /** Regresado por tesorería con error (5-nov-2026). */
  devuelto_en: string | null;
  devuelto_por_nombre: string | null;
  devuelto_tipo: string | null;
  devuelto_motivo: string | null;
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
  // Comentario de un pago, editable en el renglón (10-nov-2026, Mario:
  // "Laura necesita un apartado de comentarios para los pagos que se
  // seleccionan"); lo ve tesorería y sale en la hoja de pagos del día.
  const [comentarioEditando, setComentarioEditando] = useState<{ id: string; texto: string } | null>(null);

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
      const { data, error: err } = await supabase.from("v_pagos_programados").select("*").order("fecha_programada").order("created_at");
      if (err) throw err;
      return data as PagoProgramado[];
    },
  });

  const invalidar = () => {
    queryClient.invalidateQueries({ queryKey: ["pagos-programados"] });
    queryClient.invalidateQueries({ queryKey: ["tesoreria"] });
  };

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

  // Cuenta de cargo a un pago que quedó sin ella (9-nov-2026): tesorería
  // necesita saber de qué banco sale cada pago.
  const asignarCuenta = useMutation({
    mutationFn: async ({ id, cuentaId }: { id: string; cuentaId: string }) => {
      const { error: err } = await supabase.from("pagos_programados").update({ cuenta_id: cuentaId }).eq("id", id).eq("estatus", "pendiente");
      if (err) throw err;
    },
    onSuccess: () => {
      invalidar();
      queryClient.invalidateQueries({ queryKey: ["tesoreria"] });
    },
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

  // Regresados por tesorería con error (5-nov-2026, Delia): dirección los
  // corrige aquí y los da por corregidos; mientras, no salen en Tesorería.
  const resolverDevolucion = useMutation({
    mutationFn: async (p: PagoProgramado) => {
      const nota = window.prompt(`¿Qué se corrigió del pago a ${p.beneficiario}? (opcional)`, "");
      if (nota === null) return;
      const { error: err } = await supabase.rpc("fn_pago_devolucion_resolver", { p_pago: p.id, p_nota: nota.trim() || null });
      if (err) throw err;
    },
    onSuccess: () => {
      invalidar();
      queryClient.invalidateQueries({ queryKey: ["tesoreria"] });
    },
    onError: (err) => setError((err as Error).message),
  });
  const devueltos = (pagos ?? []).filter((p) => p.estatus === "pendiente" && estaDevuelto(p) && (!filtroEmpresa || p.empresa_id === filtroEmpresa));
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
            Hoja de pagos del día, órdenes de compra, préstamos y traspasos, y nómina: todo contra el saldo de cada empresa.{" "}
            <Link to="/finanzas/saldos" className="underline">
              Ver saldos
            </Link>
            {" · "}
            <Link to="/finanzas/tesoreria" className="underline">
              Tesorería: pagos de hoy
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
          <BotonSincronizarOcOv queryKeys={[["pagos-programados"]]} />
          <AltaOcManual />
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

      {/* Orden que pidió Laura (8-oct-2026): 1) hoja de pagos del día,
          2) órdenes de compra, 3) préstamos y traspasos, 4) nómina fiscal y
          mano de obra; todo entra a la hoja y va descontando el saldo. El
          efectivo por confirmar tiene su propia pantalla (/finanzas/efectivo). */}
      <HojaPagosDia filtroEmpresa={filtroEmpresa} hoy={hoy} />
      <div id="ordenes" className="scroll-mt-20" />
      <OrdenesPorPagar filtroEmpresa={filtroEmpresa} hoy={hoy} nombreEmpresa={nombreEmpresa} cuentas={cuentas ?? []} />
      <TraspasosNomina modo="traspasos" empresas={empresas ?? []} cuentas={cuentas ?? []} hoy={hoy} filtroEmpresa={filtroEmpresa} />
      <TraspasosNomina modo="nomina" empresas={empresas ?? []} cuentas={cuentas ?? []} hoy={hoy} filtroEmpresa={filtroEmpresa} />

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
      {/* De qué cuenta sale cada pago (9-nov-2026, Mario): lo que no tiene
          cuenta se asigna aquí; Delia ve el mismo bloque en Tesorería. */}
      <CuentasDeCargo
        titulo="De qué cuenta sale cada pago (lo ve tesorería)"
        pagos={pendientes.filter((p) => (!filtroEmpresa || p.empresa_id === filtroEmpresa) && !estaDevuelto(p))}
        cuentas={cuentas ?? []}
        nombreEmpresa={nombreEmpresa}
        hoy={hoy}
        onAsignar={(id, cuentaId) => asignarCuenta.mutate({ id, cuentaId })}
        ocupado={asignarCuenta.isPending}
      />
      {devueltos.length > 0 && (
        <div id="pagos-devueltos" className="mb-4 scroll-mt-20 rounded border border-amber-300 bg-amber-50">
          <div className="flex items-center justify-between border-b border-amber-200 px-3 py-2">
            <p className="text-sm font-semibold text-amber-900">Regresados por tesorería con error ({devueltos.length})</p>
            <p className="text-sm tabular-nums text-amber-800">{moneda(devueltos.reduce((s, p) => s + Number(p.monto), 0))}</p>
          </div>
          <p className="px-3 pt-2 text-xs text-amber-800">Corrige el pago (cuenta, monto, proveedor…) y dalo por corregido para que regrese a Tesorería. Los que pasaron a efectivo se confirman en Efectivo por confirmar.</p>
          <table className="w-full text-sm">
            <tbody>
              {devueltos.map((p) => (
                <tr key={p.id} className="border-t border-amber-200">
                  <td className="whitespace-nowrap px-3 py-2">{fechaCorta(p.fecha_programada)}</td>
                  <td className="px-3 py-2">
                    {p.beneficiario}
                    <div className="text-xs text-slate-500">
                      {nombreEmpresa.get(p.empresa_id)}
                      {p.cuenta_id && ` · ${cuentaTexto.get(p.cuenta_id) ?? ""}`}
                      {p.concepto && ` · ${p.concepto}`}
                      {p.metodo === "efectivo" && " · efectivo"}
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-amber-800">{textoDevolucion(p)}</div>
                    {p.orden_compra_id && (
                      <div className="mt-0.5 text-xs">
                        <BotonVerOc ocId={p.orden_compra_id} etiqueta={`ver OC ${p.id_orden ?? ""}`} className="text-slate-600 underline" />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{moneda(Number(p.monto))}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-xs">
                    {p.metodo === "efectivo" ? (
                      <Link to="/finanzas/efectivo" className="text-emerald-700 underline">
                        Efectivo por confirmar
                      </Link>
                    ) : (
                      <button onClick={() => resolverDevolucion.mutate(p)} disabled={resolverDevolucion.isPending} className="rounded bg-emerald-700 px-2.5 py-1 font-medium text-white disabled:opacity-50">
                        Ya quedó corregido
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
          <div key={clave} id={`pagos-${clave}`} className={`mb-4 scroll-mt-20 rounded border bg-white ${borde}`}>
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
                        {p.cuenta_id && ` · desde ${cuentaTexto.get(p.cuenta_id) ?? ""}`}
                        {!p.cuenta_id && p.estatus === "pendiente" && necesitaCuenta(p.metodo) && (
                          <>
                            {" · "}
                            <a href="#cuenta-cargo" className="font-medium text-amber-700 underline">
                              sin cuenta de cargo
                            </a>
                          </>
                        )}
                        {p.concepto && ` · ${p.concepto}`}
                        {p.referencia && ` · ref. ${p.referencia}`}
                        {p.metodo === "efectivo" && " · efectivo"}
                        {p.clabe && ` · ${p.banco_proveedor ?? ""} CLABE ${p.clabe}`}
                        {p.estatus === "pagado" && p.pagado_en && ` · pagado ${p.pagado_en}`}
                        {p.estatus === "cancelado" && " · cancelado"}
                      </div>
                      {comentarioEditando?.id === p.id ? (
                        <form
                          className="mt-0.5 flex flex-wrap items-center gap-1 text-xs"
                          onSubmit={(e) => {
                            e.preventDefault();
                            actualizar.mutate({ id: p.id, cambios: { notas: comentarioEditando.texto.trim() || null } });
                            setComentarioEditando(null);
                          }}
                        >
                          <input autoFocus value={comentarioEditando.texto} onChange={(e) => setComentarioEditando({ id: p.id, texto: e.target.value })} placeholder="Comentario para tesorería…" className="w-72 rounded border border-slate-300 px-1.5 py-0.5 text-slate-800" />
                          <button type="submit" className="rounded bg-slate-800 px-2 py-0.5 text-white">Guardar</button>
                          <button type="button" onClick={() => setComentarioEditando(null)} className="text-slate-500 underline">cancelar</button>
                        </form>
                      ) : (
                        <div className="mt-0.5 text-xs">
                          {p.notas ? <span className="text-slate-700">💬 {p.notas}</span> : <span className="text-slate-400">sin comentario</span>}
                          {p.estatus === "pendiente" && (
                            <button type="button" onClick={() => setComentarioEditando({ id: p.id, texto: p.notas ?? "" })} className="ml-2 text-slate-500 underline">
                              {p.notas ? "editar" : "agregar comentario"}
                            </button>
                          )}
                        </div>
                      )}
                      {p.estatus === "pendiente" && estaDevuelto(p) && <div className="mt-0.5 text-xs font-medium text-amber-800">{textoDevolucion(p)}</div>}
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                        {p.orden_compra_id && <BotonVerOc ocId={p.orden_compra_id} etiqueta={`ver OC ${p.id_orden ?? ""}`} className="text-slate-600 underline" />}
                        <ComprobantePago pagoId={p.id} nombre={p.comprobante_nombre} compacto />
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
