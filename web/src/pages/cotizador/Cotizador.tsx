import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import { CampoBuscador } from "../../components/CampoBuscador";
import { abrirParaImprimir, abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import { htmlCotizacionPlanta, sinIva, totalesCotizacion, type LineaCotizacionPlanta } from "../../lib/cotizacionPlanta";
import { buscarProductos, detalleProducto, lineasParaOrdenVenta, type ProductoCotizador } from "../../lib/cotizador";
import { detalleContraparte, filtrarContrapartes, normalizarBusqueda, type ContraparteCatalogo } from "../../lib/buscadorCaptura";
import { BotonVerOv } from "../ordenes/VerOrdenVenta";
import { useCatalogoCotizador, useEmpresaCotizadora } from "./datosCotizador";
import { logoDeEmpresa } from "../../lib/logoEmpresaCargar";

const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";
const etiqueta = "mb-1 block text-xs font-medium text-slate-700";
const $ = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN" }));
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

interface LineaForm {
  descripcion: string;
  cantidad: string;
  unidad: string;
  precio: string;
  costo: number | null;
  productoPlantaId: string | null;
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
  orden_venta_id: string | null;
  cotizaciones_produccion_lineas: (LineaCotizacionPlanta & { orden: number })[];
}

const VACIA: LineaForm = { descripcion: "", cantidad: "1", unidad: "pza", precio: "", costo: null, productoPlantaId: null };

/** Cotizador de cualquier empresa (Mario, 15-oct-2026): misma lógica que el de
 * Clavicón (precio con IVA incluido, margen interno contra el costo,
 * impresión membretada sin costos); productos de la planta, del catálogo y
 * lo ya vendido; clientes compartidos de todas las empresas; y de una
 * cotización aceptada sale la orden de venta. */
export function Cotizador() {
  const { perfil, soloConsulta } = useAuth();
  const queryClient = useQueryClient();
  const [empresaFiltro] = useEmpresaFiltro();
  const [empresaId, setEmpresaId] = useState(empresaFiltro);
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
  const [buscando, setBuscando] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [altaCliente, setAltaCliente] = useState(false);

  const { data: empresa } = useEmpresaCotizadora(empresaId);
  const { data: catalogo, isLoading: cargandoCatalogo } = useCatalogoCotizador(empresaId);

  const { data: historial = [] } = useQuery({
    queryKey: ["cotizaciones-empresa", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cotizaciones_produccion")
        .select("id, folio, fecha, contraparte, obra, vigencia_dias, condicion_pago, dias_credito, notas, cliente_id, estatus, created_by_nombre, orden_venta_id, cotizaciones_produccion_lineas(orden, descripcion, cantidad, unidad, precio_unitario, costo_unitario)")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as CotizacionFila[];
    },
  });

  const lineasCalculo: LineaCotizacionPlanta[] = useMemo(
    () =>
      lineas
        .filter((l) => l.descripcion.trim() && Number(l.cantidad) > 0 && l.precio !== "")
        .map((l) => ({ descripcion: l.descripcion.trim(), cantidad: Number(l.cantidad), unidad: l.unidad || "pza", precio_unitario: conIva ? sinIva(Number(l.precio)) : Number(l.precio), costo_unitario: l.costo })),
    [lineas, conIva],
  );
  const t = totalesCotizacion(lineasCalculo);
  const setLinea = (i: number, cambios: Partial<LineaForm>) => setLineas((p) => p.map((l, j) => (j === i ? { ...l, ...cambios } : l)));

  function elegirProducto(i: number, p: ProductoCotizador) {
    const l = lineas[i];
    setLinea(i, {
      descripcion: p.descripcion,
      unidad: p.unidad,
      costo: p.costo,
      productoPlantaId: p.productoPlantaId,
      precio: l.precio !== "" || p.precio == null ? l.precio : String(Math.round((conIva ? p.precio * 1.16 : p.precio) * 100) / 100),
    });
    setBuscando(null);
  }

  // Clientes: los registrados de todas las empresas (compartidos) + los de
  // órdenes de venta de esta empresa.
  const opcionesCliente = useMemo(() => {
    const registrados: ContraparteCatalogo[] = (catalogo?.clientes ?? []).map((c) => ({ nombre: c.razon_social, rfc: c.rfc, veces: 0, ultima: null, misma_empresa: c.empresa_id === empresaId, ficha: true }));
    const vistos = new Set(registrados.map((r) => normalizarBusqueda(r.nombre)));
    const otros = (catalogo?.contrapartes ?? []).filter((c) => !vistos.has(normalizarBusqueda(c.nombre)));
    return filtrarContrapartes([...registrados, ...otros], cliente, 40).filter((c) => normalizarBusqueda(c.nombre) !== normalizarBusqueda(cliente) || cliente === "");
  }, [catalogo, cliente, empresaId]);

  const imprimir = async (c: Pick<CotizacionFila, "folio" | "fecha" | "contraparte" | "obra" | "vigencia_dias" | "condicion_pago" | "dias_credito" | "notas" | "cliente_id" | "created_by_nombre">, ls: LineaCotizacionPlanta[], ventana: Window | null) => {
    const cli = catalogo?.clientes.find((x) => x.id === c.cliente_id) ?? catalogo?.clientes.find((x) => normalizarBusqueda(x.razon_social) === normalizarBusqueda(c.contraparte));
    const html = htmlCotizacionPlanta(
      {
        ...c,
        empresa_nombre: empresa?.nombre ?? "",
        empresa_rfc: empresa?.rfc ?? null,
        elaboro: c.created_by_nombre,
        firma_nombre: c.created_by_nombre,
        membrete: empresa?.membrete ?? null,
        cliente_rfc: cli?.rfc ?? null,
        cliente_domicilio: cli ? [cli.domicilio, cli.codigo_postal ? `C.P. ${cli.codigo_postal}` : null].filter(Boolean).join(", ") || null : null,
      },
      ls,
      await logoDeEmpresa(empresa?.codigo),
    );
    if (!abrirParaImprimir(html, ventana)) {
      cerrarVentanaImpresion(ventana);
      setAviso("El navegador bloqueó la ventana. Permite ventanas emergentes.");
    }
  };

  const guardar = useMutation({
    mutationFn: async (ventana: Window | null) => {
      if (!empresaId) throw new Error("Elige la empresa que cotiza.");
      if (!cliente.trim()) throw new Error("Indica el cliente.");
      if (lineasCalculo.length === 0) throw new Error("Agrega al menos una partida con cantidad y precio.");
      const { data: cot, error } = await supabase
        .from("cotizaciones_produccion")
        .insert({
          empresa_id: empresaId,
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
          producto_id: l.productoPlantaId,
          descripcion: l.descripcion.trim(),
          cantidad: Number(l.cantidad),
          unidad: l.unidad || "pza",
          precio_unitario: conIva ? sinIva(Number(l.precio)) : Number(l.precio),
          costo_unitario: l.costo,
        }));
      const { error: e2 } = await supabase.from("cotizaciones_produccion_lineas").insert(filas);
      if (e2) throw e2;
      imprimir(cot as CotizacionFila, lineasCalculo, ventana);
      return cot.folio as string;
    },
    onSuccess: (folio) => {
      setAviso(`Cotización ${folio} guardada.`);
      setLineas([{ ...VACIA }]);
      queryClient.invalidateQueries({ queryKey: ["cotizaciones-empresa", empresaId] });
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["cotizaciones-empresa", empresaId] }),
    onError: (e) => setAviso((e as Error).message),
  });

  // Cotización aceptada → orden de venta IA con las mismas partidas.
  const convertir = useMutation({
    mutationFn: async (c: CotizacionFila) => {
      if (!window.confirm(`¿Generar la orden de venta de la cotización ${c.folio} para ${c.contraparte}?`)) return null;
      const ls = [...c.cotizaciones_produccion_lineas].sort((a, b) => a.orden - b.orden);
      const { data, error } = await supabase.rpc("fn_orden_ia_guardar", {
        p_id: null,
        p_tipo: "OV",
        p_empresa: empresaId,
        p_contraparte: c.contraparte,
        p_proyecto: c.obra,
        p_fecha: hoy(),
        p_lineas: lineasParaOrdenVenta(ls),
        p_forma_pago: null,
        p_condicion: c.condicion_pago,
        p_fecha_entrega: null,
        p_lugar_entrega: null,
        p_notas: [`De la cotización ${c.folio}`, c.condicion_pago === "credito" && c.dias_credito ? `crédito a ${c.dias_credito} días` : null, c.notas].filter(Boolean).join(" · "),
      });
      if (error) throw error;
      const ov = data as { id: string; folio: string };
      const { error: e2 } = await supabase.from("cotizaciones_produccion").update({ orden_venta_id: ov.id, estatus: "aceptada" }).eq("id", c.id);
      if (e2) throw e2;
      return ov.folio;
    },
    onSuccess: (folio) => {
      if (!folio) return;
      setAviso(`Orden de venta ${folio} generada; ya está en Compras → Órdenes de venta.`);
      queryClient.invalidateQueries({ queryKey: ["cotizaciones-empresa", empresaId] });
      queryClient.invalidateQueries({ queryKey: ["ordenes-ia"] });
    },
    onError: (e) => setAviso((e as Error).message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Cotizador</h1>
          <p className="text-sm text-slate-500">Cotiza a clientes con los productos de la empresa; el margen contra el costo solo lo ves tú y no sale impreso. Aceptada, se convierte en orden de venta.</p>
        </div>
        <label className="text-xs text-slate-600">
          Empresa que cotiza
          <div className="mt-1 w-64">
            <SelectorEmpresa value={empresaId} onChange={(v) => setEmpresaId(v)} vacio="Selecciona…" className={campo} />
          </div>
        </label>
      </div>

      {!empresaId ? (
        <p className="rounded border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">Elige la empresa que cotiza.</p>
      ) : (
        <>
          {!soloConsulta && (
            <section className="rounded border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Nueva cotización · {empresa?.nombre ?? ""}</h2>
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className={etiqueta}>
                    Cliente
                    <button type="button" onClick={() => setAltaCliente((v) => !v)} className="ml-2 font-normal text-slate-600 underline">
                      {altaCliente ? "cerrar alta" : "+ dar de alta cliente"}
                    </button>
                  </label>
                  <CampoBuscador
                    value={cliente}
                    onChange={(v) => {
                      setCliente(v);
                      setClienteId("");
                    }}
                    opciones={opcionesCliente.map((c) => ({ clave: c.nombre, titulo: c.nombre, detalle: detalleContraparte(c) }))}
                    onElegir={(nombre) => {
                      setCliente(nombre);
                      const cli = catalogo?.clientes.filter((x) => normalizarBusqueda(x.razon_social) === normalizarBusqueda(nombre));
                      setClienteId((cli?.find((x) => x.empresa_id === empresaId) ?? cli?.[0])?.id ?? "");
                    }}
                    placeholder={cargandoCatalogo ? "Cargando…" : "Busca por nombre o RFC"}
                    vacio="Cliente nuevo: se guarda como lo escribiste (o dalo de alta)"
                    className={campo}
                  />
                </div>
                <div>
                  <label className={etiqueta}>Obra / destino</label>
                  <input value={obra} onChange={(e) => setObra(e.target.value)} className={campo} />
                </div>
                <div>
                  <label className={etiqueta}>Vigencia (días)</label>
                  <input type="number" min="1" value={vigencia} onChange={(e) => setVigencia(e.target.value)} className={campo} />
                </div>
                {altaCliente && (
                  <AltaCliente
                    empresaId={empresaId}
                    nombreInicial={cliente}
                    onListo={(c) => {
                      setAltaCliente(false);
                      setCliente(c.razon_social);
                      setClienteId(c.id);
                      queryClient.invalidateQueries({ queryKey: ["cotizador-productos", empresaId] });
                    }}
                  />
                )}
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
                  Partidas ({catalogo?.productos.length ?? 0} productos de la empresa)
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
                  const pu = l.precio === "" ? null : conIva ? sinIva(Number(l.precio)) : Number(l.precio);
                  const m = pu != null && l.costo != null ? pu - Number(l.costo) : null;
                  const sugeridos = buscando === i ? buscarProductos(catalogo?.productos ?? [], l.descripcion) : [];
                  return (
                    <div key={i} className="grid grid-cols-12 items-center gap-2">
                      <div className="col-span-12 sm:col-span-5">
                        <CampoBuscador
                          value={l.descripcion}
                          onChange={(v) => {
                            setBuscando(i);
                            setLinea(i, { descripcion: v, productoPlantaId: null, costo: null });
                          }}
                          opciones={sugeridos.map((p) => ({ clave: p.clave, titulo: p.descripcion, detalle: detalleProducto(p, conIva, veMargen) }))}
                          onElegir={(k) => {
                            const p = catalogo?.productos.find((x) => x.clave === k);
                            if (p) elegirProducto(i, p);
                          }}
                          placeholder="Busca producto o escribe la descripción"
                          className={campo}
                        />
                      </div>
                      <input type="number" min="0" step="0.01" value={l.cantidad} onChange={(e) => setLinea(i, { cantidad: e.target.value })} className={`${campo} col-span-3 sm:col-span-1`} aria-label="Cantidad" />
                      <input value={l.unidad} onChange={(e) => setLinea(i, { unidad: e.target.value })} className={`${campo} col-span-3 sm:col-span-1`} aria-label="Unidad" />
                      <input type="number" min="0" step="0.01" value={l.precio} onChange={(e) => setLinea(i, { precio: e.target.value })} placeholder={conIva ? "Precio c/IVA" : "Precio s/IVA"} className={`${campo} col-span-4 sm:col-span-2`} />
                      <div className="col-span-10 text-right text-[11px] leading-tight text-slate-500 sm:col-span-2">
                        {veMargen && l.costo != null && (
                          <>
                            costo {conIva ? "c/IVA" : "s/IVA"} {$(Number(l.costo) * (conIva ? 1.16 : 1))}
                            {m != null && <div className={m < 0 ? "text-red-700" : "text-emerald-700"}>margen {$(m)} s/IVA c/u ({pu ? ((m / pu) * 100).toFixed(1) : "0"} %)</div>}
                          </>
                        )}
                      </div>
                      <button type="button" onClick={() => setLineas((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : [{ ...VACIA }]))} className="col-span-2 text-xs text-red-600 sm:col-span-1">
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
                      Margen contra costo: {$(t.margen)} ({t.margenPct?.toFixed(1)} %){t.sinCosto ? ` · ${t.sinCosto} partida(s) sin costo` : ""} — solo lo ves tú, no sale impreso.
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => guardar.mutate(abrirVentanaImpresion())} disabled={guardar.isPending} className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {guardar.isPending ? "Guardando…" : "Guardar e imprimir cotización"}
                </button>
              </div>
              {aviso && <p className="mt-2 text-sm text-slate-700">{aviso}</p>}
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Cotizaciones de {empresa?.nombre ?? ""}</h2>
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
                        <td className="px-3 py-2">
                          {c.contraparte}
                          {c.obra && <div className="text-xs text-slate-400">{c.obra}</div>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{$(tt.total)}</td>
                        {veMargen && <td className={`px-3 py-2 text-right tabular-nums ${tt.margen != null && tt.margen < 0 ? "text-red-700" : ""}`}>{tt.margen == null ? "—" : `${$(tt.margen)} (${tt.margenPct?.toFixed(1)} %)`}</td>}
                        <td className="px-3 py-2">
                          <select value={c.estatus} disabled={soloConsulta} onChange={(e) => estatus.mutate({ id: c.id, valor: e.target.value as CotizacionFila["estatus"] })} className="rounded border border-slate-300 px-1 py-0.5 text-xs">
                            <option value="enviada">enviada</option>
                            <option value="aceptada">aceptada</option>
                            <option value="rechazada">rechazada</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button type="button" onClick={() => imprimir(c, ls, abrirVentanaImpresion())} className="text-xs text-slate-600 underline">
                              imprimir
                            </button>
                            {c.orden_venta_id ? (
                              <BotonVerOv ovId={c.orden_venta_id} etiqueta="ver OV" />
                            ) : (
                              !soloConsulta &&
                              c.estatus !== "rechazada" && (
                                <button type="button" onClick={() => convertir.mutate(c)} disabled={convertir.isPending} className="rounded border border-emerald-300 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
                                  Convertir en orden de venta
                                </button>
                              )
                            )}
                          </div>
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
        </>
      )}
    </div>
  );
}

/** Alta rápida de cliente (queda en el catálogo compartido de clientes). */
function AltaCliente({ empresaId, nombreInicial, onListo }: { empresaId: string; nombreInicial: string; onListo: (c: { id: string; razon_social: string }) => void }) {
  const { perfil } = useAuth();
  const [v, setV] = useState({ razon_social: nombreInicial, rfc: "", domicilio: "", codigo_postal: "", email: "", telefono: "" });
  const [error, setError] = useState<string | null>(null);
  const guardar = useMutation({
    mutationFn: async () => {
      if (!v.razon_social.trim()) throw new Error("Escribe la razón social.");
      const rfc = v.rfc.trim().toUpperCase();
      if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) throw new Error("El RFC no tiene el formato correcto (12 o 13 caracteres).");
      const { data, error: e } = await supabase
        .from("clientes")
        .insert({ empresa_id: empresaId, razon_social: v.razon_social.trim(), rfc: rfc || null, domicilio: v.domicilio.trim() || null, codigo_postal: v.codigo_postal.trim() || null, email: v.email.trim() || null, telefono: v.telefono.trim() || null, created_by: perfil?.id })
        .select("id, razon_social")
        .single();
      if (e) throw e;
      return data as { id: string; razon_social: string };
    },
    onSuccess: onListo,
    onError: (e: Error) => setError(e.message),
  });
  const input = (k: keyof typeof v, t: string, extra = "") => (
    <label className={`text-xs text-slate-600 ${extra}`}>
      {t}
      <input value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className={`mt-1 ${campo}`} />
    </label>
  );
  return (
    <div className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 sm:col-span-4 sm:grid-cols-4">
      {input("razon_social", "Razón social", "sm:col-span-2")}
      {input("rfc", "RFC")}
      {input("telefono", "Teléfono")}
      {input("domicilio", "Domicilio fiscal", "sm:col-span-2")}
      {input("codigo_postal", "C.P.")}
      {input("email", "Correo")}
      <div className="flex items-center gap-3 sm:col-span-4">
        <button type="button" onClick={() => guardar.mutate()} disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {guardar.isPending ? "Guardando…" : "Guardar cliente"}
        </button>
        <span className="text-xs text-slate-500">Queda en el catálogo de clientes de todas las empresas.</span>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
