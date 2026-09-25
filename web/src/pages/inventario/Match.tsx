import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { cantidadTexto } from "../../lib/remision";
import { dineroMx } from "../../lib/kpisEmpresa";
import type { AvanceRecepcionOc, AvanceEmbarqueOv, EstadoRecepcion, EstadoEmbarque } from "../../types/database";

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

function useAvanceRecepcion(empresaId: string) {
  return useQuery({
    queryKey: ["avance-recepcion-oc", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avance_recepcion_oc")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("fecha", { ascending: false, nullsFirst: false })
        .order("id_orden", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as AvanceRecepcionOc[];
    },
  });
}

function useAvanceEmbarque(empresaId: string) {
  return useQuery({
    queryKey: ["avance-embarque-ov", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("avance_embarque_ov")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("fecha", { ascending: false, nullsFirst: false })
        .order("id_ov", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as AvanceEmbarqueOv[];
    },
  });
}

function fechaTabla(iso: string | null): string {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

const ESTILO_RECEPCION: Record<EstadoRecepcion, { color: string; etiqueta: string }> = {
  sin_total: { color: "bg-slate-100 text-slate-600", etiqueta: "Sin total en la orden" },
  sin_recibir: { color: "bg-red-100 text-red-800", etiqueta: "Sin recibir" },
  parcial: { color: "bg-amber-100 text-amber-800", etiqueta: "Recepción parcial" },
  completo: { color: "bg-emerald-100 text-emerald-800", etiqueta: "Recibido completo" },
};

const ESTILO_EMBARQUE: Record<EstadoEmbarque, { color: string; etiqueta: string }> = {
  sin_total: { color: "bg-slate-100 text-slate-600", etiqueta: "Sin total en la orden" },
  sin_embarcar: { color: "bg-red-100 text-red-800", etiqueta: "Sin embarcar" },
  parcial: { color: "bg-amber-100 text-amber-800", etiqueta: "Embarque parcial" },
  completo: { color: "bg-emerald-100 text-emerald-800", etiqueta: "Embarcado completo" },
};

function Badge({ color, etiqueta }: { color: string; etiqueta: string }) {
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>{etiqueta}</span>;
}

/** Fila de v_ov_lineas_avance (partidas de una OV con lo embarcado). */
interface LineaOvAvance {
  linea_id: string;
  orden_venta_id: string;
  numero: number;
  concepto: string;
  unidad: string | null;
  cantidad: number | null;
  precio_base: number | null;
  embarcado: number;
  pendiente: number | null;
  estado: string;
  fecha_ultimo_embarque: string | null;
  diferencia: number | null;
}

interface LineaOcAvance {
  linea_id: string;
  numero: number;
  item: string;
  unidad: string | null;
  cantidad: number | null;
  recibido: number;
  diferencia: number;
  estado: "sin_recibir" | "parcial" | "completo" | "excedido";
  fecha_ultima_recepcion: string | null;
}

const ESTILO_LINEA: Record<LineaOcAvance["estado"], { color: string; etiqueta: string }> = {
  sin_recibir: { color: "bg-red-100 text-red-800", etiqueta: "Sin recibir" },
  parcial: { color: "bg-amber-100 text-amber-800", etiqueta: "Parcial · el proveedor debe" },
  completo: { color: "bg-emerald-100 text-emerald-800", etiqueta: "Completa" },
  excedido: { color: "bg-red-100 text-red-800", etiqueta: "Excedente · ajuste/reclamación" },
};

/** Partidas de una OC con lo recibido por cantidad (v_oc_lineas_avance). Es
 * lo que abre el QR del comprobante de entrada. */
function PartidasOc({ ordenCompraId }: { ordenCompraId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["lineas-orden", ordenCompraId, "entrada"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_oc_lineas_avance").select("*").eq("orden_compra_id", ordenCompraId).order("numero");
      if (error) throw error;
      return (data ?? []).map((l: any) => ({
        linea_id: String(l.linea_id),
        numero: Number(l.numero),
        item: String(l.item),
        unidad: l.unidad ?? null,
        cantidad: l.cantidad == null ? null : Number(l.cantidad),
        recibido: Number(l.recibido ?? 0),
        diferencia: Number(l.diferencia ?? 0),
        estado: String(l.estado) as LineaOcAvance["estado"],
        fecha_ultima_recepcion: l.fecha_ultima_recepcion ?? null,
      })) as LineaOcAvance[];
    },
  });
  if (isLoading) return <p className="px-3 py-2 text-xs text-slate-500">Cargando partidas…</p>;
  if (error) return <p className="px-3 py-2 text-xs text-red-600">{(error as Error).message}</p>;
  if (!data || data.length === 0) return <p className="px-3 py-2 text-xs text-slate-500">Esta orden no tiene partidas del backoffice (o aún no se sincronizan).</p>;
  return (
    <table className="w-full text-xs">
      <thead className="bg-slate-100 text-left uppercase text-slate-500">
        <tr>
          <th className="px-2 py-1">#</th>
          <th className="px-2 py-1">Partida</th>
          <th className="px-2 py-1">Unidad</th>
          <th className="px-2 py-1 text-right">Pedido</th>
          <th className="px-2 py-1 text-right">Recibido</th>
          <th className="px-2 py-1 text-right">Diferencia</th>
          <th className="px-2 py-1">Estado</th>
          <th className="px-2 py-1">Última recepción</th>
        </tr>
      </thead>
      <tbody>
        {data.map((l) => (
          <tr key={l.linea_id} className="border-t border-slate-100">
            <td className="px-2 py-1 text-slate-500">{l.numero}</td>
            <td className="px-2 py-1">{l.item}</td>
            <td className="px-2 py-1">{l.unidad ?? ""}</td>
            <td className="px-2 py-1 text-right">{l.cantidad == null ? "—" : cantidadTexto(l.cantidad)}</td>
            <td className="px-2 py-1 text-right">{cantidadTexto(l.recibido)}</td>
            <td className={`px-2 py-1 text-right ${l.diferencia > 0 ? "text-amber-700" : l.diferencia < 0 ? "text-red-700" : "text-emerald-700"}`}>
              {l.diferencia > 0 ? `faltan ${cantidadTexto(l.diferencia)}` : l.diferencia < 0 ? `sobran ${cantidadTexto(-l.diferencia)}` : "0"}
            </td>
            <td className="px-2 py-1">
              <Badge {...ESTILO_LINEA[l.estado]} />
            </td>
            <td className="px-2 py-1 text-slate-500">{l.fecha_ultima_recepcion ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const ESTILO_LINEA_OV: Record<string, { color: string; etiqueta: string }> = {
  sin_embarcar: { color: "bg-red-100 text-red-800", etiqueta: "Sin embarcar" },
  parcial: { color: "bg-amber-100 text-amber-800", etiqueta: "Parcial · falta por embarcar" },
  completo: { color: "bg-emerald-100 text-emerald-800", etiqueta: "Completa" },
  excedido: { color: "bg-red-100 text-red-800", etiqueta: "Excedente" },
};

/** Partidas de una OV con lo embarcado por cantidad (v_ov_lineas_avance). */
function PartidasOv({ ordenVentaId }: { ordenVentaId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["lineas-orden", ordenVentaId, "salida"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_ov_lineas_avance").select("*").eq("orden_venta_id", ordenVentaId).order("numero");
      if (error) throw error;
      return (data ?? []) as LineaOvAvance[];
    },
  });
  if (isLoading) return <p className="px-3 py-2 text-xs text-slate-500">Cargando partidas…</p>;
  if (error) return <p className="px-3 py-2 text-xs text-red-600">{(error as Error).message}</p>;
  if (!data || data.length === 0) return <p className="px-3 py-2 text-xs text-slate-500">Esta orden de venta no tiene partidas del backoffice (o aún no se sincronizan).</p>;
  return (
    <table className="w-full text-xs">
      <thead className="bg-slate-100 text-left uppercase text-slate-500">
        <tr>
          <th className="px-2 py-1">#</th>
          <th className="px-2 py-1">Concepto</th>
          <th className="px-2 py-1">Unidad</th>
          <th className="px-2 py-1 text-right">Vendido</th>
          <th className="px-2 py-1 text-right">Embarcado</th>
          <th className="px-2 py-1 text-right">Diferencia</th>
          <th className="px-2 py-1 text-right">Precio</th>
          <th className="px-2 py-1">Estado</th>
          <th className="px-2 py-1">Último embarque</th>
        </tr>
      </thead>
      <tbody>
        {data.map((l) => {
          const dif = Number(l.diferencia ?? 0);
          return (
            <tr key={l.linea_id} className="border-t border-slate-100">
              <td className="px-2 py-1 text-slate-500">{l.numero}</td>
              <td className="px-2 py-1">{l.concepto}</td>
              <td className="px-2 py-1">{l.unidad ?? ""}</td>
              <td className="px-2 py-1 text-right">{l.cantidad == null ? "—" : cantidadTexto(Number(l.cantidad))}</td>
              <td className="px-2 py-1 text-right">{cantidadTexto(Number(l.embarcado ?? 0))}</td>
              <td className={`px-2 py-1 text-right ${dif > 0 ? "text-amber-700" : dif < 0 ? "text-red-700" : "text-emerald-700"}`}>
                {dif > 0 ? `faltan ${cantidadTexto(dif)}` : dif < 0 ? `sobran ${cantidadTexto(-dif)}` : "0"}
              </td>
              <td className="px-2 py-1 text-right">{l.precio_base == null ? "—" : dineroMx(Number(l.precio_base))}</td>
              <td className="px-2 py-1">
                <Badge {...(ESTILO_LINEA_OV[String(l.estado)] ?? { color: "bg-slate-100 text-slate-600", etiqueta: String(l.estado) })} />
              </td>
              <td className="px-2 py-1 text-slate-500">{l.fecha_ultimo_embarque ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function Match() {
  const { veTodasLasEmpresas, perfil } = useAuth();
  const { data: empresas } = useEmpresas();
  const [empresaId, setEmpresaId] = useState(perfil?.empresa_id ?? "");
  const [vista, setVista] = useState<"oc" | "ov">("oc");
  // ?oc=<id>: llega del QR del comprobante de entrada -- abre esa orden con
  // sus partidas y, si hace falta, cambia a su empresa.
  const [params] = useSearchParams();
  const ocDesdeQr = params.get("oc");
  const [ocAbierta, setOcAbierta] = useState<string | null>(ocDesdeQr);
  const { data: avanceOc, isLoading: cargandoOc } = useAvanceRecepcion(empresaId);
  const { data: avanceOv, isLoading: cargandoOv } = useAvanceEmbarque(empresaId);
  const [ovAbierta, setOvAbierta] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [soloPendientes, setSoloPendientes] = useState(false);
  const coincide = (...campos: (string | null | undefined)[]) => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return campos.some((c) => (c ?? "").toLowerCase().includes(q));
  };
  const ocFiltradas = (avanceOc ?? []).filter((o) => coincide(o.id_orden, o.proveedor, o.proyecto, o.fecha) && (!soloPendientes || o.estado_recepcion === "sin_recibir" || o.estado_recepcion === "parcial"));
  const ovFiltradas = (avanceOv ?? []).filter((o) => coincide(o.id_ov, o.cliente, o.proyecto, o.fecha) && (!soloPendientes || o.estado_embarque === "sin_embarcar" || o.estado_embarque === "parcial"));

  useEffect(() => {
    if (!ocDesdeQr) return;
    setOcAbierta(ocDesdeQr);
    setVista("oc");
    supabase
      .from("ordenes_compra")
      .select("empresa_id")
      .eq("id", ocDesdeQr)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.empresa_id) setEmpresaId(String(data.empresa_id));
      });
  }, [ocDesdeQr]);


  return (
    <div>
      <p className="mb-4 max-w-2xl text-sm text-slate-500">
        Compara lo que el almacén registró como recibido/embarcado (entradas y salidas de inventario vinculadas a una
        orden) contra el total en dinero de esa orden en el catálogo de Grupo Loma.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
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
        <div className="flex overflow-hidden rounded border border-slate-300">
          <button
            onClick={() => setVista("oc")}
            className={`px-3 py-1.5 text-sm ${vista === "oc" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
          >
            Compras (OC/OS)
          </button>
          <button
            onClick={() => setVista("ov")}
            className={`px-3 py-1.5 text-sm ${vista === "ov" ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}
          >
            Ventas (OV)
          </button>
        </div>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar folio, proveedor/cliente, proyecto o fecha…"
          className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} /> solo con pendiente
        </label>
      </div>

      {!empresaId && <p className="text-sm text-slate-500">Selecciona una empresa para ver el match.</p>}

      {empresaId && vista === "oc" && (
        <>
          {cargandoOc && <p className="text-sm text-slate-500">Cargando…</p>}
          {avanceOc && (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Orden</th>
                    <th className="px-3 py-2">Proveedor</th>
                    <th className="px-3 py-2">Proyecto</th>
                    <th className="px-3 py-2 text-right">Total OC</th>
                    <th className="px-3 py-2 text-right">Recibido</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {ocFiltradas.map((o) => (
                    <Fragment key={o.orden_compra_id}>
                      <tr className={`border-t border-slate-100 ${ocAbierta === o.orden_compra_id ? "bg-emerald-50" : ""}`}>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fechaTabla(o.fecha)}</td>
                        <td className="px-3 py-2">
                          {o.tipo} {o.id_orden}
                          <button
                            type="button"
                            onClick={() => setOcAbierta(ocAbierta === o.orden_compra_id ? null : o.orden_compra_id)}
                            className="ml-2 text-xs text-slate-500 underline"
                          >
                            {ocAbierta === o.orden_compra_id ? "ocultar partidas" : "partidas"}
                          </button>
                        </td>
                        <td className="px-3 py-2">{o.proveedor ?? "—"}</td>
                        <td className="px-3 py-2">{o.proyecto ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{o.total_oc == null ? "—" : dineroMx(Number(o.total_oc))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{dineroMx(Number(o.total_recibido))}</td>
                        <td className="px-3 py-2">
                          <Badge {...ESTILO_RECEPCION[o.estado_recepcion]} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <Link to={`/inventario?empresa=${empresaId}&tipo=entrada&oc=${o.orden_compra_id}`} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100">
                            Registrar entrada
                          </Link>
                        </td>
                      </tr>
                      {ocAbierta === o.orden_compra_id && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-3 py-2">
                            <PartidasOc ordenCompraId={o.orden_compra_id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {ocFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                        {avanceOc.length === 0 ? "No hay órdenes de compra cargadas para esta empresa." : "Ninguna orden coincide con el filtro."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {empresaId && vista === "ov" && (
        <>
          {cargandoOv && <p className="text-sm text-slate-500">Cargando…</p>}
          {avanceOv && (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Orden</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Proyecto</th>
                    <th className="px-3 py-2 text-right">Total OV</th>
                    <th className="px-3 py-2 text-right">Embarcado</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {ovFiltradas.map((o) => (
                    <Fragment key={o.orden_venta_id}>
                      <tr className={`border-t border-slate-100 ${ovAbierta === o.orden_venta_id ? "bg-emerald-50" : ""}`}>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500">{fechaTabla(o.fecha)}</td>
                        <td className="px-3 py-2">
                          OV {o.id_ov}
                          <button type="button" onClick={() => setOvAbierta(ovAbierta === o.orden_venta_id ? null : o.orden_venta_id)} className="ml-2 text-xs text-slate-500 underline">
                            {ovAbierta === o.orden_venta_id ? "ocultar partidas" : "partidas"}
                          </button>
                        </td>
                        <td className="px-3 py-2">{o.cliente ?? "—"}</td>
                        <td className="px-3 py-2">{o.proyecto ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{o.total_ov == null ? "—" : dineroMx(Number(o.total_ov))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{dineroMx(Number(o.total_embarcado))}</td>
                        <td className="px-3 py-2">
                          <Badge {...ESTILO_EMBARQUE[o.estado_embarque]} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <Link to={`/inventario?empresa=${empresaId}&tipo=salida&ov=${o.orden_venta_id}`} className="rounded border border-sky-300 bg-sky-50 px-2 py-1 text-xs text-sky-800 hover:bg-sky-100">
                            Registrar salida
                          </Link>
                        </td>
                      </tr>
                      {ovAbierta === o.orden_venta_id && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-3 py-2">
                            <PartidasOv ordenVentaId={o.orden_venta_id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {ovFiltradas.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                        {avanceOv.length === 0 ? "No hay órdenes de venta cargadas para esta empresa." : "Ninguna orden coincide con el filtro."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
