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
import type { EstadoClasificacion, Movimiento } from "../types/database";

const TAMANO_PAGINA = 50;

const ESTADOS: { valor: EstadoClasificacion | "todos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos los estados" },
  { valor: "pendiente_revision", etiqueta: "🔴 Revisión" },
  { valor: "pendiente_esperado", etiqueta: "🟡 Esperado" },
  { valor: "ambiguo", etiqueta: "🟣 Ambiguo" },
  { valor: "resuelto", etiqueta: "Resuelto" },
];


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
  // Marcar "sin factura" con motivo (7-oct-2026): dirección, corporativo, admin.
  const marcaSinFactura = perfil?.rol === "admin" || perfil?.rol === "direccion" || perfil?.rol === "corporativo";
  const [marcando, setMarcando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const empresaFiltro = veTodasLasEmpresas ? empresaId : (perfil?.empresa_id ?? "");

  // Al cambiar cualquier filtro, la página actual puede quedar fuera de
  // rango del nuevo resultado (ej. estabas en la página 5 y el filtro nuevo
  // solo trae 2 páginas) -- siempre se regresa a la primera.
  useEffect(() => {
    setPagina(0);
  }, [empresaFiltro, cuentaId, estado, soloDuplicados]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["movimientos", empresaFiltro, cuentaId, estado, soloDuplicados, pagina],
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
      const { data, error, count } = await query;
      if (error) throw error;
      return { movimientos: data as Movimiento[], total: count ?? 0 };
    },
  });

  const { data: cuenta } = useQuery({
    queryKey: ["cuenta-bancaria", cuentaId],
    enabled: !!cuentaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("cuentas_bancarias").select("id, banco, ultimos_4, alias").eq("id", cuentaId).maybeSingle();
      if (error) throw error;
      return data;
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
        {cuentaId && (
          <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs text-sky-800">
            Cuenta: {cuenta ? `${cuenta.banco} ${cuenta.ultimos_4}${cuenta.alias ? ` · ${cuenta.alias}` : ""}` : "…"}
            <button
              type="button"
              onClick={() => {
                params.delete("cuenta");
                setParams(params, { replace: true });
              }}
              className="font-semibold hover:text-sky-950"
              title="Quitar el filtro de cuenta"
            >
              ×
            </button>
          </span>
        )}
        <Link to="/finanzas/saldos" className="text-xs text-slate-500 underline">
          Saldos por empresa
        </Link>
      </div>

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
                  <td className="px-3 py-2">
                    {m.referencia_tipo ? `${m.referencia_tipo} ${m.referencia_numero}` : "—"}
                  </td>
                  <td className="max-w-xs px-3 py-2" title={m.factura ?? undefined}>
                    <span className="block truncate">{m.factura ?? <span className="text-slate-400">—</span>}</span>
                    {marcaSinFactura && puedeMarcarSinFactura(m.factura) && marcando !== m.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setAviso(null);
                          setMarcando(m.id);
                        }}
                        className="text-xs text-sky-700 underline"
                      >
                        {m.factura ? "Cambiar motivo" : "No lleva factura"}
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
