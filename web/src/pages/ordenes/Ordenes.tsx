import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa, useEmpresasAlcance } from "../../components/SelectorEmpresa";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";
import { BotonVerOv } from "./VerOrdenVenta";
import { EditorOrden } from "./EditorOrden";
import { VentaInterempresa } from "./VentaInterempresa";
import { csvOrdenes, csvOrdenesConDetalle, etapaOrdenCompra, type LineaExcelOrden, infoTipo, ordenEditable, type TipoOrden } from "../../lib/ordenesIa";
import { descargarCsv } from "../../lib/descargarArchivo";

const dinero = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 2 });

const TONOS: Record<string, string> = {
  gris: "bg-slate-100 text-slate-600",
  rojo: "bg-red-100 text-red-800",
  ambar: "bg-amber-100 text-amber-800",
  azul: "bg-sky-100 text-sky-800",
  verde: "bg-emerald-100 text-emerald-800",
};

interface FilaOrden {
  id: string;
  tipo: TipoOrden;
  folio: string;
  empresa_id: string;
  contraparte: string | null;
  forma_pago: string | null;
  estatus_backoffice?: string | null;
  proyecto: string | null;
  total: number | null;
  fecha: string | null;
  fuente: string;
  creada_por: string | null;
  etapa: { etiqueta: string; tono: string };
  editable: boolean;
  cancelable: boolean;
}

/** Órdenes propias OC / OS / OV con folio IA (10-oct-2026). Conviven con las
 * del backoffice: lo autorizado, pagado y recibido sigue en sus pantallas.
 * Compras y servicios van en UNA lista (19-oct-2026, Mario: "órdenes de
 * compra y órdenes de servicio dentro del mismo menú para revisarlo en un solo
 * archivo"): ?tipo=OC u OS solo filtra; ?tipo=OV es la pestaña de ventas. */
export function Ordenes() {
  const [params, setParams] = useSearchParams();
  const tipoParam = params.get("tipo");
  const vista: "compras" | "OV" = tipoParam === "OV" ? "OV" : "compras";
  const filtro: "todas" | "OC" | "OS" = tipoParam === "OC" || tipoParam === "OS" ? tipoParam : "todas";
  // Tipo con el que abre "+ Nueva" (en el editor se cambia entre OC y OS).
  const tipo: TipoOrden = vista === "OV" ? "OV" : filtro === "OS" ? "OS" : "OC";
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const { perfil } = useAuth();
  const { data: empresas } = useEmpresasAlcance();
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{ id: string | null } | null>(null);
  const [interempresa, setInterempresa] = useState<string | null>(null);
  const [verBackoffice, setVerBackoffice] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const esDireccion = !!perfil && ["admin", "corporativo", "direccion"].includes(perfil.rol);

  const lista = useQuery({
    queryKey: ["ordenes-ia", vista, filtro, empresaId, verBackoffice],
    queryFn: async (): Promise<FilaOrden[]> => {
      if (vista === "OV") {
        let q = supabase
          .from("ordenes_venta")
          .select("id, id_ov, empresa_id, cliente, forma_pago, proyecto, total, fecha_ov, fuente, creada_por, cancelada_en, created_at")
          .order("fecha_ov", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(300);
        if (!verBackoffice) q = q.eq("fuente", "acumulado");
        if (empresaId) q = q.eq("empresa_id", empresaId);
        const { data, error: e } = await q;
        if (e) throw e;
        return (data ?? []).map((o) => {
          const cancelada = !!o.cancelada_en;
          return {
            id: o.id as string,
            tipo: "OV" as TipoOrden,
            folio: o.id_ov as string,
            empresa_id: o.empresa_id as string,
            contraparte: o.cliente as string | null,
            forma_pago: o.forma_pago as string | null,
            proyecto: o.proyecto as string | null,
            total: o.total as number | null,
            fecha: o.fecha_ov as string | null,
            fuente: o.fuente as string,
            creada_por: o.creada_por as string | null,
            etapa: cancelada ? { etiqueta: "cancelada", tono: "gris" } : { etiqueta: o.fuente === "acumulado" ? "abierta" : "backoffice", tono: "azul" },
            editable: ordenEditable({ fuente: o.fuente as string, cancelada }),
            cancelable: o.fuente === "acumulado" && !cancelada,
          };
        });
      }
      let q = supabase
        .from("v_oc_pagos")
        .select("id, id_orden, tipo, empresa_id, proveedor, proyecto, total, fecha_creacion, fuente, autorizacion, rechazo_motivo, saldo, programado, recepcion_estado, pagada_backoffice, tipo_pago_backoffice, estatus_backoffice")
        .in("tipo", filtro === "todas" ? ["OC", "OS"] : [filtro])
        .order("fecha_creacion", { ascending: false })
        .limit(300);
      if (!verBackoffice) q = q.eq("fuente", "acumulado");
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error: e } = await q;
      if (e) throw e;
      const ids = (data ?? []).filter((o) => o.fuente === "acumulado").map((o) => o.id as string);
      const creadores = new Map<string, string | null>();
      if (ids.length) {
        const { data: c } = await supabase.from("ordenes_compra").select("id, creada_por").in("id", ids);
        for (const x of c ?? []) creadores.set(x.id as string, x.creada_por as string | null);
      }
      return (data ?? []).map((o) => {
        const tipoFila = (o.tipo === "OS" ? "OS" : "OC") as "OC" | "OS";
        const etapa = etapaOrdenCompra(o as never, tipoFila);
        return {
          id: o.id as string,
          tipo: tipoFila,
          folio: o.id_orden as string,
          empresa_id: o.empresa_id as string,
          contraparte: o.proveedor as string | null,
          forma_pago: o.tipo_pago_backoffice as string | null,
          estatus_backoffice: o.estatus_backoffice as string | null,
          proyecto: o.proyecto as string | null,
          total: o.total as number | null,
          fecha: o.fecha_creacion as string | null,
          fuente: o.fuente as string,
          creada_por: creadores.get(o.id as string) ?? null,
          etapa,
          editable: ordenEditable({ fuente: o.fuente as string, autorizacion: o.autorizacion as string }),
          // Cualquier OC/OS sin pagos (Mario, 15-oct-2026); las que no son IA
          // solo las cancela dirección (puedeTocar + fn_orden_ia_cancelar).
          cancelable: o.autorizacion !== "rechazada" && !o.pagada_backoffice && Number(o.saldo) >= Number(o.total ?? 0) - 0.01,
        };
      });
    },
  });

  // Órdenes que ya tienen venta inter empresa: completas ya no ofrecen el botón
  // (Mario, 21-oct-2026: "si ya se generó la venta y compra total, que ya no te
  // deje volverlo a hacer"); la base también lo impide (fn_orden_interempresa).
  const interempresaEstado = useQuery({
    queryKey: ["ordenes-ia", "interempresa-estado"],
    enabled: vista !== "OV",
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc("fn_interempresa_estado");
      if (e) throw e;
      return new Map(((data ?? []) as { origen_id: string; completa: boolean }[]).map((x) => [x.origen_id, x.completa]));
    },
  });

  // Más reciente primero: fecha y luego folio como número.
  const filas = useMemo(() => {
    const q = texto.trim().toLowerCase();
    return (lista.data ?? [])
      .filter((o) => !q || `${o.folio} ${o.contraparte ?? ""} ${o.proyecto ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.folio.localeCompare(a.folio, "es", { numeric: true }));
  }, [lista.data, texto]);

  const codigo = (id: string) => empresas?.find((e) => e.id === id)?.codigo ?? "—";
  const info = infoTipo(tipo);
  // Cancelada aquí o en el backoffice, o rechazada: sin inter empresa (Laura, 22-oct-2026).
  const cerrada = (o: FilaOrden) => o.etapa.etiqueta === "cancelada" || o.etapa.etiqueta === "rechazada" || /cancel/i.test(o.estatus_backoffice ?? "");
  const puedeTocar = (o: FilaOrden) => esDireccion || o.creada_por === perfil?.id;

  const [descargando, setDescargando] = useState(false);
  async function descargar() {
    const conEstado = filas.map((o) => ({ ...o, empresa: codigo(o.empresa_id), estado: o.etapa.etiqueta }));
    let csv: string;
    if (vista === "OV") {
      // Con el detalle de cada orden (Laura, 22-oct-2026).
      setDescargando(true);
      try {
        const lineas = new Map<string, LineaExcelOrden[]>();
        const ids = filas.map((o) => o.id);
        for (let i = 0; i < ids.length; i += 100) {
          for (let desde = 0; ; desde += 1000) {
            const { data, error: e } = await supabase
              .from("ordenes_venta_lineas")
              .select("id, orden_venta_id, numero, concepto, unidad, cantidad, precio_base, iva")
              .in("orden_venta_id", ids.slice(i, i + 100))
              .order("id")
              .range(desde, desde + 999);
            if (e) throw e;
            for (const l of data ?? []) {
              const lista = lineas.get(l.orden_venta_id as string) ?? [];
              lista.push({ numero: l.numero as number | null, concepto: l.concepto as string | null, unidad: l.unidad as string | null, cantidad: l.cantidad as number | null, precio: l.precio_base as number | null, iva: l.iva as boolean | null });
              lineas.set(l.orden_venta_id as string, lista);
            }
            if ((data ?? []).length < 1000) break;
          }
        }
        csv = csvOrdenesConDetalle(conEstado, lineas);
      } catch (e) {
        setError((e as Error).message);
        return;
      } finally {
        setDescargando(false);
      }
    } else {
      csv = csvOrdenes(conEstado);
    }
    descargarCsv(`${vista === "OV" ? "ordenes-venta" : "ordenes-compra-y-servicio"}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  async function cancelar(o: FilaOrden) {
    const motivo = window.prompt(`¿Por qué se cancela ${o.folio}?`);
    if (!motivo?.trim()) return;
    setError(null);
    const { error: e } = await supabase.rpc("fn_orden_ia_cancelar", { p_id: o.id, p_venta: o.tipo === "OV", p_motivo: motivo });
    if (e) setError(e.message);
    queryClient.invalidateQueries({ queryKey: ["ordenes-ia"] });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{vista === "OV" ? "Órdenes de venta (OV)" : "Órdenes de compra y de servicio (OC / OS)"}</h1>
          <p className="text-xs text-slate-500">
            {vista === "OV"
              ? "Folio propio IA-OV; almacén surte la salida contra la OV."
              : "Compras y servicios en una sola lista y una sola serie de folios. Van a \"Por autorizar\" de dirección y de ahí a pagos y recepción como las del backoffice."}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={descargar} disabled={!filas.length || descargando} className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {descargando ? "Preparando Excel…" : vista === "OV" ? "Descargar Excel (con detalle)" : "Descargar Excel"}
          </button>
          <button type="button" onClick={() => setEditor({ id: null })} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
            + Nueva {vista === "OV" ? "OV" : "OC u OS"}
          </button>
        </div>
      </div>

      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-200">
        {([
          { clave: "compras", etiqueta: "Compras y servicios (OC / OS)", params: {} },
          { clave: "OV", etiqueta: "Ventas (OV)", params: { tipo: "OV" } },
        ] as const).map((t) => (
          <button
            key={t.clave}
            type="button"
            onClick={() => {
              setParams(t.params);
              setEditor(null);
            }}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${vista === t.clave ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {t.etiqueta}
          </button>
        ))}
      </div>

      {editor && (
        <EditorOrden
          key={`${tipo}-${editor.id ?? "nueva"}`}
          tipo={tipo}
          id={editor.id}
          empresaInicial={empresaId}
          onCerrar={() => setEditor(null)}
          onGuardada={() => queryClient.invalidateQueries({ queryKey: ["ordenes-ia"] })}
        />
      )}

      {interempresa && (
        <VentaInterempresa
          key={interempresa}
          ocId={interempresa}
          onCerrar={() => setInterempresa(null)}
          onGuardada={() => queryClient.invalidateQueries({ queryKey: ["ordenes-ia"] })}
        />
      )}

      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />
        {vista === "compras" && (
          <div className="flex gap-1 rounded border border-slate-300 p-0.5">
            {(["todas", "OC", "OS"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setParams(f === "todas" ? {} : { tipo: f })}
                className={`rounded px-2 py-1 text-xs ${filtro === f ? "bg-slate-900 text-white" : "text-slate-600"}`}
              >
                {f === "todas" ? "Todas" : f === "OC" ? "Compras" : "Servicios"}
              </button>
            ))}
          </div>
        )}
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={`Buscar folio, ${info.contraparte.toLowerCase()} u obra`} className="w-64 rounded border border-slate-300 px-2 py-1.5" />
        <label className="flex items-center gap-1 text-slate-600">
          <input type="checkbox" checked={verBackoffice} onChange={(e) => setVerBackoffice(e.target.checked)} />
          Ver también las del backoffice
        </label>
      </div>
      {error && <p className="mb-2 rounded bg-red-50 px-2 py-1 text-sm text-red-700">{error}</p>}
      {lista.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {lista.error && <p className="text-sm text-red-600">Error: {(lista.error as Error).message}</p>}

      {lista.data && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Folio</th>
                {vista === "compras" && <th className="px-3 py-2">Tipo</th>}
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">{info.contraparte}</th>
                <th className="px-3 py-2">Proyecto</th>
                <th className="px-3 py-2 text-right">Total c/IVA</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                    Todavía no hay órdenes con folio IA. Usa "+ Nueva {vista === "OV" ? "OV" : "OC u OS"}".
                  </td>
                </tr>
              )}
              {filas.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs font-semibold">
                    {o.folio}
                    {o.fuente !== "acumulado" && <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 font-sans text-[10px] font-normal uppercase text-slate-500">{o.fuente === "api" ? "backoffice" : o.fuente}</span>}
                  </td>
                  {vista === "compras" && (
                    <td className="px-3 py-2 text-xs">
                      <span className={`rounded px-1.5 py-0.5 ${o.tipo === "OS" ? "bg-violet-100 text-violet-800" : "bg-sky-100 text-sky-800"}`}>{o.tipo === "OS" ? "servicio" : "compra"}</span>
                    </td>
                  )}
                  <td className="px-3 py-2 text-xs">{o.fecha ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{codigo(o.empresa_id)}</td>
                  <td className="px-3 py-2">{o.contraparte ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{o.proyecto ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{dinero(o.total)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${TONOS[o.etapa.tono]}`}>{o.etapa.etiqueta}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-2">
                      {o.tipo === "OV" ? <BotonVerOv ovId={o.id} /> : <BotonVerOc ocId={o.id} />}
                      {o.tipo !== "OV" && !cerrada(o) && interempresaEstado.data?.get(o.id) === true && (
                        <span className="rounded-full bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700" title="Ya se generaron la venta y la compra inter empresa de todas sus partidas">
                          inter empresa ✓
                        </span>
                      )}
                      {o.tipo !== "OV" && !cerrada(o) && interempresaEstado.data?.get(o.id) !== true && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditor(null);
                            setInterempresa(o.id);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                          title="Copiar esta orden como base: venta a otra empresa del grupo y su compra, con comisión"
                          className="rounded border border-indigo-200 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-50"
                        >
                          {interempresaEstado.data?.get(o.id) === false ? "Inter empresa (falta)" : "Inter empresa"}
                        </button>
                      )}
                      {o.editable && puedeTocar(o) && (
                        <button type="button" onClick={() => setEditor({ id: o.id })} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100">
                          Editar
                        </button>
                      )}
                      {o.cancelable && puedeTocar(o) && (
                        <button type="button" onClick={() => cancelar(o)} className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50">
                          Cancelar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
