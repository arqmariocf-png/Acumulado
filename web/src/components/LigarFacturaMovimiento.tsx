import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { filtrarFacturas, folioDeFactura, ordenarFacturas, terminoBusqueda, type FacturaCandidata } from "../lib/ligarFactura";

// Panel para elegir la factura (CFDI) de un movimiento por número de factura o
// folio fiscal (Mario, 21-oct-2026), como el de ligar OC/OS/OV. Cargo → CFDI
// recibidos, abono → emitidos, de la misma empresa. Al elegir,
// fn_movimiento_ligar_factura deja FACTURA "FM- <folio>" y lo concilia.

interface Props {
  movimiento: {
    id: string;
    empresa_id: string;
    fecha_pago: string | null;
    cargo_total: number | null;
    abono_total: number | null;
    nombre_razon_social: string | null;
    factura: string | null;
  };
  onListo: (mensaje: string) => void;
  onCancelar: () => void;
}

const MAXIMO = 40;
const CAMPOS = "id, folio, rfc, contraparte, total, fecha, es_complemento_pago";

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function moneda(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

interface FilaCfdi {
  id: string;
  folio: string;
  rfc: string | null;
  contraparte: string | null;
  total: number | null;
  fecha: string | null;
  es_complemento_pago: boolean | null;
}

export function LigarFacturaMovimiento({ movimiento, onListo, onCancelar }: Props) {
  const qc = useQueryClient();
  const esCargo = movimiento.cargo_total != null;
  const tipoCfdi = esCargo ? "recibido" : "emitido";
  const monto = movimiento.cargo_total ?? movimiento.abono_total;
  const actual = folioDeFactura(movimiento.factura);
  const [texto, setTexto] = useState("");
  const [buscar, setBuscar] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Las de la fecha del pago (4 meses antes, mes y medio después), las del
  // mismo monto de cualquier fecha y, si se escribe, las que coincidan en todo
  // el histórico por folio, RFC o nombre.
  const { data: facturas, isLoading, error: errorCarga } = useQuery({
    queryKey: ["ligar-factura", movimiento.empresa_id, tipoCfdi, movimiento.fecha_pago, monto, buscar],
    queryFn: async (): Promise<FacturaCandidata[]> => {
      const fecha = movimiento.fecha_pago ?? new Date().toISOString().slice(0, 10);
      const base = () => supabase.from("cfdi").select(CAMPOS).eq("empresa_id", movimiento.empresa_id).eq("tipo", tipoCfdi);
      const consultas = [
        base().gte("fecha", sumarDias(fecha, -120)).lte("fecha", sumarDias(fecha, 45)).order("fecha", { ascending: false }).limit(400),
      ];
      if (monto != null) consultas.push(base().gte("total", monto - 1).lte("total", monto + 1).limit(100));
      const termino = terminoBusqueda(buscar);
      if (termino) {
        consultas.push(
          base().or(`folio.ilike.%${termino}%,rfc.ilike.%${termino}%,contraparte.ilike.%${termino}%`).order("fecha", { ascending: false }).limit(100),
        );
      }
      const resultados = await Promise.all(consultas);
      const vistos = new Map<string, FacturaCandidata>();
      for (const r of resultados) {
        if (r.error) throw r.error;
        for (const c of (r.data ?? []) as FilaCfdi[]) {
          vistos.set(c.id, {
            id: c.id,
            folio: c.folio,
            rfc: c.rfc,
            contraparte: c.contraparte,
            total: c.total == null ? null : Number(c.total),
            fecha: c.fecha,
            complemento: !!c.es_complemento_pago,
          });
        }
      }
      return [...vistos.values()];
    },
  });

  const lista = useMemo(
    () =>
      filtrarFacturas(
        ordenarFacturas(facturas ?? [], { monto, fecha: movimiento.fecha_pago, nombre: movimiento.nombre_razon_social }),
        texto,
      ).slice(0, MAXIMO),
    [facturas, texto, monto, movimiento.fecha_pago, movimiento.nombre_razon_social],
  );

  // Cuáles de las que se muestran ya están ligadas a otro movimiento.
  const folios = lista.map((f) => f.folio);
  const { data: usadas } = useQuery({
    queryKey: ["ligar-factura-usadas", movimiento.empresa_id, folios.join(",")],
    enabled: folios.length > 0,
    queryFn: async () => {
      const valores = folios.flatMap((fo) => [`F- ${fo}`, `FM- ${fo}`]);
      const { data, error } = await supabase
        .from("movimientos")
        .select("id, factura")
        .eq("empresa_id", movimiento.empresa_id)
        .in("factura", valores)
        .neq("id", movimiento.id);
      if (error) throw error;
      const cuenta = new Map<string, number>();
      for (const m of data ?? []) {
        const fo = folioDeFactura(m.factura);
        if (fo) cuenta.set(fo, (cuenta.get(fo) ?? 0) + 1);
      }
      return cuenta;
    },
  });

  const ligar = useMutation({
    mutationFn: async (f: FacturaCandidata) => {
      const { data, error } = await supabase.rpc("fn_movimiento_ligar_factura", {
        p_movimiento: movimiento.id,
        p_cfdi: f.id,
      });
      if (error) throw error;
      return data as { folio: string; contraparte: string | null; total: number | null; otros_movimientos: number };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["movimientos"] });
      const diferencia = monto != null && r.total != null && Math.abs(Number(r.total) - monto) > 1;
      onListo(
        `Factura ${r.folio}${r.contraparte ? ` (${r.contraparte})` : ""} ligada: conciliado.` +
          (diferencia ? ` Ojo: la factura es de ${moneda(Number(r.total))} y el movimiento de ${moneda(monto)}.` : "") +
          (r.otros_movimientos > 0 ? ` Esa factura ya estaba en ${r.otros_movimientos} movimiento(s) más.` : ""),
      );
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="rounded bg-violet-50 p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Buscar factura por número, folio fiscal (UUID), RFC o {esCargo ? "proveedor" : "cliente"}
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setBuscar(texto.trim());
              }
            }}
            placeholder="Ej. A3E54ADE o 1203"
            autoFocus
            className="mt-1 block w-72 rounded border border-slate-300 px-2 py-1.5 text-sm"
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
          {esCargo ? "Cargo" : "Abono"} de {moneda(monto)} · facturas {esCargo ? "recibidas" : "emitidas"} de esta empresa; primero las del mismo monto
        </span>
      </div>
      {actual && <p className="mb-2 text-xs text-slate-600">Factura actual: {actual}</p>}
      {error && <p className="mb-2 text-xs text-red-700">{error}</p>}
      {errorCarga && <p className="mb-2 text-xs text-red-700">No se pudieron cargar las facturas: {(errorCarga as Error).message}</p>}
      {isLoading ? (
        <p className="text-xs text-slate-500">Cargando facturas…</p>
      ) : lista.length === 0 ? (
        <p className="text-xs text-slate-500">
          No hay facturas {esCargo ? "recibidas" : "emitidas"} de esta empresa con ese filtro. Escribe el folio y da "Buscar en todo el histórico".
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1">Factura / folio fiscal</th>
                <th className="px-2 py-1">{esCargo ? "Proveedor" : "Cliente"}</th>
                <th className="px-2 py-1">Fecha</th>
                <th className="px-2 py-1 text-right">Total</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => {
                const enOtros = usadas?.get(f.folio) ?? 0;
                return (
                  <tr key={f.id} className={`border-t border-slate-100 ${f.mismoMonto ? "bg-amber-50" : ""}`}>
                    <td className="px-2 py-1 font-mono text-[11px]">
                      <span className="break-all">{f.folio}</span>
                      {f.mismoMonto && <span className="ml-1 rounded bg-amber-100 px-1 font-sans text-[10px] text-amber-800">mismo monto</span>}
                      {f.mismaContraparte && <span className="ml-1 rounded bg-emerald-100 px-1 font-sans text-[10px] text-emerald-800">mismo nombre</span>}
                      {f.complemento && <span className="ml-1 rounded bg-slate-100 px-1 font-sans text-[10px] text-slate-700">complemento de pago</span>}
                      {enOtros > 0 && (
                        <span className="ml-1 rounded bg-red-100 px-1 font-sans text-[10px] text-red-800">ya en {enOtros} movimiento(s)</span>
                      )}
                      {f.folio === actual && <span className="ml-1 rounded bg-violet-100 px-1 font-sans text-[10px] text-violet-800">la actual</span>}
                    </td>
                    <td className="px-2 py-1">
                      {f.contraparte ?? "—"}
                      {f.rfc && <span className="block text-[10px] text-slate-500">{f.rfc}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1">{f.fecha?.slice(0, 10) ?? "—"}</td>
                    <td className="px-2 py-1 text-right">{moneda(f.total)}</td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        disabled={ligar.isPending || f.folio === actual}
                        onClick={() => {
                          setError(null);
                          ligar.mutate(f);
                        }}
                        className="rounded bg-violet-700 px-2 py-1 text-white disabled:opacity-50"
                      >
                        Elegir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
