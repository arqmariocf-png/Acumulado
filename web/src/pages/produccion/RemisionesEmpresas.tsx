import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { RemisionProduccionModal } from "./RemisionProduccionModal";
import { RemisionesPlanta } from "./RemisionesPlanta";
import { DespieceBalken } from "./DespieceBalken";

interface EmpresaPlanta {
  id: string;
  nombre: string;
  codigo: string;
}

interface ProductoPlanta {
  id: string;
  nombre: string;
  unidad_medida: string;
}

const CLAVE_EMPRESA = "remisiones-planta-empresa";

/** Remisiones de salida de planta de todas las empresas, para quien no
 * entra a Producción (almacén y dirección; Mario, 20-nov-2026: "deja a Alma y
 * a Laura poder hacer remisiones de todas las empresas también"). Las
 * empresas que salen son las que tienen productos de producción dados de
 * alta (Clavicón, Balken, carpintería…); la remisión es la misma de la
 * planta (folio REM-<EMP>-…, membrete, QR) y para Balken está también el
 * despiece con su botón "Generar remisión de salida". */
export function RemisionesEmpresas() {
  const { perfil } = useAuth();
  const [empresaId, setEmpresaId] = useState<string>(() => {
    try {
      return localStorage.getItem(CLAVE_EMPRESA) ?? "";
    } catch {
      return "";
    }
  });
  const [remisionAbierta, setRemisionAbierta] = useState(false);
  const [verDespiece, setVerDespiece] = useState(false);

  const { data: empresas, isLoading, error } = useQuery({
    queryKey: ["remisiones-planta-empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("productos_produccion").select("empresa_id, empresas(id, nombre, codigo)").eq("activo", true);
      if (error) throw error;
      const porId = new Map<string, EmpresaPlanta>();
      for (const fila of (data ?? []) as unknown as { empresa_id: string; empresas: EmpresaPlanta | null }[]) {
        if (fila.empresas && !porId.has(fila.empresa_id)) porId.set(fila.empresa_id, fila.empresas);
      }
      return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    },
  });

  useEffect(() => {
    if (!empresas?.length) return;
    if (!empresas.some((e) => e.id === empresaId)) setEmpresaId(empresas[0].id);
  }, [empresas, empresaId]);

  useEffect(() => {
    try {
      if (empresaId) localStorage.setItem(CLAVE_EMPRESA, empresaId);
    } catch {
      /* sin almacenamiento local */
    }
  }, [empresaId]);

  const empresa = empresas?.find((e) => e.id === empresaId) ?? null;

  const { data: productos } = useQuery({
    queryKey: ["remisiones-planta-productos", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase.from("productos_produccion").select("id, nombre, unidad_medida").eq("empresa_id", empresaId).eq("activo", true).order("nombre");
      if (error) throw error;
      return (data ?? []) as ProductoPlanta[];
    },
  });

  const { data: ordenesVenta } = useQuery({
    queryKey: ["remisiones-planta-ov", empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ordenes_venta")
        .select("id, id_ov, cliente")
        .eq("empresa_id", empresaId)
        .order("fecha_ov", { ascending: false, nullsFirst: false })
        .order("id_ov", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as { id: string; id_ov: string; cliente: string | null }[];
    },
  });

  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (error) return <p className="text-sm text-red-600">No se pudieron cargar las empresas: {(error as Error).message}</p>;
  if (!empresas?.length) return <p className="text-sm text-slate-500">Ninguna empresa tiene productos de producción dados de alta.</p>;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Remisiones de planta</h1>
      <p className="mb-4 text-sm text-slate-500">
        Remisiones de salida de producto terminado de cualquier empresa del grupo (misma remisión que emite la planta, con folio y QR). La remisión no descuenta
        inventario de planta.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-700">
          <span className="mb-1 block text-xs uppercase text-slate-500">Empresa</span>
          <select
            value={empresaId}
            onChange={(e) => {
              setEmpresaId(e.target.value);
              setVerDespiece(false);
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre} ({e.codigo})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setRemisionAbierta(true)}
          disabled={!empresa || !(productos ?? []).length}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
        >
          + Nueva remisión de salida
        </button>
        {empresa?.codigo === "VBB" && (
          <button type="button" onClick={() => setVerDespiece((v) => !v)} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
            {verDespiece ? "Ocultar despiece de Balken" : "Despiece de Balken (vigueta y bovedilla)"}
          </button>
        )}
        {empresa && !(productos ?? []).length && <span className="text-xs text-amber-700">Esta empresa no tiene productos de producción activos.</span>}
      </div>

      {empresa && verDespiece && empresa.codigo === "VBB" && (
        <div className="mb-6 rounded border border-slate-200 bg-white p-3">
          <DespieceBalken empresaId={empresa.id} empresaNombre={empresa.nombre} empresaCodigo={empresa.codigo} />
        </div>
      )}

      {empresa && <RemisionesPlanta key={empresa.id} empresaId={empresa.id} tipo="salida" />}

      {remisionAbierta && empresa && (
        <RemisionProduccionModal
          empresaId={empresa.id}
          tipo="salida"
          items={(productos ?? []).map((p) => ({ id: p.id, nombre: p.nombre, unidad_medida: p.unidad_medida }))}
          referencias={(ordenesVenta ?? []).map((ov) => ({ id: ov.id, folio: `OV ${ov.id_ov}`, contraparte: ov.cliente }))}
          onCerrar={() => setRemisionAbierta(false)}
        />
      )}
      {perfil?.rol === "almacen" && (
        <p className="mt-4 text-xs text-slate-500">Las remisiones de almacén (material contra OC/OV) siguen en Almacén › Entradas y salidas.</p>
      )}
    </div>
  );
}
