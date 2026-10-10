import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { abrirParaImprimir, abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import { htmlCotizacionPlanta, sinIva, totalesCotizacion, type LineaCotizacionPlanta, type MembreteEmpresa } from "../../lib/cotizacionPlanta";

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";
const $ = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN" }));

interface Producto {
  id: string;
  nombre: string;
  calibre: string | null;
  unidad_medida: string | null;
}
interface LineaForm {
  productoId: string;
  descripcion: string;
  cantidad: string;
  unidad: string;
  precio: string;
}
interface CotizacionFila {
  id: string;
  folio: string;
  fecha: string;
  contraparte: string;
  obra: string | null;
  vigencia_dias: number;
  condicion_pago: "contado" | "credito" | null;
  dias_credito: number | null;
  notas: string | null;
  cliente_id: string | null;
  estatus: "enviada" | "aceptada" | "rechazada";
  created_by_nombre: string | null;
  cotizaciones_produccion_lineas: (LineaCotizacionPlanta & { orden: number })[];
}

const VACIA: LineaForm = { productoId: "", descripcion: "", cantidad: "1", unidad: "pza", precio: "" };

/** Cotizador de planta (Clavicón, 30-sep-2026): cotiza producto terminado con
 * precio cerrado con IVA incluido, muestra el margen contra el costo real
 * (interno) e imprime la cotización sin costos. */
export function CotizadorPlanta({ empresa }: { empresa: { id: string; nombre: string; codigo?: string } }) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const veMargen = !!perfil && ["admin", "corporativo", "direccion", "empresa"].includes(perfil.rol);
  const [cliente, setCliente] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [obra, setObra] = useState("");
  const [vigencia, setVigencia] = useState("15");
  const [condicion, setCondicion] = useState<"" | "contado" | "credito">("");
  const [dias, setDias] = useState("");
  const [notas, setNotas] = useState("");
  const [conIva, setConIva] = useState(true);
  const [lineas, setLineas] = useState<LineaForm[]>([{ ...VACIA }]);
  const [aviso, setAviso] = useState<string | null>(null);

  const { data: catalogo } = useQuery({
    queryKey: ["cotizador-catalogo", empresa.id],
    queryFn: async () => {
      const [prod, stock, clientes, emp] = await Promise.all([
        supabase.from("productos_produccion").select("id, nombre, calibre, unidad_medida").eq("empresa_id", empresa.id).eq("activo", true).order("nombre"),
        supabase.from("v_stock_producto_terminado").select("producto_id, stock_actual, costo_promedio_ponderado, costo_peps").eq("empresa_id", empresa.id),
        supabase.from("clientes").select("id, razon_social, rfc, domicilio").eq("empresa_id", empresa.id).eq("activo", true).order("razon_social"),
        supabase.from("empresas").select("codigo, rfc, razon_social, domicilio_fiscal, telefono, correo, banco, cuenta_bancaria, clabe, sucursal_bancaria").eq("id", empresa.id).maybeSingle(),
      ]);
      if (prod.error) throw prod.error;
      const costos = new Map((stock.data ?? []).map((s) => [s.producto_id as string, { costo: (s.costo_peps ?? s.costo_promedio_ponderado) as number | null, stock: s.stock_actual as number | null }]));
      return {
        productos: (prod.data ?? []) as Producto[],
        costos,
        clientes: (clientes.data ?? []) as { id: string; razon_social: string; rfc: string | null; domicilio: string | null }[],
        membrete: (emp.data ?? null) as MembreteEmpresa | null,
        codigo: (emp.data?.codigo as string | undefined) ?? "",
        rfc: (emp.data?.rfc as string | null | undefined) ?? null,
      };
    },
  });

  const { data: historial = [] } = useQuery({
    queryKey: ["cotizaciones-planta", empresa.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cotizaciones_produccion")
        .select("id, folio, fecha, contraparte, obra, vigencia_dias, condicion_pago, dias_credito, notas, cliente_id, estatus, created_by_nombre, cotizaciones_produccion_lineas(orden, descripcion, cantidad, unidad, precio_unitario, costo_unitario)")
        .eq("empresa_id", empresa.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as unknown as CotizacionFila[];
    },
  });

  const lineasCalculo: LineaCotizacionPlanta[] = useMemo(
    () =>
      lineas
        .filter((l) => l.descripcion.trim() && Number(l.cantidad) > 0 && l.precio !== "")
        .map((l) => ({
          descripcion: l.descripcion.trim(),
          cantidad: Number(l.cantidad),
          unidad: l.unidad || "pza",
          precio_unitario: conIva ? sinIva(Number(l.precio)) : Number(l.precio),
          costo_unitario: l.productoId ? catalogo?.costos.get(l.productoId)?.costo ?? null : null,
        })),
    [lineas, conIva, catalogo],
  );
  const t = totalesCotizacion(lineasCalculo);

  const setLinea = (i: number, cambios: Partial<LineaForm>) => setLineas((p) => p.map((l, j) => (j === i ? { ...l, ...cambios } : l)));

  const imprimir = (c: Pick<CotizacionFila, "folio" | "fecha" | "contraparte" | "obra" | "vigencia_dias" | "condicion_pago" | "dias_credito" | "notas" | "cliente_id" | "created_by_nombre">, ls: LineaCotizacionPlanta[], ventana: Window | null) => {
    const cli = catalogo?.clientes.find((x) => x.id === c.cliente_id);
    const html = htmlCotizacionPlanta(
      {
        ...c,
        empresa_nombre: empresa.nombre,
        empresa_rfc: catalogo?.rfc ?? null,
        elaboro: c.created_by_nombre,
        firma_nombre: c.created_by_nombre,
        membrete: catalogo?.membrete ?? null,
        cliente_rfc: cli?.rfc ?? null,
        cliente_domicilio: cli?.domicilio ?? null,
      },
      ls,
      catalogo?.codigo ? `/logos/${catalogo.codigo.toLowerCase()}.png` : null,
    );
    if (!abrirParaImprimir(html, ventana)) {
      cerrarVentanaImpresion(ventana);
      setAviso("El navegador bloqueó la ventana. Permite ventanas emergentes.");
    }
  };

  const guardar = useMutation({
    mutationFn: async (ventana: Window | null) => {
      if (!cliente.trim()) throw new Error("Indica el cliente.");
      if (lineasCalculo.length === 0) throw new Error("Agrega al menos una partida con cantidad y precio.");
      const { data: cot, error } = await supabase
        .from("cotizaciones_produccion")
        .insert({
          empresa_id: empresa.id,
          contraparte: cliente.trim(),
          cliente_id: clienteId || null,
          obra: obra.trim() || null,
          vigencia_dias: Number(vigencia) > 0 ? Math.round(Number(vigencia)) : 15,
          condicion_pago: condicion || null,
          dias_credito: condicion === "credito" && Number(dias) > 0 ? Math.round(Number(dias)) : null,
          notas: notas.trim() || null,
        })
        .select("id, folio, fecha, contraparte, obra, vigencia_dias, condicion_pago, dias_credito, notas, cliente_id, created_by_nombre")
        .single();
      if (error) throw error;
      const filas = lineas
        .filter((l) => l.descripcion.trim() && Number(l.cantidad) > 0 && l.precio !== "")
        .map((l, i) => ({
          cotizacion_id: cot.id,
          orden: i,
          producto_id: l.productoId || null,
          descripcion: l.descripcion.trim(),
          cantidad: Number(l.cantidad),
          unidad: l.unidad || "pza",
          precio_unitario: conIva ? sinIva(Number(l.precio)) : Number(l.precio),
        }));
      const { error: e2 } = await supabase.from("cotizaciones_produccion_lineas").insert(filas);
      if (e2) throw e2;
      imprimir(cot as CotizacionFila, lineasCalculo, ventana);
      return cot.folio as string;
    },
    onSuccess: (folio) => {
      setAviso(`Cotización ${folio} guardada.`);
      setLineas([{ ...VACIA }]);
      queryClient.invalidateQueries({ queryKey: ["cotizaciones-planta", empresa.id] });
    },
    onError: (e, ventana) => {
      cerrarVentanaImpresion(ventana);
      setAviso((e as Error).message);
    },
  });

  const estatus = useMutation({
    mutationFn: async ({ id, valor }: { id: string; valor: CotizacionFila["estatus"] }) => {
      const { error } = await supabase.from("cotizaciones_produccion").update({ estatus: valor }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cotizaciones-planta", empresa.id] }),
    onError: (e) => setAviso((e as Error).message),
  });

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Nueva cotización</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className={etiqueta}>Cliente</label>
            <input
              list="cotizador-clientes"
              value={cliente}
              onChange={(e) => {
                setCliente(e.target.value);
                setClienteId(catalogo?.clientes.find((c) => c.razon_social === e.target.value)?.id ?? "");
              }}
              className={campo}
              placeholder="Razón social"
            />
            <datalist id="cotizador-clientes">
              {(catalogo?.clientes ?? []).map((c) => (
                <option key={c.id} value={c.razon_social} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={etiqueta}>Obra / destino</label>
            <input value={obra} onChange={(e) => setObra(e.target.value)} className={campo} />
          </div>
          <div>
            <label className={etiqueta}>Vigencia (días)</label>
            <input type="number" min="1" value={vigencia} onChange={(e) => setVigencia(e.target.value)} className={campo} />
          </div>
          <div className="sm:col-span-2">
            <label className={etiqueta}>Pago</label>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {(["contado", "credito"] as const).map((c) => (
                <label key={c} className="flex items-center gap-1">
                  <input type="radio" name="cotizador_pago" checked={condicion === c} onChange={() => setCondicion(c)} />
                  {c === "contado" ? "Contado" : "Crédito"}
                </label>
              ))}
              {condicion === "credito" && <input type="number" min="1" value={dias} onChange={(e) => setDias(e.target.value)} placeholder="días" className="w-20 rounded border border-slate-300 px-2 py-1 text-sm" />}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className={etiqueta}>Notas</label>
            <input value={notas} onChange={(e) => setNotas(e.target.value)} className={campo} placeholder="Tiempo de entrega, flete, etc." />
          </div>
        </div>

        <div className="mt-4 mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className={etiqueta}>
            Partidas
            <label className="ml-3 font-normal">
              <input type="checkbox" checked={conIva} onChange={(e) => setConIva(e.target.checked)} className="mr-1 align-middle" />
              precios con IVA incluido
            </label>
          </span>
          <button type="button" onClick={() => setLineas((p) => [...p, { ...VACIA }])} className="text-xs text-slate-700 underline">
            + Agregar partida
          </button>
        </div>
        <div className="space-y-2">
          {lineas.map((l, i) => {
            const costo = l.productoId ? catalogo?.costos.get(l.productoId) : undefined;
            const pu = l.precio === "" ? null : conIva ? sinIva(Number(l.precio)) : Number(l.precio);
            const m = pu != null && costo?.costo != null ? pu - Number(costo.costo) : null;
            return (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <select
                  value={l.productoId}
                  onChange={(e) => {
                    const p = catalogo?.productos.find((x) => x.id === e.target.value);
                    setLinea(i, { productoId: e.target.value, descripcion: p ? `${p.nombre.trim()}${p.calibre ? ` ${p.calibre}` : ""}` : l.descripcion, unidad: p?.unidad_medida ?? l.unidad });
                  }}
                  className={`${campo} col-span-3`}
                >
                  <option value="">Producto (o texto libre)…</option>
                  {(catalogo?.productos ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre.trim()} {p.calibre ?? ""}
                    </option>
                  ))}
                </select>
                <input value={l.descripcion} onChange={(e) => setLinea(i, { descripcion: e.target.value })} placeholder="Descripción" className={`${campo} col-span-3`} />
                <input type="number" min="0" step="0.01" value={l.cantidad} onChange={(e) => setLinea(i, { cantidad: e.target.value })} className={`${campo} col-span-1`} aria-label="Cantidad" />
                <input value={l.unidad} onChange={(e) => setLinea(i, { unidad: e.target.value })} className={`${campo} col-span-1`} aria-label="Unidad" />
                <input type="number" min="0" step="0.01" value={l.precio} onChange={(e) => setLinea(i, { precio: e.target.value })} placeholder={conIva ? "Precio c/IVA" : "Precio s/IVA"} className={`${campo} col-span-2`} />
                <div className="col-span-1 text-right text-[11px] leading-tight text-slate-500">
                  {veMargen && costo?.costo != null && (
                    <>
                      costo {$(costo.costo)}
                      {m != null && <div className={m < 0 ? "text-red-700" : "text-emerald-700"}>{$(m)} c/u</div>}
                    </>
                  )}
                </div>
                <button type="button" onClick={() => setLineas((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : [{ ...VACIA }]))} className="col-span-1 text-xs text-red-600">
                  Quitar
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div className="text-sm">
            <div>
              Subtotal {$(t.subtotal)} · IVA {$(t.iva)} · <b>Total {$(t.total)}</b>
            </div>
            {veMargen && t.margen != null && (
              <div className={t.margen < 0 ? "text-red-700" : "text-emerald-700"}>
                Margen contra costo real: {$(t.margen)} ({t.margenPct?.toFixed(1)} %){t.sinCosto ? ` · ${t.sinCosto} partida(s) sin costo` : ""} — solo lo ves tú, no sale impreso.
              </div>
            )}
          </div>
          <button type="button" onClick={() => guardar.mutate(abrirVentanaImpresion())} disabled={guardar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {guardar.isPending ? "Guardando…" : "Guardar e imprimir cotización"}
          </button>
        </div>
        {aviso && <p className="mt-2 text-sm text-slate-700">{aviso}</p>}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Cotizaciones</h2>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Folio</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2 text-right">Total</th>
                {veMargen && <th className="px-3 py-2 text-right">Margen</th>}
                <th className="px-3 py-2">Estatus</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {historial.map((c) => {
                const ls = [...c.cotizaciones_produccion_lineas].sort((a, b) => a.orden - b.orden);
                const tt = totalesCotizacion(ls);
                return (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <span className="font-mono">{c.folio}</span> <span className="text-xs text-slate-500">{c.fecha}</span>
                    </td>
                    <td className="px-3 py-2">{c.contraparte}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{$(tt.total)}</td>
                    {veMargen && <td className={`px-3 py-2 text-right tabular-nums ${tt.margen != null && tt.margen < 0 ? "text-red-700" : ""}`}>{tt.margen == null ? "—" : `${$(tt.margen)} (${tt.margenPct?.toFixed(1)} %)`}</td>}
                    <td className="px-3 py-2">
                      <select value={c.estatus} onChange={(e) => estatus.mutate({ id: c.id, valor: e.target.value as CotizacionFila["estatus"] })} className="rounded border border-slate-300 px-1 py-0.5 text-xs">
                        <option value="enviada">enviada</option>
                        <option value="aceptada">aceptada</option>
                        <option value="rechazada">rechazada</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => imprimir(c, ls, abrirVentanaImpresion())} className="text-xs text-slate-600 underline">
                        imprimir
                      </button>
                    </td>
                  </tr>
                );
              })}
              {historial.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                    Sin cotizaciones todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
