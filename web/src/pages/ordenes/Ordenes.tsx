import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth, useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa, useEmpresasAlcance } from "../../components/SelectorEmpresa";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";
import { BotonVerOv } from "./VerOrdenVenta";
import { EditorOrden } from "./EditorOrden";
import { TIPOS_ORDEN, etapaOrdenCompra, infoTipo, ordenEditable, type TipoOrden } from "../../lib/ordenesIa";

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
  folio: string;
  empresa_id: string;
  contraparte: string | null;
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
 * del backoffice: lo autorizado, pagado y recibido sigue en sus pantallas. */
export function Ordenes() {
  const [params, setParams] = useSearchParams();
  const tipo = (["OC", "OS", "OV"].includes(params.get("tipo") ?? "") ? params.get("tipo") : "OC") as TipoOrden;
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const { perfil } = useAuth();
  const { data: empresas } = useEmpresasAlcance();
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<{ id: string | null } | null>(null);
  const [verBackoffice, setVerBackoffice] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const esDireccion = !!perfil && ["admin", "corporativo", "direccion"].includes(perfil.rol);

  const lista = useQuery({
    queryKey: ["ordenes-ia", tipo, empresaId, verBackoffice],
    queryFn: async (): Promise<FilaOrden[]> => {
      if (tipo === "OV") {
        let q = supabase
          .from("ordenes_venta")
          .select("id, id_ov, empresa_id, cliente, proyecto, total, fecha_ov, fuente, creada_por, cancelada_en, created_at")
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
            folio: o.id_ov as string,
            empresa_id: o.empresa_id as string,
            contraparte: o.cliente as string | null,
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
        .select("id, id_orden, tipo, empresa_id, proveedor, proyecto, total, fecha_creacion, fuente, autorizacion, rechazo_motivo, saldo, programado, recepcion_estado")
        .eq("tipo", tipo)
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
        const etapa = etapaOrdenCompra(o as never, tipo as "OC" | "OS");
        return {
          id: o.id as string,
          folio: o.id_orden as string,
          empresa_id: o.empresa_id as string,
          contraparte: o.proveedor as string | null,
          proyecto: o.proyecto as string | null,
          total: o.total as number | null,
          fecha: o.fecha_creacion as string | null,
          fuente: o.fuente as string,
          creada_por: creadores.get(o.id as string) ?? null,
          etapa,
          editable: ordenEditable({ fuente: o.fuente as string, autorizacion: o.autorizacion as string }),
          cancelable: o.fuente === "acumulado" && o.autorizacion !== "rechazada" && Number(o.saldo) >= Number(o.total ?? 0) - 0.01,
        };
      });
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
  const puedeTocar = (o: FilaOrden) => esDireccion || o.creada_por === perfil?.id;

  async function cancelar(o: FilaOrden) {
    const motivo = window.prompt(`¿Por qué se cancela ${o.folio}?`);
    if (!motivo?.trim()) return;
    setError(null);
    const { error: e } = await supabase.rpc("fn_orden_ia_cancelar", { p_id: o.id, p_venta: tipo === "OV", p_motivo: motivo });
    if (e) setError(e.message);
    queryClient.invalidateQueries({ queryKey: ["ordenes-ia"] });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Órdenes OC / OS / OV</h1>
          <p className="text-xs text-slate-500">Folio propio IA-OC, IA-OS e IA-OV. Las OC y OS van a "Por autorizar" de dirección y de ahí a pagos y recepción como las del backoffice.</p>
        </div>
        <button type="button" onClick={() => setEditor({ id: null })} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
          + Nueva {tipo}
        </button>
      </div>

      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TIPOS_ORDEN.map((t) => (
          <button
            key={t.tipo}
            type="button"
            onClick={() => {
              setParams({ tipo: t.tipo });
              setEditor(null);
            }}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tipo === t.tipo ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {t.corto}
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

      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />
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
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                    Todavía no hay {info.corto.toLowerCase()} con folio IA. Usa "+ Nueva {tipo}".
                  </td>
                </tr>
              )}
              {filas.map((o) => (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs font-semibold">
                    {o.folio}
                    {o.fuente !== "acumulado" && <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 font-sans text-[10px] font-normal uppercase text-slate-500">{o.fuente === "api" ? "backoffice" : o.fuente}</span>}
                  </td>
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
                      {tipo === "OV" ? <BotonVerOv ovId={o.id} /> : <BotonVerOc ocId={o.id} />}
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
