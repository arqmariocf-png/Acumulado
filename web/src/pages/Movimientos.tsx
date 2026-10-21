import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../lib/supabase";
import { errorDeFuncion } from "../lib/funciones";
import { useAuth, useEmpresaFiltro } from "../lib/auth";
import { SelectorEmpresa } from "../components/SelectorEmpresa";
import { Semaforo } from "../components/Semaforo";
import { MarcarSinFactura } from "../components/MarcarSinFactura";
import { puedeMarcarSinFactura } from "../lib/sinFactura";
import { LigarOrdenMovimiento } from "../components/LigarOrdenMovimiento";
import { puedeLigarOrden } from "../lib/ligarOrden";
import { LigarFacturaMovimiento } from "../components/LigarFacturaMovimiento";
import { puedeLigarFactura } from "../lib/ligarFactura";
import { TIPOS_PERIODO, etiquetaPeriodo, moverPeriodo, rangoPeriodo, type TipoPeriodo } from "../lib/periodoFiltro";
import type { EstadoClasificacion, Movimiento } from "../types/database";

const TAMANO_PAGINA = 50;

const ESTADOS: { valor: EstadoClasificacion | "todos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos los estados" },
  { valor: "pendiente_revision", etiqueta: "🔴 Revisión" },
  { valor: "pendiente_esperado", etiqueta: "🟡 Esperado" },
  { valor: "ambiguo", etiqueta: "🟣 Ambiguo" },
  { valor: "resuelto", etiqueta: "Resuelto" },
];


function hoyMx(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
}

function formatoMoneda(valor: number | null): string {
  if (valor == null) return "—";
  return valor.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function Movimientos() {
  const { veTodasLasEmpresas, eligeEmpresa, perfil } = useAuth();
  const queryClient = useQueryClient();

  // Desde Saldos por empresa se llega con ?empresa=&cuenta= (Laura arranca en
  // saldos y da clic para ver los últimos movimientos de esa cuenta).
  const [params, setParams] = useSearchParams();
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const cuentaId = params.get("cuenta") ?? "";
  // Desde Saldos por empresa llega ?empresa=: se vuelve la empresa activa.
  const empresaParam = params.get("empresa");
  useEffect(() => {
    if (empresaParam) setEmpresaId(empresaParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaParam]);
  // Desde los indicadores (?ver=…): ambiguos, duplicados o sin factura
  // (pendiente de revisión) -- lo que cuenta "Movimientos por revisar".
  const verParam = params.get("ver");
  const [estado, setEstado] = useState<EstadoClasificacion | "todos">(
    verParam === "ambiguos" ? "ambiguo" : verParam === "sin_cfdi" || verParam === "revisar" ? "pendiente_revision" : "todos",
  );
  const [soloDuplicados, setSoloDuplicados] = useState(verParam === "duplicados");
  const [cuentaReclasificando, setCuentaReclasificando] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  // Periodo para revisar la conciliación (20-oct-2026, Mario): día, semana o
  // mes con flechas; queda en la liga (?periodo=&fecha=).
  const periodoParam = params.get("periodo");
  const periodo: TipoPeriodo = periodoParam === "dia" || periodoParam === "semana" || periodoParam === "mes" ? periodoParam : "todo";
  const fechaPeriodo = params.get("fecha") ?? hoyMx();
  const rango = rangoPeriodo(periodo, fechaPeriodo);
  const ponerParams = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };
  // Marcar "sin factura" con motivo (7-oct-2026): dirección, corporativo, admin.
  const marcaSinFactura = perfil?.rol === "admin" || perfil?.rol === "direccion" || perfil?.rol === "corporativo";
  const [marcando, setMarcando] = useState<string | null>(null);
  // Ligar a su OC/OS/OV desde la lista (20-oct-2026, Mario): mismos roles.
  const [ligando, setLigando] = useState<string | null>(null);
  // Elegir la factura por número o folio fiscal (21-oct-2026, Mario).
  const [eligiendoFactura, setEligiendoFactura] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const empresaFiltro = veTodasLasEmpresas ? empresaId : (perfil?.empresa_id ?? "");

  // Al cambiar cualquier filtro, la página actual puede quedar fuera de
  // rango del nuevo resultado (ej. estabas en la página 5 y el filtro nuevo
  // solo trae 2 páginas) -- siempre se regresa a la primera.
  useEffect(() => {
    setPagina(0);
  }, [empresaFiltro, cuentaId, estado, soloDuplicados, periodo, fechaPeriodo]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["movimientos", empresaFiltro, cuentaId, estado, soloDuplicados, pagina, rango?.desde ?? "", rango?.hasta ?? ""],
    queryFn: async () => {
      const desde = pagina * TAMANO_PAGINA;
      const hasta = desde + TAMANO_PAGINA - 1;
      let query = supabase
        .from("movimientos")
        .select("*", { count: "exact" })
        .order("fecha_pago", { ascending: false })
        .range(desde, hasta);
      if (empresaFiltro) query = query.eq("empresa_id", empresaFiltro);
      if (cuentaId) query = query.eq("cuenta_id", cuentaId);
      if (estado !== "todos") query = query.eq("estado_clasificacion", estado);
      if (soloDuplicados) query = query.eq("posible_duplicado", true);
      if (rango) query = query.gte("fecha_pago", rango.desde).lte("fecha_pago", rango.hasta);
      const { data, error, count } = await query;
      if (error) throw error;
      return { movimientos: data as Movimiento[], total: count ?? 0 };
    },
  });

  // Cuentas bancarias de la empresa elegida (o de todas) para el filtro.
  const { data: cuentas } = useQuery({
    queryKey: ["cuentas-bancarias-filtro", empresaFiltro],
    queryFn: async () => {
      let q = supabase.from("cuentas_bancarias").select("id, empresa_id, banco, ultimos_4, alias, activo, empresas(codigo)").order("banco");
      if (empresaFiltro) q = q.eq("empresa_id", empresaFiltro);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; empresa_id: string; banco: string; ultimos_4: string; alias: string | null; activo: boolean; empresas: { codigo: string } | null }[];
    },
  });
  const textoCuenta = (c: { banco: string; ultimos_4: string; alias: string | null; empresas?: { codigo: string } | null }) =>
    `${empresaFiltro ? "" : `${c.empresas?.codigo ?? ""} · `}${c.banco} ${c.ultimos_4}${c.alias ? ` · ${c.alias}` : ""}`;

  // Totales del periodo (todas las páginas) para cuadrar contra el estado de cuenta.
  const { data: totales } = useQuery({
    queryKey: ["movimientos", "totales", empresaFiltro, cuentaId, estado, soloDuplicados, rango?.desde ?? "", rango?.hasta ?? ""],
    enabled: !!rango || !!cuentaId,
    queryFn: async () => {
      let q = supabase.from("movimientos").select("cargo_total, abono_total, estado_clasificacion").limit(10000);
      if (empresaFiltro) q = q.eq("empresa_id", empresaFiltro);
      if (cuentaId) q = q.eq("cuenta_id", cuentaId);
      if (estado !== "todos") q = q.eq("estado_clasificacion", estado);
      if (soloDuplicados) q = q.eq("posible_duplicado", true);
      if (rango) q = q.gte("fecha_pago", rango.desde).lte("fecha_pago", rango.hasta);
      const { data, error } = await q;
      if (error) throw error;
      const filas = data ?? [];
      return {
        cargos: filas.reduce((t, m) => t + Number(m.cargo_total ?? 0), 0),
        abonos: filas.reduce((t, m) => t + Number(m.abono_total ?? 0), 0),
        resueltos: filas.filter((m) => m.estado_clasificacion === "resuelto").length,
        n: filas.length,
      };
    },
  });

  const movimientos = data?.movimientos;
  const total = data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA));

  // Reclasifica TODOS los movimientos de la cuenta bancaria de la fila en la
  // que se dio clic (no solo esa fila) contra el catálogo actual (CFDI,
  // OC/OV, reglas) -- necesario cuando se sube CFDI/OC/OV después de haber
  // cargado el estado de cuenta, caso en el que esos movimientos no se
  // reclasifican solos (el motor solo corre automático justo después de
  // cargar un estado de cuenta).
  const reclasificar = useMutation({
    mutationFn: async ({ empresaId, cuentaId }: { empresaId: string; cuentaId: string }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const respuesta = await fetch(urlFuncion("motor-conciliacion"), {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionData.session?.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ empresaId, cuentaId }),
      });
      const json = await respuesta.json();
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
      return json;
    },
    onSettled: () => {
      setCuentaReclasificando(null);
      queryClient.invalidateQueries({ queryKey: ["movimientos"] });
      queryClient.invalidateQueries({ queryKey: ["kpis-mensuales"] });
      queryClient.invalidateQueries({ queryKey: ["kpis-anuales"] });
      queryClient.invalidateQueries({ queryKey: ["kpis-por-empresa"] });
      queryClient.invalidateQueries({ queryKey: ["pendientes-por-empresa"] });
      queryClient.invalidateQueries({ queryKey: ["concentrado-pendientes"] });
    },
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Movimientos</h1>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {eligeEmpresa && <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />}
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoClasificacion | "todos")} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          {ESTADOS.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.etiqueta}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={soloDuplicados} onChange={(e) => setSoloDuplicados(e.target.checked)} />
          Solo posibles duplicados
        </label>
        <select
          value={cuentaId}
          onChange={(e) => ponerParams({ cuenta: e.target.value || null })}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          title="Cuenta bancaria"
        >
          <option value="">Todas las cuentas</option>
          {(cuentas ?? [])
            .filter((c) => c.activo || c.id === cuentaId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {textoCuenta(c)}
              </option>
            ))}
        </select>
        <span className="inline-flex items-center gap-1 text-sm">
          <select
            value={periodo}
            onChange={(e) => ponerParams({ periodo: e.target.value === "todo" ? null : e.target.value })}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
            title="Periodo"
          >
            {TIPOS_PERIODO.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
          {periodo !== "todo" && (
            <>
              <button type="button" onClick={() => ponerParams({ fecha: moverPeriodo(periodo, fechaPeriodo, -1) })} className="rounded border border-slate-300 px-2 py-1" title="Periodo anterior">
                ←
              </button>
              <input type="date" value={fechaPeriodo} onChange={(e) => e.target.value && ponerParams({ fecha: e.target.value })} className="rounded border border-slate-300 px-2 py-1" />
              <button type="button" onClick={() => ponerParams({ fecha: moverPeriodo(periodo, fechaPeriodo, 1) })} className="rounded border border-slate-300 px-2 py-1" title="Periodo siguiente">
                →
              </button>
              <span className="text-xs text-slate-500">{etiquetaPeriodo(periodo, fechaPeriodo)}</span>
            </>
          )}
        </span>
        <Link to="/finanzas/saldos" className="text-xs text-slate-500 underline">
          Saldos por empresa
        </Link>
      </div>

      {totales && (
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 rounded border border-slate-200 bg-white px-3 py-2 text-sm">
          <span className="text-slate-500">
            {cuentaId && cuentas ? `${textoCuenta(cuentas.find((c) => c.id === cuentaId) ?? { banco: "", ultimos_4: "", alias: null })} · ` : ""}
            {etiquetaPeriodo(periodo, fechaPeriodo)}
          </span>
          <span>
            {totales.n} movimientos · <b>{totales.resueltos}</b> conciliados ({totales.n ? Math.round((totales.resueltos / totales.n) * 100) : 0} %)
          </span>
          <span>
            Cargos <b className="tabular-nums">{formatoMoneda(totales.cargos)}</b>
          </span>
          <span>
            Abonos <b className="tabular-nums">{formatoMoneda(totales.abonos)}</b>
          </span>
        </div>
      )}

      {aviso && (
        <p className="mb-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {aviso}{" "}
          <button type="button" onClick={() => setAviso(null)} className="ml-2 text-xs underline">
            cerrar
          </button>
        </p>
      )}
      {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {error && <p className="text-sm text-red-600">Error: {(error as Error).message}</p>}

      {movimientos && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Proyecto</th>
                <th className="px-3 py-2">Nombre / Razón Social</th>
                <th className="px-3 py-2 text-right">Cargo</th>
                <th className="px-3 py-2 text-right">Abono</th>
                <th className="px-3 py-2">Referencia</th>
                <th className="px-3 py-2">FACTURA</th>
                <th className="px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <Fragment key={m.id}>
                <tr className={`border-t border-slate-100 ${m.posible_duplicado ? "bg-orange-50" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2">{m.fecha_pago}</td>
                  <td className="px-3 py-2">{m.proyecto ?? <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2">{m.nombre_razon_social ?? <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(m.cargo_total)}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda(m.abono_total)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {m.referencia_tipo ? `${m.referencia_tipo} ${m.referencia_numero}` : "—"}
                    {marcaSinFactura && puedeLigarOrden(m.estado_clasificacion) && ligando !== m.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setAviso(null);
                          setMarcando(null);
                          setEligiendoFactura(null);
                          setLigando(m.id);
                        }}
                        className="block text-xs text-sky-700 underline"
                      >
                        {m.referencia_tipo ? "Cambiar orden" : m.abono_total != null && m.cargo_total == null ? "Ligar OV" : "Ligar OC/OS"}
                      </button>
                    )}
                  </td>
                  <td className="max-w-xs px-3 py-2" title={m.factura ?? undefined}>
                    <span className="block truncate">{m.factura ?? <span className="text-slate-400">—</span>}</span>
                    {marcaSinFactura && puedeMarcarSinFactura(m.factura) && marcando !== m.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setAviso(null);
                          setLigando(null);
                          setEligiendoFactura(null);
                          setMarcando(m.id);
                        }}
                        className="text-xs text-sky-700 underline"
                      >
                        {m.factura ? "Cambiar motivo" : "No lleva factura"}
                      </button>
                    )}
                    {marcaSinFactura && puedeLigarFactura(m.estado_clasificacion, m.factura) && eligiendoFactura !== m.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setAviso(null);
                          setLigando(null);
                          setMarcando(null);
                          setEligiendoFactura(m.id);
                        }}
                        className="block text-xs text-violet-700 underline"
                      >
                        {/^FM?- /.test(m.factura ?? "") ? "Cambiar factura" : "Elegir factura / folio fiscal"}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Semaforo
                      estado={m.estado_clasificacion}
                      cargando={cuentaReclasificando === m.cuenta_id}
                      titulo="Reclasificar todos los movimientos de esta cuenta contra el catálogo actual (CFDI, OC/OV, reglas)"
                      onClick={() => {
                        setCuentaReclasificando(m.cuenta_id);
                        reclasificar.mutate({ empresaId: m.empresa_id, cuentaId: m.cuenta_id });
                      }}
                    />
                    {m.posible_duplicado && <span className="ml-1 text-xs text-orange-600">dup.</span>}
                  </td>
                </tr>
                {ligando === m.id && (
                  <tr>
                    <td colSpan={8} className="px-3 pb-3">
                      <LigarOrdenMovimiento
                        movimiento={m}
                        onListo={(msg) => {
                          setLigando(null);
                          setAviso(msg);
                        }}
                        onCancelar={() => setLigando(null)}
                      />
                    </td>
                  </tr>
                )}
                {eligiendoFactura === m.id && (
                  <tr>
                    <td colSpan={8} className="px-3 pb-3">
                      <LigarFacturaMovimiento
                        movimiento={m}
                        onListo={(msg) => {
                          setEligiendoFactura(null);
                          setAviso(msg);
                        }}
                        onCancelar={() => setEligiendoFactura(null)}
                      />
                    </td>
                  </tr>
                )}
                {marcando === m.id && (
                  <tr>
                    <td colSpan={8} className="px-3 pb-3">
                      <MarcarSinFactura
                        movimientoId={m.id}
                        concepto={m.nombre_razon_social}
                        facturaActual={m.factura}
                        onListo={(msg) => {
                          setMarcando(null);
                          setAviso(msg);
                        }}
                        onCancelar={() => setMarcando(null)}
                      />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
              {movimientos.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                    Sin movimientos para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {movimientos && total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
          <span>
            Mostrando {pagina * TAMANO_PAGINA + 1}–{Math.min((pagina + 1) * TAMANO_PAGINA, total)} de {total} movimientos
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={pagina === 0}
              className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="text-xs text-slate-500">
              Página {pagina + 1} de {totalPaginas}
            </span>
            <button
              onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))}
              disabled={pagina + 1 >= totalPaginas}
              className="rounded border border-slate-300 px-3 py-1.5 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
