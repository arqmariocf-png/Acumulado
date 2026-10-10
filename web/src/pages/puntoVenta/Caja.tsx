import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { corteCaja } from "../../lib/puntoVenta";
import { botonPrimario, botonSecundario, campo, dinero, fechaHora, type Turno } from "./datos";

/** Abrir caja con fondo. */
export function AbrirCaja({ empresaId }: { empresaId: string }) {
  const queryClient = useQueryClient();
  const [fondo, setFondo] = useState("500");
  const [error, setError] = useState<string | null>(null);
  const abrir = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("fn_pv_abrir_turno", { p_empresa: empresaId, p_fondo: Number(fondo) || 0 });
      if (e) throw e;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pv-turno"] }),
    onError: (e) => setError((e as Error).message),
  });
  return (
    <div className="mx-auto max-w-sm rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-base font-semibold text-slate-800">Abrir caja</h3>
      <p className="mt-1 text-xs text-slate-500">Cuenta el efectivo con el que arranca la caja (fondo para cambio).</p>
      <label className="mt-3 block text-sm">
        Fondo inicial
        <input type="number" min="0" step="0.01" value={fondo} onChange={(e) => setFondo(e.target.value)} className={campo} autoFocus />
      </label>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <button type="button" disabled={abrir.isPending} onClick={() => abrir.mutate()} className={`${botonPrimario} mt-3 w-full py-2.5`}>
        {abrir.isPending ? "Abriendo…" : "Abrir caja"}
      </button>
    </div>
  );
}

/** Corte de caja del turno abierto y turnos anteriores. */
export function Caja({ empresaId, turno }: { empresaId: string; turno: Turno | null }) {
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<"retiro" | "ingreso">("retiro");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [contado, setContado] = useState("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: historial = [] } = useQuery({
    queryKey: ["pv-turnos", empresaId],
    queryFn: async () => {
      let q = supabase.from("v_pv_turnos").select("*").order("abierto_en", { ascending: false }).limit(30);
      if (empresaId) q = q.eq("empresa_id", empresaId);
      const { data, error: e } = await q;
      if (e) throw e;
      return (data ?? []) as Turno[];
    },
  });
  const refrescar = () => {
    queryClient.invalidateQueries({ queryKey: ["pv-turno"] });
    queryClient.invalidateQueries({ queryKey: ["pv-turnos"] });
  };
  const movimiento = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("fn_pv_caja_movimiento", { p_turno: turno!.id, p_tipo: tipo, p_monto: Number(monto), p_motivo: motivo });
      if (e) throw e;
    },
    onSuccess: () => {
      setMonto("");
      setMotivo("");
      refrescar();
    },
    onError: (e) => setError((e as Error).message),
  });
  const cerrar = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.rpc("fn_pv_cerrar_turno", { p_turno: turno!.id, p_contado: Number(contado), p_notas: notas || null });
      if (e) throw e;
    },
    onSuccess: () => {
      setContado("");
      setNotas("");
      refrescar();
    },
    onError: (e) => setError((e as Error).message),
  });
  const corte = turno ? corteCaja(turno, contado === "" ? null : Number(contado)) : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {turno ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-base font-semibold text-slate-800">Caja abierta · {fechaHora(turno.abierto_en)}</h3>
          <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
            <dt>Fondo inicial</dt>
            <dd className="text-right">{dinero(turno.fondo_inicial)}</dd>
            <dt>Ventas en efectivo</dt>
            <dd className="text-right">{dinero(turno.efectivo)}</dd>
            <dt>Ingresos</dt>
            <dd className="text-right">{dinero(turno.ingresos)}</dd>
            <dt>Retiros</dt>
            <dd className="text-right">−{dinero(turno.retiros)}</dd>
            <dt className="font-semibold">Efectivo esperado</dt>
            <dd className="text-right font-semibold">{dinero(corte?.esperado)}</dd>
            <dt className="text-slate-500">Tarjeta</dt>
            <dd className="text-right text-slate-500">{dinero(turno.tarjeta)}</dd>
            <dt className="text-slate-500">Transferencia</dt>
            <dd className="text-right text-slate-500">{dinero(turno.transferencia)}</dd>
            <dt className="text-slate-500">A crédito</dt>
            <dd className="text-right text-slate-500">{dinero(turno.credito)}</dd>
            <dt className="text-slate-500">Ventas</dt>
            <dd className="text-right text-slate-500">
              {turno.ventas} {turno.canceladas ? `(${turno.canceladas} canceladas)` : ""}
            </dd>
          </dl>
          <div className="mt-4 border-t border-slate-100 pt-3">
            <h4 className="text-xs font-semibold uppercase text-slate-500">Retiro o ingreso de efectivo</h4>
            <div className="mt-1 flex flex-wrap gap-2">
              <select value={tipo} onChange={(e) => setTipo(e.target.value as "retiro" | "ingreso")} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
                <option value="retiro">Retiro</option>
                <option value="ingreso">Ingreso</option>
              </select>
              <input type="number" min="0" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="Monto" className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm" />
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" className="min-w-[140px] flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
              <button type="button" disabled={!monto || !motivo || movimiento.isPending} onClick={() => movimiento.mutate()} className={botonSecundario}>
                Registrar
              </button>
            </div>
          </div>
          <div className="mt-4 border-t border-slate-100 pt-3">
            <h4 className="text-xs font-semibold uppercase text-slate-500">Corte y cierre</h4>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input type="number" min="0" step="0.01" value={contado} onChange={(e) => setContado(e.target.value)} placeholder="Efectivo contado" className="w-40 rounded border border-slate-300 px-2 py-1.5 text-sm" />
              {corte?.diferencia != null && (
                <span className={`text-sm font-semibold ${corte.diferencia === 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {corte.diferencia === 0 ? "Cuadra" : corte.diferencia > 0 ? `Sobran ${dinero(corte.diferencia)}` : `Faltan ${dinero(-corte.diferencia)}`}
                </span>
              )}
            </div>
            <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Notas del corte (opcional)" className={`${campo} mt-2`} />
            <button type="button" disabled={contado === "" || cerrar.isPending} onClick={() => window.confirm("¿Cerrar la caja con este corte?") && cerrar.mutate()} className={`${botonPrimario} mt-2`}>
              Cerrar caja
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      ) : (
        <AbrirCaja empresaId={empresaId} />
      )}
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Cortes de caja</h3>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-2 py-1.5">Apertura</th>
                <th className="px-2 py-1.5">Cajero</th>
                <th className="px-2 py-1.5 text-right">Ventas</th>
                <th className="px-2 py-1.5 text-right">Esperado</th>
                <th className="px-2 py-1.5 text-right">Contado</th>
                <th className="px-2 py-1.5 text-right">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((t) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="px-2 py-1">{fechaHora(t.abierto_en)}</td>
                  <td className="px-2 py-1">{t.abierto_por_nombre}</td>
                  <td className="px-2 py-1 text-right">{t.ventas}</td>
                  <td className="px-2 py-1 text-right">{dinero(t.efectivo_esperado)}</td>
                  <td className="px-2 py-1 text-right">{t.cerrado_en ? dinero(t.efectivo_contado) : "abierta"}</td>
                  <td className={`px-2 py-1 text-right ${t.diferencia != null && Number(t.diferencia) !== 0 ? "font-semibold text-red-700" : ""}`}>{t.diferencia == null ? "—" : dinero(t.diferencia)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
