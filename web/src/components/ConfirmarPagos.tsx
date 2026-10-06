import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, urlFuncion } from "../lib/supabase";
import { errorDeFuncion } from "../lib/funciones";
import { rutaVerArchivo } from "../lib/verArchivo";

// Confirmar varios pagos de una vez con UN comprobante (Mario, 6-oct-2026:
// "un mismo comprobante cubre varias órdenes de pago"). Laura lo usa para el
// efectivo (las devoluciones a quien lo cubrió) en Programación de pagos;
// Tesorería para las transferencias. La edge pagos-comprobante deja pagados
// los pendientes, registra quién confirmó y liga el mismo archivo a todos.

interface PagoConfirmable {
  id: string;
  beneficiario: string;
  concepto: string | null;
  monto: number;
  fecha_programada: string;
  estatus: string;
  pagado_en: string | null;
  metodo: string;
  empresa_id: string;
  comprobante_path: string | null;
  confirmado_en: string | null;
  ordenes_compra: { id_orden: string | null; proyecto: string | null } | null;
}

const pesos = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

export function ConfirmarPagos({
  metodo,
  titulo,
  ayuda,
  nombreEmpresa,
  empresaId,
  id,
}: {
  metodo: "efectivo" | "transferencia";
  titulo: string;
  ayuda: string;
  nombreEmpresa?: Map<string, string>;
  empresaId?: string | null;
  id?: string;
}) {
  const qc = useQueryClient();
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [referencia, setReferencia] = useState("");
  const [verConfirmados, setVerConfirmados] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["pagos-programados", "confirmar", metodo, verConfirmados, empresaId ?? null],
    queryFn: async () => {
      let q = supabase
        .from("pagos_programados")
        .select("id, beneficiario, concepto, monto, fecha_programada, estatus, pagado_en, metodo, empresa_id, comprobante_path, confirmado_en, ordenes_compra(id_orden, proyecto)")
        .eq("metodo", metodo)
        .neq("estatus", "cancelado")
        .order("fecha_programada", { ascending: false })
        .limit(300);
      if (!verConfirmados) q = q.is("confirmado_en", null);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as PagoConfirmable[];
    },
  });
  const filas = data ?? [];
  const elegidos = useMemo(() => filas.filter((f) => seleccion.has(f.id)), [filas, seleccion]);
  const suma = elegidos.reduce((s, f) => s + Number(f.monto), 0);

  const confirmar = useMutation({
    mutationFn: async () => {
      if (elegidos.length === 0) throw new Error("Elige al menos un pago.");
      const form = new FormData();
      form.set("pagoIds", elegidos.map((f) => f.id).join(","));
      form.set("confirmar", "1");
      if (referencia.trim()) form.set("referencia", referencia.trim());
      const archivo = archivoRef.current?.files?.[0];
      if (archivo) form.set("file", archivo);
      const { data: sesion } = await supabase.auth.getSession();
      const respuesta = await fetch(urlFuncion("pagos-comprobante"), {
        method: "POST",
        headers: { Authorization: `Bearer ${sesion.session?.access_token ?? ""}` },
        body: form,
      });
      const json = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw await errorDeFuncion(respuesta, json);
      return { n: elegidos.length, conArchivo: !!archivo };
    },
    onSuccess: ({ n, conArchivo }) => {
      setAviso(`${n} pago(s) confirmados${conArchivo ? " con el mismo comprobante" : ""} · ${pesos(suma)}.`);
      setSeleccion(new Set());
      setReferencia("");
      if (archivoRef.current) archivoRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["pagos-programados"] });
      qc.invalidateQueries({ queryKey: ["oc-pagos"] });
      qc.invalidateQueries({ queryKey: ["tesoreria"] });
      qc.invalidateQueries({ queryKey: ["indicador"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function alternar(idPago: string) {
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(idPago)) n.delete(idPago);
      else n.add(idPago);
      return n;
    });
  }

  const porConfirmar = filas.filter((f) => !f.confirmado_en);

  return (
    <section id={id} className="mb-6 scroll-mt-20 rounded border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
        <span className="text-xs text-slate-500">
          {porConfirmar.length} por confirmar · {pesos(porConfirmar.reduce((s, f) => s + Number(f.monto), 0))}
        </span>
        <span className="flex-1" />
        <label className="flex items-center gap-1 text-xs text-slate-600">
          <input type="checkbox" checked={verConfirmados} onChange={(e) => setVerConfirmados(e.target.checked)} /> ver también confirmados
        </label>
      </div>
      <p className="mt-1 text-xs text-slate-500">{ayuda}</p>
      {error && (
        <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700" onClick={() => setError(null)}>
          {error}
        </p>
      )}
      {aviso && (
        <p className="mt-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-800" onClick={() => setAviso(null)}>
          {aviso}
        </p>
      )}

      {elegidos.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-sky-200 bg-sky-50 p-2 text-sm">
          <span className="font-medium text-sky-900">
            {elegidos.length} elegido(s) · {pesos(suma)}
          </span>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Referencia (opcional)" className="rounded border border-slate-300 px-2 py-1 text-xs" />
          <label className="text-xs text-slate-700">
            Comprobante (uno para todos, opcional):{" "}
            <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="text-xs" />
          </label>
          <button
            disabled={confirmar.isPending}
            onClick={() => {
              setError(null);
              confirmar.mutate();
            }}
            className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {confirmar.isPending ? "Confirmando…" : `Confirmar ${elegidos.length}`}
          </button>
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        {isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
        {!isLoading && filas.length === 0 && <p className="text-sm text-slate-500">No hay pagos por confirmar.</p>}
        {filas.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1 pr-2">
                  <input
                    type="checkbox"
                    aria-label="Elegir todos"
                    checked={porConfirmar.length > 0 && porConfirmar.every((f) => seleccion.has(f.id))}
                    onChange={(e) => setSeleccion(e.target.checked ? new Set(porConfirmar.map((f) => f.id)) : new Set())}
                  />
                </th>
                <th className="pr-2">Fecha</th>
                <th className="pr-2">OC</th>
                <th className="pr-2">Beneficiario</th>
                <th className="pr-2 text-right">Monto</th>
                <th className="pr-2">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-2">{!f.confirmado_en && <input type="checkbox" checked={seleccion.has(f.id)} onChange={() => alternar(f.id)} />}</td>
                  <td className="whitespace-nowrap pr-2 text-slate-500">{f.pagado_en ?? f.fecha_programada}</td>
                  <td className="pr-2">
                    {f.ordenes_compra?.id_orden ?? "—"}
                    {f.ordenes_compra?.proyecto && <div className="text-[11px] text-slate-500">{f.ordenes_compra.proyecto}</div>}
                  </td>
                  <td className="pr-2">
                    {f.beneficiario}
                    {nombreEmpresa?.get(f.empresa_id) && <div className="text-[11px] text-slate-500">{nombreEmpresa.get(f.empresa_id)}</div>}
                  </td>
                  <td className="pr-2 text-right tabular-nums">{pesos(Number(f.monto))}</td>
                  <td className="pr-2 text-xs">
                    {f.confirmado_en ? (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">confirmado</span>
                    ) : f.estatus === "pagado" ? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">pagado, por confirmar</span>
                    ) : (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">pendiente</span>
                    )}
                    {f.comprobante_path && (
                      <button onClick={() => window.open(rutaVerArchivo("pago", f.id), "_blank")} className="ml-1 text-slate-600 underline">
                        comprobante
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
