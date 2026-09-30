import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { moneda } from "../../lib/saldosEmpresas";
import { abrirParaImprimir, abrirVentanaImpresion, cerrarVentanaImpresion } from "../../lib/imprimir";
import {
  ETIQUETA_TIPO_DIRECTO,
  importeDirecto,
  importePartida,
  leerPresupuestoPegado,
  porcentajeTabulador,
  resumenCosteo,
  type CostoDirecto,
  type CosteoContrato,
  type PartidaPresupuesto,
  type RealObra,
  type RenglonTabulador,
  type TipoDirecto,
} from "../../lib/costeoObra";
import { htmlReporteObra, type OcReporte } from "../../lib/reporteObra";
import type { Proyecto, ProyectoPlano } from "../../types/database";

const campo = "w-full rounded border border-slate-300 px-2 py-1 text-sm";
const etiqueta = "mb-0.5 block text-xs font-medium text-slate-600";
const VACIO: CosteoContrato = {
  folio_contrato: null,
  fecha_inicio: null,
  fecha_fin: null,
  subtotal: null,
  iva: null,
  m2: null,
  ubicacion: null,
  latitud: null,
  longitud: null,
  km: null,
  plano_id: null,
  indirectos_pct: null,
  notas: null,
};

type Proy = Proyecto & { empresas: { nombre: string } | null };

function useCosteo(proyecto: Proy) {
  const { perfil } = useAuth();
  return useQuery({
    queryKey: ["costeo-obra", proyecto.id],
    queryFn: async () => {
      const [c, pres, dir, imss, tab, planos, ocs] = await Promise.all([
        supabase.from("proyecto_costeo").select("*").eq("proyecto_id", proyecto.id).maybeSingle(),
        supabase.from("proyecto_presupuesto_cliente").select("*").eq("proyecto_id", proyecto.id).order("orden"),
        supabase.from("proyecto_costeo_directos").select("*").eq("proyecto_id", proyecto.id).order("tipo").order("created_at"),
        supabase.from("proyecto_costeo_imss").select("monto, capturado_por_nombre, capturado_en").eq("proyecto_id", proyecto.id).maybeSingle(),
        supabase.from("indirectos_tabulador").select("id, km_hasta, porcentaje").eq("grupo_id", perfil?.grupo_id ?? "").order("km_hasta"),
        supabase.from("proyecto_planos").select("id, nombre_original").eq("proyecto_id", proyecto.id).order("created_at"),
        supabase
          .from("v_oc_pagos")
          .select("id, id_orden, fecha_creacion, proveedor, subtotal, total, estatus_backoffice, pagado, pagada_backoffice, empresa_id, autorizacion")
          .ilike("proyecto", proyecto.nombre)
          .order("fecha_creacion"),
      ]);
      for (const r of [c, pres, dir, imss, tab, planos, ocs]) if (r.error) throw r.error;
      const ocIds = (ocs.data ?? []).map((o) => o.id);
      const [lineas, empresas] = await Promise.all([
        ocIds.length ? supabase.from("ordenes_compra_lineas").select("orden_compra_id, item").in("orden_compra_id", ocIds) : Promise.resolve({ data: [], error: null }),
        supabase.from("empresas").select("id, codigo"),
      ]);
      const conceptos = new Map<string, string[]>();
      for (const l of (lineas.data ?? []) as { orden_compra_id: string; item: string }[]) conceptos.set(l.orden_compra_id, [...(conceptos.get(l.orden_compra_id) ?? []), l.item]);
      const codigo = new Map((empresas.data ?? []).map((e) => [e.id, e.codigo as string]));
      const vigentes = (ocs.data ?? []).filter((o) => o.autorizacion !== "rechazada");
      const listaOc: OcReporte[] = vigentes.map((o) => ({
        id_orden: o.id_orden,
        fecha: o.fecha_creacion,
        empresa: codigo.get(o.empresa_id) ?? "",
        proveedor: o.proveedor,
        concepto: (conceptos.get(o.id) ?? []).join("; "),
        total: Number(o.total),
        estatus: o.estatus_backoffice,
        pagado: o.pagada_backoffice ? Number(o.total) : Number(o.pagado),
      }));
      const real: RealObra = {
        n_oc: vigentes.length,
        subtotal: vigentes.reduce((s, o) => s + Number(o.subtotal ?? 0), 0),
        total: vigentes.reduce((s, o) => s + Number(o.total ?? 0), 0),
        pagado: listaOc.reduce((s, o) => s + o.pagado, 0),
      };
      return {
        contrato: (c.data as CosteoContrato | null) ?? null,
        presupuesto: (pres.data ?? []) as PartidaPresupuesto[],
        directos: (dir.data ?? []) as CostoDirecto[],
        imss: imss.data as { monto: number; capturado_por_nombre: string | null; capturado_en: string } | null,
        tabulador: (tab.data ?? []) as (RenglonTabulador & { id: string })[],
        planos: (planos.data ?? []) as Pick<ProyectoPlano, "id" | "nombre_original">[],
        ocs: listaOc,
        real,
      };
    },
  });
}

/** Costeo y pronóstico de la obra: solo el director general (Mario,
 * 30-sep-2026). Modelo para las obras de Abarrotes Neto. */
export function CosteoObra({ proyecto }: { proyecto: Proy }) {
  const { perfil } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useCosteo(proyecto);
  const [aviso, setAviso] = useState<string | null>(null);
  const refrescar = () => queryClient.invalidateQueries({ queryKey: ["costeo-obra", proyecto.id] });
  const falla = (e: unknown) => setAviso((e as Error).message);

  const resumen = useMemo(
    () => (data ? resumenCosteo(data.contrato, data.presupuesto, data.directos, data.imss ? Number(data.imss.monto) : null, data.tabulador, data.real) : null),
    [data],
  );

  const imprimir = () => {
    if (!data || !resumen) return;
    const ventana = abrirVentanaImpresion();
    const html = htmlReporteObra({
      obra: proyecto.nombre,
      empresa: proyecto.empresas?.nombre ?? "",
      cliente: proyecto.cliente ?? null,
      responsable: proyecto.responsable_nombre ?? null,
      plano: data.planos.find((p) => p.id === data.contrato?.plano_id)?.nombre_original ?? null,
      fechaCorte: new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10),
      contrato: data.contrato,
      presupuesto: data.presupuesto,
      directos: data.directos,
      imss: data.imss ? { monto: Number(data.imss.monto), por: data.imss.capturado_por_nombre, en: data.imss.capturado_en } : null,
      resumen,
      real: data.real,
      ocs: data.ocs,
    });
    if (!abrirParaImprimir(html, ventana)) {
      cerrarVentanaImpresion(ventana);
      setAviso("El navegador bloqueó la ventana. Permite ventanas emergentes.");
    }
  };

  if (perfil?.rol !== "admin") return <p className="text-sm text-slate-500">Solo el director general ve el costeo.</p>;
  if (isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (error || !data || !resumen) return <p className="text-sm text-red-600">No se pudo cargar el costeo: {(error as Error)?.message}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Confidencial: solo tú lo ves. Contabilidad solo captura el seguro social.</p>
        <button type="button" onClick={imprimir} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
          Reporte de obra (imprimir / PDF)
        </button>
      </div>
      {aviso && <p className="text-sm text-slate-700">{aviso}</p>}

      <Tarjetas resumen={resumen} />
      {resumen.alertas.length > 0 && (
        <ul className="space-y-1">
          {resumen.alertas.map((a) => (
            <li key={a} className="rounded border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
              {a}
            </li>
          ))}
        </ul>
      )}

      <Contrato proyectoId={proyecto.id} inicial={data.contrato} planos={data.planos} tabulador={data.tabulador} onGuardado={refrescar} onError={falla} />
      <Presupuesto proyectoId={proyecto.id} partidas={data.presupuesto} total={resumen.presupuestoCliente} onCambio={refrescar} onError={falla} />
      <Directos proyectoId={proyecto.id} directos={data.directos} resumen={resumen} imss={data.imss} onCambio={refrescar} onError={falla} />
      <Tabulador grupoId={perfil.grupo_id ?? null} renglones={data.tabulador} onCambio={refrescar} onError={falla} />

      <section>
        <h3 className="mb-1 text-sm font-semibold text-slate-800">
          Real a la fecha: {data.real.n_oc} OC · {moneda(data.real.total)} con IVA · pagado {moneda(data.real.pagado)}
        </h3>
        <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white text-xs">
          {data.ocs.map((o) => (
            <li key={o.id_orden} className="flex flex-wrap gap-2 px-3 py-1.5">
              <span className="font-mono">{o.id_orden}</span>
              <span>{o.fecha}</span>
              <span className="text-slate-500">{o.empresa}</span>
              <span className="font-medium">{o.proveedor}</span>
              <span className="text-slate-600">{o.concepto}</span>
              <span className="ml-auto tabular-nums">{moneda(o.total)}</span>
              <span className="text-slate-500">{o.estatus}</span>
            </li>
          ))}
          {data.ocs.length === 0 && <li className="px-3 py-2 text-slate-400">Sin órdenes de compra con el nombre de esta obra.</li>}
        </ul>
      </section>
    </div>
  );
}

function Tarjetas({ resumen: r }: { resumen: ReturnType<typeof resumenCosteo> }) {
  const t = [
    { e: "Contrato sin IVA", v: moneda(r.subtotal), s: `total ${moneda(r.total)}` },
    { e: "Costo total pronóstico", v: moneda(r.costoTotal), s: r.costoM2 ? `${moneda(r.costoM2)} por m²` : "" },
    { e: "Utilidad pronóstico", v: moneda(r.utilidad), s: r.margenPct != null ? `${r.margenPct.toFixed(1)} % de margen` : "", color: r.utilidad < 0 ? "text-red-700" : "text-emerald-700" },
    { e: "Indirectos", v: `${r.pctIndirectos.toFixed(1)} %`, s: r.origenIndirectos === "propio" ? "fijado por ti" : r.origenIndirectos === "tabulador" ? "del tabulador por km" : "sin definir" },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-4">
      {t.map((x) => (
        <div key={x.e} className="rounded border border-slate-200 bg-white px-3 py-2">
          <div className="text-xs text-slate-500">{x.e}</div>
          <div className={`text-lg font-semibold tabular-nums ${x.color ?? "text-slate-900"}`}>{x.v}</div>
          <div className="text-xs text-slate-500">{x.s}</div>
        </div>
      ))}
    </div>
  );
}

function Contrato({
  proyectoId,
  inicial,
  planos,
  tabulador,
  onGuardado,
  onError,
}: {
  proyectoId: string;
  inicial: CosteoContrato | null;
  planos: Pick<ProyectoPlano, "id" | "nombre_original">[];
  tabulador: RenglonTabulador[];
  onGuardado: () => void;
  onError: (e: unknown) => void;
}) {
  const [f, setF] = useState<CosteoContrato>({ ...VACIO, ...(inicial ?? {}) });
  const set = (k: keyof CosteoContrato, v: string) => {
    const numericos: (keyof CosteoContrato)[] = ["subtotal", "iva", "m2", "latitud", "longitud", "km", "indirectos_pct"];
    setF({ ...f, [k]: v === "" ? null : numericos.includes(k) ? Number(v) : v });
  };
  const guardar = useMutation({
    mutationFn: async () => {
      const { data: s } = await supabase.auth.getSession();
      const { error } = await supabase.from("proyecto_costeo").upsert({ ...f, proyecto_id: proyectoId, updated_by: s.session?.user.id, updated_at: new Date().toISOString() }, { onConflict: "proyecto_id" });
      if (error) throw error;
    },
    onSuccess: onGuardado,
    onError,
  });
  const sugerido = porcentajeTabulador(f.km, tabulador);
  const input = (k: keyof CosteoContrato, tipo = "text", paso?: string) => (
    <input type={tipo} step={paso} value={(f[k] as string | number | null) ?? ""} onChange={(e) => set(k, e.target.value)} className={campo} />
  );

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">1. Contrato u orden de compra del cliente</h3>
      <div className="grid gap-3 rounded border border-slate-200 bg-white p-3 sm:grid-cols-4">
        <label>
          <span className={etiqueta}>Folio del contrato / OC</span>
          {input("folio_contrato")}
        </label>
        <label>
          <span className={etiqueta}>Inicio</span>
          {input("fecha_inicio", "date")}
        </label>
        <label>
          <span className={etiqueta}>Fin</span>
          {input("fecha_fin", "date")}
        </label>
        <label>
          <span className={etiqueta}>m² de la sucursal</span>
          {input("m2", "number", "0.01")}
        </label>
        <label>
          <span className={etiqueta}>Monto antes de IVA</span>
          {input("subtotal", "number", "0.01")}
        </label>
        <label>
          <span className={etiqueta}>
            IVA{" "}
            {f.subtotal ? (
              <button type="button" onClick={() => setF({ ...f, iva: Math.round(Number(f.subtotal) * 16) / 100 })} className="text-slate-500 underline">
                16 %
              </button>
            ) : null}
          </span>
          {input("iva", "number", "0.01")}
        </label>
        <div>
          <span className={etiqueta}>Total</span>
          <div className="py-1 text-sm font-medium tabular-nums">{moneda(Number(f.subtotal ?? 0) + Number(f.iva ?? 0))}</div>
        </div>
        <label>
          <span className={etiqueta}>Plano de ubicación</span>
          <select value={f.plano_id ?? ""} onChange={(e) => set("plano_id", e.target.value)} className={campo}>
            <option value="">{planos.length ? "Elige un plano" : "Sube el plano en la pestaña Planos"}</option>
            {planos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre_original}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className={etiqueta}>Ubicación (dirección)</span>
          {input("ubicacion")}
        </label>
        <label>
          <span className={etiqueta}>Latitud</span>
          {input("latitud", "number", "0.000001")}
        </label>
        <label>
          <span className={etiqueta}>Longitud</span>
          {input("longitud", "number", "0.000001")}
        </label>
        <label>
          <span className={etiqueta}>Km de la oficina a la obra</span>
          {input("km", "number", "0.1")}
        </label>
        <label>
          <span className={etiqueta}>% de indirectos (vacío = tabulador{sugerido != null ? `: ${sugerido} %` : ""})</span>
          {input("indirectos_pct", "number", "0.01")}
        </label>
        <label className="sm:col-span-2">
          <span className={etiqueta}>Notas</span>
          {input("notas")}
        </label>
        <div className="flex items-end gap-3 sm:col-span-4">
          <button type="button" onClick={() => guardar.mutate()} disabled={guardar.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {guardar.isPending ? "Guardando…" : "Guardar contrato"}
          </button>
          {f.latitud != null && f.longitud != null && (
            <a href={`https://www.google.com/maps?q=${f.latitud},${f.longitud}`} target="_blank" rel="noreferrer" className="text-sm text-slate-600 underline">
              Ver en el mapa
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

function Presupuesto({ proyectoId, partidas, total, onCambio, onError }: { proyectoId: string; partidas: PartidaPresupuesto[]; total: number; onCambio: () => void; onError: (e: unknown) => void }) {
  const [pegado, setPegado] = useState("");
  const leidas = useMemo(() => leerPresupuestoPegado(pegado), [pegado]);
  const cargar = useMutation({
    mutationFn: async (reemplazar: boolean) => {
      if (leidas.length === 0) throw new Error("No se reconoció ninguna partida. Copia desde Excel las columnas clave, concepto, unidad, cantidad y P.U.");
      if (reemplazar) {
        if (!window.confirm(`¿Reemplazar las ${partidas.length} partidas actuales por ${leidas.length}?`)) return;
        const { error } = await supabase.from("proyecto_presupuesto_cliente").delete().eq("proyecto_id", proyectoId);
        if (error) throw error;
      }
      const base = reemplazar ? 0 : partidas.length;
      const { error } = await supabase.from("proyecto_presupuesto_cliente").insert(leidas.map((p, i) => ({ ...p, orden: base + i + 1, proyecto_id: proyectoId })));
      if (error) throw error;
      setPegado("");
    },
    onSuccess: onCambio,
    onError,
  });
  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("proyecto_presupuesto_cliente").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: onCambio,
    onError,
  });

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">2. Presupuesto original del cliente · {moneda(total)}</h3>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1.5">Clave</th>
              <th className="px-2 py-1.5">Concepto</th>
              <th className="px-2 py-1.5">Unidad</th>
              <th className="px-2 py-1.5 text-right">Cantidad</th>
              <th className="px-2 py-1.5 text-right">P.U.</th>
              <th className="px-2 py-1.5 text-right">Importe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {partidas.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-2 py-1">{p.clave}</td>
                <td className="px-2 py-1">{p.concepto}</td>
                <td className="px-2 py-1">{p.unidad}</td>
                <td className="px-2 py-1 text-right tabular-nums">{Number(p.cantidad).toLocaleString("es-MX")}</td>
                <td className="px-2 py-1 text-right tabular-nums">{moneda(Number(p.precio_unitario))}</td>
                <td className="px-2 py-1 text-right tabular-nums">{moneda(importePartida(p))}</td>
                <td className="px-2 py-1 text-right">
                  <button type="button" onClick={() => p.id && quitar.mutate(p.id)} className="text-red-600 underline">
                    quitar
                  </button>
                </td>
              </tr>
            ))}
            {partidas.length === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-3 text-center text-slate-400">
                  Sin presupuesto. Pégalo abajo desde Excel.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <textarea
        value={pegado}
        onChange={(e) => setPegado(e.target.value)}
        rows={4}
        placeholder="Copia en Excel las columnas Clave · Concepto · Unidad · Cantidad · P.U. (o sin clave) y pégalas aquí."
        className="mt-2 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
      />
      {pegado && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span>
            {leidas.length} partidas reconocidas · {moneda(leidas.reduce((s, p) => s + importePartida(p), 0))}
          </span>
          <button type="button" onClick={() => cargar.mutate(false)} className="rounded bg-slate-900 px-2.5 py-1 font-medium text-white">
            Agregar
          </button>
          {partidas.length > 0 && (
            <button type="button" onClick={() => cargar.mutate(true)} className="rounded border border-slate-300 px-2.5 py-1">
              Reemplazar todo
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Directos({
  proyectoId,
  directos,
  resumen,
  imss,
  onCambio,
  onError,
}: {
  proyectoId: string;
  directos: CostoDirecto[];
  resumen: ReturnType<typeof resumenCosteo>;
  imss: { monto: number; capturado_por_nombre: string | null; capturado_en: string } | null;
  onCambio: () => void;
  onError: (e: unknown) => void;
}) {
  const [n, setN] = useState({ tipo: "contratista" as TipoDirecto, nombre: "", especialidad: "", cantidad: "1", unidad: "", costo: "" });
  const agregar = useMutation({
    mutationFn: async () => {
      if (!n.nombre.trim()) throw new Error("Escribe el nombre del contratista, persona o concepto.");
      const { error } = await supabase.from("proyecto_costeo_directos").insert({
        proyecto_id: proyectoId,
        tipo: n.tipo,
        nombre: n.nombre.trim(),
        especialidad: n.especialidad.trim() || null,
        cantidad: Number(n.cantidad || 0),
        unidad: n.unidad.trim() || null,
        costo_unitario: Number(n.costo || 0),
      });
      if (error) throw error;
      setN({ ...n, nombre: "", especialidad: "", cantidad: "1", costo: "" });
    },
    onSuccess: onCambio,
    onError,
  });
  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("proyecto_costeo_directos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: onCambio,
    onError,
  });

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">3. Contratistas, personal asignado y costeo</h3>
      <div className="overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left uppercase text-slate-500">
            <tr>
              <th className="px-2 py-1.5">Tipo</th>
              <th className="px-2 py-1.5">Nombre / concepto</th>
              <th className="px-2 py-1.5">Especialidad</th>
              <th className="px-2 py-1.5 text-right">Cantidad</th>
              <th className="px-2 py-1.5 text-right">Costo unitario</th>
              <th className="px-2 py-1.5 text-right">Importe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {directos.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="px-2 py-1 text-slate-500">{ETIQUETA_TIPO_DIRECTO[d.tipo]}</td>
                <td className="px-2 py-1 font-medium">{d.nombre}</td>
                <td className="px-2 py-1">{d.especialidad}</td>
                <td className="px-2 py-1 text-right tabular-nums">
                  {d.cantidad} {d.unidad}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{moneda(Number(d.costo_unitario))}</td>
                <td className="px-2 py-1 text-right tabular-nums">{moneda(importeDirecto(d))}</td>
                <td className="px-2 py-1 text-right">
                  <button type="button" onClick={() => d.id && quitar.mutate(d.id)} className="text-red-600 underline">
                    quitar
                  </button>
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 font-medium">
              <td colSpan={5} className="px-2 py-1">
                Costo directo
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{moneda(resumen.directos)}</td>
              <td />
            </tr>
            <tr>
              <td colSpan={5} className="px-2 py-1">
                Seguro social {imss ? `(capturó ${imss.capturado_por_nombre ?? "contabilidad"} el ${imss.capturado_en.slice(0, 10)})` : "(pendiente: lo captura contabilidad)"}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{moneda(resumen.imss)}</td>
              <td />
            </tr>
            <tr>
              <td colSpan={5} className="px-2 py-1">
                Indirectos {resumen.pctIndirectos.toFixed(1)} % sobre costo directo + seguro social
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{moneda(resumen.indirectos)}</td>
              <td />
            </tr>
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td colSpan={5} className="px-2 py-1">
                Utilidad pronóstico (contrato sin IVA − costo total)
              </td>
              <td className={`px-2 py-1 text-right tabular-nums ${resumen.utilidad < 0 ? "text-red-700" : "text-emerald-700"}`}>{moneda(resumen.utilidad)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          agregar.mutate();
        }}
        className="mt-2 flex flex-wrap items-center gap-2 text-xs"
      >
        <select value={n.tipo} onChange={(e) => setN({ ...n, tipo: e.target.value as TipoDirecto })} className="rounded border border-slate-300 px-2 py-1">
          {(Object.keys(ETIQUETA_TIPO_DIRECTO) as TipoDirecto[]).map((t) => (
            <option key={t} value={t}>
              {ETIQUETA_TIPO_DIRECTO[t]}
            </option>
          ))}
        </select>
        <input value={n.nombre} onChange={(e) => setN({ ...n, nombre: e.target.value })} placeholder="Nombre o concepto" className="rounded border border-slate-300 px-2 py-1" />
        <input value={n.especialidad} onChange={(e) => setN({ ...n, especialidad: e.target.value })} placeholder="Especialidad / puesto" className="rounded border border-slate-300 px-2 py-1" />
        <input type="number" min="0" step="0.01" value={n.cantidad} onChange={(e) => setN({ ...n, cantidad: e.target.value })} className="w-20 rounded border border-slate-300 px-2 py-1" aria-label="Cantidad" />
        <input value={n.unidad} onChange={(e) => setN({ ...n, unidad: e.target.value })} placeholder="semanas, obra, m²…" className="w-28 rounded border border-slate-300 px-2 py-1" />
        <input type="number" min="0" step="0.01" value={n.costo} onChange={(e) => setN({ ...n, costo: e.target.value })} placeholder="Costo unitario" className="w-28 rounded border border-slate-300 px-2 py-1" />
        <button type="submit" disabled={agregar.isPending} className="rounded bg-slate-900 px-2.5 py-1 font-medium text-white disabled:opacity-50">
          Agregar
        </button>
      </form>
    </section>
  );
}

function Tabulador({ grupoId, renglones, onCambio, onError }: { grupoId: string | null; renglones: (RenglonTabulador & { id: string })[]; onCambio: () => void; onError: (e: unknown) => void }) {
  const [km, setKm] = useState("");
  const [p, setP] = useState("");
  const agregar = useMutation({
    mutationFn: async () => {
      if (!grupoId) throw new Error("Tu cuenta no tiene organización.");
      if (!(Number(km) > 0) || p === "") throw new Error("Captura hasta cuántos km y el porcentaje.");
      const { error } = await supabase.from("indirectos_tabulador").upsert({ grupo_id: grupoId, km_hasta: Number(km), porcentaje: Number(p) }, { onConflict: "grupo_id,km_hasta" });
      if (error) throw error;
      setKm("");
      setP("");
    },
    onSuccess: onCambio,
    onError,
  });
  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("indirectos_tabulador").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: onCambio,
    onError,
  });
  let desde = 0;
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-slate-800">Tabulador de indirectos por distancia (para todas las obras)</h3>
      <p className="mb-2 text-xs text-slate-500">Cada obra toma el % del tramo de sus km, salvo que fijes un % propio en el contrato.</p>
      <ul className="mb-2 flex flex-wrap gap-2 text-xs">
        {renglones.map((r) => {
          const texto = `${desde} a ${r.km_hasta} km: ${r.porcentaje} %`;
          desde = Number(r.km_hasta);
          return (
            <li key={r.id} className="rounded border border-slate-200 bg-white px-2 py-1">
              {texto}{" "}
              <button type="button" onClick={() => quitar.mutate(r.id)} className="ml-1 text-red-600">
                ×
              </button>
            </li>
          );
        })}
        {renglones.length === 0 && <li className="text-slate-400">Sin tramos todavía.</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        Hasta
        <input type="number" min="1" value={km} onChange={(e) => setKm(e.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1" aria-label="Hasta km" />
        km →
        <input type="number" min="0" step="0.1" value={p} onChange={(e) => setP(e.target.value)} className="w-20 rounded border border-slate-300 px-2 py-1" aria-label="Porcentaje" />%
        <button type="button" onClick={() => agregar.mutate()} className="rounded bg-slate-900 px-2.5 py-1 font-medium text-white">
          Guardar tramo
        </button>
      </div>
    </section>
  );
}
