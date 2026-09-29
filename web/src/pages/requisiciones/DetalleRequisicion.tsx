import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { moneda } from "../../lib/saldosEmpresas";
import { CompraEnUnPaso } from "./CompraEnUnPaso";
import { BotonVerOc } from "./VerOrdenCompra";

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
}

/** Una requisición abierta: sus renglones con lo que falta por resolver, el
 * botón "Comprar" (un paso: proveedor, costo, cotización → OC RQ) para
 * almacén, y las órdenes de compra que ya salieron de ella con "Ver orden"
 * (Mario, 29-sep-2026: todo en una sola pantalla). */
export function DetalleRequisicion({ requisicionId }: { requisicionId: string }) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const puedeComprar = perfil?.rol === "admin" || perfil?.rol === "corporativo" || perfil?.rol === "almacen";
  const [compraAbierta, setCompraAbierta] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["requisicion-detalle", requisicionId],
    queryFn: async () => {
      const [lineas, avance, ordenes] = await Promise.all([
        supabase.from("requisicion_lineas").select("id, cantidad_solicitada, unidad_medida, descripcion, productos(id, nombre, sku)").eq("requisicion_id", requisicionId).order("created_at"),
        supabase.from("avance_resolucion_linea").select("requisicion_linea_id, cantidad_a_compra, cantidad_a_entrega, cantidad_sin_resolver").eq("requisicion_id", requisicionId),
        supabase.from("v_requisicion_ordenes").select("orden_compra_id, id_orden, proveedor, total, fecha_creacion, autorizada_en").eq("requisicion_id", requisicionId).order("created_at", { ascending: false }),
      ]);
      if (lineas.error) throw lineas.error;
      if (avance.error) throw avance.error;
      if (ordenes.error) throw ordenes.error;
      const porLinea = new Map<string, AvanceLinea>();
      (avance.data as AvanceLinea[]).forEach((a) => porLinea.set(a.requisicion_linea_id, a));
      return { lineas: lineas.data as unknown as LineaDetalle[], porLinea, ordenes: ordenes.data as OrdenDeRequisicion[] };
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

  if (isLoading) return <p className="px-3 py-2 text-xs text-slate-500">Cargando renglones…</p>;
  if (error) return <p className="px-3 py-2 text-xs text-red-600">No se pudieron cargar los renglones: {(error as Error).message}</p>;
  if (!data) return null;

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-3 py-3">
      <table className="w-full text-xs">
        <thead className="text-left uppercase text-slate-400">
          <tr>
            <th className="py-1 pr-2">Concepto</th>
            <th className="py-1 pr-2 text-right">Solicitado</th>
            <th className="py-1 pr-2 text-right">En compra</th>
            <th className="py-1 pr-2 text-right">Surtido</th>
            <th className="py-1 pr-2 text-right">Falta</th>
            {puedeComprar && <th className="py-1" />}
          </tr>
        </thead>
        <tbody>
          {data.lineas.map((l) => {
            const a = data.porLinea.get(l.id);
            const falta = Number(a?.cantidad_sin_resolver ?? l.cantidad_solicitada);
            return (
              <FilaLinea
                key={l.id}
                linea={l}
                avance={a}
                falta={falta}
                puedeComprar={puedeComprar}
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
              <td colSpan={6} className="py-2 text-slate-400">
                Sin renglones.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {aviso && <p className={`mt-2 text-xs ${aviso.startsWith("Orden") || aviso.startsWith("Surtido") ? "text-emerald-800" : "text-red-700"}`}>{aviso}</p>}

      <div className="mt-3">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Órdenes de compra de esta requisición</p>
        {data.ordenes.length === 0 && <p className="text-xs text-slate-400">Todavía no hay órdenes de compra.</p>}
        <ul className="space-y-1">
          {data.ordenes.map((o) => (
            <li key={o.orden_compra_id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono font-semibold text-slate-900">{o.id_orden}</span>
              <span className="text-slate-600">{o.proveedor ?? "sin proveedor"}</span>
              <span className="tabular-nums text-slate-700">{o.total != null ? moneda(o.total) : ""}</span>
              <span className={`rounded-full px-2 py-0.5 ${o.autorizada_en ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{o.autorizada_en ? "autorizada" : "por autorizar"}</span>
              <BotonVerOc ocId={o.orden_compra_id} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FilaLinea({ linea, avance, falta, puedeComprar, abierta, onComprar, onSurtir, onListo }: { linea: LineaDetalle; avance: AvanceLinea | undefined; falta: number; puedeComprar: boolean; abierta: boolean; onComprar: () => void; onSurtir: () => void; onListo: (folio: string) => void }) {
  return (
    <>
      <tr className="border-t border-slate-200">
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
        {puedeComprar && (
          <td className="py-1.5 text-right">
            {falta > 0 ? (
              <span className="inline-flex gap-1">
                <button type="button" onClick={onComprar} className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white">
                  {abierta ? "Cerrar" : "Comprar"}
                </button>
                {linea.productos && (
                  <button type="button" onClick={onSurtir} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100" title="Entregar de existencia sin comprar">
                    Surtir
                  </button>
                )}
              </span>
            ) : (
              <span className="text-xs text-emerald-700">resuelto</span>
            )}
          </td>
        )}
      </tr>
      {abierta && (
        <tr>
          <td colSpan={6} className="pb-2">
            <div className="rounded border border-emerald-200 bg-white px-3 pb-3">
              <CompraEnUnPaso lineaId={linea.id} sinResolver={falta} unidad={linea.unidad_medida} onListo={onListo} onCancelar={onComprar} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
