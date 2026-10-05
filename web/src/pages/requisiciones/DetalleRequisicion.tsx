import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { moneda } from "../../lib/saldosEmpresas";
import { CompraEnUnPaso } from "./CompraEnUnPaso";
import { BotonVerOc } from "./VerOrdenCompra";
import { RecepcionOc } from "./RecepcionOc";
import { ETIQUETA_CONDICION, type CondicionPago } from "../../lib/pagosOc";
import { ETIQUETA_SEGUIMIENTO, avancePartidas, puedeMarcarEvento, seguimientoLinea, type EstadoSeguimiento, type EventoLinea, type ExtraLinea, type Seguimiento, type TipoEvento } from "../../lib/seguimientoLinea";
import { SeguimientoLinea } from "./SeguimientoLinea";

const COLOR_SEGUIMIENTO: Record<EstadoSeguimiento, string> = {
  sin_pedir: "bg-slate-100 text-slate-600",
  pedido_parcial: "bg-amber-100 text-amber-800",
  pedido: "bg-sky-100 text-sky-800",
  en_bodega: "bg-indigo-100 text-indigo-800",
  en_transito: "bg-violet-100 text-violet-800",
  entregado_parcial: "bg-amber-100 text-amber-800",
  entregado: "bg-emerald-100 text-emerald-800",
};

const UNIDADES = ["pza", "m", "m2", "m3", "kg", "ton", "lt", "bulto", "rollo", "caja", "juego", "lote", "servicio"];

interface LineaDetalle {
  id: string;
  cantidad_solicitada: number;
  unidad_medida: string;
  descripcion: string | null;
  productos: { id: string; nombre: string; sku: string } | null;
}

interface AvanceLinea {
  requisicion_linea_id: string;
  cantidad_a_compra: number;
  cantidad_a_entrega: number;
  cantidad_sin_resolver: number;
}

interface OrdenDeRequisicion {
  orden_compra_id: string;
  id_orden: string;
  proveedor: string | null;
  total: number | null;
  fecha_creacion: string | null;
  autorizada_en: string | null;
  condicion_pago: CondicionPago | null;
  pagado: number;
  saldo: number;
}

/** Una requisición abierta: sus renglones con lo que falta por resolver, el
 * botón "Comprar" (un paso: proveedor, costo, cotización → OC RQ) para
 * almacén, y las órdenes de compra que ya salieron de ella con "Ver orden"
 * (Mario, 29-sep-2026: todo en una sola pantalla). */
export function DetalleRequisicion({ requisicionId, solicitadoPor, estado, esDeLaObra = false }: { requisicionId: string; solicitadoPor?: string; estado?: string; esDeLaObra?: boolean }) {
  const { perfil, soloConsulta } = useAuth();
  const queryClient = useQueryClient();
  // Pedido / entregado / devolución / comentarios: cualquiera que vea la
  // requisición (Jonathan, 29-sep-2026). La base exige que sea a su nombre.
  const puedeMarcar = !!perfil && !soloConsulta;
  // Bodega la marca almacén; lo recibido en obra, quien pidió o el
  // responsable/comprador de la obra (5-oct-2026, Mario con Alma).
  const deLaObra = esDeLaObra || (!!perfil && perfil.id === solicitadoPor);
  const puede = (t: TipoEvento) => puedeMarcar && puedeMarcarEvento(t, perfil?.rol, deLaObra);
  const [seguimientoAbierto, setSeguimientoAbierto] = useState<{ lineaId: string; tipo: TipoEvento } | null>(null);
  const puedeComprar = perfil?.rol === "admin" || perfil?.rol === "corporativo" || perfil?.rol === "almacen";
  // Quien la pidió puede seguir agregando renglones mientras esté enviada
  // (policy requisicion_lineas_write): a Maria Fernanda se le fue con uno solo.
  const puedeEditar = estado === "enviada" && !!perfil && (perfil.id === solicitadoPor || perfil.rol === "admin" || perfil.rol === "corporativo");
  const [editando, setEditando] = useState<string | null>(null);
  const [compraAbierta, setCompraAbierta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocAbierta, setOcAbierta] = useState<string | null>(null);
  const [nuevaDescripcion, setNuevaDescripcion] = useState("");
  const [nuevaCantidad, setNuevaCantidad] = useState("1");
  const [nuevaUnidad, setNuevaUnidad] = useState("pza");

  const agregarRenglon = useMutation({
    mutationFn: async () => {
      const descripcion = nuevaDescripcion.trim();
      const cantidad = Number(nuevaCantidad);
      if (!descripcion) throw new Error("Escribe qué material o servicio necesitas.");
      if (!(cantidad > 0)) throw new Error("La cantidad debe ser mayor a 0.");
      const { error: err } = await supabase.from("requisicion_lineas").insert({ requisicion_id: requisicionId, concepto_id: null, descripcion, cantidad_solicitada: cantidad, unidad_medida: nuevaUnidad });
      if (err) throw err;
    },
    onSuccess: () => {
      setAviso("Renglón agregado.");
      setNuevaDescripcion("");
      setNuevaCantidad("1");
      queryClient.invalidateQueries({ queryKey: ["requisicion-detalle", requisicionId] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["requisicion-detalle", requisicionId],
    queryFn: async () => {
      const [lineas, avance, ordenes, eventos, entrega] = await Promise.all([
        supabase.from("requisicion_lineas").select("id, cantidad_solicitada, unidad_medida, descripcion, productos(id, nombre, sku)").eq("requisicion_id", requisicionId).order("created_at"),
        supabase.from("avance_resolucion_linea").select("requisicion_linea_id, cantidad_a_compra, cantidad_a_entrega, cantidad_sin_resolver").eq("requisicion_id", requisicionId),
        supabase.from("v_requisicion_ordenes").select("orden_compra_id, id_orden, proveedor, total, fecha_creacion, autorizada_en, condicion_pago, pagado, saldo").eq("requisicion_id", requisicionId).order("created_at", { ascending: false }),
        supabase.from("requisicion_linea_eventos").select("id, requisicion_linea_id, tipo, cantidad, nota, created_by, created_by_nombre, created_at").eq("requisicion_id", requisicionId).order("created_at"),
        supabase.from("v_requisicion_linea_entrega").select("requisicion_linea_id, comprado, oc_bodega, oc_obra").eq("requisicion_id", requisicionId),
      ]);
      const extraPorLinea = new Map<string, ExtraLinea>();
      ((entrega.data ?? []) as { requisicion_linea_id: string; comprado: number; oc_bodega: number; oc_obra: number }[]).forEach((x) =>
        extraPorLinea.set(x.requisicion_linea_id, { comprado: Number(x.comprado), ocBodega: Number(x.oc_bodega), ocObra: Number(x.oc_obra) }),
      );
      if (eventos.error) throw eventos.error;
      const eventosPorLinea = new Map<string, EventoLinea[]>();
      (eventos.data as EventoLinea[]).forEach((e) => eventosPorLinea.set(e.requisicion_linea_id, [...(eventosPorLinea.get(e.requisicion_linea_id) ?? []), e]));
      if (lineas.error) throw lineas.error;
      if (avance.error) throw avance.error;
      if (ordenes.error) throw ordenes.error;
      const porLinea = new Map<string, AvanceLinea>();
      (avance.data as AvanceLinea[]).forEach((a) => porLinea.set(a.requisicion_linea_id, a));
      return { lineas: lineas.data as unknown as LineaDetalle[], porLinea, ordenes: ordenes.data as OrdenDeRequisicion[], eventosPorLinea, extraPorLinea };
    },
  });

  const surtir = useMutation({
    mutationFn: async ({ lineaId, maximo, unidad }: { lineaId: string; maximo: number; unidad: string }) => {
      const texto = window.prompt(`¿Cuánto se surte de existencia? (hasta ${maximo} ${unidad})`, String(maximo));
      if (texto === null) return false;
      const cantidad = Number(texto);
      if (!(cantidad > 0) || cantidad > maximo + 0.001) throw new Error(`La cantidad debe ser mayor a 0 y hasta ${maximo}.`);
      const { data: sessionData } = await supabase.auth.getSession();
      const { error: err } = await supabase.from("necesidades_entrega").insert({ requisicion_linea_id: lineaId, cantidad, resuelto_por: sessionData.session?.user.id });
      if (err) throw err;
      return true;
    },
    onSuccess: (hecho) => {
      if (!hecho) return;
      setAviso("Surtido de existencia registrado.");
      queryClient.invalidateQueries({ queryKey: ["requisicion-detalle", requisicionId] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  // Editar / quitar renglones y cancelar la requisición mientras nada se haya
  // comprado ni surtido (Mario, 29-sep-2026: "para no hacer tantos folios
  // por errores sencillos"). El trigger requisicion_lineas_guarda_resueltas
  // protege lo ya resuelto aunque alguien lo intente desde fuera.
  const guardarRenglon = useMutation({
    mutationFn: async ({ lineaId, descripcion, cantidad, unidad, esCatalogo }: { lineaId: string; descripcion: string; cantidad: number; unidad: string; esCatalogo: boolean }) => {
      if (!esCatalogo && !descripcion.trim()) throw new Error("Escribe qué material o servicio necesitas.");
      if (!(cantidad > 0)) throw new Error("La cantidad debe ser mayor a 0.");
      const cambios: Record<string, unknown> = { cantidad_solicitada: cantidad, unidad_medida: unidad };
      if (!esCatalogo) cambios.descripcion = descripcion.trim();
      const { error: err } = await supabase.from("requisicion_lineas").update(cambios).eq("id", lineaId);
      if (err) throw err;
    },
    onSuccess: () => {
      setAviso("Renglón actualizado.");
      setEditando(null);
      queryClient.invalidateQueries({ queryKey: ["requisicion-detalle", requisicionId] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const quitarRenglon = useMutation({
    mutationFn: async (lineaId: string) => {
      if (!window.confirm("¿Quitar este renglón de la requisición?")) return false;
      const { error: err } = await supabase.from("requisicion_lineas").delete().eq("id", lineaId);
      if (err) throw err;
      return true;
    },
    onSuccess: (hecho) => {
      if (!hecho) return;
      setAviso("Renglón quitado.");
      queryClient.invalidateQueries({ queryKey: ["requisicion-detalle", requisicionId] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const cancelar = useMutation({
    mutationFn: async () => {
      if (!window.confirm("¿Cancelar esta requisición completa? El folio queda como cancelada.")) return false;
      const { error: err } = await supabase.from("requisiciones").update({ estado: "cancelada" }).eq("id", requisicionId);
      if (err) throw err;
      return true;
    },
    onSuccess: (hecho) => {
      if (!hecho) return;
      queryClient.invalidateQueries({ queryKey: ["requisiciones"] });
      queryClient.invalidateQueries({ queryKey: ["requisicion-detalle", requisicionId] });
    },
    onError: (e: Error) => setAviso(e.message),
  });

  if (isLoading) return <p className="px-3 py-2 text-xs text-slate-500">Cargando renglones…</p>;
  if (error) return <p className="px-3 py-2 text-xs text-red-600">No se pudieron cargar los renglones: {(error as Error).message}</p>;
  if (!data) return null;

  const segs = data.lineas.map((l) => seguimientoLinea(Number(l.cantidad_solicitada), data.eventosPorLinea.get(l.id) ?? [], data.extraPorLinea.get(l.id)));
  const avanceTotal = avancePartidas(segs);
  const cuenta = (e: EstadoSeguimiento[]) => segs.filter((x) => e.includes(x.estado)).length;

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-3 py-3">
      {segs.length > 0 && (
        <div className="mb-2 rounded border border-slate-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold text-slate-800">Avance {avanceTotal}%</span>
            <span className="h-2 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-slate-100">
              <span className={`block h-full ${avanceTotal >= 100 ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${Math.min(100, avanceTotal)}%` }} />
            </span>
            <span className="text-slate-500">{segs.length} partidas:</span>
            <span className="text-slate-600">{cuenta(["sin_pedir"])} sin pedir</span>
            <span className="text-sky-800">{cuenta(["pedido", "pedido_parcial"])} pedidas</span>
            <span className="text-indigo-800">{cuenta(["en_bodega"])} en bodega</span>
            <span className="text-violet-800">{cuenta(["en_transito"])} en camino</span>
            <span className="text-amber-800">{cuenta(["entregado_parcial"])} en obra parcial</span>
            <span className="font-medium text-emerald-800">{cuenta(["entregado"])} en obra</span>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">El avance cuenta cuatro pasos por partida: pedido · recibido en bodega · enviado a obra · recibido en obra. Recibir en bodega no completa la requisición.</p>
        </div>
      )}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-xs">
        <thead className="text-left uppercase text-slate-400">
          <tr>
            <th className="py-1 pr-2">Concepto</th>
            <th className="py-1 pr-2 text-right">Solicitado</th>
            <th className="py-1 pr-2 text-right">En compra</th>
            <th className="py-1 pr-2 text-right">Surtido</th>
            <th className="py-1 pr-2 text-right">Falta</th>
            <th className="py-1 pr-2 text-right">Pedido</th>
            <th className="py-1 pr-2 text-right">Bodega</th>
            <th className="py-1 pr-2 text-right">En obra</th>
            <th className="py-1 pr-2">Comentarios</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {data.lineas.map((l, i) => {
            const a = data.porLinea.get(l.id);
            const falta = Number(a?.cantidad_sin_resolver ?? l.cantidad_solicitada);
            const resuelto = Number(a?.cantidad_a_compra ?? 0) + Number(a?.cantidad_a_entrega ?? 0);
            const eventosLinea = data.eventosPorLinea.get(l.id) ?? [];
            const seg = segs[i];
            const abiertoSeg = seguimientoAbierto?.lineaId === l.id ? seguimientoAbierto : null;
            return (
              <FilaLinea
                key={l.id}
                requisicionId={requisicionId}
                seguimiento={seg}
                eventos={eventosLinea}
                puedeMarcar={puedeMarcar}
                puede={puede}
                seguimientoTipo={abiertoSeg?.tipo ?? null}
                onSeguimiento={(tipo) => {
                  setCompraAbierta(null);
                  setEditando(null);
                  setSeguimientoAbierto(tipo && !(abiertoSeg && abiertoSeg.tipo === tipo) ? { lineaId: l.id, tipo } : null);
                }}
                linea={l}
                avance={a}
                falta={falta}
                puedeComprar={puedeComprar}
                puedeEditar={puedeEditar}
                resuelto={resuelto}
                editando={editando === l.id}
                onEditar={() => {
                  setAviso(null);
                  setCompraAbierta(null);
                  setEditando(editando === l.id ? null : l.id);
                }}
                onGuardar={(v) => guardarRenglon.mutate({ lineaId: l.id, esCatalogo: !!l.productos, ...v })}
                onQuitar={() => quitarRenglon.mutate(l.id)}
                abierta={compraAbierta === l.id}
                onComprar={() => {
                  setAviso(null);
                  setCompraAbierta(compraAbierta === l.id ? null : l.id);
                }}
                onSurtir={() => surtir.mutate({ lineaId: l.id, maximo: falta, unidad: l.unidad_medida })}
                onListo={(folio) => {
                  setCompraAbierta(null);
                  setAviso(`Orden de compra ${folio} generada. Dirección la verá en sus pendientes para autorizar.`);
                  queryClient.invalidateQueries({ queryKey: ["requisicion-detalle", requisicionId] });
                  queryClient.invalidateQueries({ queryKey: ["requisiciones"] });
                }}
              />
            );
          })}
          {data.lineas.length === 0 && (
            <tr>
              <td colSpan={10} className="py-2 text-slate-400">
                Sin renglones.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {puedeEditar && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAviso(null);
            agregarRenglon.mutate();
          }}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <input value={nuevaDescripcion} onChange={(e) => setNuevaDescripcion(e.target.value)} placeholder="Agregar otro material o servicio…" className="min-w-[12rem] flex-1 rounded border border-slate-300 px-2 py-1 text-xs" />
          <input type="number" min="0.001" step="0.001" value={nuevaCantidad} onChange={(e) => setNuevaCantidad(e.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1 text-xs" aria-label="Cantidad" />
          <select value={nuevaUnidad} onChange={(e) => setNuevaUnidad(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-xs" aria-label="Unidad">
            {UNIDADES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <button type="submit" disabled={agregarRenglon.isPending} className="rounded border border-slate-900 px-2.5 py-1 text-xs font-medium text-slate-900 disabled:opacity-50">
            Agregar renglón
          </button>
          {data.ordenes.length === 0 && data.lineas.every((l) => Number(data.porLinea.get(l.id)?.cantidad_a_compra ?? 0) + Number(data.porLinea.get(l.id)?.cantidad_a_entrega ?? 0) === 0) && (
            <button type="button" onClick={() => cancelar.mutate()} disabled={cancelar.isPending} className="ml-auto text-xs text-red-700 underline disabled:opacity-50" title="Solo mientras nada se haya comprado ni surtido">
              Cancelar requisición
            </button>
          )}
        </form>
      )}

      {aviso && <p className={`mt-2 text-xs ${aviso.startsWith("Orden") || aviso.startsWith("Surtido") || aviso.startsWith("Renglón") ? "text-emerald-800" : "text-red-700"}`}>{aviso}</p>}

      <div className="mt-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Órdenes de compra de esta requisición</p>
        {data.ordenes.length === 0 && <p className="text-xs text-slate-400">Todavía no hay órdenes de compra.</p>}
        <ul className="space-y-1">
          {data.ordenes.map((o) => {
            const pagada = Number(o.saldo) <= 0.005;
            return (
              <li key={o.orden_compra_id} className="text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold text-slate-900">{o.id_orden}</span>
                  <span className="text-slate-600">{o.proveedor ?? "sin proveedor"}</span>
                  <span className="tabular-nums text-slate-700">{o.total != null ? moneda(o.total) : ""}</span>
                  <span className={`rounded-full px-2 py-0.5 ${o.autorizada_en ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{o.autorizada_en ? "autorizada" : "por autorizar"}</span>
                  <span className={`rounded-full px-2 py-0.5 ${pagada ? "bg-emerald-100 text-emerald-800" : Number(o.pagado) > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`} title={o.condicion_pago ? ETIQUETA_CONDICION[o.condicion_pago] : "sin condición de pago"}>
                    {pagada ? "pagada" : Number(o.pagado) > 0 ? `saldo ${moneda(Number(o.saldo))}` : "sin pagar"}
                    {o.condicion_pago ? ` · ${ETIQUETA_CONDICION[o.condicion_pago].toLowerCase()}` : ""}
                  </span>
                  <BotonVerOc ocId={o.orden_compra_id} />
                  <button type="button" onClick={() => setOcAbierta(ocAbierta === o.orden_compra_id ? null : o.orden_compra_id)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
                    {ocAbierta === o.orden_compra_id ? "Cerrar" : puedeComprar ? "Recibir" : "Recepción"}
                  </button>
                </div>
                {ocAbierta === o.orden_compra_id && (
                  <RecepcionOc
                    ocId={o.orden_compra_id}
                    puedeRecibir={puedeComprar}
                    onCambio={() => {
                      queryClient.invalidateQueries({ queryKey: ["requisiciones"] });
                      queryClient.invalidateQueries({ queryKey: ["requisicion-detalle", requisicionId] });
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

interface FilaLineaProps {
  requisicionId: string;
  seguimiento: Seguimiento;
  eventos: EventoLinea[];
  puedeMarcar: boolean;
  puede: (t: TipoEvento) => boolean;
  seguimientoTipo: TipoEvento | null;
  onSeguimiento: (tipo: TipoEvento | null) => void;
  linea: LineaDetalle;
  avance: AvanceLinea | undefined;
  falta: number;
  resuelto: number;
  puedeComprar: boolean;
  puedeEditar: boolean;
  editando: boolean;
  abierta: boolean;
  onEditar: () => void;
  onGuardar: (v: { descripcion: string; cantidad: number; unidad: string }) => void;
  onQuitar: () => void;
  onComprar: () => void;
  onSurtir: () => void;
  onListo: (folio: string) => void;
}

function FilaLinea({ requisicionId, seguimiento, eventos, puedeMarcar, puede, seguimientoTipo, onSeguimiento, linea, avance, falta, resuelto, puedeComprar, puedeEditar, editando, abierta, onEditar, onGuardar, onQuitar, onComprar, onSurtir, onListo }: FilaLineaProps) {
  const [descripcion, setDescripcion] = useState(linea.descripcion ?? "");
  const [cantidad, setCantidad] = useState(String(linea.cantidad_solicitada));
  const [unidad, setUnidad] = useState(linea.unidad_medida);
  const intacta = resuelto <= 0;
  return (
    <>
      <tr className="border-t border-slate-200">
        {editando ? (
          <>
            <td className="py-1.5 pr-2">
              {linea.productos ? (
                <span className="text-slate-800">
                  {linea.productos.nombre} <span className="text-slate-400">({linea.productos.sku})</span>
                </span>
              ) : (
                <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1 text-xs" aria-label="Descripción" />
              )}
            </td>
            <td className="py-1.5 pr-2 text-right">
              <span className="inline-flex items-center gap-1">
                <input type="number" min={intacta ? "0.001" : String(resuelto)} step="0.001" value={cantidad} onChange={(e) => setCantidad(e.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-xs" aria-label="Cantidad" />
                {intacta && !linea.productos ? (
                  <select value={unidad} onChange={(e) => setUnidad(e.target.value)} className="rounded border border-slate-300 px-1 py-1 text-xs" aria-label="Unidad">
                    {UNIDADES.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-slate-600">{linea.unidad_medida}</span>
                )}
              </span>
            </td>
            <td colSpan={7} className="py-1.5 pr-2 text-right text-slate-500">{intacta ? "" : `ya hay ${resuelto} resueltos: solo puede subir la cantidad`}</td>
            <td className="py-1.5 text-right">
              <span className="inline-flex gap-1">
                <button type="button" onClick={() => onGuardar({ descripcion, cantidad: Number(cantidad), unidad })} className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white">
                  Guardar
                </button>
                <button type="button" onClick={onEditar} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
                  Cancelar
                </button>
              </span>
            </td>
          </>
        ) : (
          <>
            <td className="py-1.5 pr-2 text-slate-800">
              {linea.productos?.nombre ?? linea.descripcion}
              {linea.productos && <span className="ml-1 text-slate-400">({linea.productos.sku})</span>}
            </td>
            <td className="py-1.5 pr-2 text-right tabular-nums">
              {linea.cantidad_solicitada} {linea.unidad_medida}
            </td>
            <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{avance?.cantidad_a_compra ?? 0}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{avance?.cantidad_a_entrega ?? 0}</td>
            <td className={`py-1.5 pr-2 text-right tabular-nums font-medium ${falta > 0 ? "text-amber-700" : "text-emerald-700"}`}>{falta}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700">{seguimiento.pedido}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700">
              {seguimiento.enBodega}
              {seguimiento.enTransito > 0 && <div className="text-[10px] text-violet-700">{seguimiento.enTransito} en camino</div>}
              {seguimiento.quedaBodega > 0 && <div className="text-[10px] text-slate-500">{seguimiento.quedaBodega} se queda</div>}
            </td>
            <td className="py-1.5 pr-2 text-right">
              <span className="tabular-nums text-slate-700">{seguimiento.entregado}</span>{" "}
              <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] ${COLOR_SEGUIMIENTO[seguimiento.estado]}`}>{ETIQUETA_SEGUIMIENTO[seguimiento.estado]}</span>
              <div className="text-[10px] text-slate-500">avance {seguimiento.avance}%</div>
              {seguimiento.enCambio > 0 && <div className="text-[10px] text-amber-700">{seguimiento.enCambio} en cambio</div>}
              {seguimiento.faltante > 0 && <div className="text-[10px] text-red-700">{seguimiento.faltante} faltante</div>}
            </td>
            <td className="max-w-[14rem] py-1.5 pr-2 text-slate-600">
              {seguimiento.comentarios[0] ? (
                <button type="button" onClick={() => onSeguimiento("comentario")} className="text-left hover:underline" title="Ver la bitácora del renglón">
                  <span className="line-clamp-2">{seguimiento.comentarios[0].nota}</span>
                  <span className="text-[10px] text-slate-400">
                    {seguimiento.comentarios[0].created_by_nombre ?? ""}
                    {seguimiento.comentarios.length > 1 ? ` · +${seguimiento.comentarios.length - 1}` : ""}
                  </span>
                </button>
              ) : (
                puedeMarcar && (
                  <button type="button" onClick={() => onSeguimiento("comentario")} className="text-slate-400 underline">
                    comentar
                  </button>
                )
              )}
            </td>
            <td className="py-1.5 text-right">
                <span className="inline-flex flex-wrap justify-end gap-1">
                  {puede("pedido") && seguimiento.porPedir > 0 && (
                    <button type="button" onClick={() => onSeguimiento("pedido")} className="rounded border border-sky-300 px-2 py-1 text-xs text-sky-800 hover:bg-sky-50">
                      Pedido
                    </button>
                  )}
                  {puede("en_bodega") && seguimiento.estado !== "entregado" && seguimiento.recibidoBodega + seguimiento.entregado < Number(linea.cantidad_solicitada) - 0.001 && (
                    <button type="button" onClick={() => onSeguimiento("en_bodega")} className="rounded border border-indigo-300 px-2 py-1 text-xs text-indigo-800 hover:bg-indigo-50">
                      Recibí en bodega
                    </button>
                  )}
                  {puede("enviado_obra") && seguimiento.enBodega > 0 && (
                    <button type="button" onClick={() => onSeguimiento("enviado_obra")} className="rounded border border-violet-300 px-2 py-1 text-xs text-violet-800 hover:bg-violet-50">
                      Enviar a obra
                    </button>
                  )}
                  {puede("entregado") && seguimiento.estado !== "entregado" && (
                    <button type="button" onClick={() => onSeguimiento(seguimiento.enTransito > 0 ? "entregado" : "directo_obra")} className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-50">
                      Recibido en obra
                    </button>
                  )}
                  {puede("devolucion") && seguimiento.entregado > 0 && (
                    <button type="button" onClick={() => onSeguimiento("cambio")} className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-800 hover:bg-amber-50" title="Cambio de piezas o devolución">
                      Devolver
                    </button>
                  )}
                  {puedeComprar && falta > 0 && (
                    <button type="button" onClick={onComprar} className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white">
                      {abierta ? "Cerrar" : "Comprar"}
                    </button>
                  )}
                  {puedeComprar && falta > 0 && linea.productos && (
                    <button type="button" onClick={onSurtir} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100" title="Entregar de existencia sin comprar">
                      Surtir
                    </button>
                  )}
                  {puedeComprar && falta <= 0 && <span className="px-1 text-xs text-emerald-700">resuelto</span>}
                  {puedeEditar && (
                    <button type="button" onClick={onEditar} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
                      Editar
                    </button>
                  )}
                  {puedeEditar && intacta && (
                    <button type="button" onClick={onQuitar} className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50">
                      Quitar
                    </button>
                  )}
                </span>
              </td>
          </>
        )}
      </tr>
      {seguimientoTipo && (
        <tr>
          <td colSpan={10} className="pb-2">
            <SeguimientoLinea
              key={seguimientoTipo}
              puede={puede}
              lineaId={linea.id}
              requisicionId={requisicionId}
              solicitado={Number(linea.cantidad_solicitada)}
              unidad={linea.unidad_medida}
              seguimiento={seguimiento}
              eventos={eventos}
              tipoInicial={seguimientoTipo}
              onCerrar={() => onSeguimiento(null)}
            />
          </td>
        </tr>
      )}
      {abierta && (
        <tr>
          <td colSpan={10} className="pb-2">
            <div className="rounded border border-emerald-200 bg-white px-3 pb-3">
              <CompraEnUnPaso lineaId={linea.id} sinResolver={falta} unidad={linea.unidad_medida} onListo={onListo} onCancelar={onComprar} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
