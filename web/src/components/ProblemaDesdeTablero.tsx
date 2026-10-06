import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useVer } from "./FiltroDesdeTablero";

// Regla general (Mario, 5 y 6-oct-2026: "dirígelos directo al problema",
// "este error ya se corrigió con otros roles; que se aplique general"): todo
// indicador con conteo lleva `?ver=<clave>` y, en cualquier pantalla, este
// panel pinta arriba la lista exacta de lo que se contó, con liga a cada
// cosa. Las pantallas que ya filtran por su cuenta (movimientos, match,
// folios, requisiciones) usan otras claves y no pasan por aquí.
// **Indicador nuevo con conteo → su ruta lleva ?ver= y su entrada aquí.**

interface Fila {
  celdas: (string | number | null)[];
  liga?: string;
}

interface Problema {
  titulo: string;
  columnas: string[];
  consulta: () => Promise<Fila[]>;
}

const fecha = (v: string | null | undefined) => (v ? new Date(v.length <= 10 ? `${v}T12:00:00` : v).toLocaleDateString("es-MX") : "—");
const pesos = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const hoyIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
const haceDias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const dias = (v: string | null | undefined) => (v ? Math.round((Date.now() - new Date(v.length <= 10 ? `${v}T12:00:00` : v).getTime()) / 86_400_000) : null);

async function filas<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data as T[] | null) ?? []) as T[];
}

async function nombresEmpresa(): Promise<Map<string, string>> {
  const e = await filas<{ id: string; codigo: string; nombre: string }>(supabase.from("empresas").select("id, codigo, nombre"));
  return new Map(e.map((x) => [x.id, x.codigo || x.nombre]));
}

export const PROBLEMAS: Record<string, Problema> = {
  cfdi_atrasados: {
    titulo: "Empresas con CFDI atrasados (más de 7 días)",
    columnas: ["Empresa", "Último emitido", "Último recibido", "Cargado", "Días"],
    consulta: async () => {
      const r = await filas<{ empresa_codigo: string; ultima_fecha: string | null; ultimo_emitido: string | null; ultimo_recibido: string | null; ultima_carga: string | null; total_cfdi: number }>(
        supabase.from("v_cfdi_ultimo_por_empresa").select("*").gt("total_cfdi", 0).order("ultima_fecha", { ascending: true }),
      );
      return r.filter((x) => (dias(x.ultima_fecha) ?? 999) > 7).map((x) => ({ celdas: [x.empresa_codigo, fecha(x.ultimo_emitido), fecha(x.ultimo_recibido), fecha(x.ultima_carga), dias(x.ultima_fecha)] }));
    },
  },
  cuentas_sin_movimientos: {
    titulo: "Cuentas bancarias sin movimientos en 7 días (falta estado de cuenta)",
    columnas: ["Empresa", "Cuenta", "Último movimiento", "Saldo"],
    consulta: async () => {
      const limite = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
      const [r, cuentas, emp] = await Promise.all([
        filas<{ cuenta_id: string; empresa_id: string; fecha_ultimo_movimiento: string | null; saldo_cierre: number }>(supabase.from("v_saldo_cierre_cuenta").select("*").lt("fecha_ultimo_movimiento", limite)),
        filas<{ id: string; banco: string; ultimos_4: string; alias: string | null }>(supabase.from("cuentas_bancarias").select("id, banco, ultimos_4, alias")),
        nombresEmpresa(),
      ]);
      const c = new Map(cuentas.map((x) => [x.id, `${x.banco} ${x.ultimos_4}${x.alias ? ` · ${x.alias}` : ""}`]));
      return r.map((x) => ({ celdas: [emp.get(x.empresa_id) ?? "", c.get(x.cuenta_id) ?? "", fecha(x.fecha_ultimo_movimiento), pesos(Number(x.saldo_cierre))] }));
    },
  },
  sin_estado_cuenta: {
    titulo: "Empresas que nunca han cargado estado de cuenta",
    columnas: ["Empresa"],
    consulta: async () =>
      (await filas<{ empresa_nombre: string }>(supabase.from("v_estado_carga_empresa").select("empresa_nombre").is("ultima_carga_estado_cuenta", null))).map((x) => ({ celdas: [x.empresa_nombre] })),
  },
  ultimas_cargas: {
    titulo: "Últimas cargas completadas",
    columnas: ["Archivo", "Tipo", "Empresa", "Terminada"],
    consulta: async () => {
      const [r, emp] = await Promise.all([
        filas<{ nombre_original: string; tipo: string; empresa_id: string; completed_at: string }>(supabase.from("archivos_cargados").select("nombre_original, tipo, empresa_id, completed_at").eq("estado", "completado").order("completed_at", { ascending: false }).limit(15)),
        nombresEmpresa(),
      ]);
      return r.map((x) => ({ celdas: [x.nombre_original, x.tipo, emp.get(x.empresa_id) ?? "", fecha(x.completed_at)] }));
    },
  },
  cargas_error: {
    titulo: "Cargas con error (últimos 30 días): vuelve a subirlas",
    columnas: ["Archivo", "Tipo", "Empresa", "Fecha", "Error"],
    consulta: async () => {
      const [r, emp] = await Promise.all([
        filas<{ nombre_original: string; tipo: string; empresa_id: string; created_at: string; detalle_error: unknown }>(
          supabase.from("archivos_cargados").select("nombre_original, tipo, empresa_id, created_at, detalle_error").eq("estado", "error").gte("created_at", haceDias(30)).order("created_at", { ascending: false }),
        ),
        nombresEmpresa(),
      ]);
      return r.map((x) => ({ celdas: [x.nombre_original, x.tipo, emp.get(x.empresa_id) ?? "", fecha(x.created_at), typeof x.detalle_error === "string" ? x.detalle_error : JSON.stringify(x.detalle_error ?? "").slice(0, 160)] }));
    },
  },
  sincronizacion_oc_ov: {
    titulo: "Últimas sincronizaciones con el backoffice",
    columnas: ["Pedida", "Terminada", "OC procesadas", "OC guardadas", "Error"],
    consulta: async () =>
      (
        await filas<{ solicitada_en: string; terminada_en: string | null; resultado: Record<string, unknown> | null; error: string | null }>(
          supabase.from("sincronizaciones_oc_ov").select("solicitada_en, terminada_en, resultado, error").order("solicitada_en", { ascending: false }).limit(10),
        )
      ).map((x) => ({ celdas: [new Date(x.solicitada_en).toLocaleString("es-MX"), x.terminada_en ? new Date(x.terminada_en).toLocaleString("es-MX") : "en curso", String(x.resultado?.oc_procesadas ?? ""), String(x.resultado?.oc_guardadas ?? ""), x.error] })),
  },
  prestamos_con_saldo: {
    titulo: "Préstamos entre empresas sin liquidar",
    columnas: ["Empresa", "Contraparte", "Fecha", "Monto"],
    consulta: async () =>
      (await filas<{ empresa_nombre: string; empresa_contraparte_nombre: string; fecha_pago: string; monto: number }>(supabase.from("v_prestamos_intercompania").select("empresa_nombre, empresa_contraparte_nombre, fecha_pago, monto").order("fecha_pago", { ascending: false })))
        .filter((x) => Math.abs(Number(x.monto ?? 0)) > 0.01)
        .map((x) => ({ celdas: [x.empresa_nombre, x.empresa_contraparte_nombre, fecha(x.fecha_pago), pesos(Number(x.monto))] })),
  },
  entradas_sin_oc: {
    titulo: "Entradas de almacén sin orden de compra",
    columnas: ["Fecha", "Producto", "Cantidad", "Comentario"],
    consulta: async () =>
      (
        await filas<{ fecha: string; cantidad: number; comentario: string | null; productos: { nombre: string } | null }>(
          supabase.from("movimientos_inventario").select("fecha, cantidad, comentario, productos(nombre)").eq("tipo", "entrada").eq("es_ajuste", false).is("orden_compra_id", null).order("fecha", { ascending: false }).limit(200),
        )
      ).map((x) => ({ celdas: [fecha(x.fecha), x.productos?.nombre ?? "", x.cantidad, x.comentario] })),
  },
  movimientos_hoy: {
    titulo: "Movimientos de inventario de hoy",
    columnas: ["Tipo", "Producto", "Cantidad", "Comentario"],
    consulta: async () =>
      (
        await filas<{ tipo: string; cantidad: number; comentario: string | null; productos: { nombre: string } | null }>(
          supabase.from("movimientos_inventario").select("tipo, cantidad, comentario, productos(nombre)").gte("created_at", `${hoyIso()}T06:00:00Z`).order("created_at", { ascending: false }),
        )
      ).map((x) => ({ celdas: [x.tipo, x.productos?.nombre ?? "", x.cantidad, x.comentario] })),
  },
  productos_sin_costo: {
    titulo: "Productos activos sin costo de referencia",
    columnas: ["SKU", "Producto", "Unidad"],
    consulta: async () =>
      (await filas<{ sku: string | null; nombre: string; unidad_medida: string | null }>(supabase.from("productos").select("sku, nombre, unidad_medida").eq("activo", true).is("costo_referencia", null).order("nombre"))).map((x) => ({
        celdas: [x.sku, x.nombre, x.unidad_medida],
      })),
  },
  remisiones_por_confirmar: {
    titulo: "Remisiones de salida sin confirmar entrega",
    columnas: ["Folio", "Fecha", "Entregar a", "Destino"],
    consulta: async () =>
      (await filas<{ folio: string; fecha: string; entregar_a: string | null; destino: string | null }>(supabase.from("remisiones_salida").select("folio, fecha, entregar_a, destino").eq("estatus", "emitida").order("fecha", { ascending: false }))).map((x) => ({
        celdas: [x.folio, fecha(x.fecha), x.entregar_a, x.destino],
      })),
  },
  remisiones_planta_por_confirmar: {
    titulo: "Remisiones de planta sin confirmar",
    columnas: ["Folio", "Fecha", "Contraparte", "Tipo"],
    consulta: async () =>
      (await filas<{ folio: string; fecha: string; contraparte: string | null; tipo: string }>(supabase.from("remisiones_produccion").select("folio, fecha, contraparte, tipo").eq("estatus", "emitida").order("fecha", { ascending: false }))).map((x) => ({
        celdas: [x.folio, fecha(x.fecha), x.contraparte, x.tipo],
      })),
  },
  ordenes_abiertas: {
    titulo: "Órdenes de producción planeadas o en proceso",
    columnas: ["Folio", "Estado", "Planeada", "Producida", "Embarque"],
    consulta: async () =>
      (
        await filas<{ folio: string; estado: string; cantidad_planeada: number; cantidad_producida: number; fecha_estimada_embarque: string | null }>(
          supabase.from("ordenes_produccion").select("folio, estado, cantidad_planeada, cantidad_producida, fecha_estimada_embarque").in("estado", ["planeada", "en_proceso"]).order("fecha_estimada_embarque", { ascending: true }),
        )
      ).map((x) => ({ celdas: [x.folio, x.estado, x.cantidad_planeada, x.cantidad_producida, fecha(x.fecha_estimada_embarque)] })),
  },
  ordenes_atrasadas: {
    titulo: "Órdenes de producción con embarque vencido",
    columnas: ["Folio", "Estado", "Planeada", "Producida", "Embarque"],
    consulta: async () =>
      (
        await filas<{ folio: string; estado: string; cantidad_planeada: number; cantidad_producida: number; fecha_estimada_embarque: string | null }>(
          supabase.from("ordenes_produccion").select("folio, estado, cantidad_planeada, cantidad_producida, fecha_estimada_embarque").in("estado", ["planeada", "en_proceso"]).lt("fecha_estimada_embarque", hoyIso()).order("fecha_estimada_embarque"),
        )
      ).map((x) => ({ celdas: [x.folio, x.estado, x.cantidad_planeada, x.cantidad_producida, fecha(x.fecha_estimada_embarque)] })),
  },
  operaciones_retrasadas: {
    titulo: "Operaciones de máquina retrasadas",
    columnas: ["Paso", "Estado", "Fin programado"],
    consulta: async () =>
      (
        await filas<{ nombre_paso: string; estado: string; fin_programado: string }>(
          supabase.from("operaciones_programadas").select("nombre_paso, estado, fin_programado").in("estado", ["programada", "en_proceso"]).lt("fin_programado", new Date().toISOString()).order("fin_programado"),
        )
      ).map((x) => ({ celdas: [x.nombre_paso, x.estado, new Date(x.fin_programado).toLocaleString("es-MX")] })),
  },
  pu_por_autorizar: {
    titulo: "Precios unitarios por firmar o publicar",
    columnas: ["Código", "Concepto", "Proyecto", "Estado", "Actualizado"],
    consulta: async () =>
      (
        await filas<{ codigo: string | null; concepto: string; proyecto_nombre: string | null; estado: string; updated_at: string }>(
          supabase.from("v_pu_analisis_costeo").select("codigo, concepto, proyecto_nombre, estado, updated_at").in("estado", ["material_confirmado", "autorizado"]).order("updated_at", { ascending: false }),
        )
      ).map((x) => ({ celdas: [x.codigo, x.concepto, x.proyecto_nombre, x.estado, fecha(x.updated_at)] })),
  },
  pu_borrador_viejo: {
    titulo: "Precios unitarios en borrador más de 7 días",
    columnas: ["Código", "Concepto", "Proyecto", "Elaboró", "Sin moverse desde"],
    consulta: async () =>
      (
        await filas<{ codigo: string | null; concepto: string; proyecto_nombre: string | null; creado_por_nombre: string | null; updated_at: string }>(
          supabase.from("v_pu_analisis_costeo").select("codigo, concepto, proyecto_nombre, creado_por_nombre, updated_at").eq("estado", "borrador").lt("updated_at", haceDias(7)).order("updated_at"),
        )
      ).map((x) => ({ celdas: [x.codigo, x.concepto, x.proyecto_nombre, x.creado_por_nombre, fecha(x.updated_at)] })),
  },
  tareas_vencidas: {
    titulo: "Tareas con fecha límite vencida",
    columnas: ["Tarea", "Fecha límite", "Días de atraso"],
    consulta: async () =>
      (
        await filas<{ id: string; tablero_id: string; titulo: string; fecha_limite: string }>(
          supabase.from("tarjetas").select("id, tablero_id, titulo, fecha_limite").eq("archivada", false).lt("fecha_limite", hoyIso()).order("fecha_limite").limit(300),
        )
      ).map((x) => ({ celdas: [x.titulo, fecha(x.fecha_limite), dias(x.fecha_limite)], liga: `/tareas/${x.tablero_id}?tarjeta=${x.id}` })),
  },
  cuentas_sin_rol: {
    titulo: "Cuentas registradas sin rol (no tienen acceso)",
    columnas: ["Nombre", "Registrada"],
    consulta: async () =>
      (await filas<{ nombre: string | null; created_at: string }>(supabase.from("profiles").select("nombre, created_at").eq("rol", "pendiente").order("created_at", { ascending: false }))).map((x) => ({
        celdas: [x.nombre, fecha(x.created_at)],
      })),
  },
  fotos_error: {
    titulo: "Fotos de notas de entrega con error de lectura (7 días)",
    columnas: ["Fecha", "Proveedor sugerido", "Error"],
    consulta: async () =>
      (await filas<{ created_at: string; proveedor_sugerido: string | null; texto_extraido: { error?: string | null } | null }>(supabase.from("notas_entrega").select("created_at, proveedor_sugerido, texto_extraido").gte("created_at", haceDias(7))))
        .filter((x) => x.texto_extraido?.error)
        .map((x) => ({ celdas: [fecha(x.created_at), x.proveedor_sugerido, String(x.texto_extraido?.error ?? "")] })),
  },
};

/** Va una vez en el Layout, arriba de cada pantalla. */
export function ProblemaDesdeTablero() {
  const [ver, quitar] = useVer();
  const problema = ver ? PROBLEMAS[ver] : undefined;
  const { data, isLoading, error } = useQuery({
    queryKey: ["problema-tablero", ver],
    enabled: !!problema,
    queryFn: () => problema!.consulta(),
  });
  if (!problema) return null;
  const lista = data ?? [];
  return (
    <section className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-amber-900">
        <span className="font-semibold">{problema.titulo}</span>
        {!isLoading && <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs">{lista.length}</span>}
        <button type="button" onClick={quitar} className="ml-auto text-xs underline">
          Cerrar
        </button>
      </div>
      {isLoading && <p className="text-xs text-amber-800">Cargando…</p>}
      {error && <p className="text-xs text-red-700">{(error as Error).message}</p>}
      {!isLoading && !error && lista.length === 0 && <p className="text-xs text-amber-800">Nada pendiente: ya se resolvió.</p>}
      {lista.length > 0 && (
        <div className="max-h-80 overflow-auto rounded border border-amber-200 bg-white">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-amber-100 text-left text-amber-900">
              <tr>
                {problema.columnas.map((c) => (
                  <th key={c} className="px-2 py-1">
                    {c}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((f, i) => (
                <tr key={i} className="border-t border-amber-100">
                  {f.celdas.map((c, j) => (
                    <td key={j} className="px-2 py-1 text-slate-700">
                      {c ?? "—"}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right">
                    {f.liga && (
                      <Link to={f.liga} className="underline">
                        abrir
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
