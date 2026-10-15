import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";
import { BotonVerOv } from "./VerOrdenVenta";
import { CampoBuscador } from "../../components/CampoBuscador";
import { detalleContraparte, detalleItem, fechaCortaCatalogo, filtrarContrapartes, filtrarItems, filtrarObras, normalizarBusqueda, tienePartidas, type ContraparteCatalogo, type ItemCatalogo, type ObraCatalogo } from "../../lib/buscadorCaptura";
import {
  FORMAS_PAGO,
  importePartida,
  infoTipo,
  partidaVacia,
  partidasParaGuardar,
  revisarOrden,
  totalesPartidas,
  type PartidaCaptura,
  type TipoOrden,
} from "../../lib/ordenesIa";

const dinero = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });
const hoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
const campo = "w-full rounded border border-slate-300 px-2 py-1.5 text-sm";

interface Encabezado {
  empresaId: string;
  contraparte: string;
  proyecto: string;
  fecha: string;
  formaPago: string;
  condicion: string;
  fechaEntrega: string;
  lugarEntrega: string;
  notas: string;
}

/** Captura y edición de una OC / OS / OV con folio IA. */
export function EditorOrden({
  tipo,
  id,
  empresaInicial,
  onCerrar,
  onGuardada,
}: {
  tipo: TipoOrden;
  id: string | null;
  empresaInicial: string;
  onCerrar: () => void;
  onGuardada: () => void;
}) {
  const info = infoTipo(tipo);
  const [enc, setEnc] = useState<Encabezado>({
    empresaId: empresaInicial,
    contraparte: "",
    proyecto: "",
    fecha: hoy(),
    formaPago: tipo === "OV" ? "" : FORMAS_PAGO[0],
    condicion: "",
    fechaEntrega: "",
    lugarEntrega: "",
    notas: "",
  });
  const [tipoOrden, setTipoOrden] = useState<TipoOrden>(tipo);
  const [partidas, setPartidas] = useState<PartidaCaptura[]>([partidaVacia()]);
  const [errores, setErrores] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [guardada, setGuardada] = useState<{ id: string; folio: string; total: number } | null>(null);
  const [cargado, setCargado] = useState(id == null);

  // Editar: carga la orden y sus partidas.
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    (async () => {
      if (tipo === "OV") {
        const { data: o } = await supabase.from("ordenes_venta").select("empresa_id, cliente, proyecto, fecha_ov, forma_pago, condicion_pago, fecha_entrega, lugar_entrega, notas").eq("id", id).maybeSingle();
        const { data: l } = await supabase.from("ordenes_venta_lineas").select("concepto, unidad, cantidad, precio_base, iva").eq("orden_venta_id", id).order("numero");
        if (!vivo || !o) return;
        setEnc({ empresaId: o.empresa_id, contraparte: o.cliente ?? "", proyecto: o.proyecto ?? "", fecha: o.fecha_ov ?? hoy(), formaPago: o.forma_pago ?? "", condicion: o.condicion_pago ?? "", fechaEntrega: o.fecha_entrega ?? "", lugarEntrega: o.lugar_entrega ?? "", notas: o.notas ?? "" });
        setPartidas([...(l ?? []).map((x) => ({ item: x.concepto ?? "", unidad: x.unidad ?? "", cantidad: x.cantidad ?? "", costo: x.precio_base ?? "", iva: x.iva ?? true })), partidaVacia()]);
      } else {
        const { data: o } = await supabase.from("ordenes_compra").select("empresa_id, tipo, proveedor, proyecto, fecha_creacion, tipo_pago_backoffice, condicion_pago, fecha_entrega, lugar_entrega, notas").eq("id", id).maybeSingle();
        const { data: l } = await supabase.from("ordenes_compra_lineas").select("item, unidad, cantidad, costo, iva").eq("orden_compra_id", id).order("numero");
        if (!vivo || !o) return;
        setTipoOrden(o.tipo as TipoOrden);
        setEnc({ empresaId: o.empresa_id, contraparte: o.proveedor ?? "", proyecto: o.proyecto ?? "", fecha: o.fecha_creacion ?? hoy(), formaPago: o.tipo_pago_backoffice ?? "", condicion: o.condicion_pago ?? "", fechaEntrega: o.fecha_entrega ?? "", lugarEntrega: o.lugar_entrega ?? "", notas: o.notas ?? "" });
        setPartidas([...(l ?? []).map((x) => ({ item: x.item ?? "", unidad: x.unidad ?? "", cantidad: x.cantidad ?? "", costo: x.costo ?? "", iva: x.iva ?? true })), partidaVacia()]);
      }
      setCargado(true);
    })();
    return () => {
      vivo = false;
    };
  }, [id, tipo]);

  // Buscador (Mario, 15-oct-2026): proveedores/clientes de todas las órdenes
  // que quien captura puede ver y cada partida ya comprada/vendida con su
  // unidad y último precio s/IVA (fn_ordenes_catalogo_captura), más las obras.
  const catalogo = useQuery({
    queryKey: ["ordenes-ia-catalogo", tipo === "OV", enc.empresaId],
    enabled: !!enc.empresaId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const cat = await supabase.rpc("fn_ordenes_catalogo_captura", { p_venta: tipo === "OV", p_empresa: enc.empresaId });
      if (cat.error) throw cat.error;
      const j = (cat.data ?? {}) as { contrapartes?: ContraparteCatalogo[]; items?: ItemCatalogo[]; obras?: ObraCatalogo[] };
      return { contrapartes: j.contrapartes ?? [], items: j.items ?? [], obras: j.obras ?? [] };
    },
  });
  const [partidaBuscando, setPartidaBuscando] = useState<number | null>(null);
  const opcionesContraparte = filtrarContrapartes(catalogo.data?.contrapartes ?? [], enc.contraparte, 40).filter((c) => normalizarBusqueda(c.nombre) !== normalizarBusqueda(enc.contraparte) || enc.contraparte === "");
  const opcionesObra = filtrarObras(catalogo.data?.obras ?? [], enc.proyecto);
  // Con proveedor elegido solo se ven SUS partidas (Mario, 15-oct-2026: "para
  // no ver todo el universo"); la casilla abre las de todos.
  const [todosProveedores, setTodosProveedores] = useState(false);
  const conPartidas = tienePartidas(catalogo.data?.items ?? [], enc.contraparte);
  const itemsDe = (texto: string) => filtrarItems(catalogo.data?.items ?? [], texto, enc.contraparte, 12, !todosProveedores);

  function cambiar(i: number, cambio: Partial<PartidaCaptura>) {
    setPartidas((ps) => {
      const nuevas = ps.map((p, j) => (j === i ? { ...p, ...cambio } : p));
      // Siempre queda un renglón vacío al final para seguir capturando.
      const ultimo = nuevas[nuevas.length - 1];
      if (ultimo.item.trim() || String(ultimo.cantidad).trim() || String(ultimo.costo).trim()) nuevas.push(partidaVacia());
      return nuevas;
    });
  }

  // Elegir una partida del buscador: descripción, unidad y último precio
  // s/IVA (sin pisar lo que ya se escribió en unidad o precio).
  function elegirItem(i: number, item: ItemCatalogo) {
    const p = partidas[i];
    cambiar(i, {
      item: item.descripcion,
      unidad: p.unidad || item.unidad || "",
      costo: p.costo === "" && item.precio != null ? Number(item.precio) : p.costo,
      iva: item.iva ?? p.iva,
    });
  }

  async function guardar() {
    const problemas = revisarOrden({ contraparte: enc.contraparte, empresaId: enc.empresaId, partidas }, tipoOrden);
    setErrores(problemas);
    if (problemas.length) return;
    setGuardando(true);
    const { data, error } = await supabase.rpc("fn_orden_ia_guardar", {
      p_id: id,
      p_tipo: tipoOrden,
      p_empresa: enc.empresaId,
      p_contraparte: enc.contraparte,
      p_proyecto: enc.proyecto || null,
      p_fecha: enc.fecha || null,
      p_lineas: partidasParaGuardar(partidas),
      p_forma_pago: enc.formaPago || null,
      p_condicion: enc.condicion || null,
      p_fecha_entrega: enc.fechaEntrega || null,
      p_lugar_entrega: enc.lugarEntrega || null,
      p_notas: enc.notas || null,
    });
    setGuardando(false);
    if (error) {
      setErrores([error.message]);
      return;
    }
    const r = data as { id: string; folio: string; total: number };
    setGuardada(r);
    onGuardada();
  }

  const t = totalesPartidas(partidas);

  if (guardada) {
    return (
      <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm text-emerald-900">
          Orden <b className="font-mono">{guardada.folio}</b> guardada por {dinero(Number(guardada.total))} con IVA.
          {tipoOrden !== "OV" && " Ya está en \"Órdenes por autorizar\" de dirección."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {tipoOrden === "OV" ? <BotonVerOv ovId={guardada.id} etiqueta="Imprimir orden" /> : <BotonVerOc ocId={guardada.id} etiqueta="Imprimir orden" />}
          <button type="button" onClick={onCerrar} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700">
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded border border-slate-300 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{id ? "Editar orden" : `Nueva ${info.titulo.toLowerCase()}`}</h2>
        <button type="button" onClick={onCerrar} className="text-xs text-slate-500 hover:underline">
          Cerrar
        </button>
      </div>
      {!cargado ? (
        <p className="text-sm text-slate-500">Cargando…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-slate-600">
              Empresa
              <div className="mt-1">
                {id ? (
                  <span className="text-sm text-slate-800">(no se cambia al editar)</span>
                ) : (
                  <SelectorEmpresa value={enc.empresaId} onChange={(v) => setEnc({ ...enc, empresaId: v })} vacio="Selecciona…" className={campo} />
                )}
              </div>
            </label>
            {tipo !== "OV" && (
              <label className="text-xs text-slate-600">
                Tipo
                <select value={tipoOrden} onChange={(e) => setTipoOrden(e.target.value as TipoOrden)} className={`mt-1 ${campo}`}>
                  <option value="OC">Orden de compra (material)</option>
                  <option value="OS">Orden de servicio</option>
                </select>
              </label>
            )}
            <label className="text-xs text-slate-600 lg:col-span-2">
              {info.contraparte}
              <CampoBuscador
                value={enc.contraparte}
                onChange={(v) => setEnc({ ...enc, contraparte: v })}
                opciones={opcionesContraparte.map((c) => ({ clave: c.nombre, titulo: c.nombre, detalle: detalleContraparte(c) }))}
                onElegir={(nombre) => setEnc({ ...enc, contraparte: nombre })}
                placeholder={catalogo.isLoading ? "Cargando…" : `Busca por nombre o RFC (${catalogo.data?.contrapartes.length ?? 0})`}
                vacio={`Nuevo ${info.contraparte.toLowerCase()}: se guarda como lo escribiste`}
                className={`mt-1 ${campo}`}
              />
            </label>
            <label className="text-xs text-slate-600 lg:col-span-2">
              Proyecto / obra
              <CampoBuscador
                value={enc.proyecto}
                onChange={(v) => setEnc({ ...enc, proyecto: v })}
                opciones={opcionesObra.map((o) => ({ clave: o.nombre, titulo: o.nombre, detalle: [o.veces ? `${o.veces} partidas en órdenes` : "proyecto dado de alta", o.ultima ? `última ${fechaCortaCatalogo(o.ultima)}` : null].filter(Boolean).join(" · ") }))}
                onElegir={(o) => setEnc({ ...enc, proyecto: o })}
                placeholder="Busca la obra"
                className={`mt-1 ${campo}`}
              />
            </label>
            <label className="text-xs text-slate-600">
              Fecha
              <input type="date" value={enc.fecha} onChange={(e) => setEnc({ ...enc, fecha: e.target.value })} className={`mt-1 ${campo}`} />
            </label>
            <label className="text-xs text-slate-600">
              Forma de pago
              <select value={enc.formaPago} onChange={(e) => setEnc({ ...enc, formaPago: e.target.value })} className={`mt-1 ${campo}`}>
                <option value="">—</option>
                {FORMAS_PAGO.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Condición
              <select value={enc.condicion} onChange={(e) => setEnc({ ...enc, condicion: e.target.value })} className={`mt-1 ${campo}`}>
                <option value="">{tipo === "OV" ? "—" : "la define dirección"}</option>
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
                <option value="anticipo">Anticipo</option>
                <option value="efectivo">Efectivo</option>
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Fecha de entrega
              <input type="date" value={enc.fechaEntrega} onChange={(e) => setEnc({ ...enc, fechaEntrega: e.target.value })} className={`mt-1 ${campo}`} />
            </label>
            <label className="text-xs text-slate-600 lg:col-span-2">
              Lugar de entrega
              <input value={enc.lugarEntrega} onChange={(e) => setEnc({ ...enc, lugarEntrega: e.target.value })} placeholder="bodega, obra, domicilio del cliente…" className={`mt-1 ${campo}`} />
            </label>
            <label className="text-xs text-slate-600 lg:col-span-2">
              Notas
              <input value={enc.notas} onChange={(e) => setEnc({ ...enc, notas: e.target.value })} className={`mt-1 ${campo}`} />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
            {enc.contraparte.trim() && (
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={todosProveedores} onChange={(e) => setTodosProveedores(e.target.checked)} />
                buscar partidas de todos los {tipo === "OV" ? "clientes" : "proveedores"}
              </label>
            )}
            {enc.contraparte.trim() && !todosProveedores && catalogo.data && !conPartidas && (
              <span className="text-amber-700">Este {info.contraparte.toLowerCase()} aún no tiene partidas: escríbelas o busca en todos.</span>
            )}
            {tipo !== "OV" && (
              <a href="/compras/catalogo" target="_blank" rel="noreferrer" className="ml-auto underline">
                Dar de alta proveedor o artículos
              </a>
            )}
          </div>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 pr-2">#</th>
                  <th className="py-1 pr-2">Descripción</th>
                  <th className="py-1 pr-2">Unidad</th>
                  <th className="py-1 pr-2 text-right">Cantidad</th>
                  <th className="py-1 pr-2 text-right">{info.importe}</th>
                  <th className="py-1 pr-2 text-center">IVA</th>
                  <th className="py-1 pr-2 text-right">Importe</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {partidas.map((p, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1 pr-2 text-xs text-slate-400">{i + 1}</td>
                    <td className="py-1 pr-2">
                      <CampoBuscador
                        value={p.item}
                        onChange={(v) => {
                          setPartidaBuscando(i);
                          cambiar(i, { item: v });
                        }}
                        opciones={(partidaBuscando === i || p.item === "" ? itemsDe(p.item) : []).map((x, k) => ({ clave: String(k), titulo: x.descripcion, detalle: detalleItem(x, tipo === "OV") }))}
                        onElegir={(k) => {
                          const x = itemsDe(p.item)[Number(k)];
                          if (x) elegirItem(i, x);
                          setPartidaBuscando(null);
                        }}
                        placeholder={i === 0 && p.item === "" ? (enc.contraparte ? `Busca o elige lo que le ${tipo === "OV" ? "vendes" : "compras"}` : "Busca material o servicio") : ""}
                        className="w-full min-w-[16rem] rounded border border-slate-200 px-1.5 py-1"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input value={p.unidad} onChange={(e) => cambiar(i, { unidad: e.target.value })} className="w-20 rounded border border-slate-200 px-1.5 py-1" />
                    </td>
                    <td className="py-1 pr-2 text-right">
                      <input type="number" min="0" step="any" value={p.cantidad} onChange={(e) => cambiar(i, { cantidad: e.target.value })} className="w-24 rounded border border-slate-200 px-1.5 py-1 text-right" />
                    </td>
                    <td className="py-1 pr-2 text-right">
                      <input type="number" min="0" step="0.01" value={p.costo} onChange={(e) => cambiar(i, { costo: e.target.value })} className="w-28 rounded border border-slate-200 px-1.5 py-1 text-right" />
                    </td>
                    <td className="py-1 pr-2 text-center">
                      <input type="checkbox" checked={p.iva} onChange={(e) => cambiar(i, { iva: e.target.checked })} />
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{dinero(importePartida(p))}</td>
                    <td className="py-1">
                      {partidas.length > 1 && i < partidas.length - 1 && (
                        <button type="button" onClick={() => setPartidas((ps) => ps.filter((_, j) => j !== i))} className="text-xs text-red-600">
                          quitar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                <tr>
                  <td colSpan={6} className="pt-2 text-right text-slate-500">Subtotal</td>
                  <td className="pt-2 text-right tabular-nums">{dinero(t.subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={6} className="text-right text-slate-500">IVA 16 %</td>
                  <td className="text-right tabular-nums">{dinero(t.iva)}</td>
                </tr>
                <tr>
                  <td colSpan={6} className="text-right font-semibold">Total</td>
                  <td className="text-right font-semibold tabular-nums">{dinero(t.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {errores.length > 0 && (
            <ul className="mt-3 list-disc rounded bg-red-50 px-6 py-2 text-sm text-red-700">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onCerrar} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700">
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={guardando} className="rounded bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {guardando ? "Guardando…" : id ? "Guardar cambios" : `Guardar y sacar folio IA-${tipoOrden}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
