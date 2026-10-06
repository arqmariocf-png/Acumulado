import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { moneda } from "../../lib/saldosEmpresas";
import { deudaCxp, estadoVencimiento, filtrarYOrdenar, llaveCxp, normalizarTexto, semaforoCredito, type EstadoVencimiento, type FilaCxp } from "../../lib/cuentasPorPagar";
import { useEmpresaFiltro } from "../../lib/auth";
import { SelectorEmpresa } from "../../components/SelectorEmpresa";

const VENCE: Record<EstadoVencimiento, { punto: string; texto: string }> = {
  sin_fecha: { punto: "bg-slate-300", texto: "sin fecha" },
  vigente: { punto: "bg-emerald-500", texto: "vigente" },
  por_vencer: { punto: "bg-amber-400", texto: "por vencer" },
  vencida: { punto: "bg-red-500", texto: "vencida" },
};

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Menú de dirección (Laura): captura de la línea de crédito, días y fecha
 * de vencimiento de cada proveedor, con lo que se le debe hoy al lado. Los
 * proveedores salen de las OC y CFDI (v_cxp_empresa); la captura va a
 * proveedores_credito por empresa y clave normalizada (6-oct-2026: cada
 * empresa tiene su línea y su vencimiento, p. ej. Cemex en AEP y en ERG). */
export function LineasCredito() {
  const [texto, setTexto] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "con_linea" | "sin_linea" | "por_vencer">("todos");
  const hoy = hoyIso();
  const [empresaId, setEmpresaId] = useEmpresaFiltro();
  const { data: empresas } = useQuery({
    queryKey: ["empresas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nombre, codigo").order("nombre");
      if (error) throw error;
      return data as { id: string; nombre: string; codigo: string }[];
    },
  });
  const nombreEmpresa = useMemo(() => new Map((empresas ?? []).map((e) => [e.id, e.codigo || e.nombre])), [empresas]);

  const { data: filas, isLoading, error } = useQuery({
    queryKey: ["cxp-proveedores"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cxp_empresa").select("*");
      if (error) throw error;
      return (data ?? []) as FilaCxp[];
    },
  });

  const lista = useMemo(() => {
    const base = filtrarYOrdenar(filas ?? [], texto, empresaId, "por_pagar", false);
    return base.filter((f) => {
      const tiene = f.linea_credito != null && Number(f.linea_credito) > 0;
      if (filtro === "con_linea") return tiene;
      if (filtro === "sin_linea") return !tiene;
      if (filtro === "por_vencer") {
        const e = estadoVencimiento(f.vencimiento, hoy).estado;
        return e === "por_vencer" || e === "vencida";
      }
      return true;
    });
  }, [filas, texto, filtro, hoy, empresaId]);

  const resumen = useMemo(() => {
    const todas = (filas ?? []).filter((f) => !empresaId || f.empresa_id === empresaId);
    const con = todas.filter((f) => f.linea_credito != null && Number(f.linea_credito) > 0);
    return {
      proveedores: todas.length,
      conLinea: con.length,
      totalLineas: con.reduce((s, f) => s + Number(f.linea_credito ?? 0), 0),
      disponible: con.reduce((s, f) => s + Number(f.disponible ?? 0), 0),
      porVencer: con.filter((f) => ["por_vencer", "vencida"].includes(estadoVencimiento(f.vencimiento, hoy).estado)).length,
    };
  }, [filas, hoy, empresaId]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Líneas de crédito con proveedores</h1>
          <p className="text-sm text-slate-500">Monto, días y fecha de vencimiento de la línea de cada proveedor en cada empresa (cada empresa tiene su propia línea). Se guarda renglón por renglón.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <Link to="/finanzas/proveedores" className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-100">
            Cuentas por pagar
          </Link>
          <Link to="/finanzas/saldos" className="rounded bg-slate-900 px-4 py-1.5 font-medium text-white">
            Saldos por empresa
          </Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Dato etiqueta="Proveedores con línea" valor={`${resumen.conLinea} de ${resumen.proveedores}`} />
        <Dato etiqueta="Suma de líneas" valor={moneda(resumen.totalLineas)} />
        <Dato etiqueta="Disponible en conjunto" valor={moneda(resumen.disponible)} alerta={resumen.disponible < 0} />
        <Dato etiqueta="Vencidas o por vencer (30 días)" valor={String(resumen.porVencer)} alerta={resumen.porVencer > 0} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SelectorEmpresa value={empresaId} onChange={setEmpresaId} />
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar proveedor…" className="w-56 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <select value={filtro} onChange={(e) => setFiltro(e.target.value as typeof filtro)} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
          <option value="todos">Todos los proveedores</option>
          <option value="con_linea">Con línea capturada</option>
          <option value="sin_linea">Sin línea</option>
          <option value="por_vencer">Vencidas o por vencer</option>
        </select>
        <span className="text-xs text-slate-400">{lista.length} proveedores</span>
      </div>

      {error && <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>}
      {isLoading && <p className="text-sm text-slate-400">Cargando proveedores…</p>}

      {filas && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2 text-right">Se debe hoy</th>
                <th className="px-3 py-2 text-right">Línea (MXN)</th>
                <th className="px-3 py-2 text-right">Días</th>
                <th className="px-3 py-2">Vence el</th>
                <th className="px-3 py-2">Notas</th>
                <th className="px-3 py-2 text-right">Disponible</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.map((f) => (
                <RenglonLinea key={llaveCxp(f)} fila={f} hoy={hoy} empresa={nombreEmpresa.get(f.empresa_id) ?? ""} />
              ))}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                    Sin proveedores para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Los proveedores salen de las órdenes de compra y las facturas recibidas; los nombres que vienen distintos (con o sin razón social) se juntan en un solo renglón. Un renglón por empresa: la línea de Cemex en AEP no es la de ERG. Disponible = línea − lo que se debe (facturado sin pagar o saldo de OC, lo mayor).
      </p>
    </div>
  );
}

function Dato({ etiqueta, valor, alerta = false }: { etiqueta: string; valor: string; alerta?: boolean }) {
  return (
    <div className={`rounded border px-3 py-2 ${alerta ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] uppercase text-slate-500">{etiqueta}</p>
      <p className={`text-lg font-semibold tabular-nums ${alerta ? "text-red-700" : "text-slate-900"}`}>{valor}</p>
    </div>
  );
}

function RenglonLinea({ fila: f, hoy, empresa }: { fila: FilaCxp; hoy: string; empresa: string }) {
  const queryClient = useQueryClient();
  const [linea, setLinea] = useState(f.linea_credito != null ? String(f.linea_credito) : "");
  const [dias, setDias] = useState(f.dias_credito != null ? String(f.dias_credito) : "");
  const [vencimiento, setVencimiento] = useState(f.vencimiento ?? "");
  const [notas, setNotas] = useState(f.notas ?? "");
  const [aviso, setAviso] = useState<string | null>(null);

  const cambiado =
    normalizarTexto(linea) !== normalizarTexto(f.linea_credito != null ? String(f.linea_credito) : "") ||
    normalizarTexto(dias) !== normalizarTexto(f.dias_credito != null ? String(f.dias_credito) : "") ||
    vencimiento !== (f.vencimiento ?? "") ||
    notas.trim() !== (f.notas ?? "").trim();

  const guardar = useMutation({
    mutationFn: async () => {
      const lineaNum = linea.trim() === "" ? 0 : Number(linea.replace(/[^0-9.-]/g, ""));
      const diasNum = dias.trim() === "" ? 0 : Number(dias);
      if (!Number.isFinite(lineaNum) || lineaNum < 0) throw new Error("La línea debe ser un número mayor o igual a cero.");
      if (!Number.isInteger(diasNum) || diasNum < 0) throw new Error("Los días deben ser un entero.");
      const { error } = await supabase
        .from("proveedores_credito")
        .upsert({ empresa_id: f.empresa_id, clave: f.clave, nombre: f.proveedor, linea_credito: lineaNum, dias_credito: diasNum, vencimiento: vencimiento || null, notas: notas.trim() || null }, { onConflict: "empresa_id,clave" });
      if (error) throw error;
    },
    onSuccess: () => {
      setAviso("Guardado");
      queryClient.invalidateQueries({ queryKey: ["cxp-proveedores"] });
      setTimeout(() => setAviso(null), 2500);
    },
    onError: (e: Error) => setAviso(e.message),
  });

  const credito = semaforoCredito(deudaCxp(f), f.linea_credito);
  const vence = estadoVencimiento(f.vencimiento, hoy);
  const PUNTO = { gris: "bg-slate-300", verde: "bg-emerald-500", ambar: "bg-amber-400", rojo: "bg-red-500" } as const;

  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-3 py-2">
        <div className="font-medium text-slate-900">{f.proveedor}</div>
        <div className="text-[11px] text-slate-400">
          <span className="font-medium text-slate-600">{empresa}</span> · {f.n_oc} OC · {f.n_facturas} facturas
        </div>
      </td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums">{moneda(deudaCxp(f))}</td>
      <td className="px-3 py-2 text-right">
        <input value={linea} onChange={(e) => setLinea(e.target.value)} inputMode="decimal" placeholder="0" className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm" />
      </td>
      <td className="px-3 py-2 text-right">
        <input value={dias} onChange={(e) => setDias(e.target.value)} inputMode="numeric" placeholder="0" className="w-14 rounded border border-slate-300 px-2 py-1 text-right text-sm" />
      </td>
      <td className="px-3 py-2">
        <input type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm" />
      </td>
      <td className="px-3 py-2">
        <input value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="condiciones, contacto" className="w-40 rounded border border-slate-300 px-2 py-1 text-sm" />
      </td>
      <td className={`px-3 py-2 text-right tabular-nums ${f.disponible != null && Number(f.disponible) < 0 ? "text-red-700" : ""}`}>{f.disponible != null ? moneda(f.disponible) : <span className="text-slate-400">—</span>}</td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${PUNTO[credito.color]}`} />
          {credito.etiqueta}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${VENCE[vence.estado].punto}`} />
          {VENCE[vence.estado].texto}
          {vence.dias != null && vence.estado !== "vigente" && <span className="text-slate-400">({vence.dias < 0 ? `hace ${-vence.dias} d` : `en ${vence.dias} d`})</span>}
        </div>
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => {
            setAviso(null);
            guardar.mutate();
          }}
          disabled={guardar.isPending || !cambiado}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          {guardar.isPending ? "…" : "Guardar"}
        </button>
        {aviso && <div className={`mt-1 text-[11px] ${aviso === "Guardado" ? "text-emerald-700" : "text-red-700"}`}>{aviso}</div>}
      </td>
    </tr>
  );
}
