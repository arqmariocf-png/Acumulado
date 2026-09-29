import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

export interface DatosBancarios {
  clave: string | null;
  nombre: string | null;
  beneficiario_bancario?: string | null;
  banco_proveedor?: string | null;
  clabe?: string | null;
  cuenta_proveedor?: string | null;
  rfc_proveedor?: string | null;
  correo_proveedor?: string | null;
}

const campo = "rounded border border-slate-300 px-2 py-1 text-xs";

/** Datos bancarios del proveedor (beneficiario, banco, CLABE, cuenta, RFC,
 * correo) para que tesorería pague sin buscar en otro lado (Delia,
 * 29-sep-2026). Se guardan por clave de proveedor (fn_proveedor_clave), la
 * misma de líneas de crédito. Nunca datos de tarjeta. */
export function DatosBancariosProveedor({ datos, compacto = false }: { datos: DatosBancarios; compacto?: boolean }) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const puedeEditar = perfil?.rol === "admin" || perfil?.rol === "corporativo" || perfil?.rol === "direccion";
  const [editando, setEditando] = useState(false);
  const [beneficiario, setBeneficiario] = useState(datos.beneficiario_bancario ?? datos.nombre ?? "");
  const [banco, setBanco] = useState(datos.banco_proveedor ?? "");
  const [clabe, setClabe] = useState(datos.clabe ?? "");
  const [cuenta, setCuenta] = useState(datos.cuenta_proveedor ?? "");
  const [rfc, setRfc] = useState(datos.rfc_proveedor ?? "");
  const [correo, setCorreo] = useState(datos.correo_proveedor ?? "");
  const [error, setError] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: async () => {
      if (!datos.clave) throw new Error("Este proveedor no tiene nombre; no se puede guardar.");
      const clabeLimpia = clabe.replace(/\s/g, "");
      if (clabeLimpia && !/^\d{18}$/.test(clabeLimpia)) throw new Error("La CLABE debe tener 18 dígitos.");
      const { error: err } = await supabase.from("proveedores_datos_bancarios").upsert(
        { clave: datos.clave, nombre: datos.nombre ?? datos.clave, beneficiario: beneficiario.trim() || null, banco: banco.trim() || null, clabe: clabeLimpia || null, cuenta: cuenta.trim() || null, rfc: rfc.trim().toUpperCase() || null, correo: correo.trim() || null, origen: "captura", updated_by: perfil?.id, updated_at: new Date().toISOString() },
        { onConflict: "clave" },
      );
      if (err) throw err;
    },
    onSuccess: () => {
      setEditando(false);
      setError(null);
      for (const k of [["oc-pagos"], ["pagos-programados"], ["tesoreria"], ["cxp-proveedores"]]) queryClient.invalidateQueries({ queryKey: k });
    },
    onError: (e: Error) => setError(e.message),
  });

  const tiene = !!(datos.clabe || datos.cuenta_proveedor || datos.banco_proveedor);

  if (!editando) {
    return (
      <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 ${compacto ? "text-[11px]" : "text-xs"} text-slate-600`}>
        {tiene ? (
          <>
            {datos.banco_proveedor && <span>{datos.banco_proveedor}</span>}
            {datos.clabe && <span className="font-mono">CLABE {datos.clabe}</span>}
            {datos.cuenta_proveedor && <span className="font-mono">cta {datos.cuenta_proveedor}</span>}
            {datos.beneficiario_bancario && datos.beneficiario_bancario !== datos.nombre && <span>a nombre de {datos.beneficiario_bancario}</span>}
          </>
        ) : (
          <span className="text-slate-400">sin datos bancarios</span>
        )}
        {puedeEditar && datos.clave && (
          <button type="button" onClick={() => setEditando(true)} className="text-slate-500 underline">
            {tiene ? "editar" : "capturar"}
          </button>
        )}
      </span>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        guardar.mutate();
      }}
      className="mt-1 flex flex-wrap items-end gap-2 rounded border border-slate-200 bg-slate-50 p-2"
    >
      <label className="text-[11px] text-slate-500">
        Beneficiario
        <input value={beneficiario} onChange={(e) => setBeneficiario(e.target.value)} className={`${campo} block w-48`} />
      </label>
      <label className="text-[11px] text-slate-500">
        Banco
        <input value={banco} onChange={(e) => setBanco(e.target.value)} className={`${campo} block w-28`} />
      </label>
      <label className="text-[11px] text-slate-500">
        CLABE (18 dígitos)
        <input value={clabe} onChange={(e) => setClabe(e.target.value)} inputMode="numeric" className={`${campo} block w-44 font-mono`} />
      </label>
      <label className="text-[11px] text-slate-500">
        Cuenta
        <input value={cuenta} onChange={(e) => setCuenta(e.target.value)} className={`${campo} block w-32 font-mono`} />
      </label>
      <label className="text-[11px] text-slate-500">
        RFC
        <input value={rfc} onChange={(e) => setRfc(e.target.value)} className={`${campo} block w-32 uppercase`} />
      </label>
      <label className="text-[11px] text-slate-500">
        Correo
        <input value={correo} onChange={(e) => setCorreo(e.target.value)} type="email" className={`${campo} block w-44`} />
      </label>
      <button type="submit" disabled={guardar.isPending} className="rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
        Guardar
      </button>
      <button type="button" onClick={() => setEditando(false)} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700">
        Cancelar
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
