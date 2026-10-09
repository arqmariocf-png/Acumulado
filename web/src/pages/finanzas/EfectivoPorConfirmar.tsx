import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../../lib/supabase";
import { errorDeFuncion } from "../../lib/funciones";
import { moneda } from "../../lib/saldosEmpresas";
import { BotonVerOc } from "../requisiciones/VerOrdenCompra";

// Laura (8-oct-2026, "CORRECCIONES SISTEMA GRUPO LOMA"): "OC – proveedor –
// monto – ver orden – confirmar pago – subir comprobante, y que se puedan
// confirmar varias OC con un solo comprobante de pago". Son las OC con saldo
// que se pagan en efectivo (condición efectivo, o el backoffice dice
// Efectivo y aún no tienen condición). fn_oc_confirmar_pagadas deja pagado y
// confirmado lo que falte de cada una y el archivo se liga a todos esos pagos.

interface OcEfectivo {
  id: string;
  id_orden: string;
  empresa_id: string;
  proveedor: string | null;
  proyecto: string | null;
  fecha_creacion: string | null;
  saldo: number;
}

export const FILTRO_OC_EFECTIVO = "condicion_pago.eq.efectivo,and(condicion_pago.is.null,tipo_pago_backoffice.ilike.efectivo*)";

function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function EfectivoPorConfirmar() {
  const qc = useQueryClient();
  const hoy = hoyIso();
  const [texto, setTexto] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const { data: empresas } = useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, codigo").order("nombre");
      if (error) throw error;
      return data as { id: string; nombre: string; codigo: string }[];
    },
  });
  const nombreEmpresa = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.codigo || e.nombre])), [empresas]);

  const { data: ocs, isLoading, error } = useQuery({
    queryKey: ["oc-pagos", "efectivo-por-confirmar"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_oc_pagos")
        .select("id, id_orden, empresa_id, proveedor, proyecto, fecha_creacion, saldo")
        .gt("saldo", 0.009)
        .neq("autorizacion", "rechazada")
        .eq("pagada_backoffice", false)
        .or(FILTRO_OC_EFECTIVO)
        .order("fecha_creacion", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return ((data ?? []) as OcEfectivo[]).sort((a, b) => (b.fecha_creacion ?? "").localeCompare(a.fecha_creacion ?? "") || b.id_orden.localeCompare(a.id_orden, "es", { numeric: true }));
    },
  });

  const lista = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return (ocs ?? []).filter((o) => (!empresaId || o.empresa_id === empresaId) && (!t || `${o.id_orden} ${o.proveedor ?? ""} ${o.proyecto ?? ""}`.toLowerCase().includes(t)));
  }, [ocs, texto, empresaId]);
  const elegidas = useMemo(() => (ocs ?? []).filter((o) => sel.has(o.id)), [ocs, sel]);
  const suma = elegidas.reduce((s, o) => s + Number(o.saldo), 0);
  const total = lista.reduce((s, o) => s + Number(o.saldo), 0);

  function alternar(id: string) {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Efectivo por confirmar</h1>
      <p className="mb-4 text-sm text-slate-500">Órdenes de compra con saldo que se pagan en efectivo. Elige una o varias, confirma el pago y sube un solo comprobante para todas.</p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar OC, proveedor u obra…" className="w-64 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="">Todas las empresas</option>
          {empresas?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-600">
          {lista.length} OC · <b className="tabular-nums">{moneda(total)}</b>
        </span>
        {sel.size > 0 && (
          <span className="ml-auto flex items-center gap-2 text-sm">
            <span>
              {sel.size} elegidas · <b className="tabular-nums">{moneda(suma)}</b>
            </span>
            <button type="button" onClick={() => setPanel(true)} className="rounded bg-emerald-700 px-3 py-1.5 font-medium text-white">
              Confirmar pago {sel.size}
            </button>
            <button type="button" onClick={() => setSel(new Set())} className="text-xs underline">
              quitar selección
            </button>
          </span>
        )}
      </div>

      {aviso && <p className="mb-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{aviso}</p>}
      {panel && elegidas.length > 0 && (
        <ConfirmarEfectivo
          ocs={elegidas}
          hoy={hoy}
          onCancelar={() => setPanel(false)}
          onListo={(m) => {
            setAviso(m);
            setPanel(false);
            setSel(new Set());
            qc.invalidateQueries({ queryKey: ["oc-pagos"] });
            qc.invalidateQueries({ queryKey: ["pagos-programados"] });
            qc.invalidateQueries({ queryKey: ["cxp-proveedores"] });
          }}
        />
      )}
      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-slate-400">Cargando órdenes…</p>}

      {ocs && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Elegir todas"
                    checked={lista.length > 0 && lista.every((o) => sel.has(o.id))}
                    onChange={(e) => setSel(e.target.checked ? new Set(lista.map((o) => o.id)) : new Set())}
                  />
                </th>
                <th className="px-3 py-2">OC</th>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2">Ver orden</th>
                <th className="px-3 py-2">Confirmar pago / comprobante</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((o) => (
                <tr key={o.id} className={`border-t border-slate-100 ${sel.has(o.id) ? "bg-emerald-50/60" : ""}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={sel.has(o.id)} onChange={() => alternar(o.id)} aria-label={`Elegir ${o.id_orden}`} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{o.id_orden}</div>
                    <div className="text-[11px] text-slate-400">
                      {nombreEmpresa.get(o.empresa_id) ?? ""} · {o.fecha_creacion?.slice(0, 10) ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {o.proveedor ?? "—"}
                    {o.proyecto && <div className="text-[11px] text-slate-400">{o.proyecto}</div>}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{moneda(o.saldo)}</td>
                  <td className="px-3 py-2">
                    <BotonVerOc ocId={o.id} className="text-xs text-sky-700 underline" />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSel(new Set([o.id]));
                        setPanel(true);
                      }}
                      className="rounded border border-emerald-600 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    >
                      Confirmar y subir comprobante
                    </button>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    No hay órdenes en efectivo por confirmar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConfirmarEfectivo({ ocs, hoy, onListo, onCancelar }: { ocs: OcEfectivo[]; hoy: string; onListo: (m: string) => void; onCancelar: () => void }) {
  const [fecha, setFecha] = useState(hoy);
  const [referencia, setReferencia] = useState("");
  const [error, setError] = useState<string | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const suma = ocs.reduce((s, o) => s + Number(o.saldo), 0);

  const confirmar = useMutation({
    mutationFn: async () => {
      const { data: ids, error: err } = await supabase.rpc("fn_oc_confirmar_pagadas", { p_ocs: ocs.map((o) => o.id), p_fecha: fecha, p_metodo: "efectivo", p_referencia: referencia.trim() || null, p_cuenta_id: null });
      if (err) throw err;
      const pagos = (ids ?? []) as string[];
      const archivo = archivoRef.current?.files?.[0];
      if (archivo && pagos.length > 0) {
        const form = new FormData();
        form.set("pagoIds", pagos.join(","));
        form.set("file", archivo);
        const { data: sesion } = await supabase.auth.getSession();
        const r = await fetch(urlFuncion("pagos-comprobante"), { method: "POST", headers: { Authorization: `Bearer ${sesion.session?.access_token ?? ""}` }, body: form });
        const json = await r.json().catch(() => null);
        if (!r.ok) throw new Error(`Quedaron pagadas, pero el comprobante no se subió: ${(await errorDeFuncion(r, json)).message}`);
      }
      return `${ocs.length} orden(es) confirmadas como pagadas en efectivo · ${moneda(suma)}${archivo ? " · con el mismo comprobante" : " · sin comprobante (súbelo desde la Base de OC y pagos)"}.`;
    },
    onSuccess: onListo,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="mb-3 flex flex-wrap items-end gap-3 rounded border border-emerald-300 bg-white p-3 text-sm">
      <p className="w-full text-slate-600">
        Confirmar pago en efectivo de <b>{ocs.map((o) => o.id_orden).join(", ")}</b> por <b className="tabular-nums">{moneda(suma)}</b>. Lo que falte de cada OC queda pagado y confirmado a tu nombre.
      </p>
      <label className="text-xs text-slate-600">
        Fecha de pago
        <input type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} className="mt-1 block rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-slate-600">
        Referencia / quién recibió (opcional)
        <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className="mt-1 block w-56 rounded border border-slate-300 px-2 py-1.5 text-sm" />
      </label>
      <label className="text-xs text-slate-600">
        Comprobante (uno para todas)
        <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="mt-1 block text-sm" />
      </label>
      <button
        type="button"
        disabled={confirmar.isPending}
        onClick={() => {
          setError(null);
          confirmar.mutate();
        }}
        className="rounded bg-emerald-700 px-4 py-1.5 font-medium text-white disabled:opacity-50"
      >
        {confirmar.isPending ? "Confirmando…" : `Confirmar ${ocs.length} pagada${ocs.length > 1 ? "s" : ""}`}
      </button>
      <button type="button" onClick={onCancelar} className="text-xs underline">
        cancelar
      </button>
      {error && <p className="w-full text-red-700">{error}</p>}
    </div>
  );
}
