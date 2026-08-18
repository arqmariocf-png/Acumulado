import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../lib/supabase";
import { useAuth } from "../lib/auth";

type Pestana = "estado_cuenta" | "cfdi" | "oc_ov";

const PESTANAS: { valor: Pestana; etiqueta: string }[] = [
  { valor: "estado_cuenta", etiqueta: "Estado de cuenta" },
  { valor: "cfdi", etiqueta: "CFDI" },
  { valor: "oc_ov", etiqueta: "Catálogo OC/OV (Excel)" },
];

function useEmpresas() {
  return useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre").order("nombre");
      if (error) throw error;
      return data;
    },
  });
}

function useCuentas(empresaId: string) {
  return useQuery({
    queryKey: ["cuentas", empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from("cuentas_bancarias").select("id, banco, ultimos_4").eq("empresa_id", empresaId);
      if (error) throw error;
      return data;
    },
    enabled: !!empresaId,
  });
}

/** Lee de vuelta lo que ya quedó guardado para la pestaña activa, filtrado a
 * la empresa seleccionada -- así se ve directamente en la página que el
 * archivo cargado sí llegó a la tabla, sin depender de ir a otra pantalla
 * (Dashboard/Movimientos solo reflejan `movimientos`, que se llenan al cargar
 * un estado de cuenta -- CFDI y el catálogo OC/OV son datos de referencia
 * para el motor de conciliación, no aparecen ahí por separado). */
function useDatosRecientes(pestana: Pestana, empresaId: string) {
  return useQuery({
    queryKey: ["carga-recientes", pestana, empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      if (pestana === "estado_cuenta") {
        const { data, error } = await supabase
          .from("movimientos")
          .select("id, fecha_pago, nombre_razon_social, cargo_total, abono_total, saldo, estado_clasificacion")
          .eq("empresa_id", empresaId)
          .order("created_at", { ascending: false })
          .limit(10);
        if (error) throw error;
        return data;
      }
      if (pestana === "cfdi") {
        const { data, error } = await supabase
          .from("cfdi")
          .select("id, tipo, folio, total, periodo, contraparte, fecha")
          .eq("empresa_id", empresaId)
          .order("created_at", { ascending: false })
          .limit(10);
        if (error) throw error;
        return data;
      }
      const [{ data: oc, error: errOc }, { data: ov, error: errOv }] = await Promise.all([
        supabase.from("ordenes_compra").select("id, id_orden, tipo, proveedor, total, fecha_creacion").eq("empresa_id", empresaId).order("id_orden", { ascending: false }).limit(5),
        supabase.from("ordenes_venta").select("id, id_ov, cliente, total, fecha_ov").eq("empresa_id", empresaId).order("id_ov", { ascending: false }).limit(5),
      ]);
      if (errOc) throw errOc;
      if (errOv) throw errOv;
      return { oc, ov };
    },
  });
}

async function llamarFuncion(nombre: string, formData: FormData) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const respuesta = await fetch(urlFuncion(nombre), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const json = await respuesta.json();
  if (!respuesta.ok) throw new Error(json.error ?? `Error ${respuesta.status}`);
  return json;
}

export function Carga() {
  const { veTodasLasEmpresas, perfil } = useAuth();
  const { data: empresas } = useEmpresas();
  const [pestana, setPestana] = useState<Pestana>("estado_cuenta");
  const [empresaId, setEmpresaId] = useState(perfil?.empresa_id ?? "");
  const [resultado, setResultado] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const { data: cuentas } = useCuentas(empresaId);
  const queryClient = useQueryClient();
  const { data: recientes, isLoading: cargandoRecientes } = useDatosRecientes(pestana, empresaId);

  async function onSubmitEstadoCuenta(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResultado(null);
    setEnviando(true);
    try {
      const form = new FormData(e.currentTarget);
      const json = await llamarFuncion("ingesta-estado-cuenta", form);
      setResultado(json);
      if (json.archivoId) {
        // Dispara la clasificación automáticamente tras una ingesta exitosa.
        const { data: sessionData } = await supabase.auth.getSession();
        await fetch(urlFuncion("motor-conciliacion"), {
          method: "POST",
          headers: { Authorization: `Bearer ${sessionData.session?.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ empresaId, archivoId: json.archivoId }),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["carga-recientes"] });
      queryClient.invalidateQueries({ queryKey: ["movimientos"] });
      queryClient.invalidateQueries({ queryKey: ["kpis-mensuales"] });
      queryClient.invalidateQueries({ queryKey: ["kpis-por-empresa"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function onSubmitGenerico(nombreFuncion: string) {
    return async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      setResultado(null);
      setEnviando(true);
      try {
        const form = new FormData(e.currentTarget);
        const json = await llamarFuncion(nombreFuncion, form);
        setResultado(json);
        queryClient.invalidateQueries({ queryKey: ["carga-recientes"] });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setEnviando(false);
      }
    };
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Carga de archivos</h1>

      <div className="mb-4 flex gap-2">
        {PESTANAS.map((p) => (
          <button
            key={p.valor}
            onClick={() => {
              setPestana(p.valor);
              setResultado(null);
              setError(null);
            }}
            className={`rounded px-3 py-1.5 text-sm ${pestana === p.valor ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"} border border-slate-200`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      <div className="mb-4">
        {veTodasLasEmpresas ? (
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
            <option value="">Selecciona una empresa…</option>
            {empresas?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-slate-500">Empresa: la asignada a tu usuario.</p>
        )}
      </div>

      {pestana === "estado_cuenta" && empresaId && (
        <form onSubmit={onSubmitEstadoCuenta} className="max-w-md space-y-3 rounded border border-slate-200 bg-white p-4">
          <input type="hidden" name="empresaId" value={empresaId} />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Cuenta bancaria</label>
            <select name="cuentaId" required className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">Selecciona…</option>
              {cuentas?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.banco} ····{c.ultimos_4}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Archivo (CSV o Excel, formato canónico)</label>
            <input type="file" name="file" accept=".csv,.xlsx,.xls" required className="w-full text-sm" />
          </div>
          <button disabled={enviando} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {enviando ? "Cargando…" : "Cargar y clasificar"}
          </button>
        </form>
      )}

      {pestana === "cfdi" && empresaId && (
        <form onSubmit={onSubmitGenerico("ingesta-cfdi")} className="max-w-md space-y-3 rounded border border-slate-200 bg-white p-4">
          <input type="hidden" name="empresaId" value={empresaId} />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Tipo</label>
            <select name="tipo" required className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
              <option value="recibido">Recibidos (compras)</option>
              <option value="emitido">Emitidos (ventas)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">RFC de la empresa</label>
            <input name="rfc" required className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Periodo (AAAAMM)</label>
            <input name="periodo" required pattern="\d{6}" placeholder="202607" className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Archivo</label>
            <input type="file" name="file" accept=".csv,.xlsx,.xls" required className="w-full text-sm" />
          </div>
          <button disabled={enviando} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {enviando ? "Cargando…" : "Cargar CFDI"}
          </button>
        </form>
      )}

      {pestana === "oc_ov" && empresaId && (
        <form onSubmit={onSubmitGenerico("ingesta-oc-ov")} className="max-w-md space-y-3 rounded border border-slate-200 bg-white p-4">
          <input type="hidden" name="empresaId" value={empresaId} />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Catálogo</label>
            <select name="recurso" required className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
              <option value="oc">Órdenes de Compra/Servicio</option>
              <option value="ov">Órdenes de Venta</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Archivo</label>
            <input type="file" name="file" accept=".csv,.xlsx,.xls" required className="w-full text-sm" />
          </div>
          <p className="text-xs text-slate-500">
            Carga de respaldo mientras se confirma la integración directa con la API del backoffice.
          </p>
          <button disabled={enviando} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {enviando ? "Cargando…" : "Cargar catálogo"}
          </button>
        </form>
      )}

      {!empresaId && <p className="text-sm text-slate-500">Selecciona una empresa para continuar.</p>}

      {error && (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          ❌ No se pudo cargar el archivo: {error}
        </p>
      )}

      {resultado && !error && (
        <div className="mt-4 max-w-2xl space-y-2">
          <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
            ✅ Archivo cargado{typeof resultado.filasProcesadas === "number" ? ` — ${resultado.filasProcesadas} fila(s) guardadas` : ""}
            {typeof resultado.filasConError === "number" && resultado.filasConError > 0
              ? `, ${resultado.filasConError} pendiente(s) de revisar (no bloquean la carga)`
              : "."}
          </p>
          {resultado.mensaje && <p className="text-sm text-slate-600">{resultado.mensaje}</p>}
          {Array.isArray(resultado.erroresPorFila) && resultado.erroresPorFila.length > 0 && (
            <details className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <summary className="cursor-pointer font-medium">Ver filas pendientes de revisar</summary>
              <pre className="mt-2 overflow-x-auto">{JSON.stringify(resultado.erroresPorFila, null, 2)}</pre>
            </details>
          )}
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer">Respuesta completa</summary>
            <pre className="mt-2 max-w-2xl overflow-x-auto rounded border border-slate-200 bg-white p-3 text-slate-700">
              {JSON.stringify(resultado, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {empresaId && (
        <div className="mt-6 max-w-3xl">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Lo último guardado en esta empresa</h2>
          {pestana !== "estado_cuenta" && (
            <p className="mb-2 text-xs text-slate-500">
              Esto es un catálogo de referencia para el motor de conciliación -- no aparece en Dashboard/Movimientos por
              sí solo. Solo un estado de cuenta genera movimientos, que es lo que alimenta esas pantallas.
            </p>
          )}
          {cargandoRecientes && <p className="text-sm text-slate-400">Cargando…</p>}

          {pestana === "estado_cuenta" && Array.isArray(recientes) && (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Nombre / Razón social</th>
                    <th className="px-3 py-2 text-right">Cargo</th>
                    <th className="px-3 py-2 text-right">Abono</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {recientes.map((m: any) => (
                    <tr key={m.id} className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-3 py-2">{m.fecha_pago}</td>
                      <td className="px-3 py-2">{m.nombre_razon_social ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{m.cargo_total ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{m.abono_total ?? "—"}</td>
                      <td className="px-3 py-2">{m.estado_clasificacion}</td>
                    </tr>
                  ))}
                  {recientes.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                        Todavía no hay movimientos cargados para esta empresa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {pestana === "cfdi" && Array.isArray(recientes) && (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">UUID (folio)</th>
                    <th className="px-3 py-2">Contraparte</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Periodo</th>
                  </tr>
                </thead>
                <tbody>
                  {recientes.map((c: any) => (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">{c.tipo}</td>
                      <td className="max-w-xs truncate px-3 py-2" title={c.folio}>{c.folio}</td>
                      <td className="px-3 py-2">{c.contraparte ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{c.total}</td>
                      <td className="px-3 py-2">{c.periodo}</td>
                    </tr>
                  ))}
                  {recientes.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                        Todavía no hay CFDI cargados para esta empresa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {pestana === "oc_ov" && recientes && !Array.isArray(recientes) && (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">OC/OS</th>
                      <th className="px-3 py-2">Proveedor</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recientes.oc?.map((o: any) => (
                      <tr key={o.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">{o.id_orden} ({o.tipo})</td>
                        <td className="px-3 py-2">{o.proveedor ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{o.total ?? "—"}</td>
                      </tr>
                    ))}
                    {(!recientes.oc || recientes.oc.length === 0) && (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                          Todavía no hay Órdenes de Compra/Servicio cargadas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">OV</th>
                      <th className="px-3 py-2">Cliente</th>
                      <th className="px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recientes.ov?.map((o: any) => (
                      <tr key={o.id} className="border-t border-slate-100">
                        <td className="px-3 py-2">{o.id_ov}</td>
                        <td className="px-3 py-2">{o.cliente ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{o.total ?? "—"}</td>
                      </tr>
                    ))}
                    {(!recientes.ov || recientes.ov.length === 0) && (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                          Todavía no hay Órdenes de Venta cargadas.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
