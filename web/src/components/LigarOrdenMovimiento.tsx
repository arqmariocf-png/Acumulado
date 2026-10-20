import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  filtrarCandidatas,
  numerosEnConcepto,
  ordenarCandidatas,
  type OrdenCandidata,
} from "../lib/ligarOrden";

// Panel para ligar un movimiento en revisión a su OC / OS (cargo) u OV (abono)
// de la misma empresa (Mario, 20-oct-2026). Al elegir, fn_movimiento_ligar_orden
// pone la referencia, el proyecto y busca la factura por monto.

interface Props {
  movimiento: {
    id: string;
    empresa_id: string;
    fecha_pago: string | null;
    cargo_total: number | null;
    abono_total: number | null;
    nombre_razon_social: string | null;
  };
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
}

const MAXIMO = 40;

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function moneda(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function LigarOrdenMovimiento({ movimiento, onListo, onCancelar }: Props) {
  const qc = useQueryClient();
  const esCargo = movimiento.cargo_total != null;
  const monto = movimiento.cargo_total ?? movimiento.abono_total;
  const [texto, setTexto] = useState("");
  const [buscar, setBuscar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const enConcepto = useMemo(() => numerosEnConcepto(movimiento.nombre_razon_social), [movimiento.nombre_razon_social]);

  // Las de la fecha del pago (4 meses antes, 2 semanas después), las que nombra
  // el concepto y, si se escribe, las que coincidan en todo el histórico.
  const { data: ordenes, isLoading, error: errorCarga } = useQuery({
    queryKey: ["ligar-orden", movimiento.empresa_id, esCargo, movimiento.fecha_pago, enConcepto.join(","), buscar],
    queryFn: async (): Promise<OrdenCandidata[]> => {
      const fecha = movimiento.fecha_pago ?? new Date().toISOString().slice(0, 10);
      const desde = sumarDias(fecha, -120);
      const hasta = sumarDias(fecha, 15);
      const termino = buscar.replace(/[%,()]/g, " ").trim();
      if (esCargo) {
        const campos = "id, id_orden, tipo, proveedor, proyecto, total, saldo, fecha_creacion, autorizacion";
        const base = () =>
          supabase.from("v_oc_pagos").select(campos).eq("empresa_id", movimiento.empresa_id).neq("autorizacion", "rechazada");
        const consultas = [base().gte("fecha_creacion", desde).lte("fecha_creacion", `${hasta}T23:59:59`).order("fecha_creacion", { ascending: false }).limit(400)];
        if (enConcepto.length) consultas.push(base().in("id_orden", enConcepto));
        if (termino) consultas.push(base().or(`id_orden.ilike.%${termino}%,proveedor.ilike.%${termino}%,proyecto.ilike.%${termino}%`).limit(100));
        const resultados = await Promise.all(consultas);
        const vistos = new Map<string, OrdenCandidata>();
        for (const r of resultados) {
          if (r.error) throw r.error;
          for (const o of r.data ?? []) {
            vistos.set(o.id, {
              id: o.id,
              numero: String(o.id_orden),
              tipo: o.tipo === "OS" ? "OS" : "OC",
              contraparte: o.proveedor,
              proyecto: o.proyecto,
              total: o.total,
              saldo: o.saldo,
              fecha: o.fecha_creacion,
            });
          }
        }
        return [...vistos.values()];
      }
      const campos = "id, id_ov, cliente, proyecto, total, fecha_ov";
      const base = () =>
        supabase.from("ordenes_venta").select(campos).eq("empresa_id", movimiento.empresa_id).is("cancelada_en", null);
      const consultas = [base().gte("fecha_ov", desde).lte("fecha_ov", hasta).order("fecha_ov", { ascending: false }).limit(400)];
      if (enConcepto.length) consultas.push(base().in("id_ov", enConcepto));
      if (termino) consultas.push(base().or(`id_ov.ilike.%${termino}%,cliente.ilike.%${termino}%,proyecto.ilike.%${termino}%`).limit(100));
      const resultados = await Promise.all(consultas);
      const vistos = new Map<string, OrdenCandidata>();
      for (const r of resultados) {
        if (r.error) throw r.error;
        for (const o of r.data ?? []) {
          vistos.set(o.id, {
            id: o.id,
            numero: String(o.id_ov),
            tipo: "OV",
            contraparte: o.cliente,
            proyecto: o.proyecto,
            total: o.total,
            saldo: null,
            fecha: o.fecha_ov,
          });
        }
      }
      return [...vistos.values()];
    },
  });

  const lista = useMemo(
    () =>
      filtrarCandidatas(
        ordenarCandidatas(ordenes ?? [], { monto, fecha: movimiento.fecha_pago, concepto: movimiento.nombre_razon_social }),
        texto,
      ).slice(0, MAXIMO),
    [ordenes, texto, monto, movimiento.fecha_pago, movimiento.nombre_razon_social],
  );

  const ligar = useMutation({
    mutationFn: async (o: OrdenCandidata) => {
      const { data, error } = await supabase.rpc("fn_movimiento_ligar_orden", {
        p_movimiento: movimiento.id,
        p_tipo: o.tipo,
        p_orden: o.id,
      });
      if (error) throw error;
      return data as { tipo: string; numero: string; factura: string | null; estado: string };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["movimientos"] });
      onListo(
        r.estado === "resuelto"
          ? `Ligado a ${r.tipo} ${r.numero} con la factura ${r.factura}: conciliado.`
          : `Ligado a ${r.tipo} ${r.numero}. Queda 🟡 Esperado: falta la factura (CFDI) con ese monto.`,
      );
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="rounded bg-sky-50 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Buscar {esCargo ? "OC / OS" : "OV"} por número, {esCargo ? "proveedor" : "cliente"} u obra
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setBuscar(texto.trim());
              }
            }}
            placeholder="Ej. 41492"
            autoFocus
            className="mt-1 block w-64 rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => setBuscar(texto.trim())}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs"
        >
          Buscar en todo el histórico
        </button>
        <button type="button" onClick={onCancelar} className="px-2 py-1.5 text-xs text-slate-600 underline">
          Cancelar
        </button>
        <span className="text-xs text-slate-500">
          {esCargo ? "Cargo" : "Abono"} de {moneda(monto)} · primero la que dice el concepto y las del mismo monto
        </span>
      </div>
      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
      {errorCarga && <p className="mb-2 text-xs text-red-700">No se pudieron cargar las órdenes: {(errorCarga as Error).message}</p>}
      {isLoading ? (
        <p className="text-xs text-slate-500">Cargando órdenes…</p>
      ) : lista.length === 0 ? (
        <p className="text-xs text-slate-500">
          No hay {esCargo ? "OC/OS" : "OV"} de esta empresa con ese filtro. Escribe el número y da "Buscar en todo el histórico".
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1">Orden</th>
                <th className="px-2 py-1">{esCargo ? "Proveedor" : "Cliente"}</th>
                <th className="px-2 py-1">Proyecto</th>
                <th className="px-2 py-1">Fecha</th>
                <th className="px-2 py-1 text-right">Total</th>
                {esCargo && <th className="px-2 py-1 text-right">Saldo</th>}
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {lista.map((o) => (
                <tr key={o.id} className={`border-t border-slate-100 ${o.enConcepto ? "bg-emerald-50" : o.mismoMonto ? "bg-amber-50" : ""}`}>
                  <td className="whitespace-nowrap px-2 py-1 font-medium">
                    {o.tipo} {o.numero}
                    {o.enConcepto && <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] text-emerald-800">lo dice el concepto</span>}
                    {o.mismoMonto && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">mismo monto</span>}
                  </td>
                  <td className="px-2 py-1">{o.contraparte ?? "—"}</td>
                  <td className="px-2 py-1">{o.proyecto ?? "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1">{o.fecha?.slice(0, 10) ?? "—"}</td>
                  <td className="px-2 py-1 text-right">{moneda(o.total)}</td>
                  {esCargo && <td className="px-2 py-1 text-right">{moneda(o.saldo)}</td>}
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      disabled={ligar.isPending}
                      onClick={() => {
                        setError(null);
                        ligar.mutate(o);
                      }}
                      className="rounded bg-sky-700 px-2 py-1 text-white disabled:opacity-50"
                    >
                      Ligar
                    </button>
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
